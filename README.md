# Collab — Recrutamento & Seleção (Unifique)

Plataforma interna da Unifique que puxa candidatos da Gupy, ranqueia por aderência à vaga
com apoio de IA, conduz a comunicação com o candidato (WhatsApp/e-mail), agenda a
entrevista no Teams e transcreve a conversa. Minimização e LGPD por construção.

> **Nome:** o produto é **Collab** — `collab.unifique.com.br`, API em
> `api-collab.unifique.com.br` —, e os identificadores técnicos acompanham:
> pacotes `@collab/*`, containers e imagens `collab-*`, volumes `collab_*`, banco e
> usuário `collab`, `STORAGE_BUCKET=collab`, `REDIS_QUEUE_PREFIX=collab`. A troca do
> banco/bucket/fila só foi possível porque a base de homologação foi **zerada** na
> virada do nome — em sistema vivo ela destruiria ou abandonaria dado. Ver o runbook
> em [docs/wipe-base-rebrand.md](docs/wipe-base-rebrand.md).
>
> Dois identificadores **seguem `uniats` de propósito**, e nenhum tem relação com o
> banco: o `AZURE_AD_AUDIENCE` (`api://uniats-api` — identificador opaco do app no
> Entra; trocar invalida todo token emitido) e a label do runner (`uniats-prod` — é o
> registro do runner na máquina). Ambos têm comentário no lugar explicando o porquê.

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
`packages/db/prisma/schema.prisma` — o **MER completo está na seção 10**. Critérios da
avaliação por IA em [`docs/ranking-criterios.md`](docs/ranking-criterios.md).

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
| `CLASSIFICACAO_CONCORRENCIA` | `10` | Chamadas simultâneas ao Claude em "classificar a vaga inteira" (era 4 fixo). Medido sem 429 em 10. |
| `TALENTOS_SIMILARIDADE_MINIMA` | `80` | Piso de aderência para o banco de talentos indicar alguém numa vaga. Alto de propósito — a aba vazia é o caso normal. |

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

**Censura em dois modelos, por natureza do dado.**

| | Transcrição | Currículo |
|---|---|---|
| Quando censura | **antes de persistir** | **na saída para IA** |
| O que o banco guarda | só o texto censurado | o texto íntegro |
| O que o recrutador vê | censurado | completo |

A diferença é decisão da área de segurança, não inconsistência. Na entrevista, o texto cru
não precisa existir. No currículo, o recrutador precisa ler o que o candidato escreveu —
então o dado fica, e quem é filtrado é o que **atravessa a fronteira** para Voyage e Claude.

O risco do currículo mora num campo só: `experiencias[].descricao`, texto livre vindo de
`activitiesPerformed` da Gupy. É onde aparece "atuei na pastoral", "diretor do sindicato",
"afastado por tratamento". O resto — cargo, empresa, datas, formação, idiomas — vem de
campos fechados e é seguro por construção.

**Nada sai sem passar por [`curriculo-para-ia.ts`](apps/api/src/modules/redacao/curriculo-para-ia.ts).**
As duas fronteiras (embedding e ranking) chamam a mesma função. O furo original nasceu
justamente da ausência desse ponto único: a censura existia, estava ligada na transcrição,
e ninguém viu que o currículo saía cru por duas portas.

O espelho censurado vive nas colunas `ia_*`, calculado uma vez por currículo pelo job
`cv-redacao` (censurar a cada ranking somaria um Claude por currículo por execução). Um cron
de 10 em 10 minutos enfileira um lote pequeno de quem ainda não tem espelho — cobre
currículo novo, acervo antigo, job que falhou e mudança de `REDACAO_CV_VERSAO`.

> **Fail-closed sem quebrar o ranking.** Sem espelho, a fronteira omite descrição, resumo e
> trecho literal, e deixa passar o histórico estruturado. O ranking perde sinal e nada vaza.
> Travar o ranking inteiro seria pior: alguém desligaria a proteção no primeiro incidente.

`ia_categorias` guarda quais categorias foram ocultadas — nunca o valor (Art. 37). É também
a métrica de quantos currículos realmente carregam dado sensível.

**Decisão humana.** Os scores da IA são sugestão. Mover ou reprovar candidato grava a
revisão humana em `scores` (Art. 20). Critérios da avaliação documentados em
[`docs/ranking-criterios.md`](docs/ranking-criterios.md) — exigência do Art. 20 sobre
informação a respeito dos critérios.

**Nome não vai para o modelo.** Na análise de respostas, o nome do candidato é trocado por
um rótulo (`[CANDIDATO]`) no transcript e na instrução, e restaurado na saída antes de
persistir. O modelo não precisa do nome verdadeiro — precisa de um rótulo consistente.
Cada variante (nome completo, primeiro nome, sobrenome) tem seu próprio token, para que a
citação literal volte com a palavra exata que estava na conversa. Ver
[`pseudonimo.ts`](apps/api/src/modules/claude/pseudonimo.ts).

