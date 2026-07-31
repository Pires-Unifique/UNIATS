# Runbook — zerar a base na virada UNIATS → Collab

Zerar a base de homologação é o que torna possível renomear **banco, usuário,
bucket, prefixo de fila e volumes** para `collab`. Em sistema vivo essas trocas
destroem ou abandonam dado; com a base zerada, tudo nasce com o nome certo.

Este runbook é para o servidor **TIO-TI-UNIATS-HML**. A seção 6 cobre a máquina
de desenvolvimento, que também precisa ser zerada (usa bind mount).

> **Ordem importa.** Os passos da seção 1 são irreversíveis se você pular: depois
> do wipe, não existe mais no mundo a informação necessária para executá-los.

### Pré-requisito de acesso (levantado em 2026-07-31)

O checkout fica em **`/opt/actions-runner/_work/UNIATS/UNIATS`** — é a árvore do
runner, dona do usuário do runner (grupo `suporte-n2`). Duas consequências práticas:

- **`git` não está instalado no host.** Não conte com comandos git no servidor.
- **Sua conta pessoal não lê esse diretório.** Todo comando que usa o arquivo do
  compose (`down`, `up`, `run`) precisa de `sudo` ou de rodar como o usuário do
  runner. Resolva isso **antes** de começar, ou você trava no meio.

Os comandos que usam apenas `docker` (`docker rm`, `docker volume rm`,
`docker exec`, `docker inspect`) **não** dependem do repo e funcionam com sua conta,
desde que ela esteja no grupo `docker`.

```bash
# Atalho usado no resto do documento (rode na raiz do checkout do repo):
cd /opt/actions-runner/_work/UNIATS/UNIATS
COMPOSE="docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml"
PSQL="docker exec -i uniats-postgres-1 psql -U uniats -d uniats"   # usuário ANTIGO, antes do wipe
```

> O `PSQL` acima usa `docker exec` direto (não o compose) justamente para não
> depender de ler o repo nas conferências da seção 1.

---

## 1. ANTES de zerar — liberar os holds da agenda (obrigatório)

Conferência (rode as três de uma vez):

```sql
SELECT 'holds presos' AS check, count(*) FROM enquetes_horario WHERE holds IS NOT NULL
UNION ALL SELECT 'enquete aguardando voto', count(*) FROM enquetes_horario WHERE status='AGUARDANDO'
UNION ALL SELECT 'chaves de API ativas', count(*) FROM chaves_api WHERE revogado_em IS NULL;
```

> A coluna é `revogado_em` (masculino), não `revogada_em`.

**Medido em 2026-07-31 no servidor:** `holds presos = 7`, distribuídos entre
**duas caixas** — `guilherme.viana@` e `silvio.rizzo@`. Enquetes aguardando voto: 0.
Chaves de API ativas: 0. Ou seja: **este passo é obrigatório**, e um dos holds está
na agenda de outra pessoa. A impressão inicial de que não havia holds pendentes
não se sustentou nos dados.

### Como liberar (sem precisar de acesso à agenda de ninguém)

Não apague no Outlook: você não tem a caixa do colega. Use o caminho que já existe
e é testado — a [limpeza automática](../apps/api/src/modules/interview/services/pre-reserva-cleanup.service.ts)
roda de 30 em 30 min e remove hold de **qualquer** caixa, porque o Graph é app-only.
Ela só considera enquetes `CANCELADA` ou `AGUARDANDO` vencidas (>3 dias). Então
basta marcá-las como canceladas e deixar o cron trabalhar:

```sql
-- Torna os 7 holds elegíveis à limpeza automática na próxima rodada
UPDATE enquetes_horario SET status = 'CANCELADA' WHERE holds IS NOT NULL;
```

Escrever no banco aqui é inofensivo — ele vai ser zerado em seguida. Espere a
próxima rodada do cron (≤30 min) e confirme que chegou a zero:

