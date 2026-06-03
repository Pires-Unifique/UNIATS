export type VoyageInputType = 'document' | 'query';

export interface VoyageEmbedding {
  vetor: number[];
  /** Tokens consumidos por este input (Voyage retorna no usage agregado). */
}

export interface VoyageUsage {
  total_tokens: number;
}

export interface EmbedRequest {
  textos: string[];
  /**
   * Use 'document' para indexar (curriculos, vagas armazenadas);
   * 'query' para buscas (não usado neste fluxo — Voyage-3 não exige).
   */
  inputType?: VoyageInputType;
}

export interface EmbedResponse {
  vetores: number[][];
  modelo: string;
  modeloVersao?: string;
  usage: VoyageUsage;
}
