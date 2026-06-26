import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import type { ChildProcess } from 'node:child_process';

import { iniciarCaptura, pararCaptura } from './audio.js';
import type { Logger } from './logger.js';

export interface Segmento {
  /** ms desde a entrada do bot na sala. */
  inicio_ms: number;
  falante: string;
  texto: string;
}

export interface ResultadoCaptura {
  texto: string;
  segmentos: Segmento[];
  /** Diagnóstico: o bot chegou a ser admitido e ligou legendas? */
  entrou: boolean;
  legendasLigadas: boolean;
  /** Caminho do WAV capturado (p/ o Whisper rodar depois), se a captura rodou. */
  wavPath?: string;
}

export interface OpcoesCaptura {
  joinUrl: string;
  displayName: string;
  headless: boolean;
  navTimeoutMs: number;
  lobbyTimeoutMs: number;
  maxDuracaoMin: number;
  ociosidadeMin: number;
  captionLang: string;
  /** Se definidos, captura o áudio da sala (monitor do sink) neste WAV. */
  wavPath?: string;
  audioSink?: string;
}

/**
 * Seletores do Teams web. SÃO VOLÁTEIS — a Microsoft muda o DOM com frequência.
 * Mantidos juntos aqui de propósito: quando a captura parar de funcionar, o ajuste
 * é quase sempre AQUI (inspecione o DOM da reunião no tenant e atualize a lista).
 * Cada campo é uma LISTA de candidatos; usamos o primeiro que casar.
 */
const SEL = {
  continuarNoNavegador: [
    '[data-tid="joinOnWeb"]',
    'button:has-text("Continuar neste navegador")',
    'button:has-text("Continue on this browser")',
  ],
  nomeInput: [
    '[data-tid="prejoin-display-name-input"]',
    'input[placeholder*="nome" i]',
    'input[placeholder*="name" i]',
  ],
  toggleMic: ['[data-tid="toggle-mute"]', 'button[aria-label*="microfone" i]'],
  toggleCam: ['[data-tid="toggle-video"]', 'button[aria-label*="câmera" i]'],
  botaoEntrar: [
    '[data-tid="prejoin-join-button"]',
    'button:has-text("Participar agora")',
    'button:has-text("Join now")',
  ],
  // Presença de QUALQUER um destes = estamos DENTRO da reunião (admitidos).
  dentroDaReuniao: [
    '[data-tid="hangup-button"]',
    '[data-tid="call-hangup"]',
    '#hangup-button',
    '[data-tid="callingButtons-showMoreBtn"]',
  ],
  // Tela de "a chamada terminou" (encerramento da reunião).
  chamadaEncerrada: [
    '[data-tid="call-ended"]',
    'text=A chamada terminou',
    'text=Your call ended',
  ],
  menuMais: ['[data-tid="callingButtons-showMoreBtn"]', 'button[aria-label*="Mais" i]'],
  itemIdiomaFala: [
    '[data-tid="appBarLanguageAndSpeech"]',
    'div[role="menuitem"]:has-text("Idioma e fala")',
    'div[role="menuitem"]:has-text("Language and speech")',
  ],
  itemLigarLegendas: [
    '#closed-captions-button',
    'div[role="menuitem"][aria-label="Legendas"]',
    '[title="Mostrar legendas ao vivo"]',
    '[data-tid="closed-caption-cc-button"]',
    'div[role="menuitem"]:has-text("Ativar legendas")',
    'div[role="menuitem"]:has-text("Turn on live captions")',
  ],
  // Configurações de legenda + combobox de idioma falado.
  settingsLegenda: [
    '[data-tid="closed-captions-settings-menu-trigger-button"]',
    '[aria-label*="Configurações da Legenda" i]',
  ],
  comboIdioma: [
    '[data-tid="callingCaptions-subtitlesLanguages"]',
    '[role="combobox"][aria-label*="idioma" i]',
  ],
  // Container e itens das legendas ao vivo.
  legendaContainer: [
    '[data-tid="closed-caption-v2-window"]',
    '[data-tid="closed-caption-renderer-wrapper"]',
    '[class*="closedCaption"]',
  ],
  legendaItem: [
    '[data-tid="closed-caption-message"]',
    '[data-tid="closed-caption-v2-virtual-list"] > *',
    '.fui-ChatMessageCompact',
  ],
  legendaAutor: ['[data-tid="author"]', '[class*="authorName"]'],
  legendaTexto: ['[data-tid="closed-caption-text"]', '[class*="captionText"]'],
};

