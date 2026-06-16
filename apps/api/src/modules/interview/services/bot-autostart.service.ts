import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { InterviewService } from './interview.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Auto-join: coloca o bot na reunião sozinho, perto do horário agendado.
 *
 * A cada minuto varre entrevistas `AGENDADA` cujo horário caia na janela
 * [agora - GRACE, agora + LEAD], que tenham `meet_url` e ainda não tenham bot
 * (`bot_session_id` nulo), e dispara `iniciarBot` (idempotente). O consentimento
 * de gravação continua sendo exigido pelo próprio `iniciarBot` — entrevistas sem
 * consentimento são puladas (logado), não derrubam o lote.
 *
 * Desligado por padrão (BOT_AUTOSTART_ENABLED=false). Ligar em homolog/prod.
 *
 * A transcrição/ATA posterior NÃO depende deste cron: é disparada pelo webhook
 * `bot.ended` do MeetStream quando a reunião encerra.
 */
@Injectable()
export class BotAutostartService {
  private readonly logger = new Logger(BotAutostartService.name);
  private readonly enabled: boolean;
  private readonly leadMin: number;
  private readonly graceMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly interview: InterviewService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('BOT_AUTOSTART_ENABLED') ?? false;
    this.leadMin = config.get<number>('BOT_AUTOSTART_LEAD_MIN') ?? 5;
    this.graceMin = config.get<number>('BOT_AUTOSTART_GRACE_MIN') ?? 10;
    if (!this.enabled) {
      this.logger.log(
        'Auto-join do bot DESABILITADO (BOT_AUTOSTART_ENABLED=false).',
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'bot-autostart' })
  async dispararEntrevistasProximas(): Promise<void> {
    if (!this.enabled) return;

    const agora = Date.now();
    const inicioJanela = new Date(agora - this.graceMin * 60_000);
    const fimJanela = new Date(agora + this.leadMin * 60_000);

    const candidatas = await this.prisma.entrevista.findMany({
      where: {
        status: 'AGENDADA',
        bot_session_id: null,
        meet_url: { not: null },
        agendada_para: { gte: inicioJanela, lte: fimJanela },
      },
      select: { id: true, agendada_para: true },
      take: 50, // teto defensivo por tick
    });
    if (candidatas.length === 0) return;

    let iniciadas = 0;
    let puladas = 0;
    for (const e of candidatas) {
      try {
        const r = await this.interview.iniciarBot(e.id);
        if (r.status === 'enfileirado') iniciadas++;
      } catch (err) {
        // Consentimento ausente, LGPD, etc. — pula sem derrubar o lote.
        puladas++;
        this.logger.warn(
          `Auto-join pulou entrevista ${e.id}: ${(err as Error).message}`,
        );
      }
    }
    if (iniciadas > 0 || puladas > 0) {
      this.logger.log(
        `Auto-join: ${iniciadas} bot(s) enfileirado(s), ${puladas} pulada(s) ` +
          `de ${candidatas.length} candidata(s) na janela [-${this.graceMin}min, +${this.leadMin}min].`,
      );
    }
  }
}
