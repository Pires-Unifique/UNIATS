import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { REDACAO_CV_VERSAO } from './curriculo-para-ia.js';

/**
 * ÚNICO produtor da fila `cv-redacao`.
 *
 * Enfileira, a cada tick, um LOTE PEQUENO de currículos sem espelho na versão
 * atual. Não enfileira tudo de uma vez de propósito: cada job é uma chamada
 * Claude, e despejar o acervo inteiro na fila é como se queimaram 8M de tokens
 * do Voyage em junho — a fila aceita, o provedor não.
 *
 * ┌─ POR QUE O SYNC DA GUPY NÃO ENFILEIRA ───────────────────────────────────┐
 * │ Seria o caminho óbvio (currículo novo → job na hora), mas colocaria uma  │
 * │ chamada Claude por currículo dentro do sync, que já é o ponto caro e não │
 * │ tem orçamento para isso. Uma consulta só, aqui, cobre TODOS os casos:    │
 * │ currículo novo, currículo antigo de antes desta funcionalidade, job que  │
 * │ falhou e reprocessamento quando REDACAO_CV_VERSAO muda.                  │
 * │                                                                          │
 * │ O custo é latência: um currículo novo espera até um tick para ter o      │
 * │ espelho. Nesse intervalo o ranking dele roda com o histórico estruturado │
 * │ e sem as descrições — degradado, nunca vazando.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Desligável por REDACAO_RECONCILE_ENABLED=false.
 */
@Injectable()
export class RedacaoReconciliationService {
  private readonly logger = new Logger(RedacaoReconciliationService.name);
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.CV_REDACAO) private readonly fila: Queue,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'redacao-cv-reconcile' })
  async reconciliar(): Promise<void> {
    if (process.env.REDACAO_RECONCILE_ENABLED === 'false') return;
    if (this.rodando) {
      this.logger.debug('Reconciliação anterior em andamento — pulando tick.');
      return;
    }
    this.rodando = true;
    try {
      const lote = Number(process.env.REDACAO_RECONCILE_BATCH ?? 20);

      const pendentes = await this.prisma.curriculoProcessado.findMany({
        where: {
          OR: [
            { ia_redacao_versao: null },
            { ia_redacao_versao: { not: REDACAO_CV_VERSAO } },
          ],
        },
        select: { id: true },
        take: lote,
      });
      if (!pendentes.length) return;

      for (const cv of pendentes) {
        // jobId estável: reenfileirar o mesmo currículo antes de processar não
        // duplica trabalho.
        await this.fila.add(
          'espelho-ia',
          { curriculoId: cv.id },
          { jobId: `cv-redacao-${cv.id}` },
        );
      }

      this.logger.log(
        `Reconciliação do espelho: ${pendentes.length} currículo(s) enfileirado(s).`,
      );
    } catch (err) {
      this.logger.error(
        `Falha na reconciliação do espelho: ${(err as Error).message}`,
      );
    } finally {
      this.rodando = false;
    }
  }

  /** Quantos currículos ainda faltam — usado para acompanhar o backfill. */
  async pendentes(): Promise<number> {
    return this.prisma.curriculoProcessado.count({
      where: {
        OR: [
          { ia_redacao_versao: null },
          { ia_redacao_versao: { not: REDACAO_CV_VERSAO } },
        ],
      },
    });
  }
}