> A chamada de **censura** (`redigirSensivel`) é a exceção, e é por construção: é ela que
> torna o texto seguro, então precisa ver o cru. Anonimizar antes seria circular.

**Operacional.** Secrets fora do git (`.env` no `.gitignore`; em produção vêm do secret
`ENV_PRODUCTION`). Logs `pino` redactam `Authorization`, `email`, `phone`, `cpf`.
Containers rodam como usuário `node`, não root. Soft delete (`excluido_em`) nas entidades
com PII. `registro_auditoria` é append-only.

**Webhooks.** HMAC com `timingSafeEqual`, idempotência por `unique(provider, external_id)`
e janela anti-replay de 5 min ([`anti-replay.ts`](apps/api/src/common/anti-replay.ts)). A
janela só é aplicada onde o timestamp é **coberto pela assinatura** — Gupy (`occurredAt`),
WAHA (`timestamp`) e SendGrid (10 min, recomendação do provedor). Autentique e o callback
do bot não trazem timestamp assinado: neles vale só a idempotência, e validar um campo que
o atacante pode reescrever seria encenação. Timestamp ausente alerta e segue;
`WEBHOOK_REPLAY_STRICT=true` transforma a ausência em recusa — ligue depois de confirmar
nos logs que o campo sempre chega, senão a ingestão do WhatsApp para em silêncio.

**Retenção.** Duas rotinas noturnas, uma por natureza de dado:

| Cron | Rotina | Prazo | Como o corte é definido |
|---|---|---|---|
| 03:00 | Áudio e transcrição (`RetencaoLGPDService`) | 90 dias / 12 meses | Coluna `expira_em`, gravada na criação |
| 03:20 | Currículo e candidato (`RetencaoDadosService`) | 2 anos | **Calculado** a partir da env, a cada execução |

A diferença é deliberada. Com o corte calculado, mudar `RETENCAO_CV_DIAS` ou
`RETENCAO_CANDIDATO_DIAS` muda a política já na madrugada seguinte — e alcança o que
está no banco, sem migration nem backfill. É o botão para acertar o prazo com a área de
segurança.

**Ensaio antes de encurtar o prazo.** `RETENCAO_MODO=simulado` faz a varredura consultar
e relatar quantos seriam alcançados, sem apagar nada. O padrão é `real` — política de
retenção precisa estar em vigor, não esperando alguém ligar. O ensaio existe para o dia
em que o prazo for **encurtado**: aí a varredura alcança de uma vez tudo que ficou entre
o prazo antigo e o novo, e vale ver a conta antes. Em modo simulado o log sai como
**warning**, de propósito — política inerte não pode passar batido. O pedido de exclusão
do titular (Art. 18) ignora o flag e executa sempre: simular a resposta a um direito
exercido seria negá-lo em silêncio.

O currículo perde texto, campos estruturados, arquivo no storage e **embeddings** (o
vetor é o mesmo texto em outra forma — mantê-lo deixaria o candidato pesquisável por
similaridade). O candidato só é alcançado quando não tem processo vivo, entrevista em
aberto nem admissão.

**Exclusão a pedido do titular (Art. 18).** `POST /api/lgpd/candidatos/:id/apagar`, com
motivo obrigatório, restrito a `admin`/`dho`, disponível na ficha da candidatura. Usa o
mesmo motor da varredura. Não existe botão de autoatendimento porque o candidato não tem
conta aqui — ele se cadastra na Gupy, e este é um espelho interno.

> **A trava que faz isso valer.** `paraUpsertCandidato` usa `update: base`, então o sync
> de 6 em 6 horas reescreveria nome, e-mail e telefone de quem acabou de ser apagado.
> `excluido_em` funciona como lápide: `GupyService.candidatoApagado` consulta antes de
> qualquer upsert e recusa reimportar. Sem essa dupla, a exclusão duraria 6 horas.

---

## 9. Itens abertos

Pendências conhecidas, para quem for pegar o projeto:

1. **Consentimento**: `consentimento_lgpd_em` nunca preenchido; consentimento de gravação
   não bloqueia a transcrição. Ver seções 6.4 e 6.5.2.
2. **E-mail inoperante**: o cliente SendGrid está pronto, mas sem `SENDGRID_API_KEY` todo
   envio falha.
3. **Currículo em PDF**: a Gupy **não expõe arquivo de currículo** nesta API — o ranking
   trabalha só com o perfil estruturado dela. O pipeline `cv-download`/`cv-parse` existe
   mas nunca é acionado.
4. **Rebrand técnico** (pacotes `@collab/*`, domínio, containers) — previsto para a virada
   do servidor, junto com a conta de serviço da agenda e a rotação de segredos.
5. **Módulos do DHO** (Admissão, Alteração Contratual, Offboarding): implementados, ocultos,
   com conectores Senior/Autentique em modo simulado.
