import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { GupyService } from '../gupy.service.js';

/**
 * Sync agendado da Gupy — substitui o clique no botão "Sincronizar Gupy".
 *
 * O que ele faz: traz VAGAS (todos os status) e as CANDIDATURAS das vagas
 * vivas, gravando os dados novos. O que ele NÃO faz, por decisão explícita:
 *
 *  - Não re-embeda nem re-parseia nada que já está processado — o skip vive no
 *    `GupyService`/processors (`parser_versao` na versão atual) e no
 *    `EmbeddingService` (mesmo texto canônico ⇒ nenhuma chamada ao Voyage).
 *  - Não dispara avaliação em massa pelo Claude: ranking/scores continuam sob
 *    demanda na tela (`MATCHING_AUTO_ON_EMBED` segue `false`).
 *  - Nunca processa mais que `GUPY_SYNC_CRON_TETO_CVS` currículos novos por
 *    rodada. O que passar do teto fica gravado como candidatura e entra na
 *    próxima execução — o custo por rodada tem um limite superior conhecido.
 *
 * Intervalo: `GUPY_SYNC_CRON` (expressão cron, default a cada 6 horas).
 * Desligável com `GUPY_SYNC_CRON_ENABLED=false`.
 */
@Injectable()
export class GupySyncSchedulerService {
  private readonly logger = new Logger(GupySyncSchedulerService.name);

  constructor(private readonly gupy: GupyService) {}

  // A expressão é lida de process.env porque decorator é avaliado na definição
  // da classe (antes do ConfigService existir) — mesmo padrão dos @Processor.
  @Cron(process.env.GUPY_SYNC_CRON ?? '0 */6 * * *', { name: 'gupy-sync' })
  async sincronizar(): Promise<void> {
    if (process.env.GUPY_SYNC_CRON_ENABLED === 'false') return;

    const teto = Math.max(0, Number(process.env.GUPY_SYNC_CRON_TETO_CVS ?? 50));

    // Vagas primeiro: candidatura sem a vaga importada não tem onde pousar.
    // Ambos são idempotentes e têm guarda de execução simultânea própria — se a
    // rodada anterior ainda estiver de pé, `iniciado: false` e este tick passa.
    const vagas = this.gupy.iniciarSyncVagas();
    if (!vagas.iniciado) {
      this.logger.log('Sync de vagas anterior ainda em andamento — pulando tick.');
    }

    const cand = this.gupy.iniciarSyncCandidaturasTodas({ tetoCvsNovos: teto });
    if (!cand.iniciado) {
      this.logger.log(
        'Sync de candidaturas anterior ainda em andamento — pulando tick.',
      );
      return;
    }

    this.logger.log(
      `Sync agendado disparado (teto de ${teto} currículo(s) novo(s) nesta rodada).`,
    );
  }
}
