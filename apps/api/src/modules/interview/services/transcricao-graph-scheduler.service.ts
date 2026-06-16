import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';

import { GraphClient } from '../../graph/graph.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Pull automático do transcript oficial do Teams (via Graph).
 *
 * A cada 5 min varre entrevistas Teams que JÁ terminaram (fim estimado +
 * DELAY_MIN, para o Teams indexar) e ainda não têm transcript do Graph, e
 * enfileira `transcrever-graph`. O job em si re-tenta enquanto o transcript não
 * fica disponível; o agendador só re-enfileira dentro de uma janela (MAX_WINDOW)
 * para não tentar pra sempre quando a reunião não teve transcrição.
 *
 * Não coloca bot na sala — o Teams transcreve nativamente; aqui só baixamos.
 * Só age se o Graph estiver configurado.
 */
@Injectable()
export class TranscricaoGraphSchedulerService {
  private readonly logger = new Logger(TranscricaoGraphSchedulerService.name);
  private readonly enabled: boolean;
  private readonly delayMin: number;
  private readonly maxWindowMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphClient,
    config: ConfigService,
    @InjectQueue(QUEUE_NAMES.TRANSCRICAO_GRAPH)
    private readonly filaGraph: Queue,
  ) {
    this.enabled = config.get<boolean>('GRAPH_TRANSCRICAO_AUTO_ENABLED') ?? true;
    this.delayMin = config.get<number>('GRAPH_TRANSCRICAO_DELAY_MIN') ?? 13;
    this.maxWindowMin = config.get<number>('GRAPH_TRANSCRICAO_MAX_WINDOW_MIN') ?? 180;
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'graph-transcript-auto' })
  async dispararTranscriptsProntos(): Promise<void> {
    if (!this.enabled || !this.graph.enabled) return;

    const agora = Date.now();
    // Limite inferior defensivo: só olha entrevistas das últimas (maxWindow + 4h),
    // calculando o fim exato em código (agendada_para + duração).
    const limiteInferior = new Date(
      agora - (this.maxWindowMin + 240) * 60_000,
    );

    const candidatas = await this.prisma.entrevista.findMany({
      where: {
        status: { in: ['AGENDADA', 'EM_ANDAMENTO'] as never },
        teams_join_url: { not: null },
        agendada_para: { gte: limiteInferior, lte: new Date(agora) },
      },
      select: {
        id: true,
        agendada_para: true,
        duracao_estimada_min: true,
        transcricao: { select: { provider: true, texto_completo: true } },
      },
      take: 100,
    });
    if (candidatas.length === 0) return;

    let enfileiradas = 0;
    for (const e of candidatas) {
      // Já tem transcript do Graph com texto? pula.
      if (
        e.transcricao?.provider === 'graph' &&
        e.transcricao.texto_completo.trim()
      ) {
        continue;
      }
      const fimEstimado =
        e.agendada_para.getTime() + (e.duracao_estimada_min ?? 30) * 60_000;
      const desde = agora - fimEstimado;
      // Janela: terminou há pelo menos DELAY e no máximo MAX_WINDOW.
      if (desde < this.delayMin * 60_000) continue; // ainda não terminou + buffer
      if (desde > this.maxWindowMin * 60_000) continue; // velha demais — desiste

      await this.filaGraph.add(
        'transcrever-graph',
        { entrevistaId: e.id },
        {
          jobId: `graph-transcript-${e.id}`,
          attempts: 12,
          backoff: { type: 'fixed', delay: 180_000 },
        },
      );
      enfileiradas++;
    }
    if (enfileiradas > 0) {
      this.logger.log(
        `Pull automático Graph: ${enfileiradas} transcript(s) enfileirado(s) ` +
          `de ${candidatas.length} candidata(s).`,
      );
    }
  }
}