6. **Dependências**: a varredura roda a cada push
   ([`security-scan.yml`](.github/workflows/security-scan.yml)) e é **não-bloqueante** —
   os achados ficam no log do job, sem reprovar nada. Triar essa saída e remover o
   `|| true` para crítico/alto é o que o REQ-DEP-002 pede.
   A menção anterior a "major do Next.js pendente" **não procede**: o lockfile está em
   `next@14.2.35`, acima do 14.2.25 que corrigiu o CVE-2025-29927 (bypass de autorização
   por middleware) — e o projeto não tem `middleware.ts`, que é o vetor.

---

## 10. MER — Modelo Entidade-Relacionamento

Fonte de verdade: [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma).
Os diagramas abaixo mostram **entidades, chaves e cardinalidades**; a lista completa de
colunas fica no schema. Se editar o schema, atualize esta seção junto.

**Convenções do modelo**

- Tabelas em **português, `snake_case`** (via `@@map`); modelos Prisma em PascalCase.
- PK sempre `id uuid` (`@default(uuid())`), exceto `configuracoes_sistema` (PK = `chave`).
- `criado_em` / `atualizado_em` em praticamente todas as tabelas; **soft delete** via
  `excluido_em` onde há PII ou histórico a preservar.
- `gupy_id` (BigInt, único) é a **chave natural** das entidades espelhadas da Gupy —
  é o que dá idempotência ao sync.
- **UUID frouxo**: várias colunas de autoria/revisão (`revisado_por`, `avaliador_id`,
  `solicitante_id`, `aprovado_*_por_id`, `criado_por_id`…) guardam `usuarios.id` **sem FK**.
  É proposital — o histórico sobrevive à remoção do usuário. Nos diagramas aparecem como
  linha tracejada (`..`).
- `embeddings` é **polimórfica**: ou `vaga_id`, ou `curriculo_id` é preenchido (nunca os dois).
- A coluna `embeddings.vetor` é `vector(1024)` (pgvector) — tipo `Unsupported` no Prisma,
  e o índice HNSW é criado por migration SQL bruta (ver §6.2).

**Notação (mermaid ER, lado a lado da linha):** `||` = exatamente um · `|o` / `o|` = zero
ou um · `o{` = zero ou muitos. A linha `--` é FK real; `..` é referência frouxa (sem FK).
Ou seja, `usuarios |o--o{ vagas` lê-se "a vaga pode ou não ter esse usuário" — é o jeito
de mostrar que a coluna é **nullable**.

**Domínios**

| Domínio | Tabelas |
|---|---|
| Recrutamento (núcleo) | `usuarios`, `vagas`, `candidatos`, `candidaturas`, `curriculos_processados`, `embeddings`, `scores` |
| Mensageria | `templates_mensagem`, `mensagens`, `enquetes_horario`, `webhooks_recebidos` |
| Entrevistas | `entrevistas`, `transcricoes`, `analises_voz`, `perguntas_entrevista`, `perguntas_padrao`, `respostas_entrevista`, `avaliacoes_entrevista` |
| Sistema & auditoria | `notificacoes`, `registro_auditoria`, `configuracoes_sistema`, `chaves_api` |
| Admissão (oculto na fase 1) | `admissoes`, `documentos_admissionais`, `exames_admissionais`, `eventos_admissao`, `solicitacoes_acesso` |
| Cadastros DHO | `cargos`, `cargos_lotacoes`, `unidades`, `centros_custo`, `colaboradores`, `procuradores` |
| Alteração contratual (oculto) | `solicitacoes_alteracao_contratual`, `itens_alteracao_contratual`, `assinaturas_alteracao_contratual`, `eventos_alteracao_contratual`, `execucoes_alteracao_contratual` |
| Offboarding (oculto) | `solicitacoes_offboarding`, `assinaturas_offboarding`, `itens_encerramento_offboarding`, `eventos_offboarding`, `convites_offboarding` |

---

### 10.1. Núcleo — vaga, candidato, candidatura, currículo, score

O eixo do produto. `candidaturas` é a tabela associativa entre `vagas` e `candidatos`
(N:N com atributos), e é dela que pendura tudo o que a IA produz.

