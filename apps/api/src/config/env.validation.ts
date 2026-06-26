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
  // Domínio(s) de e-mail aceitos no login SSO. Aceita LISTA (CSV) — o grupo usa
  // mais de um domínio verificado (ex.: unifique.com.br E redeunifique.com.br).
  AZURE_AD_ALLOWED_DOMAIN: z
    .string()
    .min(1)
    .default('unifique.com.br,redeunifique.com.br'),

  // Liga a validação REAL do token na API. Desligado por padrão: enquanto off, o
  // AuthGuard injeta o admin de desenvolvimento e nada muda no fluxo atual.
  // Ligar (=true) em homolog/prod, com o App Registration do Entra configurado.
  // NB: usamos transform em vez de z.coerce.boolean() de propósito — coerce
  // transformaria a string "false" em `true` (footgun), perigoso num flag de
  // segurança. Aqui SÓ o literal "true" liga.
  AUTH_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  // Identidade usada quando AUTH_ENABLED=false (dev/local). Default = admin do seed.
  AUTH_DEV_OID: z.string().min(1).default('00000000-0000-0000-0000-000000000001'),
  AUTH_DEV_EMAIL: z.string().email().default('admin@unifique.com.br'),
  // Lista (CSV) de e-mails que entram/permanecem como ADMIN geral no login SSO.
  // Promoção deliberada e idempotente — reaplica o papel ADMIN a cada login.
  AUTH_ADMIN_EMAILS: z.string().default('guilherme.viana@unifique.com.br'),

  // Microsoft Graph (app-only / client credentials) — agendamento de entrevista:
  // cria a reunião Teams, bloqueia a agenda do recrutador e convida o candidato
  // (convite nativo do Outlook). Opcional no MVP: sem o secret, o agendamento
  // automático fica DESABILITADO (graphEnabled()=false) e a API responde 422.
  // Reusa AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID acima.
  AZURE_AD_CLIENT_SECRET: z.string().min(1).optional(),
  GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com/v1.0'),
  GRAPH_SCOPE: z
    .string()
    .min(1)
    .default('https://graph.microsoft.com/.default'),
  // Fuso passado ao Graph (Prefer: outlook.timezone) e usado no corpo do evento.
  GRAPH_TIMEZONE: z.string().min(1).default('E. South America Standard Time'),
  // Idioma falado da transcrição/gravação (BCP-47). Sem isso, a transcrição
  // automática do Teams via Graph começa em inglês. Vai no meetingSpokenLanguageTag.
  GRAPH_SPOKEN_LANGUAGE: z.string().min(2).default('pt-BR'),
  GRAPH_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  GRAPH_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  // Organizador/agenda quando a vaga não tem recrutador vinculado (comum sem SSO).
  // Precisa ser uma caixa válida do tenant (ex.: recrutamento@unifique.com.br).
  AGENDA_ORGANIZADOR_FALLBACK_EMAIL: z.string().email().optional(),

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
  // EMBEDDING_TOKEN_BUDGET: tokens estimados por requisição. Default 3300 é seguro
  // pro free tier (RPM 3 × 3300 ≈ 9.9K < ~10K TPM, evita 429); tier pago sobe muito.
  // EMBEDDING_BATCH_SIZE: teto de inputs por requisição (máx 128).
  EMBEDDING_TOKEN_BUDGET: z.coerce.number().int().positive().default(3300),
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

  // Agendador automático do transcript oficial via Graph (pull pós-reunião).
  // Ligado por padrão; só age se o Graph estiver configurado.
  GRAPH_TRANSCRICAO_AUTO_ENABLED: z.coerce.boolean().default(true),
  // Minutos APÓS o fim estimado da reunião antes de tentar baixar (Teams indexa ~12 min).
  GRAPH_TRANSCRICAO_DELAY_MIN: z.coerce.number().int().nonnegative().default(13),
  // Janela máxima (min) após o fim em que ainda tentamos — evita re-tentar p/ sempre.
  GRAPH_TRANSCRICAO_MAX_WINDOW_MIN: z.coerce.number().int().positive().default(180),

  // Organizador fixo das reuniões de entrevista (conta de serviço). Quando
  // definido, TODAS as reuniões são criadas sob esta conta (recrutador/candidato
  // viram convidados) — garante que o transcript via Graph seja sempre acessível
  // sob um único usuário (Application Access Policy escopada a ele).
  INTERVIEW_ORGANIZER_EMAIL: z.string().email().optional(),

  // Auto-join do bot em reuniões agendadas (scheduler).
  // Desligado por padrão; ligar em homolog/prod para o bot entrar sozinho.
  BOT_AUTOSTART_ENABLED: z.coerce.boolean().default(false),
  // Quantos minutos ANTES do horário marcado o bot já pode entrar.
  BOT_AUTOSTART_LEAD_MIN: z.coerce.number().int().nonnegative().default(5),
  // Janela de tolerância DEPOIS do horário (pega entrevistas recém-iniciadas que
  // ainda não tiveram o bot disparado, ex.: deploy reiniciou no meio).
  BOT_AUTOSTART_GRACE_MIN: z.coerce.number().int().nonnegative().default(10),

  // Bot Playwright (fallback de transcrição — captura legendas do Teams web).
  // Independe de Application Access Policy / de ser o organizador (entra como
  // convidado). O job de join é consumido pelo serviço externo playwright-bot.
  PLAYWRIGHT_BOT_ENABLED: z.coerce.boolean().default(false),
  // Minutos ANTES do horário marcado em que o bot já pode entrar (entra cedo p/ lobby).
  PLAYWRIGHT_AUTOSTART_LEAD_MIN: z.coerce.number().int().nonnegative().default(2),
  // Tolerância DEPOIS do horário (pega entrevistas recém-iniciadas sem bot disparado).
  PLAYWRIGHT_AUTOSTART_GRACE_MIN: z.coerce.number().int().nonnegative().default(15),
  // Teto de duração que mandamos pro bot permanecer na sala (min).
  PLAYWRIGHT_MAX_DURACAO_MIN: z.coerce.number().int().positive().default(180),
  // Segredo compartilhado do callback interno do bot (header x-playwright-secret).
  PLAYWRIGHT_CALLBACK_SECRET: z.string().min(8).optional(),

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
  // Anti-SSRF (defesa em profundidade): allowlist OPCIONAL de sufixos de host
  // (CSV) permitidos no download de currículo. Ex.: "gupy.io,amazonaws.com".
  // Vazio = sem allowlist (ainda bloqueamos loopback/IP privado/metadados).
  CV_DOWNLOAD_ALLOWED_HOSTS: z.string().optional(),

  // Admissão — OCR do RG (Claude visão) + gatilho de criação de acesso de AD
  RG_OCR_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PROVISAO_ACESSO_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RG_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024), // 10 MB

  // Provider do gatilho de acesso: "acelerato" (abre chamado) ou "desabilitado"
  // (só registra a intenção — gating para testes, no espírito do AUTH_ENABLED).
  ACESSO_PROVIDER: z.enum(['acelerato', 'desabilitado']).default('desabilitado'),
  ACELERATO_BASE_URL: z.string().url().optional(), // ex.: https://SUBDOMINIO.acelerato.com
  ACELERATO_API_EMAIL: z.string().email().optional(),
  ACELERATO_API_TOKEN: z.string().min(1).optional(),
  ACELERATO_PROJETO_KEY: z.coerce.number().int().positive().optional(),
  ACELERATO_ESPECIE_TICKET_KEY: z.string().min(1).optional(),
  ACELERATO_TIPO_TICKET_KEY: z.string().min(1).optional(),
  ACELERATO_CATEGORIA_KEY: z.string().min(1).optional(),
  ACELERATO_PRIORIDADE_KEY: z.string().min(1).optional(),
  ACELERATO_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  ACELERATO_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),
  ACELERATO_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(20),

  // ===================================================================
  // ALTERAÇÃO CONTRATUAL (DHO) — conectores plugáveis (chaves definidas depois).
  // Todos default "desabilitado": o módulo sobe e o fluxo roda em modo SIMULADO
  // (no espírito do ACESSO_PROVIDER), sem tocar em sistemas externos.
  // ===================================================================
  // Senior (RH): SEM API — conexão DIRETA numa view do banco (read-only) para
  // espelhar colaboradores, centros de custo e filiais/unidades. A aplicação da
  // alteração (write-back) é separada (view é só leitura) — ver SeniorProvider.
  SENIOR_PROVIDER: z.enum(['senior', 'desabilitado']).default('desabilitado'),
  SENIOR_DATABASE_URL: z.string().min(1).optional(), // string de conexão da view
  SENIOR_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  // Autentique (assinatura eletrônica do documento): gestor + DHO.
  AUTENTIQUE_PROVIDER: z
    .enum(['autentique', 'desabilitado'])
    .default('desabilitado'),
  AUTENTIQUE_API_BASE_URL: z
    .string()
    .url()
    .default('https://api.autentique.com.br/v2/graphql'),
  AUTENTIQUE_API_TOKEN: z.string().min(1).optional(),
  AUTENTIQUE_WEBHOOK_SECRET: z.string().min(8).optional(),
  AUTENTIQUE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  AUTENTIQUE_RETRY_MAX: z.coerce.number().int().nonnegative().default(3),

  // Execução agendada da alteração (job no dia exato de `data_aplicacao`).
  ALTERACAO_EXECUCAO_ENABLED: z.coerce.boolean().default(true),
  ALTERACAO_EXECUCAO_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .default(2),

  // ===================================================================
  // OFFBOARDING (DHO) — reaproveita SENIOR_PROVIDER/AUTENTIQUE_PROVIDER acima.
  // ===================================================================
  // Integrações de encerramento (remoção de acessos/TI, benefícios, ponto):
  // 'simulado' (default) NÃO toca em sistemas externos; 'real' liga as
  // integrações (ainda TODO nos conectores — ver EncerramentoConectorService).
  OFFBOARDING_INTEGRACOES: z.enum(['simulado', 'real']).default('simulado'),
  // Segredo do webhook do Autentique p/ o termo de offboarding (sem ele, cai no
  // AUTENTIQUE_WEBHOOK_SECRET acima; sem nenhum, aceita — dev).
  AUTENTIQUE_OFFBOARDING_WEBHOOK_SECRET: z.string().min(8).optional(),

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
}).superRefine((env, ctx) => {
  // FALHA-FECHADO: em produção a autenticação real é OBRIGATÓRIA. Sem esta trava,
  // AUTH_ENABLED=false (o default) faz o AuthGuard injetar um ADMIN de dev em TODA
  // requisição — acesso anônimo total ao PII de candidatos. A app recusa subir
  // nesse estado em produção. Ver auth.guard.ts e o relatório de segurança.
  if (env.NODE_ENV === 'production' && !env.AUTH_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_ENABLED'],
      message:
        'AUTH_ENABLED deve ser "true" quando NODE_ENV=production — a aplicação ' +
        'não sobe sem autenticação real (proteção do PII de candidatos).',
    });
  }

  // Quando o gatilho de acesso usa o Acelerato, as credenciais/IDs são obrigatórios.
  if (env.ACESSO_PROVIDER === 'acelerato') {
    const obrigatorios: Array<[string, unknown]> = [
      ['ACELERATO_BASE_URL', env.ACELERATO_BASE_URL],
      ['ACELERATO_API_EMAIL', env.ACELERATO_API_EMAIL],
      ['ACELERATO_API_TOKEN', env.ACELERATO_API_TOKEN],
      ['ACELERATO_PROJETO_KEY', env.ACELERATO_PROJETO_KEY],
      ['ACELERATO_ESPECIE_TICKET_KEY', env.ACELERATO_ESPECIE_TICKET_KEY],
    ];
    for (const [campo, valor] of obrigatorios) {
      if (valor === undefined || valor === null || valor === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [campo],
          message: `${campo} é obrigatório quando ACESSO_PROVIDER=acelerato.`,
        });
      }
    }
  }
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Normaliza um valor de ambiente como o dotenv faria: remove espaços/`\r`/`\n`
 * nas pontas e UM par de aspas externas. Em produção os valores chegam via
 * `env_file` do Docker direto no process.env (SEM passar pelo dotenv), então um
 * `.env` salvo no Windows (CRLF) ou com aspas contaminava segredos — ex.: uma
 * `ANTHROPIC_API_KEY="sk-ant-…"` ou com `\r` no fim virava 401 "invalid x-api-key"
 * mesmo com a chave "certa". Aqui replicamos essa higiene no caminho de produção.
 */
function normalizarValor(v: string): string {
  let s = v.trim();
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  // Variáveis presentes mas vazias ("") no .env equivalem a "não definidas":
  // removê-las deixa os campos .optional()/.default() funcionarem como esperado.
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      const s = normalizarValor(v);
      // "", "undefined" e "null" significam "não definido" no .env.
      if (s === '' || s === 'undefined' || s === 'null') continue;
      limpo[k] = s;
      continue;
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
