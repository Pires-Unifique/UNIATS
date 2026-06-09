# Plataforma de Triagem & Análise de Entrevistas — Integração Gupy

Plataforma interna da Unifique para automatizar a triagem de candidatos vindos da Gupy, ranqueá-los por aderência à vaga, conduzir mensagens automatizadas, gravar e transcrever entrevistas no Google Meet, e analisar tom de voz dos candidatos. Compliance LGPD por padrão.

> **Estado atual do repositório:** Camada 1 (ingestão Gupy: API + webhooks + persistência idempotente) implementada e testada. Próximas camadas (parsing de CV, embeddings/ranking, mensageria, bot de entrevista) ficam em sprints subsequentes.

---

## 1. Arquitetura em 30 segundos

```
   Gupy ATS  ──(REST + Webhooks)──>  Camada 1 (ingestão)
                                         │
                                         ▼
                                Postgres + pgvector
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
 Camada 2 (Parser CV)    Camada 3 (Embeddings + LLM)    Camada 4 (Mensageria)
                                         │
                                         ▼
                              Camada 5 (Bot de entrevista
                              Meet → AssemblyAI → Análise voz)
```

Detalhes em `docs/arquitetura.md` (diagrama das 5 camadas) e `packages/db/prisma/schema.prisma` (modelo de dados).

---

## 2. Pré-requisitos

| Ferramenta | Versão mínima | Como instalar |
|---|---|---|
| **Node.js** | 20.11.0 (LTS) | https://nodejs.org ou `nvm install 20` |
| **pnpm** | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| **Docker Desktop** | 24+ com Compose v2 | https://www.docker.com/products/docker-desktop |
| **PostgreSQL client (psql)** | 16+ | opcional, para inspecionar o banco |
| **ngrok** ou Cloudflare Tunnel | atual | apenas para testar webhooks da Gupy localmente |
| **Git** | recente | — |

> **Importante:** o Postgres roda dentro do container `pgvector/pgvector:pg16` (já configurado em `infra/docker-compose.yml`). Você **não precisa** instalar Postgres na máquina — só o cliente `psql` se quiser conectar manualmente.

---

## 3. Setup passo-a-passo

### 3.1. Clonar e instalar dependências

```bash
git clone <repo-url> triagem-gupy
cd triagem-gupy
pnpm install
```

`pnpm install` instala todos os workspaces (`apps/api`, `apps/web`, `packages/db`, `packages/shared`).

### 3.2. Variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e **preencha pelo menos** os blocos abaixo. Os demais podem ficar com os valores de exemplo enquanto as camadas correspondentes não estão em uso.

```dotenv
# --- App ---
NODE_ENV=development
APP_PORT=3001
LOG_LEVEL=debug

# --- Banco / Redis (combinam com docker-compose) ---
DATABASE_URL=postgresql://triagem:triagem@localhost:5432/triagem?schema=public&connection_limit=20
REDIS_URL=redis://localhost:6379

# --- Azure AD (SSO Microsoft Entra) ---
AZURE_AD_TENANT_ID=<colar do portal Entra>
AZURE_AD_CLIENT_ID=<colar do portal Entra>
AZURE_AD_CLIENT_SECRET=<colar — manter em cofre>
AZURE_AD_AUDIENCE=api://triagem-api
AZURE_AD_ALLOWED_DOMAIN=unifique.com.br

# --- Gupy (Camada 1 — obrigatório) ---
# Confirmar a URL do sandbox com o CSM da Gupy (varia por tenant).
GUPY_API_BASE_URL=https://api.gupy.io/api/v1
GUPY_API_TOKEN=<token Bearer do sandbox>
GUPY_WEBHOOK_SECRET=<segredo HMAC do webhook>
GUPY_RATE_LIMIT_RPS=5
GUPY_RETRY_MAX=4

# --- Encryption (campos sensíveis no DB) ---
# Gere com: openssl rand -base64 32
DATA_ENCRYPTION_KEY=<32 bytes em base64>
```

**Como obter o `GUPY_API_TOKEN`:**
1. Solicite ao CSM da Gupy o tenant de sandbox.
2. No painel da Gupy: *Integrações → API → Gerar token*.
3. O token sai uma única vez. Salve no cofre da equipe (1Password / Bitwarden).

**Como configurar o webhook da Gupy:**
1. Painel Gupy → *Integrações → Webhooks → Adicionar*.
2. URL: `https://<sua-url-ngrok>/webhooks/gupy` (ver §3.6).
3. Eventos: `application.created`, `application.moved`, `application.hired`, `application.rejected`, `job.published`, `job.updated`.
4. Secret: gere com `openssl rand -hex 32` e cole nos dois lados — no painel e em `GUPY_WEBHOOK_SECRET`.

### 3.3. Subir a infraestrutura local

```bash
pnpm infra:up
```

Sobe os contêineres definidos em `infra/docker-compose.yml`:

| Serviço | Porta local | Login padrão |
|---|---|---|
| Postgres (pgvector) | 5432 | `triagem` / `triagem` |
| Redis 7 | 6379 | — |
| MinIO (S3 local) | 9000 / 9001 | `minioadmin` / `minioadmin` |
| MailHog (SMTP fake) | 1025 / 8025 | — |

Verifique se tudo está saudável:

```bash
docker compose -f infra/docker-compose.yml ps
```

Todos devem estar `running (healthy)`.

### 3.4. Migrations e seed

```bash
# Gera o cliente Prisma
pnpm db:generate

# Aplica as migrations (cria tabelas + extensões pgvector, pg_trgm, uuid-ossp)
pnpm db:migrate

# (opcional) popula dados de demonstração
pnpm db:seed
```

Confira no Postgres:

```bash
psql $DATABASE_URL -c "\dt"
# Deve listar: vagas, candidatos, candidaturas, embeddings, ...
psql $DATABASE_URL -c "SELECT extname FROM pg_extension;"
# Deve incluir: vector, pg_trgm, uuid-ossp
```

### 3.5. Subir a API

```bash
pnpm --filter @uniats/api dev
```

