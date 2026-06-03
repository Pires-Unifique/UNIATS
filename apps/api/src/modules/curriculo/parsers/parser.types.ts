export interface TextoExtraido {
  /** Texto cru, sem normalização forte (preserva linhas e tabulações). */
  bruto: string;
  /** Texto normalizado para indexação/LLM (sem múltiplos espaços, sem caracteres de controle). */
  normalizado: string;
  /** Páginas (PDF) ou null se não aplicável. */
  paginas?: number;
  /** Nome canônico do parser que produziu o resultado. */
  parser: 'pdf' | 'docx' | 'txt';
}

export type ContentTypeSuportado =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword'
  | 'text/plain';

export const CONTENT_TYPES_SUPORTADOS: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword', // .doc legado — tratamos como erro amigável
  'text/plain',
];
