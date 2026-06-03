import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EMBEDDING_PROVIDER } from './embedding.provider.js';
import { LocalProvider } from './local.provider.js';
import { VoyageProvider } from './voyage.provider.js';

/**
 * Seleciona o provedor de embeddings via `EMBEDDING_PROVIDER` (voyage | local).
 * Global: qualquer módulo pode injetar o token EMBEDDING_PROVIDER.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    VoyageProvider,
    LocalProvider,
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService, VoyageProvider, LocalProvider],
      useFactory: (
        config: ConfigService,
        voyage: VoyageProvider,
        local: LocalProvider,
      ) => {
        const escolha = config.get<string>('EMBEDDING_PROVIDER') ?? 'voyage';
        return escolha === 'local' ? local : voyage;
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingsModule {}
