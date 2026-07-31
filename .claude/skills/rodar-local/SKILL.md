---
name: rodar-local
description: Levanta o Collab localmente (infra Docker + API + web) e dirige a aplicação no navegador para conferir uma alteração de verdade. Use quando pedirem para rodar, subir, abrir ou tirar screenshot do app, ou para validar uma mudança na tela em vez de só rodar testes.
---

# Rodar o Collab localmente

Portas: **web `13000`**, **API `13001`**. Login local: **`admin` / `admin`**.

Tudo aqui foi verificado em 29/07/2026 nesta máquina (Windows, PowerShell).

## 1. Infra (Docker)

Só postgres, redis, minio, waha e mailhog rodam em container. **API e web rodam no host**, não em Docker.

```powershell
docker ps --format '{{.Names}}\t{{.Status}}'
# Se faltar algo:
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml up -d postgres redis minio
```

O `docker-compose.override.yml` (não versionado) liga o KMS do MinIO para SSE-S3. Portas
não-óbvias: Redis em **16379**, MinIO em **19000** (console 19001), Postgres em 5432.

## 2. Subir API + web

```powershell
pnpm dev   # raiz do repo — turbo run dev --parallel
```

⚠️ **Um supervisor só para os dois.** `pnpm dev` é um turbo que roda `next dev -p 13000`
e `nest start --watch` como filhos. Matar o processo do web **derruba a API junto** — se
precisar reiniciar só um, mate o filho (`next dev`) e não o `pnpm`/turbo pai. Rode em
background e espere as duas portas responderem:

```powershell
foreach ($p in 13000,13001) { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue }
```

A API está em **watch mode**: editar `apps/api/src` recompila e reinicia sozinho (uns 10s).
Editar o `.env` da raiz também dispara restart — confira o boot no log, porque erro de
validação de env derruba a subida.

## 3. Migrations — a pegadinha dos dois `.env`

Existem **dois `DATABASE_URL` apontando para bancos diferentes**:

| Arquivo | Banco | Quem usa |
|---|---|---|
| `.env` (raiz) | `uniats` | a **API** |
| `packages/db/.env` | `triagem` | o **Prisma CLI** (migrate/seed/studio) |

Ou seja: `prisma migrate deploy` sem override migra o banco **errado** e o app continua
quebrado. Sintoma típico: a tela carrega mas algum endpoint devolve 500 com
`The table public.<X> does not exist in the current database` no log.

Para migrar o banco que a API usa:

```powershell
$linha = (Select-String -Path '.env' -Pattern '^DATABASE_URL=').Line
$env:DATABASE_URL = $linha.Substring($linha.IndexOf('=') + 1).Trim().Trim('"')
pnpm --filter @collab/db run prisma migrate status    # o que está pendente
pnpm --filter @collab/db run prisma migrate deploy    # aplica
```

Use `run prisma …` (script do pacote). `pnpm --filter … exec prisma` às vezes falha com
"Command prisma not found" mesmo tendo executado. **Nunca** `migrate reset` — apaga dados.

Seeds, se precisar de base nova: `seed`, `seed:fake`, `seed:dho` (todos em `@collab/db`).

## 4. Cache do Next corrompido (acontece)

**Sintoma:** página fica em "Carregando…" para sempre; no console do navegador,
`Refused to execute script … MIME type ('text/html')` e 404 em `/_next/static/chunks/*`.
O dev server está servindo a própria página 404 no lugar dos chunks.

**Cura:** parar o web, apagar o cache, subir de novo.

```powershell
Remove-Item -Recurse -Force 'apps\web\.next'
```

## 5. Dirigir o app no navegador

Não existe `playwright` instalado no workspace do web. O que funciona é o `playwright-core`
do bot + o Chrome do sistema (padrão que já existe em `brand-mockups/shot-*.cjs`):

```js
const { chromium } = require('<repo>/services/playwright-bot/node_modules/playwright-core');
const b = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});
```

**Login sem digitar nada** (o formulário é React controlado e `page.fill` não habilita o
botão de forma confiável — injete a sessão antes de navegar):

```js
await p.addInitScript(
  ([k, v]) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
  ['triagem.usuario_local', JSON.stringify({
    nome: 'Admin (local)',
    email: 'admin@unifique.com.br',
    oid: '00000000-0000-0000-0000-000000000001',
  })],
);
await p.goto('http://localhost:13000/inicio', { waitUntil: 'networkidle' });
await p.waitForSelector('aside nav a');
```

Isso vale porque `NEXT_PUBLIC_LOGIN_LOCAL=true` em `apps/web/.env.local` e
`AUTH_ENABLED` está ausente do `.env` (default `false`) — o AuthGuard injeta o admin de
dev em toda requisição, então `curl` na API também funciona sem token.

Escreva o script num diretório temporário, não no repo. **Sempre olhe o screenshot** —
tela em branco ou "Carregando…" é falha de subida, não sucesso.

## 6. Smoke test rápido

```powershell
Invoke-WebRequest 'http://localhost:13001/api/auth/me' -SkipHttpErrorCheck   # 200 = admin de dev
Invoke-WebRequest 'http://localhost:13001/api/dashboard' -SkipHttpErrorCheck # 200 = banco em dia
Invoke-WebRequest 'http://localhost:13000/login' -SkipHttpErrorCheck         # 200 = web de pé
```

`/health` fica **fora** do prefixo `/api` (é `GET /health`, não `/api/health`).
A lista completa de rotas mapeadas sai no log de boot da API — é a forma mais rápida de
confirmar que um endpoint existe (ou que foi removido).

## 7. Não dispare integrações reais sem querer

O ambiente local aponta para os **mesmos serviços externos que produção** (mesmo tenant da
Gupy, mesma chave do Voyage e do Anthropic). Por isso:

- `GUPY_SYNC_CRON_ENABLED=false` no `.env` local **de propósito** — ligar faz o cron varrer
  a base real da Gupy em paralelo com o cron de produção.
- Evite acionar "Sincronizar Gupy", re-ranking em massa ou reprocessamento de currículos
  para "testar": consome Claude e Voyage de verdade.
- `PLAYWRIGHT_BOT_ENABLED=false` e o WAHA local compartilha o número real do WhatsApp.

Avisos esperados no boot, que **não** são falha: `AUTH_ENABLED=false`,
`DATA_ENCRYPTION_KEY ausente`, `SENDGRID_WEBHOOK_PUBLIC_KEY ausente`,
`GUPY_WEBHOOK_SECRET ausente`, `API key does not start with "SG."`.
