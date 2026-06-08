import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { EmbeddingService } from '../services/embedding.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

const PayloadSchema = z.discriminatedUnion('alvo', [
  z.object({
    alvo: z.literal('curriculo'),
    candidaturaId: z.string().uuid(),
    // Se true, dispara o Claude (matching) logo após o embedding.
    // Default: NÃO cascateia — o Claude é sob demanda (top-N via fluxo vetorial).
    cascataMatching: z.boolean().optional(),
  }),
  z.object({
    alvo: z.literal('vaga'),
    vagaId: z.string().uuid(),
  }),
]);
export type EmbeddingPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.EMBEDDING, {
  concurrency: Number(process.env.EMBEDDING_CONCURRENCY ?? 2),
})
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    private readonly embeddings: EmbeddingService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.MATCHING) private readonly filaMatching: Queue,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ embeddingId: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em embedding (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para embedding.');
    }

    if (parsed.data.alvo === 'vaga') {
      return this.embeddings.embedarVaga(parsed.data.vagaId);
    }

    const { candidaturaId } = parsed.data;
    const out = await this.embeddings.embedarCurriculo(candidaturaId);

    // O Claude (matching) só roda automaticamente se explicitamente pedido no job
    // ou se MATCHING_AUTO_ON_EMBED=true. Por padrão, o embedding é barato/automático
    // e o Claude é sob demanda (top-N via fluxo vetorial) — evita rodar LLM em todos.
    const autoMatching =
      parsed.data.cascataMatching === true ||
      process.env.MATCHING_AUTO_ON_EMBED === 'true';

    if (autoMatching) {
      const candidatura = await this.prisma.candidatura.findUnique({
        where: { id: candidaturaId },
        select: { vaga_id: true },
      });
      if (candidatura) {
        await this.filaMatching.add(
          'matching-candidatura',
          { candidaturaId, vagaId: candidatura.vaga_id },
          { jobId: `match-${candidaturaId}` },
        );
      } else {
        this.logger.warn(
          `Candidatura ${candidaturaId} sumiu antes de cascatear matching.`,
        );
      }
    }

    return out;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `embedding falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