/** Clica no primeiro seletor que existir/ficar visível. Retorna se clicou. */
async function clicarPrimeiro(
  page: Page,
  seletores: string[],
  timeoutMs = 8_000,
): Promise<boolean> {
  for (const sel of seletores) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      await loc.click({ timeout: 5_000 });
      return true;
    } catch {
      /* tenta o próximo */
    }
  }
  return false;
}

/** Aguarda QUALQUER um dos seletores ficar visível. Retorna o que apareceu (ou null). */
async function esperarAlgum(
  page: Page,
  seletores: string[],
  timeoutMs: number,
): Promise<string | null> {
  const ate = Date.now() + timeoutMs;
  while (Date.now() < ate) {
    for (const sel of seletores) {
      try {
        if (await page.locator(sel).first().isVisible()) return sel;
      } catch {
        /* ignora */
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

/**
 * Entra na reunião do Teams pelo navegador e captura as legendas ao vivo até a
 * reunião encerrar (ou bater o teto de duração/ociosidade). Não grava áudio/vídeo
 * — só raspa o texto que o Teams já transcreve (Azure Speech).
 */
export async function capturarReuniao(
  opts: OpcoesCaptura,
  logger: Logger,
): Promise<ResultadoCaptura> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let capturaProc: ChildProcess | null = null;
  const segmentos: Segmento[] = [];
  let entrou = false;
  let legendasLigadas = false;

  try {
    browser = await chromium.launch({
      headless: opts.headless,
      // PLAYWRIGHT_CHANNEL usa um navegador JÁ INSTALADO (ex.: 'msedge'/'chrome')
      // em vez do Chromium embutido — útil pra rodar local sem baixar nada. No
      // container (imagem oficial do Playwright) fica vazio → usa o Chromium da imagem.
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      // Roteia o ÁUDIO deste Chromium para o sink dedicado DESTA reunião (PULSE_SINK):
      // duas calls simultâneas não misturam o áudio no mesmo monitor. O Playwright
      // SUBSTITUI o env do browser, então espalhamos process.env p/ manter
      // PATH/DISPLAY/PULSE_RUNTIME_PATH/etc.
      env: opts.audioSink
        ? ({ ...process.env, PULSE_SINK: opts.audioSink } as Record<string, string>)
        : undefined,
      args: [
        // Concede mídia falsa para não travar no pedido de permissão de mic/câmera.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    context = await browser.newContext({
      locale: 'pt-BR',
      permissions: ['microphone', 'camera'],
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.navTimeoutMs);

    logger.info({ joinUrl: opts.joinUrl.slice(0, 80) }, 'Abrindo joinUrl');
    await page.goto(opts.joinUrl, { waitUntil: 'domcontentloaded' });

    // "Continuar neste navegador" (quando o Teams oferece abrir no app).
    await clicarPrimeiro(page, SEL.continuarNoNavegador, 15_000).catch(() => false);

    // Pré-join: nome + desligar mic/câmera + entrar.
    const nome = page.locator(SEL.nomeInput.join(', ')).first();
    try {
      await nome.waitFor({ state: 'visible', timeout: 30_000 });
      await nome.fill(opts.displayName);
    } catch {
      logger.warn('Campo de nome não encontrado — seguindo (talvez já autenticado).');
    }
    await clicarPrimeiro(page, SEL.toggleMic, 3_000).catch(() => false);
    await clicarPrimeiro(page, SEL.toggleCam, 3_000).catch(() => false);

    const entrouClick = await clicarPrimeiro(page, SEL.botaoEntrar, 15_000);
    if (!entrouClick) {
      logger.warn('Botão "Participar agora" não encontrado.');
    }

    // Lobby: esperar admissão (aparecer a UI de dentro da reunião).
    logger.info('Aguardando admissão do lobby…');
    const dentro = await esperarAlgum(
      page,
      SEL.dentroDaReuniao,
      opts.lobbyTimeoutMs,
    );
    if (!dentro) {
      logger.error('Não fui admitido na reunião dentro do tempo limite (lobby).');
      return { texto: '', segmentos, entrou, legendasLigadas };
    }
    entrou = true;
    logger.info('Admitido na reunião. Ligando legendas…');

    // Captura de áudio (2º motor / Whisper): grava desde a admissão. Best-effort —
    // se o ffmpeg/sink não estiver disponível, segue só com as legendas.
    if (opts.wavPath && opts.audioSink) {
      try {
        capturaProc = iniciarCaptura(opts.wavPath, opts.audioSink, logger);
      } catch (e) {
        logger.warn({ err: String(e) }, 'Não consegui iniciar a captura de áudio.');
      }
    }

    legendasLigadas = await ligarLegendas(page, logger).catch((e) => {
      logger.warn({ err: String(e) }, 'Falha ao ligar legendas (seguirá tentando ler).');
      return false;
    });

    const debug = !!process.env.PLAYWRIGHT_DEBUG_DOM;
    if (debug) {
      await dumpDom(page, logger, 'pos-admissao');
      // Abre o painel de Configurações de Legenda pra capturar os seletores do
      // idioma falado (pra automatizar PT depois), e fecha em seguida.
      await clicarPrimeiro(
        page,
        [
          '[data-tid="closed-captions-settings-menu-trigger-button"]',
          '[aria-label*="Configurações da Legenda" i]',
        ],
        4_000,
      ).catch(() => false);
      await page.waitForTimeout(1_200);
      await dumpDom(page, logger, 'settings-pane');
      await clicarPrimeiro(
        page,
        [
          '[data-tid="closed-captions-settings-menu-trigger-button"]',
          '[aria-label*="Configurações da Legenda" i]',
        ],
        2_000,
      ).catch(() => false);
    }

    // Loop de captura.
    const t0 = Date.now();
    const fimMax = t0 + opts.maxDuracaoMin * 60_000;
    let ultimaCapturaEm = Date.now();
    let ultimoDump = 0;
    // Dedup: o Teams mostra uma janela rolante das últimas ~3 legendas. Rastreamos
    // apenas a ÚLTIMA linha (a em andamento) e commitamos quando ela MUDA — assim
    // não re-gravamos as linhas que continuam visíveis na janela.
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    // Comparação "mesma fala": ignora caixa e pontuação (o Teams reescreve a linha
    // pontuada como versão final — ex.: "fala magma" → "Fala Magma.").
    const canon = (s: string): string =>
      norm(s).toLowerCase().replace(/[.,!?;:…"']/g, '').replace(/\s+/g, ' ').trim();
    let atual: { autor: string; texto: string; inicio_ms: number } | null = null;

    while (Date.now() < fimMax) {
      if (debug && Date.now() - ultimoDump > 15_000) {
        await dumpDom(page, logger, `loop+${Math.round((Date.now() - t0) / 1000)}s`);
        ultimoDump = Date.now();
      }
      // Reunião encerrou?
      const encerrou = await page
        .locator(SEL.chamadaEncerrada.join(', '))
        .first()
        .isVisible()
        .catch(() => false);
      const aindaDentro = await page
        .locator(SEL.dentroDaReuniao.join(', '))
        .first()
        .isVisible()
        .catch(() => false);
      if (encerrou || !aindaDentro) {
        logger.info('Reunião encerrada (UI sumiu / tela de fim).');
        break;
      }

      const linhas = (await lerLegendas(page)).filter((l) => norm(l.texto));
      const agoraMs = Date.now() - t0;
      if (linhas.length > 0) ultimaCapturaEm = Date.now();
      // Só a ÚLTIMA legenda importa (as anteriores já foram commitadas quando eram
      // a "última"). Enquanto cresce/corrige, atualiza; quando troca de fala, commita.
      const ultima = linhas[linhas.length - 1];
      if (ultima) {
        const autor = ultima.autor || 'Desconhecido';
        const texto = norm(ultima.texto);
        const ca = canon(texto);
        const cb = atual ? canon(atual.texto) : '';
        if (!atual) {
          atual = { autor, texto, inicio_ms: agoraMs };
        } else if (
          autor === atual.autor &&
          (ca.startsWith(cb) || cb.startsWith(ca))
        ) {
          // mesma fala evoluindo/refinada — mantém a versão mais longa
          if (texto.length >= atual.texto.length) atual.texto = texto;
        } else {
          segmentos.push({
            inicio_ms: atual.inicio_ms,
            falante: atual.autor,
            texto: atual.texto,
          });
          atual = { autor, texto, inicio_ms: agoraMs };
        }
      }

      // Ociosidade: sem legenda nova por muito tempo → assume fim.
      if (Date.now() - ultimaCapturaEm > opts.ociosidadeMin * 60_000) {
        logger.info('Sem legendas novas por muito tempo — encerrando captura.');
        break;
      }
      await page.waitForTimeout(2_000);
    }

    // Comita a última legenda em andamento.
    if (atual) {
      segmentos.push({
        inicio_ms: atual.inicio_ms,
        falante: atual.autor,
        texto: atual.texto,
      });
    }
    segmentos.sort((a, b) => a.inicio_ms - b.inicio_ms);

    // Finaliza a gravação ANTES de sair (o WAV fecha graciosamente).
    if (capturaProc) {
      await pararCaptura(capturaProc).catch(() => undefined);
      capturaProc = null;
    }

    await sairDaReuniao(page).catch(() => undefined);

    const texto = segmentos.map((s) => `${s.falante}: ${s.texto}`).join('\n');
    logger.info({ segmentos: segmentos.length, chars: texto.length }, 'Captura concluída.');
    return {
      texto,
      segmentos,
      entrou,
      legendasLigadas,
      wavPath: opts.wavPath && opts.audioSink ? opts.wavPath : undefined,
    };
  } finally {
    if (capturaProc) await pararCaptura(capturaProc).catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

/** Abre o menu "Mais → Idioma e fala → Ativar legendas". Best-effort. */
async function ligarLegendas(page: Page, logger: Logger): Promise<boolean> {
  // Algumas orgs já abrem com legenda; tenta detectar o container antes.
  const jaTem = await page
    .locator(SEL.legendaContainer.join(', '))
    .first()
    .isVisible()
    .catch(() => false);
  if (jaTem) return true;

  if (!(await clicarPrimeiro(page, SEL.menuMais, 8_000))) return false;
  await page.waitForTimeout(800);
  // Submenu de idioma/fala (quando existe) → depois "ativar legendas".
  await clicarPrimeiro(page, SEL.itemIdiomaFala, 4_000).catch(() => false);
  await page.waitForTimeout(500);
  const ligou = await clicarPrimeiro(page, SEL.itemLigarLegendas, 5_000);
  await page.waitForTimeout(1_000);
  const visivel = await page
    .locator(SEL.legendaContainer.join(', '))
    .first()
    .isVisible()
    .catch(() => false);
  if (visivel) logger.info('Legendas ao vivo ligadas.');
  return ligou || visivel;
}

/** Lê as linhas de legenda atualmente renderizadas (autor + texto). */
async function lerLegendas(
  page: Page,
): Promise<Array<{ autor: string; texto: string }>> {
  return page
    .evaluate(
      ({ itemSels, autorSels, textoSels }) => {
        const pick = (root: Element, sels: string[]): string => {
          for (const s of sels) {
            const el = root.querySelector(s);
            if (el && el.textContent) return el.textContent.trim();
          }
          return '';
        };
        let itens: Element[] = [];
        for (const s of itemSels) {
          const found = Array.from(document.querySelectorAll(s));
          if (found.length) {
            itens = found;
            break;
          }
        }
        return itens.map((el) => ({
          autor: pick(el, autorSels),
          // Quando não há sub-seletor de texto, usa o texto do próprio item.
          texto: pick(el, textoSels) || (el.textContent ?? '').trim(),
        }));
      },
      {
        itemSels: SEL.legendaItem,
        autorSels: SEL.legendaAutor,
        textoSels: SEL.legendaTexto,
      },
    )
    .catch(() => [] as Array<{ autor: string; texto: string }>);
}

/**
 * DIAGNÓSTICO (PLAYWRIGHT_DEBUG_DOM=1): tira screenshot e loga elementos candidatos
 * a legenda, pra descobrir os seletores reais do Teams web do tenant.
 */
async function dumpDom(page: Page, logger: Logger, tag: string): Promise<void> {
  try {
    await page.screenshot({ path: `debug-${tag}.png` }).catch(() => undefined);
    const info = await page.evaluate(() => {
      const amostra = (sel: string) =>
        Array.from(document.querySelectorAll(sel))
          .slice(0, 2)
          .map((e) => ({
            tag: e.tagName,
            tid: e.getAttribute('data-tid'),
            id: (e as HTMLElement).id || null,
            cls: String((e as HTMLElement).className || '').slice(0, 140),
            text: (e.textContent || '').trim().slice(0, 120),
            html: e.outerHTML.slice(0, 2500),
          }));
      const seletores = [
        '[data-tid*="caption" i]',
        '[data-tid*="closed-caption" i]',
        '[class*="caption" i]',
        '[class*="Caption"]',
        '[data-tid*="cc-" i]',
        '[aria-label*="legenda" i]',
        '[aria-label*="caption" i]',
        // Probes do painel de configurações de legenda (idioma falado).
        '[data-tid*="language" i]',
        '[data-tid*="spoken" i]',
        '[aria-label*="idioma" i]',
        'button[role="combobox"]',
        '[role="menuitemradio"]',
      ];
      const out: Record<string, { count: number; amostras: unknown[] }> = {};
      for (const s of seletores) {
        out[s] = { count: document.querySelectorAll(s).length, amostras: amostra(s) };
      }
      // Busca por TEXTO: controles ligados a idioma (pra automatizar o PT).
      const kw = /portugu|inglês|english|idioma|spoken|espanhol|language|brasil/i;
      const idioma = Array.from(
        document.querySelectorAll(
          'button,[role="menuitem"],[role="menuitemradio"],[role="option"],[role="combobox"],a',
        ),
      )
        .filter((e) => {
          const t = (e.textContent || '').trim();
          return kw.test(t) && t.length < 50;
        })
        .slice(0, 20)
        .map((e) => ({
          tag: e.tagName,
          tid: e.getAttribute('data-tid'),
          role: e.getAttribute('role'),
          aria: e.getAttribute('aria-label'),
          text: (e.textContent || '').trim().slice(0, 50),
        }));
      return { selectors: out, idioma };
    });
    logger.info({ tag, dom: info }, 'DEBUG-DOM');
  } catch (e) {
    logger.warn({ err: String(e) }, 'Falha no dumpDom.');
  }
}

/** Sai da reunião (clica no encerrar). Best-effort. */
async function sairDaReuniao(page: Page): Promise<void> {
  await clicarPrimeiro(
    page,
    ['[data-tid="hangup-button"]', '[data-tid="call-hangup"]', '#hangup-button'],
    3_000,
  );
}
