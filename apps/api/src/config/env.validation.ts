import { z } from 'zod';

/**
 * Esquema único de validação do ambiente.
 * Falha rápido na inicialização se algo crítico estiver faltando.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  REDIS_URL: z.string().url().startsWith('redis'),
  REDIS_QUEUE_PREFIX: z.string().min(1).default('uniats'),

  // Azure AD (login dos usuários internos).
  // MVP: autenticação local de dev — Azure AD opcional até o SSO ser ligado.
  AZURE_AD_TENANT_ID: z.string().min(1).optional(),
  AZURE_AD_CLIENT_ID: z.string().min(1).optional(),
  AZURE_AD_AUDIENCE: z.string().min(1).default('api://uniats-api'),
  AZURE_AD_ALLOWED_DOMAIN: z.string().min(1).default('unifique.com.br'),

  // Gupy
  GUPY_API_BASE_URL: z.string().url(),
  // API de estrutura organizacional (departamentos/cargos/filiais) — base distinta.
  GUPY_OS_API_BASE_URL: z.string().url().default('https://api.gupy.io/os/v1'),
  GUPY_API_TOKEN: z.string().min(20, 'Token Gupy parece curto demais'),
  // Opcional no MVP: necessário só para RECEBER webhooks da Gupy.
  // O sync via API key (POST /api/gupy/sync/...) não depende disto.
  GUPY_WEBHOOK_SECRET: z
    .string()
    .min(16, 'Segredo HMAC deve ter ≥16 chars')
    .optional(),
  GUPY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  GUPY_RATE_LIMIT_RPS: z.coerce.number().int().positive().default(5),
  GUPY_RETRY_MAX: z.coerce.number().int().nonnegative().default(4),
  GUPY_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),

  // Storage (S3/MinIO)
  STORAGE_PROVIDER: z
    .enum(['minio', 's3', 'azure-blob', 'local'])
    .default('minio'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(8),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // Voyage AI (Camada 3 — embeddings)
  // Opcional no MVP: sem Voyage, o ranking por embeddings fica desabilitado.
  VOYAGE_API_KEY: z.string().min(20, 'API key Voyage parece inválida').optional(),
  VOYAGE_API_BASE_URL: z.string().url().default('https://api.voyageai.com'),
  VOYAGE_MODEL: z.string().default('voyage-3'),
  VOYAGE_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  VOYAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  VOYAGE_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  // Rate limit client-side (evita 429). Ajuste conforme o tier da chave:
  // trial ≈ 3 RPM; tiers pagos chegam a centenas. minTime = 60000/RPM.
  VOYAGE_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(3),
  VOYAGE_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),

  // Provedor de embeddings: 'voyage' (API hospedada) ou 'local' (transformers.js).
  EMBEDDING_PROVIDER: z.enum(['voyage', 'local']).default('voyage'),
  // Modelo local (só quando EMBEDDING_PROVIDER=local).
  EMBEDDING_LOCAL_MODEL: z.string().default('Xenova/multilingual-e5-base'),
  // Sobrescreve a dimensão esperada (senão usa o default do modelo). Deve bater
  // com a dimensão da coluna pgvector `embeddings.vetor`.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),

  // Workers de embedding/ranking (Camada 3)
  EMBEDDING_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MATCHING_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MATCHING_TOP_K: z.coerce.number().int().positive().max(100).default(20),
  // Tamanho do lote avaliado pelo Claude por vez no fluxo vetorial (top-N / "próximos").
  MATCHING_TOP_N: z.coerce.number().int().positive().max(100).default(10),
  // Se true, o embedding de um CV dispara o Claude automaticamente (comportamento
  // antigo: LLM em todos). Default false: Claude é sob demanda (top-N vetorial).
  MATCHING_AUTO_ON_EMBED: z.coerce.boolean().default(false),
  // Cron de reconciliação: re-embeda CVs/vagas sem vetor (cura falhas + backfill).
  EMBEDDING_RECONCILE_ENABLED: z.coerce.boolean().default(true),
  EMBEDDING_RECONCILE_BATCH: z.coerce.number().int().positive().default(3),
  // Lote adaptativo de embedding por ORÇAMENTO DE TOKENS (limite real do Voyage).
  // EMBEDDING_TOKEN_BUDGET: tokens estimados por requisição (trial ~6000; tier pago
  // pode subir muito). EMBEDDING_BATCH_SIZE: teto de inputs por requisição (máx 128).
  EMBEDDING_TOKEN_BUDGET: z.coerce.number().int().positive().default(6000),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(128).default(128),

  // WAHA — WhatsApp HTTP API (Camada 4)
  WAHA_BASE_URL: z.string().url(),
  WAHA_SESSION: z.string().min(1).default('default'),
  // Opcional no MVP: sem WAHA, o envio por WhatsApp fica desabilitado.
  WAHA_API_KEY: z.string().min(8, 'WAHA_API_KEY parece curta demais').optional(),
  WAHA_WEBHOOK_SECRET: z.string().min(16).optional(),
  WAHA_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  WAHA_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  WAHA_TYPING_MS: z.coerce.number().int().nonnegative().default(1500),

  // SendGrid (Camada 4)
  SENDGRID_API_KEY: z.string().startsWith('SG.').optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  SENDGRID_FROM_NAME: z.string().min(1).optional(),
  SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().optional(),

  // Worker de mensageria
  MENSAGEM_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // MeetStream (Camada 4b — bot de entrevista)
  MEETSTREAM_API_KEY: z.string().min(8).optional(),
  MEETSTREAM_BASE_URL: z.string().url().default('https://api.meetstream.ai'),
  MEETSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MEETSTREAM_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  MEETSTREAM_WEBHOOK_SECRET: z.string().min(16).optional(),

  // AssemblyAI (Camada 4c — transcrição)
  ASSEMBLYAI_API_KEY: z.string().min(20).optional(),
  ASSEMBLYAI_LANGUAGE_CODE: z.string().min(2).default('pt'),
  ASSEMBLYAI_SPEAKER_LABELS: z.coerce.boolean().default(true),
  ASSEMBLYAI_SENTIMENT_ANALYSIS: z.coerce.boolean().default(true),
  ASSEMBLYAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  ASSEMBLYAI_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  ASSEMBLYAI_WEBHOOK_SECRET: z.string().min(16).optional(),

  // Workers Camada 4b/c/d
  BOT_ENTREVISTA_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AUDIO_PROCESS_CONCURRENCY: z.coerce.number().int().positive().default(1),
  TRANSCRICAO_CONCURRENCY: z.coerce.number().int().positive().default(1),
  ANALISE_VOZ_CONCURRENCY: z.coerce.number().int().positive().default(1),
  AUDIO_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(200 * 1024 * 1024), // 200 MB

  // Retenção LGPD
  RETENCAO_AUDIO_DIAS: z.coerce.number().int().positive().default(90),
  RETENCAO_TRANSCRICAO_DIAS: z.coerce.number().int().positive().default(365),
  RETENCAO_CV_DIAS: z.coerce.number().int().positive().default(730),

  // Base URL pública da API (para construir webhook URLs)
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Anthropic Claude (Camada 2 — estruturação de currículo)
  ANTHROPIC_API_KEY: z.string().min(20, 'API key Anthropic parece inválida'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  ANTHROPIC_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),

  // Workers da Camada 2
  CV_DOWNLOAD_CONCURRENCY: z.coerce.number().int().positive().default(3),
  CV_PARSE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CV_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024), // 15 MB

  // Criptografia simétrica (Camada 4 — áudios e transcrições)
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'DATA_ENCRYPTION_KEY deve ser 32 bytes em base64',
    })
    .optional(),

  FRONTEND_ORIGIN: z.string().url().optional(),

  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  // Variáveis presentes mas vazias ("") no .env equivalem a "não definidas":
  // removê-las deixa os campos .optional()/.default() funcionarem como esperado.
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      const t = v.trim();
      // "", "undefined" e "null" significam "não definido" no .env.
      if (t === '' || t === 'undefined' || t === 'null') continue;
    }
    limpo[k] = v;
  }
  const parsed = EnvSchema.safeParse(limpo);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
