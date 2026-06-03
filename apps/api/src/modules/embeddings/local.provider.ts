import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EmbedInput, EmbedOutput, EmbeddingProvider } from './embedding.provider.js';

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Dimensão default de modelos conhecidos (pode ser sobrescrita por EMBEDDING_DIMENSIONS). */
const DIMENSOES_CONHECIDAS: Record<string, number> = {
  'Xenova/multilingual-e5-base': 768,
  'Xenova/multilingual-e5-small': 384,
  'Xenova/multilingual-e5-large': 1024,
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': 384,
  'Xenova/paraphrase-multilingual-mpnet-base-v2': 768,
};

/**
 * Provedor de embeddings LOCAL via @xenova/transformers (ONNX em CPU).
 * Sem rate limit, sem custo por request, dados não saem do servidor (LGPD).
 *
 * Default: Xenova/multilingual-e5-base (retrieval multilíngue, 512 tokens, 768d).
 * Modelos e5 exigem prefixo "query:"/"passage:" — aplicado automaticamente.
 */
@Injectable()
export class LocalProvider implements EmbeddingProvider {
  private readonly logger = new Logger(LocalProvider.name);
  readonly nome: string;
  readonly dimensoes: number;
  private readonly modelId: string;
  private readonly ehE5: boolean;
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  constructor(config: ConfigService) {
    this.modelId =
      config.get<string>('EMBEDDING_LOCAL_MODEL') ?? 'Xenova/multilingual-e5-base';
    this.nome = `local:${this.modelId.split('/').pop()}`;
    this.ehE5 = /e5/i.test(this.modelId);
    this.dimensoes =
      config.get<number>('EMBEDDING_DIMENSIONS') ??
      DIMENSOES_CONHECIDAS[this.modelId] ??
      768;
  }

  /** Carrega o pipeline uma única vez (lazy). Import dinâmico: o pacote é ESM. */
  private async getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { pipeline } = await import('@xenova/transformers');
        this.logger.log(
          `Carregando modelo local "${this.modelId}" (na 1ª vez baixa ~100-300MB)…`,
        );
        const extractor = (await pipeline(
          'feature-extraction',
          this.modelId,
        )) as unknown as FeatureExtractor;
        this.logger.log(`Modelo local "${this.modelId}" pronto.`);
        return extractor;
      })();
    }
    return this.extractorPromise;
  }

  private prefixar(textos: string[], tipo: 'document' | 'query'): string[] {
    if (!this.ehE5) return textos;
    const p = tipo === 'query' ? 'query: ' : 'passage: ';
    return textos.map((t) => p + t);
  }

  async embed(input: EmbedInput): Promise<EmbedOutput> {
    if (!input.textos.length) throw new Error('embed: array de textos vazio.');
    const extractor = await this.getExtractor();
    const tipo = input.inputType ?? 'document';
    const entradas = this.prefixar(
      input.textos.map((t) => (t ?? '').trim()),
      tipo,
    );

    const saida = await extractor(entradas, { pooling: 'mean', normalize: true });
    const vetores = saida.tolist();
    const dim = vetores[0]?.length ?? this.dimensoes;

    return {
      vetores,
      modelo: this.nome,
      dimensoes: dim,
      usage: undefined,
    };
  }
}
