import { z } from 'zod';

/**
 * Configuração do bot via ambiente. Falha rápido se algo essencial faltar.
 *
 * O bot é stateless: recebe jobs `playwright-join` pela fila BullMQ (mesmo Redis
 * da API) e devolve o resultado por callback HTTP interno (`API_INTERNAL_URL`).
 */
const Schema = z.object({
  // Fila — DEVE casar com REDIS_URL/REDIS_QUEUE_PREFIX/QUEUE_NAMES da API.
  REDIS_URL: z.string().url().startsWith('redis'),
  REDIS_QUEUE_PREFIX: z.string().min(1).default('uniats'),
  PLAYWRIGHT_QUEUE: z.string().min(1).default('playwright-join'),
  PLAYWRIGHT_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Callback interno para devolver a transcrição capturada.
  API_INTERNAL_URL: z.string().url(), // ex.: http://api:13001
  PLAYWRIGHT_CALLBACK_SECRET: z.string().min(8),

  // Identidade exibida do bot na sala.
  PLAYWRIGHT_DISPLAY_NAME: z.string().min(1).default('Assistente de Transcrição (UniATS)'),

  // Chromium. Teams web às vezes recusa headless puro; default headless "new".
  // Em produção rodamos via xvfb-run (headful) se HEADLESS=false.
  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Quanto tempo esperar ser admitido do lobby antes de desistir.
  PLAYWRIGHT_LOBBY_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // Teto duro de permanência na sala (min) — protege contra reunião que nunca encerra.
  PLAYWRIGHT_MAX_DURACAO_MIN: z.coerce.number().int().positive().default(180),
  // Encerra se a sala ficar sem captura nova por este tempo (min) E já passou do início.
  PLAYWRIGHT_OCIOSIDADE_MIN: z.coerce.number().int().positive().default(10),
  // Idioma das legendas a forçar no Teams (best-effort).
  PLAYWRIGHT_CAPTION_LANG: z.string().min(2).default('pt-br'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),
});

export type BotConfig = z.infer<typeof Schema>;

export function loadConfig(): BotConfig {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config do bot inválida:\n${issues}`);
  }
  return parsed.data;
}
