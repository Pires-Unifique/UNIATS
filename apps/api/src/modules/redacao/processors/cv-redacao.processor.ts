import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { CurriculoRedacaoService } from '../curriculo-redacao.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

const PayloadSchema = z.object({
  curriculoId: z.string().uuid(),
  /** Ignora o skip por versão — usado quando o prompt muda. */
  forcar: z.boolean().optional(),
});

/**
 * Calcula o espelho censurado do currículo (o que pode sair para IA).
 *
 * Concorrência baixa por padrão: cada job é uma chamada Claude, e ela divide o
 * mesmo orçamento das outras — ranking, ATA, fusão de transcrição.
 */
@Processor(QUEUE_NAMES.CV_REDACAO, {
  concurrency: Number(process.env.REDACAO_CV_CONCURRENCY ?? 2),
})
export class CvRedacaoProcessor extends WorkerHost {
  private readonly logger = new Logger(CvRedacaoProcessor.name);

  constructor(private readonly servico: CurriculoRedacaoService) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ gerado: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em cv-redacao (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para cv-redacao.');
    }

    const { curriculoId, forcar } = parsed.data;
    const r = await this.servico.gerarEspelho(curriculoId, { forcar });
    return { gerado: r.gerado };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    // Falhar aqui não vaza nada: sem espelho, a fronteira omite os campos de
    // risco. O custo é ranking com menos sinal até o retry passar.
    this.logger.error(
      `cv-redacao falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
