/**
 * Tipos públicos do módulo Storage.
 * Mantém o domínio desacoplado do SDK específico (AWS S3, MinIO, Azure Blob).
 */

export type StorageObjectKind =
  | 'curriculo'
  | 'audio'
  | 'transcricao'
  | 'template'
  | 'documento-admissional'
  | 'offboarding-doc'
  | 'offboarding-assinado'
  | 'tmp';

export interface PutObjectInput {
  /** Buffer com o conteúdo a salvar. */
  body: Buffer;
  /** Content-Type detectado (ex.: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document). */
  contentType: string;
  /** Metadados opcionais (são armazenados como x-amz-meta-*). NUNCA inclua PII aqui. */
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  bucket: string;
  key: string;
  /** SHA-256 hexadecimal do conteúdo — fonte de verdade para deduplicação. */
  sha256: string;
  /** ETag retornado pelo provedor (útil para concorrência otimista). */
  etag?: string;
  /** Bytes do payload. */
  size: number;
}

export interface GetObjectResult {
  body: Buffer;
  contentType: string;
  size: number;
  metadata?: Record<string, string>;
}

export interface BuildKeyInput {
  kind: StorageObjectKind;
  /** Hash sha256 do conteúdo — entra no path para deduplicação determinística. */
  sha256: string;
  /** Extensão sem ponto (pdf, docx, mp3). */
  extension: string;
}
