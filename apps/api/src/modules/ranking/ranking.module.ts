import { Module } from '@nestjs/common';

import { EmbeddingService } from './services/embedding.service.js';
import { EmbeddingProcessor } from './processors/embedding.processor.js';
import { MatchingProcessor } from './processors/matching.processor.js';
import { MatchingService } from './services/matching.service.js';
import { RankingController } from './ranking.controller.js';
import { RankingService } from './ranking.service.js';

/**
 * Camada 3 — Embeddings + Ranking
 *
 * Composição:
 *  - EmbeddingService: gera vetores via Voyage-3 e grava em pgvector.
 *  - MatchingService: pgvector + Claude para score híbrido (40%/60%).
 *  - Processors: workers de fila `embedding` e `matching`.
 *  - RankingService: orquestração e endpoints REST.
 *
 * Depende dos módulos globais VoyageModule + ClaudeModule (ambos exportam
 * seus services automaticamente via @Global).
 */
@Module({
  controllers: [RankingController],
  providers: [
    EmbeddingService,
    MatchingService,
    RankingService,
    EmbeddingProcessor,
    MatchingProcessor,
  ],
  exports: [EmbeddingService, MatchingService, RankingService],
})
export class RankingModule {}