A API sobe em `http://localhost:3001`. Smoke test:

```bash
curl http://localhost:3001/health
# {"status":"ok","timestamp":"..."}
```

### 3.6. Expor o webhook publicamente (ngrok)

A Gupy precisa de uma URL pública para entregar webhooks. Em outro terminal:

```bash
ngrok http 3001
```

Copie a URL HTTPS impressa (ex.: `https://abcd-1234.ngrok-free.app`) e configure no painel da Gupy como `https://abcd-1234.ngrok-free.app/webhooks/gupy`.

> Quando o ngrok reiniciar, a URL muda. Reconfigurar no painel toda vez é chato — para testes prolongados, use uma URL fixa (plano pago do ngrok, ou Cloudflare Tunnel).

---

## 4. Comandos do dia-a-dia

```bash
# Desenvolvimento
pnpm --filter @uniats/api dev        # API em watch mode
pnpm --filter @uniats/web dev        # Front (Next.js) — sprint futuro
pnpm dev                              # tudo em paralelo via Turborepo

# Banco
pnpm db:migrate                       # nova migration (prompt interativo)
pnpm db:studio                        # GUI do Prisma em localhost:5555
pnpm db:seed                          # repovoar com dados de demo

# Testes
pnpm --filter @uniats/api test       # unitários (Jest + nock)
pnpm --filter @uniats/api test:cov   # com cobertura
pnpm --filter @uniats/api test:int   # integração (requer docker-compose up)

# Sincronização Gupy (sob demanda, sem esperar webhook)
curl -X POST http://localhost:3001/api/gupy/sync/vagas
curl -X POST http://localhost:3001/api/gupy/sync/vaga/<GUPY_VAGA_ID>
curl -X POST http://localhost:3001/api/gupy/sync/vaga/<GUPY_VAGA_ID>/candidaturas

# Infra
pnpm infra:up         # sobe Postgres/Redis/MinIO/MailHog
pnpm infra:down       # derruba
pnpm infra:logs       # logs em tempo real
```

---

## 5. Estrutura do monorepo

```
.
├── apps/
│   ├── api/                # NestJS — backend (Camada 1 implementada)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── gupy/                       # ← Camada 1
│   │   │   │   │   ├── gupy.client.ts          # HTTP client com retry + rate-limit + SSRF guard
│   │   │   │   │   ├── gupy.service.ts         # Orquestração: sync vaga / candidaturas
│   │   │   │   │   ├── gupy.controller.ts      # Endpoints internos /api/gupy
│   │   │   │   │   ├── gupy-webhook.controller.ts  # /webhooks/gupy (HMAC + idempotência)
│   │   │   │   │   ├── mappers/gupy.mapper.ts  # DTO Gupy → entidades Prisma
│   │   │   │   │   ├── processors/             # Workers BullMQ
│   │   │   │   │   └── __tests__/              # Suíte Jest + fixtures
│   │   │   │   └── health/
│   │   │   ├── prisma/                         # PrismaService
│   │   │   ├── queue/                          # BullMQ root config
│   │   │   ├── config/                         # Validação Zod do .env
│   │   │   ├── main.ts                         # Bootstrap (express.raw para webhook)
│   │   │   └── app.module.ts
│   │   └── package.json
│   └── web/                # Next.js — sprint futuro
├── packages/
│   ├── db/                 # Prisma schema + migrations + tipos
│   │   ├── prisma/
│   │   │   ├── schema.prisma          # Tabelas em PT-BR
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/index.ts
│   └── shared/             # Schemas Zod compartilhados (Gupy, eventos)
│       └── src/gupy/
│           ├── schemas.ts
│           └── events.ts
├── infra/
│   └── docker-compose.yml  # Postgres+pgvector, Redis, MinIO, MailHog
├── docs/
│   ├── arquitetura.md                  # Diagrama das 5 camadas
│   └── testes-integracao-gupy.md       # Plano de testes contra sandbox
├── .env.example
├── package.json            # Workspaces + Turborepo
└── README.md               # você está aqui
```

---

## 6. Endpoints da Camada 1

> Todos sob SSO Azure AD (a ser ligado no módulo de auth), exceto o webhook que valida HMAC.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/gupy/vagas` | Listagem direta passando-pela-API da Gupy (paginada). |
| `GET` | `/api/gupy/vagas/:gupyId/candidaturas` | Idem para candidaturas. |
| `POST` | `/api/gupy/sync/vaga/:gupyId` | Faz pull + upsert local de uma vaga. |
| `POST` | `/api/gupy/sync/vagas` | Backfill de todas as vagas publicadas. |
| `POST` | `/api/gupy/sync/vaga/:gupyId/candidaturas` | Pull + upsert das candidaturas + enfileira download de CV. |
| `POST` | `/webhooks/gupy` | Recebe eventos da Gupy (HMAC obrigatório, idempotente). |
| `GET` | `/health` | Liveness check. |

---

## 6.1. Camada 2 — Processamento de currículos

A Camada 2 transforma o arquivo bruto (PDF/DOCX) em texto + JSON estruturado pronto para
embedding e ranking. Tudo roda assíncrono via BullMQ.

**Pipeline**

```
[webhook/sync Gupy]
    └─ enqueue → gupy-sync (Camada 1)
                  └─ persiste vaga/candidatura
                  └─ enqueue → cv-download
                                 ├─ baixa o PDF via GupyClient (HTTPS-only, 20MB cap)
                                 ├─ grava no MinIO/S3 com chave SHA-256 (idempotente)
                                 └─ enqueue → cv-parse
                                                ├─ baixa do storage
                                                ├─ extrai texto (pdf-parse / mammoth)
                                                ├─ chama Claude (tool-use → JSON validado)
                                                └─ enqueue → embedding (Camada 3)