```sql
SELECT count(*) FROM enquetes_horario WHERE holds IS NOT NULL;   -- tem de ser 0
```

No log da API, procure `Pré-reserva cleanup: N hold(s) removidos`. **Só siga para
o wipe depois que essa contagem for 0** — depois de zerar o banco, nada mais no
mundo sabe quais eventos do Outlook são holds, e eles ficam presos para sempre.

> Se o Graph estiver desabilitado (`graph.enabled === false`), o cron não roda e
> este caminho não funciona. Aí a alternativa é o Outlook: filtrar pela categoria
> `Pré-reserva UniATS` (eventos antigos mantêm a categoria antiga — o rebrand só
> afeta os novos) e apagar em lote, o que exige acesso às duas caixas.

### Se a segunda contagem voltar diferente de zero

O voto casa por `provider_msg_id`. Depois do wipe, quem votar numa enquete já
enviada cai no log `Voto de enquete sem enquete correspondente` e **o voto é
descartado em silêncio** — para o candidato, ele respondeu e nada aconteceu.
Reenvie a enquete depois do wipe.

### Se a terceira voltar diferente de zero

Só o `sha256` vai ao banco: as chaves **não** são recuperáveis, apenas reemitidas.
Anote os nomes para reemitir e avisar quem consome.

### O que NÃO precisa de ação

- **Vagas, candidatos, candidaturas, embeddings** — voltam pelo sync da Gupy (passo 5).
- **Admin** — volta no primeiro login pela allowlist `AUTH_ADMIN_EMAILS`.
- **Transcrições e análises** — perda aceita (eram gravações de teste).
- **Schema** — as migrations aplicam do zero; `UPDATE` em tabela vazia é no-op. As
  extensões (`vector`, `pg_trgm`, `uuid-ossp`) vêm de `infra/postgres-init/`, que
  roda automaticamente **porque o volume nasce vazio**.

---

## 2. Atualizar o secret `ENV_PRODUCTION` — antes do deploy

É lá que mora a config real, não no arquivo local. Precisa mudar junto:

| Variável | Valor novo |
|---|---|
| `DATABASE_URL` | `postgresql://collab:<senha>@postgres:5432/collab?schema=public&connection_limit=20` |
| `REDIS_QUEUE_PREFIX` | `collab` |
| `STORAGE_BUCKET` | `collab` |
| `STORAGE_ACCESS_KEY` | `collab` (é o `MINIO_ROOT_USER`) |
| `FRONTEND_ORIGIN` | `https://collab.unifique.com.br` |
| `PUBLIC_BASE_URL` | `https://api-collab.unifique.com.br` |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api-collab.unifique.com.br` |
| `APP_NAME` | `collab-api` |

Cuidados:

- `POSTGRES_PASSWORD` tem de bater com a senha dentro de `DATABASE_URL`. O
  Postgres novo é inicializado com esse par — se divergirem, a API não conecta.
- `NEXT_PUBLIC_API_BASE_URL` é **build arg**: se o secret não mudar, o bundle sai
  apontando para o host antigo mesmo com o DNS certo.
- `AZURE_AD_AUDIENCE` **continua** `api://uniats-api`. Não mexa.

---

## 3. O wipe

> ⚠️ **A pegadinha:** o compose novo declara `name: collab`. Se você já tiver
> feito o deploy do código novo, `docker compose down` procura containers
> `collab-*` e **não acha a stack antiga** `uniats-*`, que fica rodando. Por isso
> derrube a stack antiga **explicitando o projeto antigo** com `-p uniats`.

