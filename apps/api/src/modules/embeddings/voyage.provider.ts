import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { VoyageClient } from '../voyage/voyage.client.js';
import type { EmbedInput, EmbedOutput, EmbeddingProvider } from './embedding.provider.js';

/**
 * Provedor de embeddings via Voyage AI (API hospedada). Delega ao VoyageClient,
 * que já trata batching, retry e throttle (rate limit).
 */
@Injectable()
export class VoyageProvider implements EmbeddingProvider {
  readonly nome: string;
  readonly dimensoes: number;

  constructor(
    private readonly voyage: VoyageClient,
    config: ConfigService,
  ) {
    this.nome = config.get<string>('VOYAGE_MODEL') ?? 'voyage-3';
    this.dimensoes = config.get<number>('VOYAGE_DIMENSIONS') ?? 1024;
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    const out = await this.voyage.embed({
      textos: input.textos,
      inputType: input.inputType ?? 'document',
    });
    return {
      vetores: out.vetores,
      modelo: out.modelo,
      dimensoes: this.dimensoes,
      usage: out.usage,
    };
  }
}
