# Plano de Testes de Integração — Camada 1 (Gupy)

> Documento da disciplina de QA da Plataforma de Triagem.
> Aplica-se à Camada 1: ingestão de vagas, candidaturas e webhooks da Gupy.
> Toda execução roda contra **sandbox da Gupy** (ambiente isolado de produção).

---

## 1. Escopo

Estes testes complementam a suíte unitária Jest (em `apps/api/src/modules/gupy/__tests__`). A suíte unitária cobre lógica pura, mappers, validação Zod, HMAC, idempotência e fluxos do `GupyService` com mocks. **Aqui** validamos contratos reais com a Gupy e o caminho ponta-a-ponta da API → fila → banco → estado consolidado.

### O que está dentro do escopo

- Autenticação Bearer contra `GUPY_API_BASE_URL` do sandbox.
- Listagem paginada de vagas (`GET /companies/jobs`).
- Listagem de candidaturas por vaga (`GET /companies/jobs/{id}/applications`).
- Fetch detalhado de vaga e candidatura.
- Download de currículo (URL pré-assinada).
- Recepção do webhook completo: HMAC válido → persistência → enfileiramento → consumo do worker → upsert idempotente no Postgres.
- Comportamento sob rate-limit (429) e instabilidade (5xx).
- Idempotência (mesmo `event_id` recebido duas vezes).
- Caminhos de erro: payload inválido, HMAC inválido, vaga não encontrada.

### Fora de escopo (validado em outras camadas / fases)

- Extração e parse de currículo (Camada 2).
- Geração de embeddings e ranking (Camada 3).
- Envio de mensagens via Z-API/SendGrid (Camada 4).
- Bot do Meet, gravação e transcrição (Camada 5).

---

## 2. Pré-requisitos

### Credenciais (cofre de equipe — nunca versionar)

| Variável | Origem |
|---|---|
| `GUPY_API_BASE_URL` | URL do sandbox: `https://sandbox-api.gupy.io/...` (confirmar com o CSM da Gupy) |
| `GUPY_API_TOKEN` | Token Bearer emitido pelo time da Gupy para o tenant de sandbox |
| `GUPY_WEBHOOK_SECRET` | Segredo HMAC configurado no painel de webhooks do sandbox |

### Infra local

- Docker rodando (`infra/docker-compose.yml`) — Postgres + Redis + MinIO.
- Migrations aplicadas (`pnpm --filter @uniats/db migrate deploy`).
- `ngrok http 3000` ativo, com URL pública apontando para `/webhooks/gupy` configurada no painel de sandbox da Gupy.
- API em execução: `pnpm --filter @uniats/api dev`.

### Dados-semente no sandbox

Recomendamos manter no sandbox (criados via painel da Gupy ou via CSM):

- 3 vagas:
  - `VAGA-IT-PUBLICADA` (status `published`, com 5 customFields preenchidos)
  - `VAGA-RH-PAUSADA` (status `paused`)
  - `VAGA-FECHADA` (status `closed`)
- 5 candidatos sintéticos, com:
  - 2 candidaturas em `in_analysis`
  - 1 em `approved`
  - 1 em `rejected`
  - 1 com `resumeUrl` presente apontando para PDF de teste hospedado em CDN do sandbox

> Política: **não usar dados reais de candidatos**, mesmo em sandbox. Toda PII deve ser sintética.

---

## 3. Cenários

### CT-001 — Listagem de vagas (happy path)

| | |
|---|---|
| **Pré-condições** | Token válido, sandbox seedado. |
| **Passos** | `curl -H "Authorization: Bearer $TOKEN" $BASE/companies/jobs?perPage=50` ou `pnpm --filter @uniats/api exec ts-node scripts/probe-listar-vagas.ts`. |
| **Resultado esperado** | HTTP 200; payload bate com `VagaGupySchema`; ao menos 3 vagas retornadas; o cliente parseia sem erros. |
| **Critério de aceite** | Nenhum log de "Resposta da Gupy não passou no schema". |

### CT-002 — Paginação automática (`iterarVagas`)

| | |
|---|---|
| **Pré-condições** | Sandbox com `≥ 12` vagas. |
| **Passos** | `await client.iterarVagas({ perPage: 5 })` — iterar até fim. |
| **Resultado esperado** | ≥ 12 vagas yieldadas; última página retorna menos que `perPage`; sem loop infinito. |
| **Critério de aceite** | Total batido com `meta.total` quando presente. |

### CT-003 — Sincronização de UMA vaga

