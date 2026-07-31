# Collab — Recrutamento & Seleção (Unifique)

Plataforma interna da Unifique que puxa candidatos da Gupy, ranqueia por aderência à vaga
com apoio de IA, conduz a comunicação com o candidato (WhatsApp/e-mail), agenda a
entrevista no Teams e transcreve a conversa. Minimização e LGPD por construção.

> **Nome:** o produto é **Collab** (`collab.unifique.com.br`, API em
> `api-collab.unifique.com.br`), e os pacotes e containers acompanham (`@collab/*`,
> `collab-api`, `collab-web`). Quatro identificadores **continuam `uniats` de propósito**,
> porque renomeá-los em sistema vivo destrói ou abandona dado: usuário/banco do Postgres,
> `STORAGE_BUCKET`, `REDIS_QUEUE_PREFIX` e os volumes Docker (pinados em `uniats_*` no
> `docker-compose.prod.yml`). Somam-se a eles o `AZURE_AD_AUDIENCE` (`api://uniats-api`,
> identificador do app no Entra) e a label do runner. Todos nascem com o nome certo, de
> graça, na virada para o servidor novo.

> **Fase 1:** a entrega atual foca em **Recrutamento & Seleção**. Os módulos de Admissão
> e Administração de Pessoas (Alteração Contratual e Offboarding) existem no código, mas
> estão **ocultos da navegação** — ver `apps/web/src/lib/modulos.ts`.

---

## 1. Arquitetura em 30 segundos

```
   Gupy ATS ──(REST; sync agendado 6/6h)──> ingestão (allowlist LGPD)
                                                │
                                                ▼
                                     Postgres + pgvector
                                                │
        ┌───────────────────────┬───────────────┴───────────┬────────────────────┐
        ▼                       ▼                           ▼                    ▼
  perfil estruturado     embeddings (Voyage)          mensageria           entrevista
  do candidato           + ranking (Claude)        WhatsApp (WAHA)      Teams via Graph
                                                    e-mail (SendGrid)   → transcrição
                                                                        → fusão + ATA
```

O fluxo real está detalhado nas seções 6.x. Modelo de dados em
`packages/db/prisma/schema.prisma`. Critérios da avaliação por IA em
[`docs/ranking-criterios.md`](docs/ranking-criterios.md).

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
pnpm --filter @collab/api dev
```

A API sobe em `http://localhost:13001` (o front, em `13000`). Smoke test:

```bash
curl http://localhost:13001/health
# {"status":"ok","timestamp":"..."}
```

> `/health` fica **fora** do prefixo `/api` — é `GET /health`, não `/api/health`.

### 3.6. Expor o webhook publicamente (ngrok)

> **Na prática o sync não depende disso.** A ingestão roda por **sync agendado**
> (seção 6.1); os webhooks da Gupy são opcionais e hoje ficam desabilitados quando
> `GUPY_WEBHOOK_SECRET` está vazio. Além disso, o ambiente implantado é interno —
> webhooks vindos da internet podem simplesmente não alcançá-lo.

Se ainda assim quiser testar webhooks localmente, em outro terminal:

```bash
ngrok http 13001
```

Copie a URL HTTPS impressa (ex.: `https://abcd-1234.ngrok-free.app`) e configure no painel da Gupy como `https://abcd-1234.ngrok-free.app/webhooks/gupy`. Defina também `GUPY_WEBHOOK_SECRET` — sem ele o endpoint responde desabilitado (falha fechada, de propósito).

> Quando o ngrok reiniciar, a URL muda. Reconfigurar no painel toda vez é chato — para testes prolongados, use uma URL fixa (plano pago do ngrok, ou Cloudflare Tunnel).

---

## 4. Comandos do dia-a-dia