```bash
# 3.1 Derruba a stack ANTIGA (o -p uniats sobrevive ao rename no arquivo)
docker compose -p uniats --env-file infra/.env.production \
  -f infra/docker-compose.prod.yml down

# 3.2 Confirma que nada de uniats sobrou de pé
docker ps -a --filter name=uniats

# 3.3 (recomendado) Preserva o pareamento do WhatsApp copiando o volume da
#     sessão para o nome novo — evita reescanear o QR com o celular.
docker volume create collab_wahasessions
docker run --rm \
  -v uniats_wahasessions:/from -v collab_wahasessions:/to \
  alpine sh -c 'cd /from && cp -a . /to/'

# 3.4 Remove os volumes de DADO. Banco e bucket JUNTOS: se o banco morrer e o
#     bucket ficar, todo áudio/transcrição vira objeto que a retenção LGPD nunca
#     mais alcança (ela varre `entrevistas`/`transcricoes` no banco).
docker volume rm uniats_pgdata uniats_miniodata uniats_redisdata

# 3.5 Opcional: o cache do modelo Whisper. Remover só faz ele rebaixar 1x.
#     Para preservar, copie como em 3.3 para collab_whispercache.
# docker volume rm uniats_whispercache

# 3.6 Só depois de conferir que a app subiu (passo 5), remova o resto:
# docker volume rm uniats_wahasessions
```

---

## 4. Deploy do código novo

O caminho normal é o CD: merge da branch `feat/rebrand-collab-tecnico` na `main`.
**Não faça o merge antes de** o DNS de `collab`/`api-collab` resolver no proxy
corporativo, a redirect URI nova existir no Entra e o secret estar atualizado
(seção 2) — o corte é seco, a URL antiga deixa de atender.

**As migrations rodam sozinhas.** O job `deploy` do `.github/workflows/cicd.yml` já
executa `prisma migrate deploy` a cada deploy da `main`, então o schema é criado do
zero automaticamente — validado localmente em 31/07: as 26 migrations aplicaram numa
base vazia sem erro (`All migrations have been successfully applied`), incluindo as
que estavam pendentes. O comando 4.1 abaixo é só para o caso de você subir a stack à
mão, sem passar pelo CD.

```bash
# 4.1 Schema do zero — SÓ se você não usou o CD (que já faz isso)
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api \
  pnpm --filter @collab/db exec prisma migrate deploy

# 4.2 Baseline: admin + templates de mensagem
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api pnpm --filter @collab/db run seed

# 4.3 Baseline DHO: unidades, centros de custo, cargos, procuradores
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api pnpm --filter @collab/db run seed:dho
```

### 4.4 Criar o bucket À MÃO (em produção não nasce sozinho)