```mermaid
erDiagram
    usuarios |o--o{ vagas : "recrutador_id"
    usuarios |o--o{ vagas : "gestor_id"
    vagas ||--o{ candidaturas : "recebe"
    candidatos ||--o{ candidaturas : "aplica"
    candidaturas ||--o| curriculos_processados : "1:0..1"
    candidatos ||--o{ curriculos_processados : "possui"
    vagas |o--o{ embeddings : "texto canonico"
    curriculos_processados |o--o{ embeddings : "texto do CV"
    candidaturas ||--o{ scores : "avaliacoes"
    usuarios |o..o{ scores : "revisado_por - sem FK"

    usuarios {
        uuid id PK
        string azure_oid UK "Object ID do Entra"
        string email UK
        string nome
        enum papel "legado - nao decide acesso"
        array areas "admin, recrutamento, dho..."
        bool ativo "false bloqueia login"
        datetime ultimo_login_em
    }

    vagas {
        uuid id PK
        bigint gupy_id UK
        string codigo "jobCode"
        string titulo "indice GIN trigram"
        text descricao
        enum status "status_vaga"
        datetime data_publicacao
        uuid recrutador_id FK
        uuid gestor_id FK
        string gestor_email "espelho p/ auto-vinculo"
        string recrutador_email
        json requisitos_json "campos do lider"
        text requisitos_texto "consolidado p/ embedding"
        datetime gupy_sincronizado_em
        datetime excluido_em "soft delete"
    }

    candidatos {
        uuid id PK
        bigint gupy_id UK
        string nome_completo "indice GIN trigram"
        string email
        string telefone
        string cpf_hash "SHA-256, nunca em claro"
        datetime consentimento_lgpd_em
        datetime consentimento_gravacao_em
        datetime excluido_em "soft delete"
    }

    candidaturas {
        uuid id PK
        bigint gupy_id UK
        uuid vaga_id FK "unique com candidato_id"
        uuid candidato_id FK
        string etapa_gupy "etapa no funil"
        enum status "status_candidatura"
        string motivo_desclassif
        datetime inscrito_em
        datetime movido_em
    }

    curriculos_processados {
        uuid id PK
        uuid candidatura_id FK "unique - 1:1"
        uuid candidato_id FK
        string arquivo_url "storage"
        string arquivo_sha256 "chave idempotente"
        text texto_bruto
        text texto_normalizado "fonte do embedding"
        json experiencias
        json formacoes
        array competencias
        float anos_experiencia
        string parser_versao
    }

    embeddings {
        uuid id PK
        uuid vaga_id FK "ou curriculo_id - polimorfica"
        uuid curriculo_id FK
        text trecho
        vector vetor "vector(1024) - indice HNSW"
        string modelo "voyage-3"
    }

    scores {
        uuid id PK
        uuid candidatura_id FK
        enum tipo "tipo_score"
        float valor "0..100"
        text justificativa
        json evidencias "citacoes da fonte"
        string modelo
        string prompt_versao
        uuid revisado_por "revisao humana - Art. 20"
        datetime revisado_em
    }
```

---

### 10.2. Mensageria — templates, envios e enquete de horários

```mermaid
erDiagram
    usuarios |o--o{ templates_mensagem : "criado_por"
    usuarios |o--o{ templates_mensagem : "atualizado_por"
    candidatos ||--o{ mensagens : "destinatario"
    candidaturas |o--o{ mensagens : "contexto opcional"
    candidatos ||--o{ enquetes_horario : "vota"
    candidaturas ||--o{ enquetes_horario : "propoe horarios"
    enquetes_horario |o--o| entrevistas : "entrevista_id unique"

    templates_mensagem {
        uuid id PK
        string codigo UK "slug estavel"
        string nome
        string versao "incrementa a cada edicao"
        bool ativo "soft-disable"
        text whatsapp_corpo
        string email_assunto
        text email_texto
        text email_html
        uuid criado_por FK
        uuid atualizado_por FK
    }

    mensagens {
        uuid id PK
        uuid candidato_id FK
        uuid candidatura_id FK "opcional"
        enum canal "canal_mensagem"
        enum direcao "direcao_mensagem"
        string template_codigo "snapshot codigo@versao"
        text corpo
        string destino "telefone ou e-mail"
        string provider "waha, sendgrid"
        string provider_msg_id
        enum status "status_mensagem"
        datetime enviado_em
        datetime entregue_em
        datetime lido_em
        datetime respondido_em
    }

    enquetes_horario {
        uuid id PK
        uuid candidatura_id FK
        uuid candidato_id FK
        string provider_msg_id "liga o voto a enquete"
        string pergunta
        json opcoes "rotulo, inicio, fim"
        json holds "pre-reservas na agenda"
        string status "AGUARDANDO, RESPONDIDA, CANCELADA"
        string opcao_escolhida
        datetime inicio_escolhido
        uuid entrevista_id FK "unique - idempotencia"
    }

    webhooks_recebidos {
        uuid id PK
        string provider "gupy, waha, sendgrid, autentique"
        string evento
        string external_id "unique com provider"
        json payload
        bool assinatura_ok
        bool processado
        int tentativas
        text ultimo_erro
    }
```

> `webhooks_recebidos` não tem FK para ninguém de propósito: é log de entrada bruto, e a
> unique `(provider, external_id)` é o que garante idempotência do reprocessamento.

---

### 10.3. Entrevistas — agenda, transcrição, perguntas e avaliação

