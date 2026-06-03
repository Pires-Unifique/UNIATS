import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { MeetStreamClient } from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
});
export type BotStartPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.BOT_ENTREVISTA, {
  concurrency: Number(process.env.BOT_ENTREVISTA_CONCURRENCY ?? 2),
})
export class BotStartProcessor extends WorkerHost {
  private readonly logger = new Logger(BotStartProcessor.name);
  private readonly publicBaseUrl: string;

  constructor(
    private readonly meetstream: MeetStreamClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.publicBaseUrl =
      this.config.get<string>('PUBLIC_BASE_URL') ??
      'http://localhost:3001';
  }

  async process(job: Job<unknown>): Promise<{ botId: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new Error('Payload inválido para bot-start.');
    }
    const { entrevistaId } = parsed.data;

    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        id: true,
        meet_url: true,
        status: true,
        bot_session_id: true,
        candidato: {
          select: {
            consentimento_gravacao_em: true,
            excluido_em: true,
          },
        },
      },
    });
    if (!entrevista) {
      throw new Error(`Entrevista ${entrevistaId} não existe.`);
    }
    if (entrevista.candidato.excluido_em) {
      // Candidato pediu exclusão entre o enfileiramento e o job rodar.
      await this.prisma.entrevista.update({
        where: { id: entrevistaId },
        data: {
          status: 'CANCELADA',
          parecer_final:
            'Cancelada automaticamente — candidato pediu exclusão LGPD.',
        },
      });
      throw new Error('Candidato excluído após enfileirar — abortando bot.');
    }
    if (!entrevista.candidato.consentimento_gravacao_em) {
      throw new Error(
        'Consentimento de gravação foi revogado — abortando bot.',
      );
    }
    if (entrevista.bot_session_id) {
      this.logger.warn(
        `Bot já criado para entrevista ${entrevistaId}: ${entrevista.bot_session_id}`,
      );
      return { botId: entrevista.bot_session_id };
    }
    if (!entrevista.meet_url) {
      throw new Error(`Entrevista ${entrevistaId} sem meetUrl.`);
    }

    const webhookUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/webhooks/meetstream`;

    const out = await this.meetstream.criarBot({
      meetUrl: entrevista.meet_url,
      webhookUrl,
      nomeExibido: 'Bot Unifique — Recrutamento',
    });

    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: {
        bot_provider: 'meetstream',
        bot_session_id: out.botId,
        bot_status: out.status ?? 'criado',
        status: 'EM_ANDAMENTO',
        iniciada_em: new Date(),
      },
    });

    this.logger.log(
      `Bot criado: entrevista=${entrevistaId} botId=${out.botId}`,
    );
    return { botId: out.botId };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `bot-start falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
