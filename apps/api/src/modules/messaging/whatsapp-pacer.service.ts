import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WahaPacingConfigDTO } from '@uniats/shared';
import { setTimeout as sleep } from 'node:timers/promises';

import { PrismaService } from '../../prisma/prisma.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { ConfiguracoesService } from '../configuracoes/configuracoes.service.js';
import { WahaClient } from '../waha/waha.client.js';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Chave em configuracoes_sistema com o override editado na tela WhatsApp. */
const CHAVE_CONFIG = 'whatsapp_pacing';

export type DecisaoPacer =
  | { liberado: true }
  | { liberado: false; retomarEm: Date; motivo: string };

/** Config efetiva (env como padrão + override do banco, se houver). */
interface PacingConfig {
  pacing: boolean;
  cap_diario: number;
  janela_inicio: number;
  janela_fim: number;
  janela_dias: number[];
  jitter_min_ms: number;
  jitter_max_ms: number;
  salvar_contato: boolean;
}

/**
 * Pacing anti-banimento do WhatsApp. O WAHA automatiza o WhatsApp Web
 * (não-oficial): os sinais que mais derrubam número são rajada de envios,
 * volume alto e contato frio. Este serviço impõe, para a FILA DE MENSAGENS:
 *
 *  - JANELA de envio (horário comercial, dias permitidos);
 *  - TETO diário (ramp-up é manual, subindo semana a semana);
 *  - JITTER: intervalo aleatório entre envios consecutivos (fim da rajada);
 *  - SALVAR CONTATO best-effort antes do 1º contato (agenda populada parece
 *    uso normal; número que só dispara pra desconhecidos parece bot).
 *
 * A configuração é EDITÁVEL na tela WhatsApp (seção Sistema): os envs
 * WHATSAPP_* são o padrão e o valor salvo no banco sobrepõe (chave
 * 'whatsapp_pacing' em configuracoes_sistema).
 *
 * Sem DST no Brasil desde 2019, então a aritmética de "wall clock" do fuso
 * (WHATSAPP_TIMEZONE, só via env) pode somar milissegundos reais com segurança.
 */
@Injectable()
export class WhatsappPacerService {
  private readonly logger = new Logger(WhatsappPacerService.name);

  private readonly padroes: PacingConfig;
  private readonly tz: string;