| | |
|---|---|
| **Passos** | `POST /api/gupy/sync/vaga/{GUPY_ID_VAGA_PUBLICADA}` autenticado. |
| **Resultado esperado** | 200/201 com `{ id: "<uuid>" }`; row em `vagas` com `gupy_id`, `requisitos_json`, `requisitos_texto`, `gupy_sincronizado_em` recentes. |
| **Critério de aceite** | Reexecutar o mesmo POST mantém o `id` local — idempotência confirmada via `SELECT id FROM vagas WHERE gupy_id = ?`. |

### CT-004 — Sincronização de TODAS as vagas (backfill)

| | |
|---|---|
| **Passos** | `POST /api/gupy/sync/vagas`. |
| **Resultado esperado** | Retorna `{ total: N }` onde N = nº de vagas em status `published` no sandbox; nenhuma vaga `closed/canceled` foi importada (filtragem do filtro `status=published`). |
| **Critério de aceite** | `SELECT count(*) FROM vagas WHERE status = 'PUBLICADA'` == N. |

### CT-005 — Sincronização de candidaturas + enfileiramento de CV

| | |
|---|---|
| **Pré-condições** | CT-003 executado para a vaga-alvo. |
| **Passos** | `POST /api/gupy/sync/vaga/{GUPY_ID}/candidaturas`. |
| **Resultado esperado** | `{ total: M }`; rows em `candidatos` e `candidaturas`; para cada candidatura com `resumeUrl`, existe job na fila `cv-download` com `jobId=cv-<candidatura_id>`. |
| **Critério de aceite** | `redis-cli LLEN bull:cv-download:wait` ≥ número de candidaturas com `resumeUrl`. Reexecução **não duplica** jobs (jobId único). |

### CT-006 — Webhook `application.created` ponta-a-ponta

| | |
|---|---|
| **Passos** | No painel do sandbox, mover candidato para etapa que dispare `application.created` *(ou via CLI helper `pnpm webhook:emitir application.created`, ver `scripts/emitir-webhook.ts`)*. |
| **Resultado esperado** | API responde 202; row em `webhooks_recebidos` com `assinatura_ok=true`, `external_id` preenchido; em ≤ 5s, `processado=true` e existe `candidatura` correspondente em `candidaturas`. |
| **Critério de aceite** | `tentativas = 0`, `ultimo_erro IS NULL`. |

### CT-007 — Webhook `job.updated`

| | |
|---|---|
| **Passos** | Editar vaga no painel de sandbox. |
| **Resultado esperado** | 202; row em `webhooks_recebidos`; campo `vagas.gupy_sincronizado_em` foi atualizado; `vagas.requisitos_json` reflete a edição. |

### CT-008 — HMAC inválido

| | |
|---|---|
| **Passos** | Enviar `POST /webhooks/gupy` via `curl` com body válido mas `X-Gupy-Signature: sha256=00...00`. |
| **Resultado esperado** | HTTP 401; **nenhuma** linha criada em `webhooks_recebidos`; log "Webhook Gupy rejeitado: HMAC inválido". |
| **Critério de aceite** | Resposta sem stack trace nem segredo. |

### CT-009 — Idempotência por `event_id`

| | |
|---|---|
| **Passos** | Reenviar exatamente o mesmo body + assinatura de CT-006 três vezes em sequência. |
| **Resultado esperado** | 1ª: 202 `{status:"accepted"}`; 2ª e 3ª: 202 `{status:"duplicate"}`. Apenas 1 row em `webhooks_recebidos`; apenas 1 job na fila `gupy-webhook`. |

### CT-010 — Body malformado

| | |
|---|---|
| **Passos** | Enviar body `{not json` com HMAC correto sobre esse body. |
| **Resultado esperado** | 400; nada persistido. |

### CT-011 — Evento desconhecido

| | |
|---|---|
| **Passos** | Enviar envelope com `event: "interview.scheduled"` (fora do enum). |
| **Resultado esperado** | 400 "Envelope inválido"; nada persistido. |

### CT-012 — Vaga não importada (race da Gupy)

| | |
|---|---|
| **Pré-condições** | `vagas` está vazia. |
| **Passos** | Enviar webhook `application.created` para vaga inexistente. |
| **Resultado esperado** | Worker lança `NotFoundException`; row do webhook fica `processado=false` com `tentativas++`; um job `sincronizar-vaga` é enfileirado; após a vaga ser sincronizada e o BullMQ re-tentar, o processamento completa. |
| **Critério de aceite** | Estado final converge para `webhooks_recebidos.processado=true` sem intervenção manual. |

### CT-013 — Rate-limit (429)

| | |
|---|---|
| **Passos** | Disparar 30 chamadas concorrentes a `GET /companies/jobs` com `GUPY_RATE_LIMIT_RPS=2`. |
| **Resultado esperado** | Cliente serializa as chamadas; nenhum 429 surge; latência cresce mas requests sucedem. Se a Gupy responder 429 mesmo assim, há retry respeitando `Retry-After`. |
| **Critério de aceite** | Logs mostram "Retry x/y" mas zero exceções no chamador. |

