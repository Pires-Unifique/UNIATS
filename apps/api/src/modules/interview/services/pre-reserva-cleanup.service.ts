import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@uniats/db';

import { GraphClient } from '../../graph/graph.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Limpeza de holds órfãos da pré-reserva. A cada 30 min remove os holds tentativos
 * de enquetes que: (a) foram CANCELADA (superada por nova enquete) ou (b) estão
 * AGUARDANDO mas vencidas (candidato não votou e a enquete é antiga) — liberando a
 * agenda dos participantes. Sem isto, holds de enquetes não confirmadas ficariam
 * presos na agenda. (No caminho feliz, os holds são apagados no auto-confirm.)
 */
@Injectable()
export class PreReservaCleanupService {
  private readonly logger = new Logger(PreReservaCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphClient,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'pre-reserva-cleanup' })
  async limparHoldsOrfaos(): Promise<void> {
    if (!this.graph.enabled) return;

    // AGUARDANDO vencida = sem voto após 3 dias. CANCELADA = superada (limpa logo).
    const limiteAguardando = new Date(Date.now() - 3 * 24 * 3600_000);
    const candidatas = await this.prisma.enqueteHorario.findMany({
      where: {
        // só linhas que ainda têm holds (evita varrer enquetes já limpas)
        NOT: { holds: { equals: Prisma.DbNull } },
        OR: [
          { status: 'CANCELADA' },
          { status: 'AGUARDANDO', criado_em: { lt: limiteAguardando } },
        ],
      },
      select: { id: true, holds: true },
      take: 100,
    });
    if (candidatas.length === 0) return;

    let removidos = 0;
    for (const enq of candidatas) {
      const holds = Array.isArray(enq.holds)
        ? (enq.holds as Array<{ participante?: string; eventId?: string }>)
        : [];
      for (const h of holds) {
        if (!h?.participante || !h?.eventId) continue;
        await this.graph
          .removerEvento(h.participante, h.eventId)
          .then(() => {
            removidos += 1;
          })
          .catch(() => undefined);
      }
      // Zera os holds (Prisma.DbNull = NULL na coluna) pra não reprocessar.
      await this.prisma.enqueteHorario
        .update({ where: { id: enq.id }, data: { holds: Prisma.DbNull } })
        .catch(() => undefined);
    }

    this.logger.log(
      `Pré-reserva cleanup: ${removidos} hold(s) removidos de ${candidatas.length} enquete(s) órfã(s).`,
    );
  }
}
