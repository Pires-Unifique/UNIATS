import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { GupyService } from '../gupy.service.js';

interface DadosJob {
  webhookId: string;
  event: string;
}

@Processor(QUEUE_NAMES.GUPY_WEBHOOK, { concurrency: 5 })
export class GupyWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(GupyWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: GupyService,
  ) {
    super();
  }

  async process(job: Job<DadosJob>): Promise<void> {
    const { webhookId, event } = job.data;

    const registro = await this.prisma.webhookRecebido.findUnique({
      where: { id: webhookId },
    });
    if (!registro) {
      this.logger.warn(`Webhook ${webhookId} não encontrado — abortando`);
      return;
    }
    if (registro.processado) {
      this.logger.log(`Webhook ${webhookId} já processado — skip`);
      return;
    }

    try {
      const payload = registro.payload as { data?: { id?: string | number } };
      const idStr = payload?.data?.id;
      if (idStr === undefined || idStr === null) {
        throw new Error('payload.data.id ausente');
      }
      const id = BigInt(idStr);

      switch (event) {
        case 'application.created':
        case 'application.moved':
        case 'application.hired':
        case 'application.rejected':
          await this.service.sincronizarCandidatura(id);
          break;
        case 'job.published':
        case 'job.updated':
          await this.service.sincronizarVaga(id);
          break;
        default:
          this.logger.warn(`Evento desconhecido ignorado: ${event}`);
      }

      await this.prisma.webhookRecebido.update({
        where: { id: webhookId },
        data: { processado: true, processado_em: new Date() },
      });
    } catch (err: any) {
      await this.prisma.webhookRecebido.update({
        where: { id: webhookId },
        data: {
          tentativas: { increment: 1 },
          ultimo_erro: String(err?.message ?? err).slice(0, 4000),
        },
      });
      throw err; // deixa o BullMQ aplicar o backoff
    }
  }
}