```

**Variáveis novas (já no `.env.example`)**

| Variável | Default | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Token da Anthropic (obrigatório). |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Modelo usado para estruturar CV. |
| `ANTHROPIC_MAX_TOKENS` | `4096` | Limite por resposta. |
| `ANTHROPIC_TIMEOUT_MS` | `60000` | Timeout HTTP por chamada. |
| `ANTHROPIC_RETRY_MAX` | `3` | Retentativas automáticas do SDK. |
| `CV_DOWNLOAD_CONCURRENCY` | `3` | Downloads simultâneos por instância de worker. |
| `CV_PARSE_CONCURRENCY` | `2` | Parses + LLM simultâneos por instância. |
| `CV_MAX_SIZE_BYTES` | `15728640` (15 MB) | Hard cap defensivo. |
| `STORAGE_*` | ver `.env.example` | Bucket/MinIO/S3 para os arquivos. |

**Endpoints**

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/curriculos/:candidaturaId` | Retorna o currículo estruturado (JSON). |
| `POST` | `/api/curriculos/:candidaturaId/reprocessar` | Re-enfileira o parse usando o arquivo já no storage (útil ao subir `PARSER_PROMPT_VERSION`). |

**Idempotência**

- `cv-download`: a key no storage deriva do `sha256` do conteúdo — re-baixar o mesmo CV não duplica blob; o `HEAD` antes do `PUT` evita escrita redundante. No banco usamos `upsert` por `candidatura_id` (`@unique`).
- `cv-parse`: `jobId` é determinístico (`cv-parse-<candidaturaId>`), então BullMQ ignora enqueue duplicado enquanto o anterior estiver pendente.

**Decisões de segurança**

- Magic bytes validados em PDF e DOCX (`%PDF` e `PK..`) — content-type sozinho não é confiável.
- Texto extraído é truncado em 50 KB antes do LLM (custo + superfície de prompt injection).
- O conteúdo do CV é enviado ao Claude dentro de `<curriculo>...</curriculo>` com saneamento básico de "ignore previous instructions".
- `tool_choice: { type: 'tool', name: 'estruturar_curriculo' }` força saída via tool — nada de texto livre.
- A saída do LLM é re-validada com Zod antes de tocar o banco.
- `.doc` legado (binário CFB) é rejeitado com erro amigável — só `.docx` OpenXML e `.pdf` passam.
- PDFs escaneados (sem camada de texto) retornam erro recuperável; OCR fica fora de escopo desta fase.

**MinIO local**

Para enxergar o bucket em dev, acesse `http://localhost:9001` (console) com `triagem` / `triagem-secret-change-me`. O bucket é criado automaticamente no boot se não existir (somente fora de produção).

**Reprocessar tudo após mudar o prompt**

```bash
# Sobe PARSER_PROMPT_VERSION em apps/api/src/modules/claude/claude.service.ts,
# faz deploy, e dispara:
psql $DATABASE_URL -tAc \
  "SELECT candidatura_id FROM curriculos_processados WHERE parser_versao <> 'claude-curriculo-v2'" \
  | xargs -I{} curl -X POST http://localhost:3001/api/curriculos/{}/reprocessar
```

---

## 6.2. Camada 3 — Embeddings + Ranking

A Camada 3 transforma a vaga e o currículo (já estruturado) em vetores via Voyage-3 (1024d), guarda em pgvector, e calcula um score híbrido vetorial + LLM com justificativa por candidato.

**Pipeline**

```
[cv-parse termina]
  └─ enqueue → embedding (alvo: curriculo)
                 ├─ Voyage gera vetor 1024d do texto canônico do CV
                 ├─ INSERT em embeddings (substitui anteriores do mesmo modelo)
                 └─ enqueue → matching
                                ├─ pgvector: distância cosseno vaga ↔ cv
                                ├─ Claude (tool-use): score 0-100 + justificativa + evidências
                                ├─ INSERT 3 linhas em scores
                                │   (SIMILARIDADE_VETORIAL, RANKING_CV, CONSOLIDADO)
                                └─ pronto p/ aparecer no ranking
```

**Texto canônico**

A função `montarTextoCanonicoVaga` repete os requisitos do gestor **duas vezes** dentro do texto que será embedado — isso aumenta o peso semântico do que o líder marcou como crítico, exatamente o sinal que mais importa para job-fit. Ao subir `TEXTO_CANONICO_VERSAO`, refaça os embeddings (`POST /api/vagas/:id/reranking`).

**Score híbrido**

```
score_consolidado = 0.4 × similaridade_vetorial   (Voyage cosine)
                  + 0.6 × ranking_cv              (Claude tool-use)
```

O peso do LLM é maior porque o vetor sozinho ignora hard requirements (ex.: "obrigatório CNH B"). O LLM lê os requisitos do gestor em JSON, cita evidências do CV e penaliza ausências explícitas.

