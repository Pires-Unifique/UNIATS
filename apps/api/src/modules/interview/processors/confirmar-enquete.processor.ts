import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { InterviewService } from '../services/interview.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Auto-confirm da pré-reserva: ao votar na enquete, o candidato dispara este job
 * (enfileirado por EnqueteService.registrarVoto). Roda o `confirmarPorEnquete` —
 * que cria a reunião no Teams, apaga os holds dos outros horários e agenda o envio
 * do link. Idempotente (jobId por enquete + a própria confirmação é idempotente).
 *
 * Lock generoso: confirmarPorEnquete chama o Graph (criar evento + transcrição),
 * que pode levar alguns segundos.
 */
const PayloadSchema = z.object({ enqueteId: z.string().uuid() });

@Processor(QUEUE_NAMES.CONFIRMAR_ENQUETE, {
  concurrency: Number(process.env.CONFIRMAR_ENQUETE_CONCURRENCY ?? 2),
  lockDuration: 2 * 60_000,
})
export class ConfirmarEnqueteProcessor extends WorkerHost {
  private readonly logger = new Logger(ConfirmarEnqueteProcessor.name);

  constructor(private readonly interview: InterviewService) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ enqueteId: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('Payload inválido para confirmar-enquete.');
    const { enqueteId } = parsed.data;

    const r = await this.interview.confirmarPorEnquete({ enqueteId });
    this.logger.log(
      `Auto-confirm ok: enquete=${enqueteId} entrevista=${r.entrevistaId} jaExistia=${r.jaExistia}`,
    );
    return { enqueteId, ok: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.warn(
      `confirmar-enquete falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
