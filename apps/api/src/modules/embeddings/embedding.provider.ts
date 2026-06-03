/**
 * Abstração de provedor de embeddings.
 *
 * Permite trocar a fonte dos vetores (Voyage hospedado x modelo local via
 * transformers.js) sem tocar no resto do pipeline (embedding.service, matching).
 * O provedor concreto é escolhido por env `EMBEDDING_PROVIDER` (voyage | local).
 */

export type EmbeddingInputType = 'document' | 'query';

export interface EmbedInput {
  textos: string[];
  /** 'document' para indexar (CVs/vagas), 'query' para buscas. */
  inputType?: EmbeddingInputType;
}

export interface EmbedOutput {
  vetores: number[][];
  /** Identificador do modelo usado (vai para a coluna `modelo` em scores/embeddings). */
  modelo: string;
  /** Dimensão dos vetores retornados. */
  dimensoes: number;
  /** Telemetria opcional (Voyage reporta tokens; local não). */
  usage?: { total_tokens?: number };
}

export interface EmbeddingProvider {
  /** Nome curto e estável do provedor/modelo (ex.: 'voyage-3', 'local:multilingual-e5-base'). */
  readonly nome: string;
  /** Dimensão fixa esperada dos vetores deste provedor. */
  readonly dimensoes: number;
  embed(input: EmbedInput): Promise<EmbedOutput>;
}

/** Token de injeção do provedor ativo. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
