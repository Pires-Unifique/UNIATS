/**
 * Tipos públicos do WAHA client. Mantemos shapes mínimos — o restante da resposta
 * do WAHA é repassada como `unknown` para evitar acoplamento a versões do engine.
 */

export type WahaChatId =
  | `${string}@c.us` // DM
  | `${string}@g.us` // grupo
  | `${string}@newsletter`; // canal

export interface EnviarTextoInput {
  chatId: WahaChatId;
  texto: string;
  /** Desativa preview de link (recrutamento: links de portal/agendamento). */
  linkPreview?: boolean;
  /** Reply-to (mensagem do candidato que estamos respondendo). */
  replyTo?: string;
}

export interface EnviarMidiaInput {
  chatId: WahaChatId;
  /** URL pública (HTTPS) OU base64 inline. */
  arquivo: { url: string } | { dataBase64: string; mimeType: string };
  nomeArquivo?: string;
  legenda?: string;
}

export interface EnviarResultado {
  /** ID retornado pelo WAHA para a mensagem (`true_xxx@c.us_AAAA`). */
  messageId: string;
  /** Timestamp epoch ms. */
  timestamp: number;
}

export interface CheckNumberResult {
  numberExists: boolean;
  chatId?: WahaChatId;
}