```mermaid
erDiagram
    candidaturas ||--o{ entrevistas : "agenda"
    candidatos ||--o{ entrevistas : "participa"
    usuarios |o--o{ entrevistas : "entrevistador_id"
    entrevistas ||--o| transcricoes : "1:0..1"
    entrevistas ||--o| analises_voz : "1:0..1"
    vagas ||--o{ perguntas_entrevista : "roteiro da vaga"
    entrevistas |o--o{ perguntas_entrevista : "roteiro da sessao"
    entrevistas ||--o{ respostas_entrevista : "analise IA"
    perguntas_entrevista |o--o{ respostas_entrevista : "origem da pergunta"
    perguntas_padrao |o--o{ respostas_entrevista : "origem da pergunta"
    entrevistas ||--o{ avaliacoes_entrevista : "scorecard"
    perguntas_entrevista |o--o{ avaliacoes_entrevista : "ancora opcional"

    entrevistas {
        uuid id PK
        uuid candidatura_id FK
        uuid candidato_id FK
        uuid entrevistador_id FK
        datetime agendada_para
        int duracao_estimada_min
        string graph_event_id "evento no Outlook"
        string teams_join_url
        string graph_online_meeting_id "resolvido na criacao"
        string graph_organizador_email "conta dona do transcript"
        enum status "status_entrevista"
        string audio_url "storage cifrado - nunca exposto"
        datetime audio_expira_em
        text parecer_final
        enum recomendacao_painel
    }

    transcricoes {
        uuid id PK
        uuid entrevista_id FK "unique - 1:1"
        string provider "graph ou playwright"
        string idioma
        text texto_completo "ja censurado"
        json segmentos "diarizado - Teams"
        json whisper_segmentos "2o motor - pt forcado"
        text texto_fundido "melhor versao - o que a tela exibe"
        json segmentos_fundidos
        text resumo "ATA"
        array topicos
        datetime expira_em "retencao 12 meses"
    }

    analises_voz {
        uuid id PK
        uuid entrevista_id FK "unique - 1:1"
        string provider
        string sentimento_global
        float confianca_media
        json segmentos
        text observacoes_llm
    }

    perguntas_entrevista {
        uuid id PK
        uuid vaga_id FK
        uuid entrevista_id FK "opcional"
        int ordem
        text pergunta
        text objetivo
        string competencia
        string dificuldade
        enum origem "IA ou HUMANO"
        string modelo
        string prompt_versao
    }

    perguntas_padrao {
        uuid id PK
        text pergunta "vale p/ TODA entrevista"
        text objetivo
        string competencia
        string categoria
        bool ativo
        int ordem
    }

    respostas_entrevista {
        uuid id PK
        uuid entrevista_id FK
        uuid pergunta_id FK "da vaga - opcional"
        uuid pergunta_padrao_id FK "do banco padrao - opcional"
        text pergunta_texto "snapshot"
        enum status "status_resposta"
        bool tema_abordado
        string falante
        text sintese
        text citacao "trecho literal - anti-alucinacao"
        string modelo
    }

    avaliacoes_entrevista {
        uuid id PK
        uuid entrevista_id FK
        uuid pergunta_id FK "opcional"
        uuid avaliador_id "usuarios.id sem FK"
        string avaliador_nome "snapshot"
        string competencia "unique com entrevista e avaliador"
        int nota "escala 1..5"
        int peso
        text evidencia
        enum origem "HUMANO ou IA_SUGERIDO"
    }
```

> `respostas_entrevista` guarda **snapshot** do texto da pergunta: editar ou apagar uma
> `perguntas_padrao` não reescreve o histórico das entrevistas passadas.

---

### 10.4. Sistema e auditoria

```mermaid
erDiagram
    usuarios ||--o{ notificacoes : "destinatario"
    usuarios |o--o{ registro_auditoria : "autor"

    notificacoes {
        uuid id PK
        uuid usuario_id FK
        enum tipo "tipo_notificacao"
        string titulo
        text mensagem
        string link "rota interna do app"
        uuid referencia_id "unique com usuario e tipo"
        datetime lida_em
    }

    registro_auditoria {
        uuid id PK
        uuid usuario_id FK
        string acao "criar, atualizar, ver_dado_sensivel"
        string entidade
        uuid entidade_id
        json diff "before/after"
        string ip
        string user_agent
    }

    configuracoes_sistema {
        string chave PK
        json valor "sobrepoe o .env quando existe"
        uuid atualizado_por_id "sem FK"
    }

    chaves_api {
        uuid id PK
        string nome
        string prefixo "identificacao sem revelar"
        string hash UK "SHA-256 da chave completa"
        array escopos "mesmas areas do usuario"
        datetime expira_em
        datetime ultimo_uso_em
        datetime revogado_em
        uuid criado_por_id "sem FK"
    }
```

