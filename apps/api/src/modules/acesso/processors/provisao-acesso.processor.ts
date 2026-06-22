import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { ProvisaoAcessoService } from '../provisao-acesso.service.js';

const PayloadSchema = z.object({
  admissaoId: z.string().uuid(),
});
export type ProvisaoAcessoPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.PROVISAO_ACESSO, {
  concurrency: Number(process.env.PROVISAO_ACESSO_CONCURRENCY ?? 2),
})
export class ProvisaoAcessoProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisaoAcessoProcessor.name);

  constructor(private readonly service: ProvisaoAcessoService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em provisao-acesso (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para provisao-acesso.');
    }
    await this.service.processar(parsed.data.admissaoId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `provisao-acesso falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
