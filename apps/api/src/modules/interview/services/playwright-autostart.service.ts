import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Auto-join do bot Playwright (fallback de transcrição).
 *
 * A cada minuto varre entrevistas `AGENDADA` do Teams cujo horário caia na janela
 * [agora - GRACE, agora + LEAD], que ainda não tenham bot disparado
 * (`bot_session_id` nulo), e enfileira `playwright-join` (consumido pelo serviço
 * externo playwright-bot). Marca `bot_session_id` para não re-disparar.
 *
 * Diferente do Graph (pull pós-reunião), aqui o bot entra DURANTE a reunião e
 * captura as legendas ao vivo. Desligado por padrão (PLAYWRIGHT_BOT_ENABLED=false).
 */
@Injectable()
export class PlaywrightAutostartService {
  private readonly logger = new Logger(PlaywrightAutostartService.name);
  private readonly enabled: boolean;
  private readonly leadMin: number;
  private readonly graceMin: number;
  private readonly maxDuracaoMin: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @InjectQueue(QUEUE_NAMES.PLAYWRIGHT_JOIN)
    private readonly filaJoin: Queue,
  ) {
    this.enabled = config.get<boolean>('PLAYWRIGHT_BOT_ENABLED') ?? false;
    this.leadMin = config.get<number>('PLAYWRIGHT_AUTOSTART_LEAD_MIN') ?? 2;
    this.graceMin = config.get<number>('PLAYWRIGHT_AUTOSTART_GRACE_MIN') ?? 15;
    this.maxDuracaoMin = config.get<number>('PLAYWRIGHT_MAX_DURACAO_MIN') ?? 180;
    if (!this.enabled) {
      this.logger.log('Bot Playwright DESABILITADO (PLAYWRIGHT_BOT_ENABLED=false).');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'playwright-autostart' })
  async dispararProximas(): Promise<void> {
    if (!this.enabled) return;

    const agora = Date.now();
    const inicioJanela = new Date(agora - this.graceMin * 60_000);
    const fimJanela = new Date(agora + this.leadMin * 60_000);

    const candidatas = await this.prisma.entrevista.findMany({
      where: {
        status: 'AGENDADA',
        bot_session_id: null,
        teams_join_url: { not: null },
        agendada_para: { gte: inicioJanela, lte: fimJanela },
      },
      select: {
        id: true,
        teams_join_url: true,
        duracao_estimada_min: true,
        transcricao: { select: { provider: true, texto_completo: true } },
      },
      take: 50,
    });
    if (candidatas.length === 0) return;

    let enfileiradas = 0;
    for (const e of candidatas) {
      // Já tem transcript (de qualquer fonte) com texto? não precisa do bot.
      if (e.transcricao?.texto_completo?.trim()) continue;
      if (!e.teams_join_url) continue;

      const jobId = `playwright-join-${e.id}`;
      await this.filaJoin.add(
        'join',
        {
          entrevistaId: e.id,
          joinUrl: e.teams_join_url,
          maxDuracaoMin: Math.min(
            this.maxDuracaoMin,
            (e.duracao_estimada_min ?? 30) + 30, // duração + folga
          ),
        },
        { jobId, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
      );
      // Marca como disparado para o próprio filtro do cron não re-enfileirar.
      await this.prisma.entrevista.update({
        where: { id: e.id },
        data: {
          bot_session_id: jobId,
          bot_provider: 'playwright',
          bot_status: 'dispatched',
        },
      });
      enfileiradas++;
    }
    if (enfileiradas > 0) {
      this.logger.log(
        `Auto-join Playwright: ${enfileiradas} bot(s) enfileirado(s) de ` +
          `${candidatas.length} candidata(s) na janela [-${this.graceMin}min, +${this.leadMin}min].`,
      );
    }
  }
}