**Endpoints**

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/vagas/:vagaId/ranking?limite=20` | Top-K já calculado, ordenado por consolidado desc. Leitura barata. |
| `POST` | `/api/vagas/:vagaId/reranking` | Re-enfileira embedding + matching de toda a vaga. Operação cara. |
| `GET` | `/api/candidaturas/:candidaturaId/score` | Detalhe das 3 linhas de score + evidências. |
| `POST` | `/api/candidaturas/:candidaturaId/score/calcular` | Calcula score sob demanda (síncrono). |
| `POST` | `/api/candidaturas/:candidaturaId/score/aprovar` | Marca revisão humana (LGPD Art. 20). Body: `{ usuarioId }`. |

**Variáveis novas**

| Variável | Default | Para que serve |
|---|---|---|
| `VOYAGE_API_KEY` | — | Token Voyage (obrigatório). |
| `VOYAGE_MODEL` | `voyage-3` | Modelo de embedding. |
| `VOYAGE_DIMENSIONS` | `1024` | Validada na resposta — falha alto se mudar. |
| `VOYAGE_TIMEOUT_MS` | `20000` | Timeout por chamada. |
| `VOYAGE_RETRY_MAX` | `3` | Re-tentativas (com backoff e Retry-After). |
| `EMBEDDING_CONCURRENCY` | `2` | Jobs de embedding simultâneos por instância. |
| `MATCHING_CONCURRENCY` | `2` | Jobs de matching simultâneos por instância. |
| `MATCHING_TOP_K` | `20` | Default do `/ranking`. |

**LGPD e fairness**

- Texto canônico do CV exclui dados pessoais sensíveis (CPF, foto, endereço).
- Prompt do Claude proíbe explicitamente uso de proxies discriminatórios (nome, bairro, escola, gênero, idade).
- Toda decisão automática carrega `prompt_versao` e `modelo` em `scores` → auditoria.
- Endpoint de aprovação permite revisão humana com `revisado_por` + `revisado_em` (Art. 20).
- Saída do LLM é re-validada por Zod antes de tocar o banco — score inválido nunca aparece no ranking.

**Migration manual (HNSW)**

O índice HNSW precisa ser criado fora do `prisma migrate` (Prisma não suporta `Unsupported` ainda):

```sql
-- migration manual, rodar UMA VEZ após `prisma migrate dev`:
CREATE INDEX IF NOT EXISTS embeddings_vetor_idx
  ON embeddings USING hnsw (vetor vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 6.3. Camada 4a — Mensageria (WhatsApp + E-mail)

A camada de mensageria orquestra comunicação com candidatos via WhatsApp (WAHA self-hosted) e e-mail (SendGrid), com templates versionados, fallback automático entre canais e webhooks autenticados.

**Subindo o WAHA local**

WAHA é um wrapper HTTP sobre WhatsApp Web — proteja-o atrás de proxy interno em produção (não exponha porta 3000 ao público).

```bash
docker run -it --rm \
  -p 3000:3000 \
  -e WHATSAPP_API_KEY=$(openssl rand -hex 16) \
  -e WHATSAPP_HOOK_URL=https://seu-dominio/webhooks/waha \
  -e WHATSAPP_HOOK_EVENTS=message,message.ack,session.status \
  -e WHATSAPP_HOOK_HMAC=$(openssl rand -hex 32) \
  --name waha \
  devlikeapro/waha
```

Após subir, abra `http://localhost:3000/dashboard` (X-Api-Key acima) e escaneie o QR com o WhatsApp do número operacional. Preencha `WAHA_API_KEY` e `WAHA_WEBHOOK_SECRET` no `.env` com os mesmos valores.

**Pipeline**

```
[recrutador clica "enviar convite"]
  → POST /api/mensagens/enviar  (validações: template existe? candidato com consentimento LGPD?)
  → INSERT em `mensagens` (status=PENDENTE)
  → enqueue → mensagem (BullMQ)
                 ├─ render template (placeholders escapados)
                 ├─ WhatsApp: checkNumberStatus (resolve "9" do BR) → sendText
                 │     (typing simulado antes do envio)
                 ├─ Falha permanente → fallback EMAIL (se permitido + email disponível)
                 ├─ Falha 5xx/429 → re-tentativa com backoff
                 └─ atualiza `mensagens.status` = ENVIADO/FALHADO
[webhook /webhooks/waha]
  → HMAC-SHA256 validado → atualiza status (ENTREGUE/LIDO/RESPONDIDO)
[webhook /webhooks/sendgrid]
  → ECDSA P-256 validado → atualiza status (delivered/open/click/bounce)
```

**Endpoints**

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/mensagens/templates` | Lista templates ativos com variáveis (derivadas) e canais suportados. |
| `POST` | `/api/mensagens/templates` | Cria template. Body: `{ codigo, nome, descricao?, whatsappCorpo?, emailAssunto?, emailTexto? }`. |
| `PATCH` | `/api/mensagens/templates/:codigo` | Edita template (incrementa `versao`). |
| `DELETE` | `/api/mensagens/templates/:codigo` | Soft-disable (`ativo=false`, preserva histórico). |
| `GET` | `/api/mensagens/contexto/:candidaturaId` | Variáveis padrão (candidato_nome, vaga_titulo, recrutador_nome) p/ pré-preencher a UI. |
| `POST` | `/api/mensagens/enviar` | Enfileira envio. Body: `{ candidaturaId, canal, templateCodigo, variaveis, permitirFallback?, agendadoPara? }`. |
| `GET` | `/api/mensagens?candidaturaId=` | Histórico (até 100) por candidatura. |
| `GET` | `/api/mensagens/:id` | Detalhe de uma mensagem com timeline (enviado/entregue/lido). |
| `POST` | `/webhooks/waha` | Receiver WAHA (HMAC). Trata `message`, `message.ack`, `session.status`. |
| `POST` | `/webhooks/sendgrid` | Receiver SendGrid (ECDSA). Trata `processed`/`delivered`/`open`/`click`/`bounce`/`dropped`. |

**Templates (editáveis no banco, versionados)**

Templates agora vivem na tabela `templates_mensagem` e são editáveis pela UI (`/configuracoes/templates`)
ou pela API acima — sem deploy. As **variáveis `{{nome}}` são derivadas** dos corpos (o recrutador nunca
as declara). Editar um template **incrementa `versao`**; o snapshot usado fica em `mensagens.template_codigo`
("codigo@versao") para auditoria. Os 4 templates de fábrica são carregados pelo seed (`pnpm db:seed`):

| Código | Variáveis | Quando usar |
|---|---|---|
| `convite_triagem` | candidato_nome, vaga_titulo, link_confirmacao | Primeiro contato após triagem da IA. |
| `agendamento_entrevista` | candidato_nome, vaga_titulo, link_agendamento, recrutador_nome | Convite formal com link de calendário. |
| `lembrete_entrevista` | candidato_nome, vaga_titulo, data_hora, link_meet | Lembrete 1h antes. |
| `comunicado_decisao` | candidato_nome, vaga_titulo, mensagem_personalizada | Aprovação ou não-aprovação. |

O agendamento de entrevista baseado na disponibilidade do Teams (Microsoft Graph) está **projetado** em
`docs/agendamento-teams.md` (ainda não implementado).

**Variáveis novas**

| Variável | Default | Para que serve |
|---|---|---|
| `WAHA_BASE_URL` | `http://localhost:3000` | URL do WAHA. |
| `WAHA_API_KEY` | — | X-Api-Key configurada no container. |
| `WAHA_SESSION` | `default` | Nome da sessão (Plus permite várias). |
| `WAHA_WEBHOOK_SECRET` | — opcional | HMAC-SHA256 dos webhooks. **Defina em produção.** |
| `WAHA_TIMEOUT_MS` | `20000` | Timeout HTTP. |
| `WAHA_RETRY_MAX` | `3` | Re-tentativas (somente em 429/5xx). |
| `WAHA_TYPING_MS` | `1500` | Simulação de "digitando..." (anti-ban). |
| `SENDGRID_API_KEY` | — | SG.xxx. Sem isso, e-mails são recusados em runtime. |
| `SENDGRID_FROM_EMAIL` | — | Sender autenticado no SendGrid. |
| `SENDGRID_FROM_NAME` | — | Nome do remetente. |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | — opcional | Chave pública ECDSA do Event Webhook. **Defina em produção.** |
| `MENSAGEM_CONCURRENCY` | `2` | Jobs simultâneos. |

**LGPD e segurança**

- **Consentimento obrigatório**: `MessagingService.enfileirar` bloqueia envios para candidatos sem `consentimento_lgpd_em` ou com `excluido_em` preenchido.
- **Placeholders escapados**: variáveis em HTML são HTML-escaped; em texto plano, caracteres de controle são rejeitados (anti-injection).
- **HMAC + ECDSA**: webhooks autenticados criptograficamente. Sem secret configurado, sobe um warning no log.
- **Anti-replay**: SendGrid webhook rejeita timestamp fora de janela de 10 minutos.
- **Idempotência**: tabela `webhooks_recebidos` com `(provider, external_id)` unique evita reprocessamento.
- **SSRF guard**: WahaClient bloqueia URLs de mídia para hosts internos (127.0.0.1, 10/8, 172.16/12, 192.168/16, link-local).
- **Anti-ban WhatsApp**: usamos `checkNumberStatus` para resolver o "9" extra dos números BR pré-2012, simulamos digitação e respeitamos rate limit do engine.

**Fallback automático**

Se você enviar com `canal: WHATSAPP` e `permitirFallback: true`:
1. Tenta WhatsApp via WAHA.
2. Se a falha é permanente (número não existe, 400/422/404) E o candidato tem e-mail → tenta EMAIL.
3. Se ambos falham → grava `FALHADO` definitivo com motivo concatenado.
4. Se a falha é 429/5xx/network → BullMQ retenta o mesmo job com backoff (não consome fallback).

**Sobre o WAHA Core vs Plus**

WAHA Core (gratuito) suporta apenas `session=default`. Para múltiplos números (ex.: separar canal de operadora vs canal de RH), use WAHA Plus que permite N sessões na mesma instância. O código já está preparado — basta mudar `WAHA_SESSION`.

---

## 6.4. Camada 4b/c/d — Entrevistas (bot + transcrição + voz)

Esta camada cobre o ciclo completo: bot do MeetStream entra na chamada do Google Meet, grava áudio, transcrição com diarização via AssemblyAI Universal-2 e análise descritiva de tom de voz com Claude. Tudo criptografado em repouso (AES-256-GCM) com retenção LGPD.

**Pré-requisitos LGPD (obrigatórios)**

Antes de qualquer entrevista com bot:
1. Coletar consentimento de gravação do candidato (campo `candidatos.consentimento_gravacao_em`). Sem isso, `agendar()` e `iniciarBot()` recusam.
2. Coletar consentimento LGPD geral (`candidatos.consentimento_lgpd_em`).
3. Versão dos termos aceitos fica em `consentimento_lgpd_versao` para auditoria.

**Pipeline completo**

```
[recrutador agenda]
  → POST /api/entrevistas (cria AGENDADA)
  → POST /api/entrevistas/:id/iniciar-bot  (ou cron 5min antes — futuro)
  → enqueue → bot-entrevista
                 └─ MeetStream.criarBot(meetUrl, webhookUrl)
                    └─ entrevistas.bot_session_id, status=EM_ANDAMENTO

[bot grava a chamada]
[webhook /webhooks/meetstream]
  ├─ bot.joined  → entrevistas.iniciada_em + bot_status='joined'
  ├─ bot.recording → bot_status='recording'
  └─ bot.ended  → enqueue audio-process

[worker audio-process]
  ├─ MeetStream.obterGravacao(botId) → URL temporária
  ├─ MeetStream.baixarAudio(url) (HTTPS-only, 200MB cap)
  ├─ valida MIME (mp3/wav/m4a/ogg/webm)
  ├─ SHA-256 do plaintext (auditoria)
  ├─ CryptoService.encrypt(audio, AAD=entrevistaId)  ← AES-256-GCM
  ├─ StorageService.putObject(audio/<sha>/<sha>.enc, metadata={algoritmo, mimeOriginal})
  ├─ entrevistas.audio_url + sha256 + audio_expira_em = now+90d
  └─ enqueue transcricao

[worker transcricao]
  ├─ StorageService.getObject(key)
  ├─ CryptoService.decrypt(payload, AAD=entrevistaId)
  ├─ AssemblyAI.uploadAudio(plaintext, mime)  → upload_url temporária
  ├─ AssemblyAI.criarTranscricao({audio_url, webhook, speaker_labels, sentiment, language:pt})
  └─ transcricoes.provider_id = tx-id

[webhook /webhooks/assemblyai]
  └─ status=completed
     ├─ AssemblyAI.obterTranscricao(tx-id) → texto + utterances + sentiment
     ├─ transcricoes.texto_completo + segmentos (jsonb)
     └─ enqueue analise-voz

[worker analise-voz]
  ├─ identifica candidato (speaker com mais fala)
  ├─ métricas determinísticas: hesitação_count (regex "ah/eh/tipo/sabe/né"), 
  │    sentimento global, confiança média da transcrição
  ├─ Claude tool-use "analisar_tom_de_voz" → confianca/nervosismo/entusiasmo/observações
  │    (fallback determinístico se LLM falha — não bloqueia o pipeline)
  └─ analises_voz upsert

[cron diário 03:00]
  └─ RetencaoLGPDService.aplicarRetencaoDiaria()
     ├─ audio_expira_em < now → apaga blob + zera audio_url (audit log)
     └─ transcricao.expira_em < now → trunca texto_completo + segmentos
```

**Endpoints**

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/entrevistas` | Agenda. Body: `{candidaturaId, agendadaPara, meetUrl, duracaoEstimadaMin?, entrevistadorId?, googleEventId?}`. |
| `GET` | `/api/entrevistas/:id` | Detalhe + transcrição + análise de voz (sem `audio_url` cru). |
| `GET` | `/api/entrevistas?candidaturaId=` | Histórico de entrevistas. |
| `POST` | `/api/entrevistas/:id/iniciar-bot` | Enfileira `bot-entrevista` (idempotente). |
| `POST` | `/api/entrevistas/:id/encerrar` | Encerra bot antes do horário. |
| `POST` | `/api/entrevistas/:id/cancelar` | Cancela entrevista (body: `{motivo?}`). |
| `POST` | `/webhooks/meetstream` | HMAC. Eventos `bot.joined/bot.recording/bot.ended/bot.failed`. |
| `POST` | `/webhooks/assemblyai` | Header `X-Webhook-Secret`. Eventos `completed/error`. |

**Variáveis novas**

| Variável | Default | Para que serve |
|---|---|---|
| `MEETSTREAM_API_KEY` | — | Token MeetStream (header `Authorization: Token <key>`). |
| `MEETSTREAM_BASE_URL` | `https://api.meetstream.ai` | Endpoint base. |
| `MEETSTREAM_WEBHOOK_SECRET` | — opcional | HMAC-SHA256 dos webhooks. **Defina em produção.** |
| `ASSEMBLYAI_API_KEY` | — | Sem prefixo Bearer. |
| `ASSEMBLYAI_WEBHOOK_SECRET` | — opcional | Valor do header `X-Webhook-Secret`. |
| `ASSEMBLYAI_SPEAKER_LABELS` | `true` | Diarização. |
| `ASSEMBLYAI_SENTIMENT_ANALYSIS` | `true` | Sentiment por trecho. |
| `DATA_ENCRYPTION_KEY` | — | 32 bytes em base64. **Obrigatória em produção.** |
| `RETENCAO_AUDIO_DIAS` | `90` | Após esse prazo, blob é apagado + audio_url zerado. |
| `RETENCAO_TRANSCRICAO_DIAS` | `365` | Após esse prazo, `texto_completo` é truncado. |
| `AUDIO_MAX_BYTES` | `209715200` (200 MB) | Hard cap por gravação. |
| `PUBLIC_BASE_URL` | `http://localhost:3001` | URL pública usada nos webhook URLs do MeetStream/AssemblyAI. Em dev use ngrok. |

**Criptografia em repouso (AES-256-GCM)**

- Chave única (DEK) de 32 bytes vinda de `DATA_ENCRYPTION_KEY` (base64).
- IV de 12 bytes random por arquivo — NUNCA reusado.
- Tag de autenticação de 16 bytes — detecta tampering.
- **AAD = `entrevistaId` (UTF-8)** — impede que alguém troque o blob entre entrevistas. Decrypt com AAD errado falha com erro de integridade.
- Layout serializado: `iv (12) || tag (16) || ciphertext (n)`.
- O sha256 gravado em `entrevistas.audio_sha256` é do **plaintext**, não do ciphertext — necessário para idempotência cross-key e auditoria independente.

Para evoluir para envelope-encryption com KMS (recomendado em produção crítica), substitua o `CryptoService` por uma versão que gere uma DEK por arquivo e criptografe a DEK com a CMK no KMS.

**LGPD — pontos importantes**

- Bot não entra na sala sem `consentimento_gravacao_em` registrado. Se for revogado entre `agendar` e `iniciarBot`, o worker `bot-start` cancela a entrevista automaticamente.
- Áudio nunca é retornado pelo `GET /api/entrevistas/:id` — campo é removido da resposta. Acesso ao áudio cru deve passar por endpoint dedicado com auditoria (a ser adicionado).
- Cron de retenção registra cada apagamento/truncagem em `registro_auditoria` (LGPD Art. 37).
- A análise de voz é descritiva, não preditiva — não decide contratação. O `parecer_final` é preenchido por humano e `parecer_aprovado_por` exige revisão (Art. 20).
- Prompt do Claude proíbe explicitamente inferir sotaque/idade/gênero/origem regional como evidência.

**Setup em dev**

```bash
# 1. Gere a chave de criptografia
openssl rand -base64 32  # cole em DATA_ENCRYPTION_KEY

# 2. Suba ngrok para expor webhooks à internet
ngrok http 3001
# Cole a URL HTTPS em PUBLIC_BASE_URL e nas configurações do MeetStream/AssemblyAI

# 3. Em outra aba, suba a API
cd apps/api && pnpm dev

# 4. Cadastre o webhook URL no painel MeetStream:
#    https://<seu-ngrok>.ngrok-free.app/webhooks/meetstream
#    Configure também o webhook secret.

# 5. AssemblyAI configura o secret no momento da criação do job
#    (já fazemos isso no AssemblyAIClient.criarTranscricao).
```

---

## 6.5. Camada 5 — Perguntas pré-entrevista + Frontend

Esta camada conecta tudo o que veio antes em uma experiência operacional para o recrutador. Tem duas peças:

### 6.5.1. Backend — gerador de perguntas

`QuestionsService` usa Claude com tool-use forçado (`gerar_perguntas`) e produz 6 a 10 perguntas customizadas combinando o currículo estruturado (Camada 2) e os requisitos do gestor (Camada 1). Cada pergunta carrega: objetivo, competência, dificuldade (baixa/média/alta) e sinais a buscar na resposta.

Endpoints (`/api/perguntas`):

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/perguntas/gerar` | Body: `{ candidaturaId, entrevistaId?, substituir? }`. Substituir apaga as anteriores (mesmo vaga+entrevista). |
| `GET` | `/api/perguntas?vagaId=` ou `?entrevistaId=` | Lista ordenada por `ordem`. |
| `PATCH` | `/api/perguntas/:id` | Edição manual inline. |
| `DELETE` | `/api/perguntas/:id` | Remove uma pergunta. |

Prompt versionado em `PERGUNTAS_PROMPT_VERSION`. Saída revalidada por Zod antes de tocar o banco. Restrições éticas no system prompt (proíbe perguntas pessoais, gênero/idade/religião/etnia).

### 6.5.2. Frontend — `apps/web` (Next.js 14 + Tailwind)

Aplicação React App Router. Auth via Microsoft Entra ID (MSAL React) — em dev, se `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` estiver vazio, o frontend roda em modo "dev sem login" com usuário fake.

**Páginas**

| Rota | O que faz |
|---|---|
| `/login` | Botão "Entrar com Microsoft". Redirect MSAL. |
| `/vagas` | Lista vagas locais (já sincronizadas). Filtros + busca + botão "Sincronizar Gupy" (POST `/api/gupy/sync/vagas`). |
| `/vagas/[id]/ranking` | Top-K candidatos com score consolidado, similaridade vetorial e ranking LLM. Botão "Re-rerank toda a vaga". |
| `/candidaturas/[id]` | CV estruturado, três scores, justificativa LLM com evidências citadas, botão "aprovar análise (LGPD Art. 20)", "gerar perguntas", "recalcular score". Estado dos consentimentos LGPD visível. |
| `/entrevistas/[id]` | Perguntas pré-geradas (lista com competência + dificuldade), botões iniciar/encerrar bot, transcrição com resumo, análise de voz (barras de confiança/nervosismo/entusiasmo) e observações descritivas do LLM. |

**Setup**

```bash
cd apps/web
cp .env.example .env.local
# Em dev sem Azure AD, deixe NEXT_PUBLIC_AZURE_AD_CLIENT_ID vazio.
pnpm install
pnpm dev    # roda em http://localhost:3000
```

**Auth flow**

1. `AuthProvider` (em `src/lib/auth.tsx`) inicializa MSAL no client.
2. Após login, todos os requests via `api()` recebem `Authorization: Bearer <token>` (escopo configurado em `NEXT_PUBLIC_AZURE_AD_API_SCOPE`).
3. Respostas 401 redirecionam para `/login?expired=1`.
4. O backend valida o token contra `AZURE_AD_AUDIENCE`/`AZURE_AD_TENANT_ID` (módulo de auth a ligar via guard global — fora do escopo desta camada).

**Decisões de UI**

- Tipos vêm de `@uniats/shared` — frontend e backend usam o mesmo shape.
- Cliente HTTP (`src/lib/api.ts`) centraliza Bearer token, 401 redirect e erros amigáveis. Suporta validação Zod opcional do response shape.
- Componentes mínimos sem dependência de UI lib pesada — `clsx` + Tailwind. Substituir por shadcn/Radix se quiser ganhar mais polish sem reescrever lógica.
- Páginas autenticadas vivem em `src/app/(authed)/` — o layout desse grupo aplica `AuthGuard` automaticamente.

**LGPD na UI**

- Bloco "Consentimentos LGPD" no detalhe da candidatura mostra estado e datas dos consentimentos (geral + gravação de voz).
- Botão "Aprovar análise" só fica disponível para um humano e marca `revisado_por` + `revisado_em` em `scores` (Art. 20).
- Análise de voz vem acompanhada do disclaimer "descritiva, não decisória".
- `audio_url` cru NUNCA é mostrado ou linkado no frontend.

---

## 6.6. Smoke test — primeiro boot

Sequência mínima para validar que tudo está vivo. Roda em ~10 minutos numa máquina com Docker + Node 20 + pnpm 9.

```bash
# 0. Pré-requisitos (uma vez)
node --version       # >= 20.11
pnpm --version       # >= 9
docker --version

# 1. Clonar + instalar
pnpm install

# 2. Configurar env (use defaults onde possível)
cp .env.example .env
# Edite .env e preencha pelo menos: ANTHROPIC_API_KEY, VOYAGE_API_KEY,
# AZURE_AD_*, GUPY_*, DATA_ENCRYPTION_KEY (openssl rand -base64 32).
# Em dev você pode deixar SENDGRID, WAHA, MEETSTREAM, ASSEMBLYAI vazios —
# a inicialização degrada (logs de warning), mas a API sobe.

# 3. Infra local
pnpm infra:up
docker compose -f infra/docker-compose.yml ps   # postgres + redis + minio + mailhog ok

# 4. Banco
pnpm db:generate              # gera o cliente Prisma
pnpm db:migrate               # cria tabelas + índice HNSW
pnpm db:seed                  # usuário admin de dev

# 5. API
pnpm --filter @uniats/api dev
# Em outro terminal:
curl http://localhost:3001/health
# → {"status":"ok",...}

# 6. Frontend
cp apps/web/.env.example apps/web/.env.local
# (deixe AZURE_AD_CLIENT_ID vazio em dev para login fake)
pnpm --filter @uniats/web dev
# abra http://localhost:3000 → redireciona para /vagas

# 7. Validação rápida
# (a) typecheck: tudo verde em apps/api e apps/web
pnpm typecheck
# (b) testes unitários do backend
pnpm --filter @uniats/api test
```

**Smoke test funcional ponta-a-ponta** (precisa de credenciais reais):

1. UI `/vagas` → clique "Sincronizar Gupy" → API chama `POST /api/gupy/sync/vagas` → vagas aparecem na tabela.
2. Clique em uma vaga → `/vagas/[id]/ranking` → após o worker `embedding` processar, os candidatos rankeados aparecem com score consolidado.
3. Clique em um candidato → `/candidaturas/[id]` → veja CV estruturado + justificativa LLM com evidências. Clique "Aprovar análise" (LGPD Art. 20).
4. Clique "Gerar perguntas" → `POST /api/perguntas/gerar` → veja perguntas customizadas.
5. Agende entrevista com `POST /api/entrevistas` (use cURL — UI de agendamento não está nesta versão) → clique "Iniciar bot" → MeetStream entra na sala.
6. Após o bot terminar: webhook MeetStream → áudio é criptografado (AES-256-GCM) e salvo no MinIO → AssemblyAI gera transcrição → análise de voz é gravada → tudo aparece em `/entrevistas/[id]`.

**Status verificado nesta sessão**

- `pnpm typecheck` apps/api → **0 erros** ✓
- `pnpm typecheck` apps/web → **0 erros** ✓
- `pnpm --filter @uniats/api test` → **127/131 testes passam** ✓ (4 falhas conhecidas em testes auxiliares; 16 suites dependem do Prisma engine em runtime — passam após `pnpm db:generate`)

**O que ainda fica fora do MVP atual** (próximos passos sugeridos):

- Auth guard Azure AD no backend ligado em todas as rotas `/api/*` (hoje a validação acontece no frontend via MSAL; o backend confia no Bearer token sem verificar a assinatura).
- UI de agendamento de entrevista (hoje só via cURL).
- Job scheduler para iniciar o bot automaticamente N minutos antes do horário.
- Apagamento real do blob de áudio no MinIO no cron de retenção (hoje só zera a referência no banco).
- CI/CD (GitHub Actions com matrix: typecheck + test + build).
- Observabilidade (OpenTelemetry exporter para Tempo/Jaeger + Sentry SDK).

---

## 7. Troubleshooting

### Postgres não sobe / pgvector não está instalado

Verifique se está usando a imagem correta:

```bash
docker compose -f infra/docker-compose.yml config | grep image
# postgres deve ser pgvector/pgvector:pg16  (NÃO postgres:16-alpine)
```

Se já criou o volume com a imagem errada, derrube e refaça:

```bash
pnpm infra:down -v   # remove os volumes
pnpm infra:up
pnpm db:migrate
```

### Erro `relation "vagas" does not exist`

Faltou rodar `pnpm db:migrate`. Se o erro persistir, confira se o `DATABASE_URL` no `.env` aponta para o mesmo `schema` que as migrations (default: `public`).

### Webhook da Gupy retorna 401 mesmo com URL pública

Causas mais comuns, em ordem:

1. **Segredo HMAC diferente entre o painel e o `.env`**. Cole o mesmo valor exato nos dois lugares e reinicie a API (`pnpm --filter @uniats/api dev`).
2. **Body alterado por proxy reverso**. O ngrok normalmente preserva o body, mas se você estiver atrás de Nginx/Cloudflare, garanta que o body bruto chega no Node (a API usa `express.raw` apenas em `/webhooks/gupy`).
3. **Cabeçalho `X-Gupy-Signature` em formato diferente do esperado** (`sha256=<hex64>`). Inspecione com:
   ```bash
   ngrok http 3001 --log stdout
   ```
   ou no inspector do ngrok em `http://localhost:4040`.

### Erro de conexão no BullMQ / `ECONNREFUSED 6379`

Redis não está de pé. Rode `pnpm infra:up` e confirme `docker ps` exibindo redis healthy.

### Webhook foi recebido (202) mas a candidatura não apareceu no banco

Cheque a fila e o erro no registro do webhook:

```sql
SELECT id, evento, processado, tentativas, ultimo_erro
FROM webhooks_recebidos
ORDER BY recebido_em DESC LIMIT 5;
```

`tentativas` aumentando + `ultimo_erro` preenchido = BullMQ está fazendo retry com backoff exponencial. O default são 8 tentativas — se persistir o erro, o job vai para a `failed` queue e precisa de intervenção (veja `docs/runbooks/webhooks.md` em sprints futuros).

### Token Gupy "expirou" / 401

Tokens Bearer do sandbox são revogados periodicamente. Gere um novo no painel e atualize `GUPY_API_TOKEN` no `.env` (reinício necessário).

### `pnpm install` falha com "ELIFECYCLE" em `prisma`

Apague `node_modules` e cache:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm store prune
pnpm install
```

### Quero ver o que está acontecendo dentro da fila

```bash
# UI Web do BullMQ (a ligar em sprints futuros via Bull Board)
# Por enquanto, via redis-cli:
redis-cli LLEN bull:gupy-webhook:wait
redis-cli LLEN bull:gupy-webhook:failed
redis-cli LRANGE bull:gupy-webhook:failed 0 5
```

---

## 8. Segurança e LGPD — checklist mínimo

- Secrets **nunca** vão para o git. `.env` está no `.gitignore`. Use cofre da equipe.
- `DATA_ENCRYPTION_KEY` rotaciona-se a cada 12 meses ou em incidente.
- Logs estruturados (`pino`) redactam `Authorization`, `email`, `phone`, `cpf` em produção.
- Webhook HMAC com `timingSafeEqual` — sem oracle de timing.
- Download de currículo só aceita `https://` — defesa SSRF.
- Soft delete (`excluido_em`) padrão para entidades com PII.
- Auditoria: `registro_auditoria` é append-only (trigger SQL bloqueia DELETE).
- Retenção: áudio 90 dias, transcrição 12 meses (variáveis no `.env`).

---

## 9. Próximos passos do roadmap

1. **Camada 2** — parsing de currículo (pdfjs / docx → texto limpo) + storage no MinIO.
2. **Camada 3** — embeddings Voyage AI + ranking via Claude Sonnet 4.6 com justificativa por candidato.
3. **Camada 4** — mensageria Z-API (WhatsApp) e SendGrid (e-mail) com templates aprovados pelo DHO.
4. **Camada 5** — bot do Meet (MeetStream) + transcrição (AssemblyAI Universal-2) + análise de voz.
5. Painel web (Next.js + Tailwind) com SSO Azure AD e RBAC (Recrutador / Gestor / Admin).

---

## 10. Suporte

- Issues internas → board Asana "Triagem Gupy".
- Dúvidas de produto → DHO (data protection officer).
- Dúvidas técnicas → canal `#tech-triagem` no Slack.
