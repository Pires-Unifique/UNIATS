import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@uniats/db';

import { EmbeddingService } from './embedding.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Cron de reconciliação de embeddings (backfill + cura de falhas).
 *
 * A cada tick, pega algumas VAGAS que ainda têm CVs sem vetor e embeda cada uma
 * EM LOTE (1 chamada ao provider por vaga, via embedarVagaEmLote), em vez de uma
 * chamada por CV. Isso minimiza o número de requisições (crucial sob rate limit)
 * e deixa o throttle livre para o fluxo sob demanda.
 *
 * Desligável por EMBEDDING_RECONCILE_ENABLED=false. Vagas por tick: EMBEDDING_RECONCILE_BATCH.
 */
@Injectable()
export class EmbeddingReconciliationService {
  private readonly logger = new Logger(EmbeddingReconciliationService.name);
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'embedding-reconcile' })
  async reconciliar(): Promise<void> {
    if (process.env.EMBEDDING_RECONCILE_ENABLED === 'false') return;
    if (this.rodando) {
      this.logger.debug('Reconciliação anterior ainda em andamento — pulando tick.');
      return;
    }
    this.rodando = true;
    try {
      const maxVagas = Number(process.env.EMBEDDING_RECONCILE_BATCH ?? 3);

      // Vagas com CVs estruturados que ainda não têm vetor.
      const vagas = await this.prisma.$queryRaw<Array<{ vaga_id: string }>>(
        Prisma.sql`
          SELECT DISTINCT c.vaga_id
          FROM candidaturas c
          JOIN curriculos_processados cp ON cp.candidatura_id = c.id
          WHERE cp.parser_versao IS NOT NULL
            AND cp.parser_versao <> 'pending'
            AND NOT EXISTS (
              SELECT 1 FROM embeddings e WHERE e.curriculo_id = cp.id
            )
          LIMIT ${maxVagas}
        `,
      );

      let totalCvs = 0;
      for (const v of vagas) {
        try {
          const r = await this.embeddings.embedarVagaEmLote(v.vaga_id);
          totalCvs += r.curriculos;
        } catch (err) {
          this.logger.warn(
            `Reconciliação da vaga ${v.vaga_id} falhou: ${(err as Error).message}`,
          );
        }
      }

      if (totalCvs > 0) {
        this.logger.log(
          `Reconciliação (lote): ${totalCvs} CV(s) embedados em ${vagas.length} vaga(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Falha na reconciliação de embeddings: ${(err as Error).message}`,
      );
    } finally {
      this.rodando = false;
    }
  }
}
