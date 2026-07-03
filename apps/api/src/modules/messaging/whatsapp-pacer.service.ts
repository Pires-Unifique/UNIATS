import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';

import { PrismaService } from '../../prisma/prisma.service.js';
import { WahaClient } from '../waha/waha.client.js';

const DIA_MS = 24 * 60 * 60 * 1000;

export type DecisaoPacer =
  | { liberado: true }
  | { liberado: false; retomarEm: Date; motivo: string };

/**
 * Pacing anti-banimento do WhatsApp. O WAHA automatiza o WhatsApp Web
 * (não-oficial): os sinais que mais derrubam número são rajada de envios,
 * volume alto e contato frio. Este serviço impõe, para a FILA DE MENSAGENS:
 *
 *  - JANELA de envio (horário comercial, dias permitidos);
 *  - TETO diário (ramp-up é manual, via env, subindo semana a semana);
 *  - JITTER: intervalo aleatório entre envios consecutivos (fim da rajada);
 *  - SALVAR CONTATO best-effort antes do 1º contato (agenda populada parece
 *    uso normal; número que só dispara pra desconhecidos parece bot).
 *
 * Sem DST no Brasil desde 2019, então a aritmética de "wall clock" do fuso
 * (WHATSAPP_TIMEZONE) pode somar milissegundos reais com segurança.
 */
@Injectable()
export class WhatsappPacerService {
  private readonly logger = new Logger(WhatsappPacerService.name);

  private readonly ativo: boolean;
  private readonly capDiario: number;
  private readonly janelaInicio: number;
  private readonly janelaFim: number;
  private readonly diasPermitidos: Set<number>;
  private readonly jitterMinMs: number;
  private readonly jitterMaxMs: number;
  private readonly salvarContatoAtivo: boolean;
  private readonly tz: string;

  /** Instante (epoch ms) a partir do qual o PRÓXIMO envio pode sair. */
  private proximoEnvioEm = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
  ) {
    this.ativo = this.config.get<boolean>('WHATSAPP_PACING') ?? true;
    this.capDiario = this.config.get<number>('WHATSAPP_CAP_DIARIO') ?? 80;
    this.janelaInicio = this.config.get<number>('WHATSAPP_JANELA_INICIO') ?? 8;
    this.janelaFim = this.config.get<number>('WHATSAPP_JANELA_FIM') ?? 19;
    this.diasPermitidos = new Set(
      (this.config.get<string>('WHATSAPP_JANELA_DIAS') ?? '1,2,3,4,5,6')
        .split(',')
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    );
    this.jitterMinMs = this.config.get<number>('WHATSAPP_JITTER_MIN_MS') ?? 20_000;
    this.jitterMaxMs = this.config.get<number>('WHATSAPP_JITTER_MAX_MS') ?? 90_000;
    this.salvarContatoAtivo =
      this.config.get<boolean>('WHATSAPP_SALVAR_CONTATO') ?? true;
    this.tz = this.config.get<string>('WHATSAPP_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  /**
   * Janela + teto diário. Fora da janela ou acima do cap → devolve QUANDO
   * retomar (o processor reagenda o job para lá, sem consumir tentativa).
   */
  async avaliarJanelaECap(): Promise<DecisaoPacer> {
    if (!this.ativo) return { liberado: true };

    const agora = this.agoraLocal();

    if (!this.dentroDaJanela(agora)) {
      return {
        liberado: false,
        retomarEm: this.proximaAbertura(agora, /*aPartirDeAmanha*/ false),
        motivo: 'fora da janela de envio',
      };
    }

    if (this.capDiario > 0) {
      const inicioDoDia = new Date(Date.now() - agora.msDoDia);
      const enviadasHoje = await this.contarEnviadasDesde(inicioDoDia);
      if (enviadasHoje >= this.capDiario) {
        return {
          liberado: false,
          retomarEm: this.proximaAbertura(agora, /*aPartirDeAmanha*/ true),
          motivo: `teto diário atingido (${enviadasHoje}/${this.capDiario})`,
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
    if (!this.ativo) return;
    const agora = Date.now();
    const espera = Math.max(0, this.proximoEnvioEm - agora);
    const gap =
      this.jitterMinMs +
      Math.floor(Math.random() * Math.max(0, this.jitterMaxMs - this.jitterMinMs + 1));
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
    if (!this.ativo || !this.salvarContatoAtivo || !nome?.trim()) return;
    try {
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
    const agora = this.agoraLocal();
    const inicioDoDia = new Date(Date.now() - agora.msDoDia);
    const enviadasHoje = await this.contarEnviadasDesde(inicioDoDia);
    return {
      pacing_ativo: this.ativo,
      enviadas_hoje: enviadasHoje,
      cap_diario: this.capDiario > 0 ? this.capDiario : null,
      janela: `${String(this.janelaInicio).padStart(2, '0')}h–${String(this.janelaFim).padStart(2, '0')}h`,
      dentro_janela: this.dentroDaJanela(agora),
    };
  }

  // -----------------------------------------------------------------------

  private contarEnviadasDesde(inicio: Date): Promise<number> {
    return this.prisma.mensagem.count({
      where: {
        canal: 'WHATSAPP',
        direcao: 'SAIDA',
        enviado_em: { gte: inicio },
      },
    });
  }

  private dentroDaJanela(agora: {
    diaSemana: number;
    hora: number;
  }): boolean {
    return (
      this.diasPermitidos.has(agora.diaSemana) &&
      agora.hora >= this.janelaInicio &&
      agora.hora < this.janelaFim
    );
  }

  /**
   * Próximo instante em que a janela abre. Com `aPartirDeAmanha` (cap diário
   * estourado), hoje não conta mesmo que a janela ainda esteja aberta.
   */
  private proximaAbertura(
    agora: { diaSemana: number; msDoDia: number },
    aPartirDeAmanha: boolean,
  ): Date {
    const aberturaMs = this.janelaInicio * 60 * 60 * 1000;
    const inicioK = aPartirDeAmanha ? 1 : 0;
    for (let k = inicioK; k <= 7; k++) {
      const dia = (agora.diaSemana + k) % 7;
      if (!this.diasPermitidos.has(dia)) continue;
      // Hoje só vale se a abertura ainda está no futuro.
      if (k === 0 && agora.msDoDia >= aberturaMs) continue;
      const delta = k * DIA_MS + (aberturaMs - agora.msDoDia);
      return new Date(Date.now() + delta);
    }
    // Config sem dia permitido (dias vazios) — devolve +1h para não travar a fila.
    this.logger.warn('WHATSAPP_JANELA_DIAS sem dias válidos — retomando em 1h.');
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