```bash
# Desenvolvimento
pnpm --filter @collab/api dev        # API em watch mode
pnpm --filter @collab/web dev        # Front (Next.js) — sprint futuro
pnpm dev                              # tudo em paralelo via Turborepo

# Banco
pnpm db:migrate                       # nova migration (prompt interativo)
pnpm db:studio                        # GUI do Prisma em localhost:5555
pnpm db:seed                          # repovoar com dados de demo

# Testes
pnpm --filter @collab/api test       # unitários (Jest + nock)
pnpm --filter @collab/api test:cov   # com cobertura
pnpm --filter @collab/api test:int   # integração (requer docker-compose up)

# Sincronização Gupy (sob demanda; o normal é o cron de 6/6h fazer sozinho)
curl -X POST http://localhost:13001/api/gupy/sync/vagas
curl -X POST http://localhost:13001/api/gupy/sync/candidaturas-todas
curl -X POST http://localhost:13001/api/gupy/sync/vaga/<GUPY_VAGA_ID>/candidaturas
# Não existe endpoint para sincronizar UMA vaga: a Gupy não expõe GET /jobs/:id.

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
  | xargs -I{} curl -X POST http://localhost:13001/api/curriculos/{}/reprocessar
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

Após subir, escaneie o QR com o WhatsApp do número operacional e preencha `WAHA_API_KEY` e `WAHA_WEBHOOK_SECRET` no `.env` com os mesmos valores. O `docker-compose` do projeto expõe o WAHA em `http://localhost:4000` (dentro do container ele escuta na 3000).

> No ambiente implantado o QR é lido pela própria tela **Sistema → WhatsApp** do Collab — o WAHA fica em loopback e a API faz o proxy. Não é preciso túnel SSH nem expor o dashboard.

> O número usado pelo WAHA **vive sendo banido** (WhatsApp Web não-oficial). Existe um pacer com janela de horário, teto diário e jitter, configurável na tela WhatsApp. A solução definitiva é migrar o contato com candidato para a Cloud API oficial.

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
  → HMAC-SHA512 validado → atualiza status (ENTREGUE/LIDO/RESPONDIDO)
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
| `WAHA_BASE_URL` | — (obrigatória) | URL do WAHA. Não tem default; em dev, `http://localhost:4000`. |
| `WAHA_API_KEY` | — | X-Api-Key configurada no container. |
| `WAHA_SESSION` | `default` | Nome da sessão (Plus permite várias). |
| `WAHA_WEBHOOK_SECRET` | — opcional | HMAC-SHA512 dos webhooks. **Defina em produção.** |
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

## 6.4. Entrevistas — agendamento no Teams + transcrição

> **Histórico:** este fluxo já foi desenhado com bot do MeetStream no Google Meet e
> transcrição via AssemblyAI. **Ambos foram removidos** (o ambiente é interno e os
> webhooks externos não chegavam). Hoje é Microsoft Teams via Graph.

O ciclo é: propor horários ao candidato por WhatsApp → o voto confirma e cria a reunião
no Teams → o transcript oficial é puxado pelo Graph após a reunião → um segundo motor
(Whisper local, forçado em `pt`) roda em paralelo → o Claude reconcilia os dois na
"melhor versão" → gera a ATA e analisa as respostas às perguntas do DHO.

**Por que dois motores:** a transcrição automática do Teams é travada em `en-US` e não há
como forçar `pt-BR` por API — áudio em português sai como inglês fonético alucinado. O
Whisper local cobre isso, e a fusão usa o Teams para diarização (quem falou) e o Whisper
para o conteúdo.

**Censura LGPD antes de persistir:** o texto cru vive só em memória. `RedacaoService`
aplica duas camadas — regex determinístico (CPF, telefone, e-mail, documentos) e análise
semântica via Claude para o art. 5º II (saúde, raça, religião, opinião política, filiação
sindical, vida sexual) — e o banco só recebe texto já censurado, com marcador
`[OCULTADO: CATEGORIA]`. Pretensão salarial é preservada de propósito.

**Pipeline**

```
[propor horários ao candidato]
  → POST /api/mensagens/enquete-horarios (WhatsApp, enquete)
  → pré-reserva: holds tentativos na agenda do recrutador/gestor por horário proposto

[candidato vota]
  → webhook WAHA (poll.vote) → enqueue confirmar-enquete
     ├─ cria a reunião no Teams via Graph (recordAutomatically)
     ├─ apaga os holds dos horários não escolhidos
     ├─ guarda graph_online_meeting_id + graph_organizador_email
     └─ notifica in-app (sino) recrutador/gestor/entrevistador
  → link da call é enviado ao candidato em max(agora, início − 2h)

[após a reunião]
  → enqueue transcricao-graph (pull do transcript oficial do Teams)
     ├─ RedacaoService.redigirTurnos()   ← censura ANTES de persistir
     ├─ transcricoes.texto_completo + segmentos (diarizado, mas em en-US)
     └─ enqueue fusao-transcricao

[fusão — 2 motores]
  → Whisper local (forçado pt) preenche whisper_segmentos
  → Claude reconcilia Teams (quem falou) × Whisper (o que foi dito)
     ├─ transcricoes.texto_fundido + segmentos_fundidos  ← é o que a tela exibe
     ├─ gera a ATA (resumo + tópicos)
     └─ analisa respostas às perguntas do DHO (respostas_entrevista)

[cron diário 03:00]
  └─ RetencaoLGPDService.aplicarRetencaoDiaria()
     ├─ áudio expirado → apaga o blob no storage e zera a referência
     └─ transcrição expirada → trunca texto_completo, segmentos, texto_fundido,
        segmentos_fundidos e whisper_segmentos
```