> `registro_auditoria` é **append-only** (LGPD Art. 37). A unique
> `(usuario_id, tipo, referencia_id)` em `notificacoes` é o que impede o retry do BullMQ
> de duplicar o aviso do sino.

---

### 10.5. Admissão

> Módulo **oculto na fase 1** (ver `apps/web/src/lib/modulos.ts`); as tabelas existem.
> Nasce de uma candidatura com status `CONTRATADO`.

```mermaid
erDiagram
    candidaturas ||--o| admissoes : "1:0..1"
    candidatos ||--o{ admissoes : "pessoa"
    vagas ||--o{ admissoes : "vaga de origem"
    usuarios |o--o{ admissoes : "responsavel_id"
    admissoes ||--o{ documentos_admissionais : "checklist"
    admissoes ||--o| exames_admissionais : "ASO 1:0..1"
    admissoes ||--o{ eventos_admissao : "timeline"
    admissoes ||--o| solicitacoes_acesso : "chamado de acesso 1:0..1"

    admissoes {
        uuid id PK
        uuid candidatura_id FK "unique - 1:1"
        uuid candidato_id FK
        uuid vaga_id FK
        uuid responsavel_id FK
        enum status "status_admissao"
        string cargo
        decimal salario
        string tipo_contratacao "CLT, PJ, ESTAGIO"
        datetime data_admissao
        string esocial_recibo "evento S-2200"
        string matricula "no ERP de RH"
        datetime excluido_em
    }

    documentos_admissionais {
        uuid id PK
        uuid admissao_id FK "unique com tipo"
        enum tipo "tipo_documento_admissional"
        enum status "status_documento_admissional"
        bool obrigatorio
        string arquivo_url
        string arquivo_sha256
        datetime validade
        json dados_extraidos_json "OCR do RG via Claude visao"
        string ocr_versao
        uuid analisado_por "sem FK"
    }

    exames_admissionais {
        uuid id PK
        uuid admissao_id FK "unique - 1:1"
        string clinica
        datetime agendado_para
        datetime realizado_em
        enum resultado "resultado_exame_admissional"
        text restricoes
        string aso_url
    }

    eventos_admissao {
        uuid id PK
        uuid admissao_id FK
        enum de_status
        enum para_status
        uuid autor_id "sem FK"
        string autor_nome
        text observacao
    }

    solicitacoes_acesso {
        uuid id PK
        uuid admissao_id FK "unique - idempotencia do chamado"
        uuid documento_id "RG que originou - sem FK"
        string provider "acelerato"
        enum status "status_solicitacao_acesso"
        string nome_enviado
        string ref_externa "ticket externo"
        string url_externa
    }
```

---

### 10.6. Cadastros DHO e alteração contratual

> Módulo **oculto na fase 1** — exceto `cargos`, que a tela `/cargos` e a publicação de
> vaga usam. `unidades`, `centros_custo` e `colaboradores` são **espelho de views do
> Senior**; `colaboradores` **não tem salário de propósito** (o solicitante informa
> anterior e novo).

