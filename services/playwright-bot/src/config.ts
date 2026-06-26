import { z } from 'zod';

/**
 * Booleano vindo de ambiente. `z.coerce.boolean()` trata QUALQUER string não-vazia
 * como `true` — inclusive `"false"` (era o bug que fazia `PLAYWRIGHT_HEADLESS="false"`
 * do compose virar headless). Aqui só "true"/"1"/"yes"/"sim"/"on" (sem caixa) são
 * `true`; vazio/ausente cai no default.
 */
const envBool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes', 'sim', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

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
  PLAYWRIGHT_DISPLAY_NAME: z.string().min(1).default('Recrutadora Monique'),

  // Chromium. Teams web às vezes recusa headless puro; default headless "new".
  // Em produção rodamos via xvfb-run (headful) se HEADLESS=false.
  PLAYWRIGHT_HEADLESS: envBool(true),
  PLAYWRIGHT_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Quanto tempo esperar ser admitido do lobby antes de desistir.
  PLAYWRIGHT_LOBBY_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // Teto duro de permanência na sala (min) — protege contra reunião que nunca encerra.
  PLAYWRIGHT_MAX_DURACAO_MIN: z.coerce.number().int().positive().default(180),
  // Encerra se a sala ficar sem captura nova por este tempo (min) E já passou do início.
  PLAYWRIGHT_OCIOSIDADE_MIN: z.coerce.number().int().positive().default(10),
  // Idioma das legendas a forçar no Teams (best-effort).
  PLAYWRIGHT_CAPTION_LANG: z.string().min(2).default('pt-br'),

  // 2º motor (Whisper local) — captura o áudio da sala e transcreve em batch p/
  // cruzar com o transcript oficial do Graph (anti-alucinação). Desligado por padrão.
  WHISPER_ENABLED: envBool(false),
  WHISPER_MODEL: z.string().min(1).default('medium'),
  WHISPER_LANG: z.string().min(2).default('pt'),
  WHISPER_SCRIPT: z.string().min(1).default('/app/transcribe.py'),
  // Sink PulseAudio onde o Chromium toca o áudio da reunião (gravamos o monitor).
  MEETBOT_AUDIO_SINK: z.string().min(1).default('meetbot'),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  LOG_PRETTY: envBool(false),
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
