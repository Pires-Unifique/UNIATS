import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EMBEDDING_PROVIDER } from './embedding.provider.js';
import { VoyageProvider } from './voyage.provider.js';

/**
 * Provedor de embeddings: Voyage AI (único suportado).
 * O provedor local (@xenova/transformers) foi removido — nunca foi usado em
 * produção e trazia uma subárvore de dependências vulneráveis (protobufjs/onnx).
 * Global: qualquer módulo pode injetar o token EMBEDDING_PROVIDER.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    VoyageProvider,
    { provide: EMBEDDING_PROVIDER, useExisting: VoyageProvider },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingsModule {}
