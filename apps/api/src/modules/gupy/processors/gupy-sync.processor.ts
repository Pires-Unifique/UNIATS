import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { GupyService } from '../gupy.service.js';

interface DadosSyncVaga {
  gupyId: string | number | bigint;
}

@Processor(QUEUE_NAMES.GUPY_SYNC, { concurrency: 2 })
export class GupySyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GupySyncProcessor.name);

  constructor(private readonly service: GupyService) {
    super();
  }

  async process(job: Job<DadosSyncVaga>): Promise<void> {
    const { gupyId } = job.data;
    const id = typeof gupyId === 'bigint' ? gupyId : BigInt(gupyId);
    if (job.name === 'sincronizar-vaga') {
      await this.service.sincronizarVaga(id);
    } else if (job.name === 'sincronizar-candidaturas-vaga') {
      await this.service.sincronizarCandidaturasDaVaga(id);
    } else {
      this.logger.warn(`Job desconhecido: ${job.name}`);
    }
  }
}