```mermaid
erDiagram
    cargos ||--o{ cargos_lotacoes : "onde pode existir"
    unidades |o--o{ cargos_lotacoes : "restricao"
    centros_custo |o--o{ cargos_lotacoes : "restricao"
    unidades |o--o{ colaboradores : "lotacao"
    centros_custo |o--o{ colaboradores : "lotacao"
    colaboradores |o--o{ solicitacoes_alteracao_contratual : "alvo"
    solicitacoes_alteracao_contratual ||--o{ itens_alteracao_contratual : "1..N por tipo"
    cargos |o--o{ itens_alteracao_contratual : "cargo_novo_id"
    solicitacoes_alteracao_contratual ||--o{ assinaturas_alteracao_contratual : "gestor + DHO"
    solicitacoes_alteracao_contratual ||--o{ eventos_alteracao_contratual : "timeline"
    solicitacoes_alteracao_contratual ||--o| execucoes_alteracao_contratual : "aplicacao no Senior"

    cargos {
        uuid id PK
        string codigo UK
        string titulo "indice GIN trigram"
        string senioridade
        text descricao
        bool ativo
        string origem "csv ou manual"
        datetime excluido_em
    }

    cargos_lotacoes {
        uuid id PK
        uuid cargo_id FK
        uuid unidade_id FK "opcional"
        uuid centro_custo_id FK "opcional"
    }

    unidades {
        uuid id PK
        string externo_id UK "chave na fonte Senior"
        string codigo
        string nome
        string cidade
        bool ativo
        datetime sincronizado_em
    }

    centros_custo {
        uuid id PK
        string senior_id UK
        string codigo
        string nome
        bool ativo
        datetime sincronizado_em
    }

    colaboradores {
        uuid id PK
        string matricula UK "chave estavel no Senior"
        string senior_id UK
        string nome
        string email
        string cpf_hash
        uuid unidade_id FK
        uuid centro_custo_id FK
        string cargo_atual
        string lider_matricula
        bool ativo
    }

    solicitacoes_alteracao_contratual {
        uuid id PK
        uuid solicitante_id "o lider - sem FK"
        string solicitante_nome
        uuid colaborador_id FK
        string colaborador_matricula "snapshot congelado"
        string cargo_atual "snapshot"
        string unidade_atual "snapshot"
        text razoes
        datetime data_aplicacao "dia exato da execucao"
        enum status "status_alteracao_contratual"
        string autentique_documento_id
        datetime assinado_em
        uuid aprovado_por_id "DHO - sem FK"
        datetime excluido_em
    }

    itens_alteracao_contratual {
        uuid id PK
        uuid solicitacao_id FK "unique com tipo"
        enum tipo "tipo_alteracao_contratual"
        string valor_anterior "de"
        string valor_novo "para"
        uuid cargo_novo_id FK
        uuid unidade_nova_id "sem FK - snapshot"
        uuid centro_custo_novo_id "sem FK - snapshot"
        decimal salario_anterior "informado, nao lido do Senior"
        decimal salario_novo
        string novo_lider_matricula
    }

    assinaturas_alteracao_contratual {
        uuid id PK
        uuid solicitacao_id FK "unique com papel"
        enum papel "GESTOR ou DHO"
        string nome "snapshot"
        string email
        enum status "status_assinatura"
        string autentique_signatario_id
        datetime assinado_em
    }

    eventos_alteracao_contratual {
        uuid id PK
        uuid solicitacao_id FK
        enum de_status
        enum para_status
        uuid autor_id "sem FK"
        text observacao
    }

    execucoes_alteracao_contratual {
        uuid id PK
        uuid solicitacao_id FK "unique - 1:1"
        datetime agendada_para "dispara o job"
        datetime executada_em
        bool sucesso
        int tentativas
        json payload_enviado "o que foi ao Senior"
        json resposta
        text erro
    }
```

---

### 10.7. Offboarding

> Módulo **oculto na fase 1**, exceto a página pública de autodesligamento (por token).
> Origem `EMPREGADOR` passa por duas aprovações (gestor + DHO); origem `COLABORADOR` vai
> direto para as assinaturas.

```mermaid
erDiagram
    colaboradores |o--o{ solicitacoes_offboarding : "desligado"
    solicitacoes_offboarding ||--o{ assinaturas_offboarding : "colaborador + empresa"
    procuradores |o--o{ assinaturas_offboarding : "via fisica"
    solicitacoes_offboarding ||--o{ itens_encerramento_offboarding : "integracoes + checklist"
    solicitacoes_offboarding ||--o{ eventos_offboarding : "timeline"
    convites_offboarding |o..o| solicitacoes_offboarding : "cria ao usar - sem FK"

    solicitacoes_offboarding {
        uuid id PK
        enum origem "origem_offboarding"
        uuid solicitante_id "sem FK"
        string solicitante_nome
        uuid colaborador_id FK
        string colaborador_matricula "snapshot"
        enum tipo_desligamento
        bool cumpre_aviso_previo
        int aviso_previo_dias
        text motivo
        string email_pessoal "do Senior - verificar"
        enum forma_assinatura "DIGITAL ou FISICA"
        json senior_snapshot "snapshot demissional"
        enum status "status_offboarding"
        datetime aprovado_gestor_em
        datetime aprovado_dho_em
        string autentique_documento_id
        string documento_assinado_url "via fisica"
        datetime assinaturas_validadas_em
        datetime excluido_em
    }

    assinaturas_offboarding {
        uuid id PK
        uuid solicitacao_id FK "unique com papel"
        enum papel "papel_assinante_offboarding"
        string nome "snapshot"
        string email
        enum status "status_assinatura"
        string representante_origem "dho ou procurador"
        uuid procurador_id FK
        datetime assinado_em
    }

    procuradores {
        uuid id PK
        string nome "indice GIN trigram"
        string email
        string documento
        string cargo
        bool ativo
        datetime excluido_em
    }

    itens_encerramento_offboarding {
        uuid id PK
        uuid solicitacao_id FK "unique com chave"
        string chave "slug estavel - ACESSO_TI"
        enum categoria "INTEGRACAO ou CHECKLIST"
        string titulo
        enum tipo_resposta "AUTOMATICO, BOOLEANO, TEXTO"
        enum status "status_item_encerramento"
        bool resposta_bool
        text resposta_texto
        json payload "resultado simulado"
    }

    eventos_offboarding {
        uuid id PK
        uuid solicitacao_id FK
        enum de_status
        enum para_status
        uuid autor_id "sem FK"
        text observacao
    }

    convites_offboarding {
        uuid id PK
        string token UK "segredo da URL - uso unico"
        uuid colaborador_id "sem FK"
        string colaborador_matricula
        string colaborador_nome
        datetime expira_em
        datetime usado_em
        datetime cancelado_em
        uuid solicitacao_id "criada ao usar - sem FK"
    }
```

