import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RedacaoService } from './redacao.service.js';

/**
 * Censura LGPD de transcrições/resumos. Global (como o ClaudeModule) para os
 * processors de transcrição injetarem o RedacaoService sem acoplar imports.
 * Depende do ClaudeService (já global) para a Camada 2 semântica.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedacaoService],
  exports: [RedacaoService],
})
export class RedacaoModule {}