⚠️ O `StorageService` cria o bucket no boot, mas o `onModuleInit`
[**aborta quando `NODE_ENV === 'production'`**](../apps/api/src/modules/storage/storage.service.ts#L83) —
de propósito, para o boot não depender do storage. Em dev o bucket aparece sozinho;
**no servidor, não**. Sem ele, todo upload (áudio, transcrição, currículo) falha.

O `mc` já vem na imagem do MinIO, então é um comando só (idempotente):

```bash
# Use os MESMOS valores de STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY do .env.production
$COMPOSE exec -T minio mc alias set local http://localhost:9000 "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"
$COMPOSE exec -T minio mc mb --ignore-existing local/collab
$COMPOSE exec -T minio mc ls local          # deve listar collab/
```

---

## 5. Repopular e conferir

### 5.1 Atenção ao teto do sync

`GUPY_SYNC_CRON_TETO_CVS=50` a cada 6h ≈ 200 currículos/dia. Com a base vazia
**tudo** é novo, então o teto vira gargalo e a repopulação se arrasta por dias.
Para a carga inicial, suba o teto temporariamente no `ENV_PRODUCTION` (ex.: 500)
e devolva ao valor normal depois — o teto existe para não reprocessar currículo
pago em massa, e essa proteção volta a importar no regime normal.

### 5.2 Conferências

```bash
# API viva
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13001/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:13000/login    # 200

# Volumes agora com o nome certo
docker volume ls | grep -E 'collab_|uniats_'

# Containers com o nome novo
docker ps --format '{{.Names}}' | grep collab

# Fila no prefixo novo (deve listar chaves collab:*)
$COMPOSE exec -T redis redis-cli --scan --pattern 'collab:*' | head

# Banco novo, com as extensões
$COMPOSE exec -T postgres psql -U collab -d collab -c '\dx'
```

Depois: entrar pelo `https://collab.unifique.com.br`, confirmar que o SSO passa
(se der `AADSTS50011`, a redirect URI não foi cadastrada) e que a sessão do
WhatsApp está `WORKING` no dashboard do WAHA (túnel SSH em `localhost:4000`).

---

## 6. Máquina de desenvolvimento

O compose de dev usa **bind mount** (`infra/postgres-data`, `infra/redis-data`,
`infra/storage`, `infra/waha-sessions`), e o Postgres só roda `initdb` em
diretório vazio — trocar `POSTGRES_USER` sem zerar deixa o cluster com o papel
antigo e a API não conecta.

```bash
docker compose -f infra/docker-compose.yml down
rm -rf infra/postgres-data infra/redis-data infra/storage
docker compose -f infra/docker-compose.yml up -d
# Atualize o .env local: DATABASE_URL (collab:collab@.../collab),
# REDIS_QUEUE_PREFIX, STORAGE_BUCKET e STORAGE_ACCESS_KEY = collab
pnpm --filter @collab/db exec prisma migrate deploy
pnpm --filter @collab/db run seed
```

> Segue valendo a pegadinha dos **dois `DATABASE_URL`**: `packages/db/.env` aponta
> para um banco próprio e é ele que o Prisma CLI lê. Ver a skill `rodar-local`.

---

## 7. Apêndice — renomear o hostname do servidor (`TIO-TI-UNIATS-HML`)

**Opcional e independente do wipe.** Nada na aplicação depende do hostname:

- O código **nunca** lê `os.hostname()` — conferido em `apps/`, `packages/` e `services/`.
- Os containers se falam pelo DNS interno do compose (`postgres`, `redis`, `minio`,
  `api`), não pelo nome do host.
- O `server_name` do nginx e o CN/SAN do certificado usam o FQDN público
  (`collab.unifique.com.br`), não o hostname da máquina.
- O proxy corporativo aponta para o **IP** `10.252.5.37`, e o script de firewall
  também trabalha com IP. SSH por IP, idem.
- O runner do GitHub Actions **não** quebra: o nome dele foi fixado no arquivo
  `.runner` no momento do registro e não é re-derivado do hostname. Ele só continua
  aparecendo com o nome antigo na UI. Quem deriva de `$(hostname)` é apenas o
  `--name` em `infra/setup-server.sh`, que só roda ao (re)registrar o runner.

### Os três riscos, medidos no servidor em 2026-07-31

1. ⚠️ **`/etc/hosts` — confirmado como risco real.** O hostname
   `TIO-TI-UNIATS-HML` **não** está no `/etc/hosts`; a resolução do próprio nome
   depende inteiramente de DNS. Hoje funciona porque o DNS resolve o nome atual —
   mas o nome NOVO não estará no DNS no instante do rename, e aí **todo `sudo`
   trava 10–30 s** com `sudo: unable to resolve host`. Mitigação obrigatória:
   adicionar a linha no `/etc/hosts` **junto** com a troca do hostname.

2. ✅ **Zabbix — não quebra.** O agente está com
   `Hostname=TIO-TI-UNIATS-HML` **hardcoded** em `/etc/zabbix/zabbix_agent2.conf`
   (linha 10), sem `HostnameItem=system.hostname` e sem override em
   `zabbix_agent2.d/`. Logo, ele continua reportando o nome antigo e o servidor
   Zabbix continua casando o host — o monitoramento **não** morre. Fica só
   desalinhado: para alinhar, é editar essa linha e reiniciar o `zabbix-agent2`,
   o que é da infra e pode ser feito depois, sem pressa.

3. ✅ **AD — não há join.** `realm list` vazio, sem keytab e `sssd` inativo. Risco
   eliminado.

**Conclusão:** o único cuidado técnico do rename é o `/etc/hosts`. Isso torna o
rename bem menos arriscado do que eu supunha — mas também não urgente.

### Como fazer, se for fazer

```bash
NOVO=TIO-TI-COLLAB-HML
sudo hostnamectl set-hostname "$NOVO"
sudo sed -i "s/TIO-TI-UNIATS-HML/$NOVO/g" /etc/hosts   # confira o arquivo antes
hostname; hostnamectl status
sudo -n true && echo "sudo ok (sem travar)"            # valida o risco 1
```

> **Recomendação:** um servidor novo será provisionado antes da implantação total,
> e ele nasce com o nome certo de graça. O ganho aqui é só cosmético e o risco vive
> todo em território da infra (Zabbix, possivelmente AD). Renomear agora é opcional
> — se for adiar, não há nenhuma pendência técnica gerada por isso.

## 8. O que pode quebrar o CI/CD

### ⚠️ 8.1 Conflito de porta — o mais provável

O job de deploy roda `docker compose up -d`. Como o projeto agora se chama
`collab`, o compose cria uma stack **nova** em vez de recriar a existente. Se a
stack `uniats-*` ainda estiver de pé, ela segura `127.0.0.1:13000` e `:13001`, e os
containers novos morrem com *port is already allocated* → **o job de deploy falha**.

Por isso a ordem do passo 3.1 (derrubar com `-p uniats`) é **antes do merge**, não
depois. Há um intervalo de app fora do ar entre derrubar e o CD subir — aceitável
em homologação.

### ⚠️ 8.2 Secret desatualizado derruba o `migrate deploy`

O job de deploy roda as migrations lendo `DATABASE_URL` do `.env.production`, que é
escrito a partir do secret `ENV_PRODUCTION`. Se o secret ainda apontar usuário/banco
`uniats` enquanto o Postgres novo nasce como `collab`, o passo de migration falha e
**derruba o deploy inteiro**. Atualize o secret (seção 2) antes do merge.

### ✅ 8.3 `--frozen-lockfile` — validado

O maior risco do rename de pacotes era o `pnpm install --frozen-lockfile` dos
Dockerfiles recusar o `pnpm-lock.yaml` regerado. **Testado em 31/07 rodando
localmente os mesmos dois comandos do CI**, e ambos passaram:

```bash
docker build -f Dockerfile.api --target test -t collab-api-test:local .   # 38 suites / 392 testes OK
docker build -f Dockerfile.web --target test -t collab-web-test:local .   # typecheck OK
```

### ✅ 8.4 O que não quebra

- **Label do runner**: ficou `uniats-prod` de propósito — o job continua achando executor.
- **Imagens de teste**: viraram `collab-*-test`, e o prune do CI passou a casar
  `(collab|uniats)-*-test`, então as antigas continuam sendo varridas.

### 8.5 Disco (histórico de ENOSPC nesta máquina)

`uniats-api:latest` e `uniats-web:latest` **mantêm as tags**, e `docker image prune -f`
só remove imagem *dangling* — então elas ficam ocupando ~1–2 GB indefinidamente, além
dos ~7 GB de build cache medidos em 31/07. Depois que a stack nova estiver de pé e
validada:

```bash
docker rmi uniats-api:latest uniats-web:latest uniats-playwright-bot:latest
docker builder prune -af --keep-storage=12g
```

## 9. Rollback

Depois do passo 3.4 **não há rollback dos dados** — os volumes foram removidos.
O que se desfaz é o código: `git revert` dos commits do rebrand devolve os nomes
antigos, mas aí a stack sobe procurando `uniats_pgdata`, que não existe mais, e
o Postgres nasce vazio de novo. Ou seja: reverter o código não traz a base de
volta, só troca o nome da base vazia.

Antes do 3.4, o rollback é trivial: subir a stack antiga com `-p uniats`.