---

### 10.8. Enums

| Enum (tipo no Postgres) | Valores |
|---|---|
| `papel_usuario` | ADMIN, RECRUTADOR, GESTOR, VISUALIZADOR |
| `status_vaga` | RASCUNHO, PUBLICADA, PAUSADA, ENCERRADA, CANCELADA, APROVADA |
| `status_candidatura` | EM_ANALISE, TRIAGEM_IA, APROVADO_TRIAGEM, ENTREVISTA_AGENDADA, ENTREVISTA_REALIZADA, APROVADO, REPROVADO, CONTRATADO, DESISTENTE |
| `tipo_score` | SIMILARIDADE_VETORIAL, RANKING_CV, ENTREVISTA, TOM_DE_VOZ, CONSOLIDADO |
| `canal_mensagem` | WHATSAPP, EMAIL, SMS |
| `direcao_mensagem` | ENTRADA, SAIDA |
| `status_mensagem` | PENDENTE, ENVIADO, ENTREGUE, LIDO, RESPONDIDO, FALHADO, CANCELADO |
| `status_entrevista` | AGENDADA, EM_ANDAMENTO, FINALIZADA, CANCELADA, NAO_COMPARECEU |
| `recomendacao_painel` | CONTRATAR, CONTRATAR_COM_RESSALVAS, NAO_CONTRATAR, INCONCLUSIVO |
| `origem_pergunta` | IA, HUMANO |
| `status_resposta` | ABORDADA, PARCIAL, NAO_ABORDADA |
| `origem_avaliacao` | HUMANO, IA_SUGERIDO |
| `tipo_notificacao` | HORARIO_CONFIRMADO, ANALISE_PRONTA, WHATSAPP_INSTAVEL |
| `status_admissao` | AGUARDANDO_ACEITE, PROPOSTA_ACEITA, COLETA_DOCUMENTOS, DOCUMENTOS_EM_ANALISE, EXAME_MEDICO, ASSINATURA_CONTRATO, ENVIO_ESOCIAL, INTEGRACAO, CONCLUIDA, CANCELADA |
| `tipo_documento_admissional` | RG, CPF, CTPS, TITULO_ELEITOR, PIS_NIS, COMPROVANTE_RESIDENCIA, COMPROVANTE_ESCOLARIDADE, CERTIDAO_NASCIMENTO_CASAMENTO, RESERVISTA, DADOS_BANCARIOS, FOTO_3X4, DEPENDENTES, OUTRO |
| `status_documento_admissional` | PENDENTE, ENVIADO, EM_ANALISE, APROVADO, REPROVADO |
| `resultado_exame_admissional` | PENDENTE, APTO, APTO_COM_RESTRICOES, INAPTO |
| `status_solicitacao_acesso` | PENDENTE, ENVIADA, FALHADA |
| `tipo_alteracao_contratual` | CARGO, SALARIO, CENTRO_CUSTO, UNIDADE, LIDER |
| `status_alteracao_contratual` | RASCUNHO, AGUARDANDO_APROVACAO_DHO, AGUARDANDO_ASSINATURAS, ASSINADO, AGENDADA, EXECUTADA, FALHA_EXECUCAO, CANCELADA |
| `papel_assinante` | GESTOR, DHO |
| `status_assinatura` | PENDENTE, ENVIADA, ASSINADA, RECUSADA |
| `origem_offboarding` | COLABORADOR, EMPREGADOR |
| `tipo_desligamento` | PEDIDO_COLABORADOR, SEM_JUSTA_CAUSA, TERMINO_EXPERIENCIA_DISTRATO, JUSTA_CAUSA |
| `forma_assinatura` | DIGITAL, FISICA |
| `status_offboarding` | RASCUNHO, AGUARDANDO_APROVACAO_GESTOR, AGUARDANDO_APROVACAO_DHO, AGUARDANDO_ASSINATURAS, ASSINADO, EM_ENCERRAMENTO, CONCLUIDO, RECUSADO, CANCELADO |
| `papel_assinante_offboarding` | COLABORADOR, REPRESENTANTE_EMPRESA |
| `categoria_item_encerramento` | INTEGRACAO, CHECKLIST |
| `status_item_encerramento` | PENDENTE, CONCLUIDO, NAO_APLICAVEL, FALHA |
| `tipo_resposta_item` | AUTOMATICO, BOOLEANO, TEXTO |

> `enquetes_horario.status` **não** é enum — é `String` com os valores
> `AGUARDANDO` / `RESPONDIDA` / `CANCELADA`.

---

## 11. Suporte

- Issues internas → board Asana "Triagem Gupy".
- Dúvidas de produto → DHO (data protection officer).
- Dúvidas técnicas → canal `#tech-triagem` no Slack.
