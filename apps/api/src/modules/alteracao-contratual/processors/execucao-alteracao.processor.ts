import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { AlteracaoContratualService } from '../alteracao-contratual.service.js';

const PayloadSchema = z.object({
  solicitacaoId: z.string().uuid(),
});

@Processor(QUEUE_NAMES.ALTERACAO_EXECUCAO, {
  concurrency: Number(process.env.ALTERACAO_EXECUCAO_CONCURRENCY ?? 2),
})
export class ExecucaoAlteracaoProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecucaoAlteracaoProcessor.name);

  constructor(private readonly service: AlteracaoContratualService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em alteracao-execucao (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para alteracao-execucao.');
    }
    await this.service.executar(parsed.data.solicitacaoId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `alteracao-execucao falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
