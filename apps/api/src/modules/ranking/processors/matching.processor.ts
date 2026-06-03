import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { MatchingService } from '../services/matching.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

const PayloadSchema = z.object({
  candidaturaId: z.string().uuid(),
  vagaId: z.string().uuid(),
});
export type MatchingPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.MATCHING, {
  concurrency: Number(process.env.MATCHING_CONCURRENCY ?? 2),
})
export class MatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchingProcessor.name);

  constructor(private readonly matching: MatchingService) {
    super();
  }

  async process(job: Job<unknown>): Promise<{
    candidaturaId: string;
    scoreConsolidado: number;
  }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em matching (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para matching.');
    }
    const { candidaturaId } = parsed.data;

    const item = await this.matching.scorearCandidatura(candidaturaId);

    this.logger.log(
      `Score consolidado=${item.scoreConsolidado.toFixed(1)} candidatura=${candidaturaId} ` +
        `(vetorial=${item.similaridadeVetorial.toFixed(1)} llm=${item.scoreRankingCv?.toFixed(1) ?? '-'})`,
    );

    return {
      candidaturaId,
      scoreConsolidado: item.scoreConsolidado,
    };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `matching falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
