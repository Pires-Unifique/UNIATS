import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';

import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { AlteracaoContratualService } from '../alteracao-contratual.service.js';

/**
 * Agenda a EXECUÇÃO das alterações no dia exato. Roda 1×/dia (cedo) e enfileira
 * as solicitações AGENDADA cuja `data_aplicacao` já chegou. O `jobId` determinístico
 * evita enfileirar a mesma solicitação duas vezes no mesmo ciclo.
 *
 * Gated por ALTERACAO_EXECUCAO_ENABLED (no espírito dos demais schedulers).
 */
@Injectable()
export class ExecucaoSchedulerService {
  private readonly logger = new Logger(ExecucaoSchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly service: AlteracaoContratualService,
    @InjectQueue(QUEUE_NAMES.ALTERACAO_EXECUCAO)
    private readonly fila: Queue,
  ) {
    this.enabled =
      this.config.get<boolean>('ALTERACAO_EXECUCAO_ENABLED') ?? true;
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'alteracao-execucao' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    let ids: string[];
    try {
      ids = await this.service.devidasParaExecucao();
    } catch (err) {
      this.logger.error(
        `Falha ao buscar alterações devidas: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    for (const id of ids) {
      await this.fila.add(
        'executar',
        { solicitacaoId: id },
        { jobId: `exec-${id}` },
      );
    }
    if (ids.length > 0) {
      this.logger.log(`${ids.length} alteração(ões) enfileirada(s) para execução.`);
    }
  }
}