### CT-014 — Instabilidade da Gupy (5xx)

| | |
|---|---|
| **Passos** | Apontar `GUPY_API_BASE_URL` para um servidor stub local que devolve `503` duas vezes e depois `200`. *(usar `scripts/stub-gupy.ts`)* |
| **Resultado esperado** | A requisição final sucede; 2 tentativas de retry registradas no log. |

### CT-015 — Download de CV (URL pré-assinada)

| | |
|---|---|
| **Pré-condições** | Candidatura com `resumeUrl` válido. |
| **Passos** | Chamar diretamente `client.baixarCurriculo(url)` ou rodar worker `cv-download`. |
| **Resultado esperado** | Buffer recebido; `Content-Type` começa com `application/pdf` ou `application/...`; **header Authorization NÃO foi enviado** (verificar via servidor stub que registra requests). |

### CT-016 — Defesa SSRF (não-HTTPS)

| | |
|---|---|
| **Passos** | Construir uma candidatura sintética com `resumeUrl=http://internal.local/cv.pdf` e rodar. |
| **Resultado esperado** | `GupyApiError('URL de currículo inválida (não-HTTPS)')`; **nenhuma chamada HTTP** sai. |

### CT-017 — LGPD: payload da Gupy não é vazado em log

| | |
|---|---|
| **Passos** | Executar CT-005 com `LOG_LEVEL=debug`. Inspecionar logs estruturados. |
| **Resultado esperado** | Nenhum log contém `email`, `phone`, `cpf` em texto claro; campos sensíveis foram redacted pelo pino (`req.headers.authorization`, `payload.candidate.email`, etc., listados em `app.module.ts`). |
| **Critério de aceite** | `grep -E "@[a-z]+\.com" logs/*.log` retorna vazio. |

---

## 4. Fixtures e artefatos

Mantemos sob `apps/api/src/modules/gupy/__tests__/fixtures/` o JSON canônico de cada tipo (`vagaFakeJson`, `candidaturaFakeJson`, `webhookApplicationCreatedJson`, etc.). Em integração, replicamos a forma — IDs reais do sandbox são lidos via env vars:

```
SANDBOX_GUPY_VAGA_ID=...
SANDBOX_GUPY_CANDIDATURA_ID=...
```

Helpers úteis (a criar em `apps/api/scripts/`):

- `probe-listar-vagas.ts` — chama o cliente diretamente e imprime o resultado validado.
- `emitir-webhook.ts` — emite um POST assinado para localhost/ngrok, útil para reproduzir CT-006 offline.
- `stub-gupy.ts` — servidor Express minimal que responde 503 N vezes e depois 200, alimentado por fixtures.

---

## 5. Critérios globais de aceite (gate de release da Camada 1)

A Camada 1 só é considerada **pronta para integração com a Camada 2** quando todos os critérios abaixo são satisfeitos em **uma execução limpa do sandbox**:

| # | Critério |
|---|---|
| 1 | Todos os 17 cenários (CT-001 a CT-017) passam sem intervenção manual. |
| 2 | Reexecutar CT-003 a CT-006 mantém a contagem de rows nas tabelas `vagas`, `candidatos`, `candidaturas`, `webhooks_recebidos` (idempotência total). |
| 3 | `redis-cli LLEN bull:gupy-webhook:failed` == 0 ao fim da bateria. |
| 4 | Cobertura unitária ≥ 85% nas pastas `mappers/`, `gupy.service.ts`, `gupy-webhook.controller.ts`. |
| 5 | Auditoria de logs (CT-017) sem PII em claro. |
| 6 | `pnpm audit` da API sem vulnerabilidades `high`/`critical`. |

---

## 6. Operacional

### Como executar

```bash
# Unitários
pnpm --filter @uniats/api test
pnpm --filter @uniats/api test:cov

# Integração local (com docker-compose up)
pnpm --filter @uniats/api test:int

# Probes contra sandbox (manuais, exigem credenciais)
pnpm --filter @uniats/api exec ts-node scripts/probe-listar-vagas.ts
pnpm --filter @uniats/api exec ts-node scripts/emitir-webhook.ts application.created
```

### Limpeza após bateria

```sql
TRUNCATE TABLE webhooks_recebidos, candidaturas, candidatos, vagas RESTART IDENTITY CASCADE;
```

> Atenção: NUNCA executar este truncate em ambiente produtivo. O script de teste valida `NODE_ENV !== 'production'` e `DATABASE_URL` contém `localhost` antes de prosseguir.

### Frequência

- Unitários: a cada push (CI obrigatório).
- Integração contra sandbox: a cada PR em `apps/api/src/modules/gupy/**`, e como smoke diário pré-prod.
