import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { TipoNotificacao } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { WahaClient } from '../waha/waha.client.js';
import { NotificacoesService } from '../notificacoes/notificacoes.service.js';

export type SaudeWaha = 'SAUDAVEL' | 'INSTAVEL' | 'DESCONHECIDA';

/**
 * Watchdog da sessão WhatsApp (WAHA). Detecta o "WORKING zumbi": a sessão reporta
 * status WORKING mas a engine (Chromium/WEBJS) congelou e PAROU DE EMITIR EVENTOS
 * — nenhum webhook chega, o status não muda, e ninguém percebe até faltar (por
 * ex.) o voto de uma enquete. `WORKING` NÃO é sinal de saúde; o sinal real é
 * evento fluindo. Só um restart de CONTAINER destrava (restart de sessão não).
 *
 * Estratégia com impacto ~zero no dia a dia:
 *  1. Lê status + idade do último webhook — barato, sem tocar no WhatsApp.
 *  2. Só SUSPEITA se WORKING + último webhook velho + houve ENVIO recente (ou
 *     seja: era pra ter vindo `message.ack` e não veio). Sem uso recente não
 *     conclui nada (madrugada ociosa não é zumbi) e nem sonda.
 *  3. CONFIRMA com um probe ativo na engine (fail-safe: só acusa em timeout).
 *  4. Alerta os ADMINS no sino — uma vez por incidente (edge-triggered). O
 *     restart de container segue manual (runbook); a API não reinicia o irmão.
 */
@Injectable()
export class WahaWatchdogService {
  private readonly logger = new Logger(WahaWatchdogService.name);
  private readonly limiteMudezMin: number;

  /** Veredito do último ciclo — lido pela tela Sistema>WhatsApp (badge). */
  private saude: SaudeWaha = 'DESCONHECIDA';
  /** Edge-trigger: enquanto um incidente está aberto, não realerta a cada ciclo. */
  private incidenteAtivoId: string | null = null;

  constructor(
    private readonly waha: WahaClient,
    private readonly prisma: PrismaService,
    private readonly notificacoes: NotificacoesService,
    config: ConfigService,
  ) {
    this.limiteMudezMin = Number(config.get('WAHA_WATCHDOG_MUDEZ_MIN') ?? 20);
  }

  /** Veredito corrente da saúde da engine (para a tela). */
  get saudeAtual(): SaudeWaha {
    return this.saude;
  }

  // A cada 10 min: o gatilho de mudez é 20 min, então checar mais fino não
  // anteciparia a detecção — só gastaria ciclos à toa.
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'waha-watchdog' })
  async verificar(): Promise<void> {
    if (!this.waha.configurado) return;

    let status: Awaited<ReturnType<WahaClient['statusSessao']>>;
    try {
      status = await this.waha.statusSessao();
    } catch {
      // WAHA inalcançável = está fora do ar, não é o zumbi silencioso (a tela já
      // mostra INDISPONIVEL). Não classificamos como INSTAVEL aqui.
      return;
    }

    // Só o estado WORKING esconde o zumbi. STOPPED/SCAN_QR_CODE/FAILED já
    // aparecem como problema óbvio na tela → não é o caso silencioso.
    if (status.status !== 'WORKING') {
      this.resolverIncidente();
      return;
    }

    const idadeMin = await this.idadeUltimoWebhookMin();
    if (idadeMin < this.limiteMudezMin) {
      this.resolverIncidente(); // eventos fluindo → saudável
      return;
    }

    // WORKING + mudo há muito tempo. Só é conclusivo se houve tentativa de uso:
    // um envio recente que DEVERIA ter gerado ack e não gerou. Sem uso, não dá
    // pra distinguir "zumbi" de "ninguém mandou nada" — não sonda nem alarma.
    if (!(await this.houveEnvioRecente())) return;

    // Confirmação: a engine responde a um round-trip? (fail-safe: só true em hang)
    const travada = await this.waha.engineTravada();
    if (!travada) {
      this.resolverIncidente();
      return;
    }

    // ZUMBI confirmado.
    this.saude = 'INSTAVEL';
    if (this.incidenteAtivoId) return; // já alertado neste incidente
    try {
      const incidente = randomUUID();
      await this.alertarAdmins(idadeMin, incidente);
      // Só fecha o gate DEPOIS de alertar com sucesso — se o envio falhar, o
      // próximo ciclo tenta de novo (não perde o aviso do incidente).
      this.incidenteAtivoId = incidente;
    } catch (err) {
      this.logger.warn(
        `Falha ao alertar admins do zumbi WAHA (tentará de novo): ${(err as Error).message}`,
      );
    }
  }

  /** Marca saudável e fecha o incidente (permite alertar de novo no futuro). */
  private resolverIncidente(): void {
    this.saude = 'SAUDAVEL';
    this.incidenteAtivoId = null;
  }

  private async idadeUltimoWebhookMin(): Promise<number> {
    const ultimo = await this.prisma.webhookRecebido.findFirst({
      where: { provider: 'waha' },
      orderBy: { recebido_em: 'desc' },
      select: { recebido_em: true },
    });
    if (!ultimo) return Number.POSITIVE_INFINITY;
    return (Date.now() - ultimo.recebido_em.getTime()) / 60_000;
  }

  /**
   * Houve envio de WhatsApp na janela recente (2× o limite de mudez)? Um envio
   * bem-sucedido numa engine sã gera `message.ack` (webhook) em segundos; a
   * ausência disso COM envio recente é o sintoma. A janela é dobrada para pegar
   * um envio ocorrido logo antes do congelamento.
   *
   * Limitação conhecida: um freeze que começa após longa ociosidade só é
   * confirmado quando o uso volta — aceitável (fora de horário o impacto é baixo).
   */
  private async houveEnvioRecente(): Promise<boolean> {
    const desde = new Date(Date.now() - 2 * this.limiteMudezMin * 60_000);
    const envio = await this.prisma.mensagem.findFirst({
      where: { canal: 'WHATSAPP', direcao: 'SAIDA', criado_em: { gt: desde } },
      select: { id: true },
    });
    return !!envio;
  }

  private async alertarAdmins(
    idadeMin: number,
    referenciaId: string,
  ): Promise<void> {
    const admins = await this.prisma.usuario.findMany({
      where: { ativo: true, areas: { has: 'admin' } },
      select: { id: true },
    });
    if (admins.length === 0) {
      this.logger.warn(
        'WAHA zumbi detectado, mas nenhum admin ativo para notificar.',
      );
      return;
    }
    const min = Math.round(idadeMin);
    await this.notificacoes.emitir({
      usuarioIds: admins.map((a) => a.id),
      tipo: TipoNotificacao.WHATSAPP_INSTAVEL,
      titulo: 'WhatsApp travado (sessão muda)',
      mensagem:
        'A sessão do WhatsApp está conectada (WORKING) mas parou de responder — ' +
        `sem eventos há ~${min} min e a engine não respondeu ao teste. ` +
        'Reinicie o CONTAINER do WAHA no servidor (reiniciar a sessão não resolve).',
      link: '/configuracoes/whatsapp',
      referenciaId,
    });
    this.logger.error(
      `WAHA "WORKING zumbi" detectado (mudo há ~${min} min). ${admins.length} admin(s) notificado(s).`,
    );
  }
}