  /** Instante (epoch ms) a partir do qual o PRÓXIMO envio pode sair. */
  private proximoEnvioEm = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly configuracoes: ConfiguracoesService,
  ) {
    this.padroes = {
      pacing: this.config.get<boolean>('WHATSAPP_PACING') ?? true,
      cap_diario: this.config.get<number>('WHATSAPP_CAP_DIARIO') ?? 80,
      janela_inicio: this.config.get<number>('WHATSAPP_JANELA_INICIO') ?? 8,
      janela_fim: this.config.get<number>('WHATSAPP_JANELA_FIM') ?? 19,
      janela_dias: (this.config.get<string>('WHATSAPP_JANELA_DIAS') ?? '1,2,3,4,5,6')
        .split(',')
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      jitter_min_ms: this.config.get<number>('WHATSAPP_JITTER_MIN_MS') ?? 20_000,
      jitter_max_ms: this.config.get<number>('WHATSAPP_JITTER_MAX_MS') ?? 90_000,
      salvar_contato: this.config.get<boolean>('WHATSAPP_SALVAR_CONTATO') ?? true,
    };
    this.tz = this.config.get<string>('WHATSAPP_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  /** Config efetiva: env (padrão) sobreposto pelo que foi salvo na tela. */
  private async cfg(): Promise<PacingConfig> {
    const override =
      await this.configuracoes.obter<Partial<PacingConfig>>(CHAVE_CONFIG);
    if (!override) return this.padroes;
    return { ...this.padroes, ...override };
  }

  /** Config efetiva + origem, para a tela de edição. */
  async obterConfig(): Promise<WahaPacingConfigDTO> {
    const override =
      await this.configuracoes.obter<Partial<PacingConfig>>(CHAVE_CONFIG);
    return { ...this.padroes, ...override, padrao_ambiente: override === null };
  }

  /** Salva o override editado na tela (validação + auditoria). */
  async atualizarConfig(
    entrada: Partial<PacingConfig>,
    autor: UsuarioAutenticado,
  ): Promise<WahaPacingConfigDTO> {
    const nova = this.validarConfig(entrada);
    const antes = await this.obterConfig();
    await this.configuracoes.salvar(
      CHAVE_CONFIG,
      nova,
      autor.chave_api ? null : autor.id,
    );
    await this.auditarConfig(autor, 'waha_pacing_atualizado', antes, nova);
    return { ...nova, padrao_ambiente: false };
  }

  /** Remove o override — volta ao padrão do ambiente (envs WHATSAPP_*). */
  async restaurarPadrao(autor: UsuarioAutenticado): Promise<WahaPacingConfigDTO> {
    const antes = await this.obterConfig();
    await this.configuracoes.remover(CHAVE_CONFIG);
    await this.auditarConfig(autor, 'waha_pacing_restaurado', antes, this.padroes);
    return { ...this.padroes, padrao_ambiente: true };
  }

  /**
   * Janela + teto diário. Fora da janela ou acima do cap → devolve QUANDO
   * retomar (o processor reagenda o job para lá, sem consumir tentativa).
   */
  async avaliarJanelaECap(): Promise<DecisaoPacer> {
    const cfg = await this.cfg();
    if (!cfg.pacing) return { liberado: true };

    const agora = this.agoraLocal();

    if (!this.dentroDaJanela(cfg, agora)) {
      return {
        liberado: false,
        retomarEm: this.proximaAbertura(cfg, agora, /*aPartirDeAmanha*/ false),
        motivo: 'fora da janela de envio',
      };
    }

    if (cfg.cap_diario > 0) {
      const inicioDoDia = new Date(Date.now() - agora.msDoDia);
      const enviadasHoje = await this.contarEnviadasDesde(inicioDoDia);
      if (enviadasHoje >= cfg.cap_diario) {
        return {
          liberado: false,
          retomarEm: this.proximaAbertura(cfg, agora, /*aPartirDeAmanha*/ true),
          motivo: `teto diário atingido (${enviadasHoje}/${cfg.cap_diario})`,
        };
      }
    }

    return { liberado: true };
  }

  /**
   * Serializa os envios com intervalo aleatório (jitter) entre eles. Todos os
   * workers da fila passam por aqui — o gate é em memória, o que basta porque
   * a API roda em instância única (docker compose).
   */
  async aguardarVez(): Promise<void> {
    const cfg = await this.cfg();
    if (!cfg.pacing) return;
    const agora = Date.now();
    const espera = Math.max(0, this.proximoEnvioEm - agora);
    const gap =
      cfg.jitter_min_ms +
      Math.floor(
        Math.random() * Math.max(0, cfg.jitter_max_ms - cfg.jitter_min_ms + 1),
      );
    this.proximoEnvioEm = agora + espera + gap;
    if (espera > 0) {
      this.logger.debug(`Jitter: aguardando ${Math.round(espera / 1000)}s para enviar.`);
      await sleep(espera);
    }
  }

  /**
   * Salva o candidato na agenda antes do PRIMEIRO contato (best-effort).
   * "Primeiro contato" = nenhuma mensagem WhatsApp já enviada a ele.
   */
  async salvarContatoSeNovo(
    candidatoId: string,
    chatId: string,
    nome: string | null,
  ): Promise<void> {
    try {
      const cfg = await this.cfg();
      if (!cfg.pacing || !cfg.salvar_contato || !nome?.trim()) return;
      const jaContatado = await this.prisma.mensagem.count({
        where: {
          candidato_id: candidatoId,
          canal: 'WHATSAPP',
          direcao: 'SAIDA',
          enviado_em: { not: null },
        },
      });
      if (jaContatado > 0) return;
      await this.waha.salvarContato(chatId, nome.trim());
      // A doc do WAHA recomenda uma folga para o aparelho sincronizar a agenda.
      await sleep(2_000);
    } catch (err) {
      // Nunca bloqueia o envio — é um reforço, não um requisito.
      this.logger.debug(`salvarContatoSeNovo falhou (ignorado): ${(err as Error).message}`);
    }
  }

  /** Visão operacional para a tela WhatsApp (seção Sistema). */
  async statusDoDia(): Promise<{
    pacing_ativo: boolean;
    enviadas_hoje: number;
    cap_diario: number | null;
    janela: string;
    dentro_janela: boolean;
  }> {
    const cfg = await this.cfg();
    const agora = this.agoraLocal();
    const inicioDoDia = new Date(Date.now() - agora.msDoDia);
    const enviadasHoje = await this.contarEnviadasDesde(inicioDoDia);
    return {
      pacing_ativo: cfg.pacing,
      enviadas_hoje: enviadasHoje,
      cap_diario: cfg.cap_diario > 0 ? cfg.cap_diario : null,
      janela: `${String(cfg.janela_inicio).padStart(2, '0')}h–${String(cfg.janela_fim).padStart(2, '0')}h`,
      dentro_janela: this.dentroDaJanela(cfg, agora),
    };
  }

  // -----------------------------------------------------------------------

  private validarConfig(entrada: Partial<PacingConfig>): PacingConfig {
    const c = { ...this.padroes, ...entrada };
    if (typeof c.pacing !== 'boolean' || typeof c.salvar_contato !== 'boolean') {
      throw new BadRequestException('pacing e salvar_contato devem ser booleanos.');
    }
    if (!Number.isInteger(c.cap_diario) || c.cap_diario < 0 || c.cap_diario > 5000) {
      throw new BadRequestException('cap_diario deve ser inteiro entre 0 (sem teto) e 5000.');
    }
    if (
      !Number.isInteger(c.janela_inicio) ||
      !Number.isInteger(c.janela_fim) ||
      c.janela_inicio < 0 ||
      c.janela_inicio > 23 ||
      c.janela_fim < 1 ||
      c.janela_fim > 24 ||
      c.janela_inicio >= c.janela_fim
    ) {
      throw new BadRequestException(
        'Janela inválida: início 0-23, fim 1-24 e início < fim.',
      );
    }
    const dias = [...new Set(c.janela_dias)].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    if (dias.length === 0) {
      throw new BadRequestException('Selecione ao menos um dia da semana.');
    }
    if (
      !Number.isInteger(c.jitter_min_ms) ||
      !Number.isInteger(c.jitter_max_ms) ||
      c.jitter_min_ms < 0 ||
      c.jitter_max_ms > 3_600_000 ||
      c.jitter_min_ms > c.jitter_max_ms
    ) {
      throw new BadRequestException(
        'Jitter inválido: 0 ≤ mínimo ≤ máximo ≤ 3600000 ms.',
      );
    }
    return {
      pacing: c.pacing,
      cap_diario: c.cap_diario,
      janela_inicio: c.janela_inicio,
      janela_fim: c.janela_fim,
      janela_dias: dias.sort((a, b) => a - b),
      jitter_min_ms: c.jitter_min_ms,
      jitter_max_ms: c.jitter_max_ms,
      salvar_contato: c.salvar_contato,
    };
  }

  private async auditarConfig(
    autor: UsuarioAutenticado,
    acao: string,
    antes: unknown,
    depois: unknown,
  ): Promise<void> {
    try {
      await this.prisma.registroAuditoria.create({
        data: {
          usuario_id: autor.chave_api ? null : autor.id,
          acao,
          entidade: 'sistema',
          diff: { antes, depois } as object,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao auditar ${acao}: ${(err as Error).message}`);
    }
  }

  private contarEnviadasDesde(inicio: Date): Promise<number> {
    return this.prisma.mensagem.count({
      where: {
        canal: 'WHATSAPP',
        direcao: 'SAIDA',
        enviado_em: { gte: inicio },
      },
    });
  }

  private dentroDaJanela(
    cfg: PacingConfig,
    agora: { diaSemana: number; hora: number },
  ): boolean {
    return (
      cfg.janela_dias.includes(agora.diaSemana) &&
      agora.hora >= cfg.janela_inicio &&
      agora.hora < cfg.janela_fim
    );
  }

  /**
   * Próximo instante em que a janela abre. Com `aPartirDeAmanha` (cap diário
   * estourado), hoje não conta mesmo que a janela ainda esteja aberta.
   */
  private proximaAbertura(
    cfg: PacingConfig,
    agora: { diaSemana: number; msDoDia: number },
    aPartirDeAmanha: boolean,
  ): Date {
    const aberturaMs = cfg.janela_inicio * 60 * 60 * 1000;
    const inicioK = aPartirDeAmanha ? 1 : 0;
    for (let k = inicioK; k <= 7; k++) {
      const dia = (agora.diaSemana + k) % 7;
      if (!cfg.janela_dias.includes(dia)) continue;
      // Hoje só vale se a abertura ainda está no futuro.
      if (k === 0 && agora.msDoDia >= aberturaMs) continue;
      const delta = k * DIA_MS + (aberturaMs - agora.msDoDia);
      return new Date(Date.now() + delta);
    }
    // Config sem dia permitido (não deveria passar na validação) — +1h p/ não travar.
    this.logger.warn('Janela sem dias válidos — retomando em 1h.');
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  /** Relógio de parede no fuso configurado (Brasil não tem DST desde 2019). */
  private agoraLocal(): { diaSemana: number; hora: number; msDoDia: number } {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: this.tz,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const get = (tipo: string) =>
      partes.find((p) => p.type === tipo)?.value ?? '0';
    const DIAS: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const hora = Number(get('hour')) % 24; // 'h23' às vezes devolve "24" à meia-noite
    const minuto = Number(get('minute'));
    const segundo = Number(get('second'));
    return {
      diaSemana: DIAS[get('weekday')] ?? 0,
      hora,
      msDoDia: ((hora * 60 + minuto) * 60 + segundo) * 1000,
    };
  }
}
