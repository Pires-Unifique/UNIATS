import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CurriculoRedacaoService } from './curriculo-redacao.service.js';
import { CvRedacaoProcessor } from './processors/cv-redacao.processor.js';
import { RedacaoReconciliationService } from './redacao-reconciliation.service.js';
import { RedacaoService } from './redacao.service.js';

/**
 * Censura LGPD. Global (como o ClaudeModule) para os processors de transcrição
 * injetarem o RedacaoService sem acoplar imports. Depende do ClaudeService (já
 * global) para a Camada 2 semântica.
 *
 * Dois modelos convivem aqui de propósito:
 *
 *  - TRANSCRIÇÃO: censura ANTES de persistir. O texto cru nunca toca o banco.
 *  - CURRÍCULO: persiste íntegro e censura na SAÍDA para IA — o recrutador
 *    precisa ver o currículo completo (decisão da área de segurança). O espelho
 *    censurado vive nas colunas `ia_*` e é o único que atravessa a fronteira.
 *    Ver `curriculo-para-ia.ts`.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedacaoService,
    CurriculoRedacaoService,
    CvRedacaoProcessor,
    RedacaoReconciliationService,
  ],
  exports: [RedacaoService, CurriculoRedacaoService],
})
export class RedacaoModule {}