> **Bot Playwright** (`services/playwright-bot`) existe como fallback para capturar
> legendas entrando na sala, e está **desligado por padrão**
> (`PLAYWRIGHT_BOT_ENABLED=false`).

**Endpoints**

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/entrevistas` | Agenda. Cria a reunião no Teams via Graph. |
| `POST` | `/api/entrevistas/confirmar-enquete` | Confirma o horário votado pelo candidato. |
| `GET` | `/api/entrevistas/:id` | Detalhe + transcrição (sem `audio_url` cru). |
| `GET` | `/api/entrevistas?candidaturaId=` | Histórico; sem o parâmetro, a agenda escopada por papel. |
| `POST` | `/api/entrevistas/:id/transcrever-graph` | Dispara o pull do transcript do Teams. |
| `POST` | `/api/entrevistas/:id/transcrever-playwright` | Fallback pelo bot (desligado por padrão). |
| `POST` | `/api/entrevistas/:id/cancelar` | Cancela a entrevista (body: `{motivo?}`). |
| `POST` | `/api/entrevistas/:id/anotacoes` | Anotações do entrevistador. |

**Variáveis**

| Variável | Default | Para que serve |
|---|---|---|
| `INTERVIEW_ORGANIZER_EMAIL` | — | Conta que organiza a reunião e sob a qual o transcript existe no Graph. A Application Access Policy do Entra precisa estar escopada nela. |
| `AGENDA_ORGANIZADOR_FALLBACK_EMAIL` | — | Usado quando a vaga não tem recrutador com agenda. |
| `GRAPH_TRANSCRICAO_AUTO_ENABLED` | `true` | Puxa o transcript automaticamente após a reunião. |
| `PLAYWRIGHT_BOT_ENABLED` | `false` | Liga o bot de legendas (fallback). |
| `REDACAO_SEMANTICA_ENABLED` | `true` | Camada 2 da censura LGPD. Desligar deixa só o piso da regex — **não recomendado**. |
| `DATA_ENCRYPTION_KEY` | — | 32 bytes em base64. Necessária para os campos cifrados. |
| `RETENCAO_TRANSCRICAO_DIAS` | `365` | Prazo do `expira_em`, gravado na **criação** da transcrição (mudar não recalcula as existentes). |
| `RETENCAO_AUDIO_DIAS` | `90` | Prazo do áudio. **Hoje sem efeito prático:** nenhum áudio é capturado desde a remoção do MeetStream. |

**Criptografia em repouso (AES-256-GCM)**

O `CryptoService` cifra com DEK única de 32 bytes (`DATA_ENCRYPTION_KEY`, base64), IV de 12
bytes por arquivo (nunca reusado), tag de 16 bytes e **AAD = `entrevistaId`** — o que impede
trocar um blob entre entrevistas. Layout: `iv (12) || tag (16) || ciphertext (n)`.

> A camada existe e está testada, mas **hoje não há áudio para cifrar** — a captura saiu
> junto com o MeetStream. Ela volta a importar quando a gravação for retomada.

**LGPD — pontos importantes**

- Censura antes de persistir: o banco nunca recebe o texto cru da conversa (ver acima).
- Retenção registra cada apagamento/truncagem em `registro_auditoria` (Art. 37).
- Nenhuma decisão é automatizada: os scores são sugestão, e mover ou reprovar candidato
  grava a revisão humana em `scores.revisado_por`/`revisado_em` (Art. 20).
- `audio_url` nunca é devolvido pelo `GET /api/entrevistas/:id`.
- ⚠️ **Consentimento de gravação não é aplicado hoje.** `candidatos.consentimento_gravacao_em`
  é gravado quando o recrutador marca a opção no agendamento, mas **nada bloqueia** a
  transcrição na ausência dele — o guard prometido em versões anteriores referenciava
  código que foi removido. Item aberto.

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

Aplicação React App Router. Auth via Microsoft Entra ID (MSAL React).

**Páginas**

| Rota | O que faz |
|---|---|
| `/login` | Entrar com Microsoft (redirect MSAL). |
| `/inicio` | Painel do recrutador — indicadores, agenda do dia, pendências ("Precisa de você") e funil. É o pouso pós-login. |
| `/vagas` | Vagas sincronizadas, com filtros e busca. |
| `/vagas/[id]/ranking` | Top-K candidatos com score consolidado, similaridade vetorial e ranking LLM. |
| `/candidaturas/[id]` | CV estruturado, scores com justificativa e evidências citadas, geração de perguntas, envio de mensagem e agendamento. |
| `/entrevistas` e `/entrevistas/[id]` | Agenda e detalhe: perguntas, transcrição fundida, ATA e respostas do candidato por pergunta. |
| `/cargos`, `/vagas/publicar` | Catálogo de cargos e publicação de vaga a partir dele. |
| `/analise`, `/configuracoes/*` | Painel de análise, templates de mensagem, perguntas padrão e a seção Sistema (usuários, WhatsApp, chaves de API). |

**Setup**

```bash
cd apps/web
cp .env.example .env.local
# Preencha os NEXT_PUBLIC_AZURE_AD_* com os dados do App Registration.
pnpm install
pnpm dev    # roda em http://localhost:13000
```

**Auth flow**

1. `AuthProvider` (em `src/lib/auth.tsx`) inicializa MSAL no client.
2. Após login, todos os requests via `api()` recebem `Authorization: Bearer <token>` (escopo configurado em `NEXT_PUBLIC_AZURE_AD_API_SCOPE`).
3. Respostas 401 redirecionam para `/login?expired=1`.
4. O backend **valida a assinatura do token** contra `AZURE_AD_AUDIENCE`/`AZURE_AD_TENANT_ID` (`AzureStrategy` + `AuthGuard`), com `AUTH_ENABLED=true` no ambiente implantado. A autorização é por **área** (`admin`, `recrutamento`, `admissao`, `dho`, `gestao_acessos`) via `@Areas()`/`AreasGuard`, mais posse de vaga para o gestor — que enxerga só as vagas dele.

**Decisões de UI**

- Tipos vêm de `@collab/shared` — frontend e backend usam o mesmo shape.
- Cliente HTTP (`src/lib/api.ts`) centraliza Bearer token, 401 redirect e erros amigáveis. Suporta validação Zod opcional do response shape.
- Componentes mínimos sem dependência de UI lib pesada — `clsx` + Tailwind. Substituir por shadcn/Radix se quiser ganhar mais polish sem reescrever lógica.
- Páginas autenticadas vivem em `src/app/(authed)/` — o layout desse grupo aplica `AuthGuard` automaticamente.

**LGPD na UI**

- Bloco "Consentimentos LGPD" no detalhe da candidatura mostra o estado dos consentimentos.
  ⚠️ `consentimento_lgpd_em` **nunca é preenchido** — o aceite é colhido na Gupy, fora do
  Collab, e o payload dela não traz esse campo. O selo aparece sempre como pendente, o que
  induz a leitura errada de que falta base legal: o tratamento da candidatura se apoia no
  **Art. 7º V** (procedimentos preliminares de contrato), não em consentimento. Item aberto.
- Marcar revisão humana grava `revisado_por` + `revisado_em` em `scores` (Art. 20).
- Trechos censurados aparecem como pílula `[OCULTADO: …]` na transcrição.
- `audio_url` cru nunca é mostrado nem linkado.

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
# Em dev você pode deixar SENDGRID e WAHA vazios — a inicialização degrada
# (logs de warning), mas a API sobe.
# Deixe GUPY_SYNC_CRON_ENABLED=false em dev: a máquina local usa o MESMO
# tenant da Gupy que o ambiente implantado, e dois crons varreriam em dobro.

# 3. Infra local
pnpm infra:up
docker compose -f infra/docker-compose.yml ps   # postgres + redis + minio + mailhog ok

# 4. Banco
pnpm db:generate              # gera o cliente Prisma
pnpm db:migrate               # cria tabelas + índice HNSW
pnpm db:seed                  # usuário admin de dev

# 5. API + web (o `pnpm dev` da raiz sobe os dois via turbo)
pnpm dev
# Em outro terminal:
curl http://localhost:13001/health
# → {"status":"ok",...}

# 6. Frontend
cp apps/web/.env.example apps/web/.env.local
pnpm dev
# abra http://localhost:13000 → após o login, cai em /inicio

# 7. Validação rápida
# (a) typecheck: tudo verde em apps/api e apps/web
pnpm typecheck
# (b) testes unitários do backend
pnpm --filter @collab/api test
```

**Smoke test funcional ponta-a-ponta** (precisa de credenciais reais):

1. `/vagas` → "Sincronizar Gupy" (ou espere o sync agendado) → as vagas aparecem.
2. Abra uma vaga → `/vagas/[id]/ranking` → após o worker `embedding` processar, os candidatos aparecem com score consolidado.
3. Abra um candidato → `/candidaturas/[id]` → CV estruturado + justificativa do LLM com evidências citadas.
4. "Gerar perguntas" → `POST /api/perguntas/gerar`.
5. Agende a entrevista pela tela (ou proponha horários por WhatsApp e deixe o voto confirmar) → a reunião é criada no Teams.
6. Depois da reunião: o transcript é puxado do Graph, fundido com o Whisper, censurado e exibido em `/entrevistas/[id]` com ATA e respostas por pergunta.

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

1. **Segredo HMAC diferente entre o painel e o `.env`**. Cole o mesmo valor exato nos dois lugares e reinicie a API (`pnpm --filter @collab/api dev`).
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

## 8. Segurança e LGPD

**Minimização na entrada.** Os schemas Zod da Gupy são **allowlist**: campo não declarado
morre no parse, antes de tocar banco, fila, log ou prompt. Com `?fields=all` a Gupy devolve
o cadastro completo — CPF, data de nascimento, gênero, raça, **deficiência**, endereço
completo, e respostas de formulário que incluem altura e peso. Nada disso entra.
O payload bruto de candidato e candidatura **não é persistido**.

> Ao acrescentar um campo ao schema, pergunte a finalidade antes. E **nunca** declare
> `additionalQuestions` da candidatura em bloco — é por onde chegam perguntas de saúde.

**Censura antes de persistir.** Transcrição e resumo passam pelo `RedacaoService` (regex +
semântica via Claude) e o banco só recebe texto censurado. Ver seção 6.4.

**Decisão humana.** Os scores da IA são sugestão. Mover ou reprovar candidato grava a
revisão humana em `scores` (Art. 20). Critérios da avaliação documentados em
[`docs/ranking-criterios.md`](docs/ranking-criterios.md) — exigência do Art. 20 sobre
informação a respeito dos critérios.

**Operacional.** Secrets fora do git (`.env` no `.gitignore`; em produção vêm do secret
`ENV_PRODUCTION`). Logs `pino` redactam `Authorization`, `email`, `phone`, `cpf`.
Webhooks com HMAC e `timingSafeEqual`. Soft delete (`excluido_em`) nas entidades com PII.
`registro_auditoria` é append-only.

**Retenção.** Transcrição 12 meses (`RETENCAO_TRANSCRICAO_DIAS`, aplicado na criação).
⚠️ `RETENCAO_CV_DIAS` está declarada mas **não há rotina de retenção de currículo** —
currículos, candidatos e candidaturas ficam indefinidamente. Item aberto, junto com a
ausência de um fluxo de exclusão a pedido do titular (Art. 18).

---

## 9. Itens abertos

Pendências conhecidas, para quem for pegar o projeto:

1. **Retenção de currículo e exclusão a pedido do titular** (Art. 18) — não existem.
2. **Consentimento**: `consentimento_lgpd_em` nunca preenchido; consentimento de gravação
   não bloqueia a transcrição. Ver seções 6.4 e 6.5.2.
3. **E-mail inoperante**: o cliente SendGrid está pronto, mas sem `SENDGRID_API_KEY` todo
   envio falha.
4. **Currículo em PDF**: a Gupy **não expõe arquivo de currículo** nesta API — o ranking
   trabalha só com o perfil estruturado dela. O pipeline `cv-download`/`cv-parse` existe
   mas nunca é acionado.
5. **Rebrand técnico** (pacotes `@collab/*`, domínio, containers) — previsto para a virada
   do servidor, junto com a conta de serviço da agenda e a rotação de segredos.
6. **Módulos do DHO** (Admissão, Alteração Contratual, Offboarding): implementados, ocultos,
   com conectores Senior/Autentique em modo simulado.
7. **Dependências**: auditoria acusa vulnerabilidades altas, com destaque para o Next.js
   (upgrade de major pendente).

---

## 10. Suporte

- Issues internas → board Asana "Triagem Gupy".
- Dúvidas de produto → DHO (data protection officer).
- Dúvidas técnicas → canal `#tech-triagem` no Slack.
