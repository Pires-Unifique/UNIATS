# Runbook — zerar a base na virada UNIATS → Collab

Zerar a base de homologação é o que torna possível renomear **banco, usuário,
bucket, prefixo de fila e volumes** para `collab`. Em sistema vivo essas trocas
destroem ou abandonam dado; com a base zerada, tudo nasce com o nome certo.

Este runbook é para o servidor **TIO-TI-UNIATS-HML**. A seção 6 cobre a máquina
de desenvolvimento, que também precisa ser zerada (usa bind mount).

> **Ordem importa.** Os passos da seção 1 são irreversíveis se você pular: depois
> do wipe, não existe mais no mundo a informação necessária para executá-los.

```bash
# Atalho usado no resto do documento (rode na raiz do checkout do repo):
COMPOSE="docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml"
PSQL="$COMPOSE exec -T postgres psql -U uniats -d uniats"   # usuário ANTIGO, antes do wipe
```

---

## 1. ANTES de zerar — uma conferência de 30 segundos

**Contexto (2026-07-31):** o sistema não está em uso por ninguém — só testes do
próprio Guilherme, e ele confirmou que não há holds pendentes na agenda. Por isso
esta seção é **verificação**, não procedimento. Rode as três queries de uma vez;
se vierem todas vazias, siga direto para a seção 2.

```sql
-- (a) Holds de pré-reserva ainda presos em alguma agenda
SELECT status, count(*) FROM enquetes_horario WHERE holds IS NOT NULL GROUP BY status;

-- (b) Enquete de WhatsApp aguardando voto
SELECT count(*) FROM enquetes_horario WHERE status = 'AGUARDANDO';

-- (c) Chaves de API ativas
SELECT nome, prefixo, criado_em FROM chaves_api WHERE revogada_em IS NULL;
```

### Se (a) voltar com linhas

Os holds são eventos reais na agenda. A
[limpeza automática](../apps/api/src/modules/interview/services/pre-reserva-cleanup.service.ts)
acha esses eventos pela coluna `holds` (JSON com `eventId`), e **zerado o banco
nada mais sabe quais eventos do Outlook são holds** — ficam presos para sempre.
Via prática: no Outlook, filtrar pela categoria `Pré-reserva UniATS` (eventos
antigos mantêm a categoria antiga — o rebrand só afeta os novos) e apagar em lote.
Para saber em quais caixas procurar:

```sql
SELECT DISTINCT jsonb_array_elements(holds::jsonb) ->> 'participante' AS caixa
FROM enquetes_horario WHERE holds IS NOT NULL;
```

### Se (b) voltar com linhas

O voto casa por `provider_msg_id`. Depois do wipe, quem votar numa enquete já
enviada cai no log `Voto de enquete sem enquete correspondente` e **o voto é
descartado em silêncio** — para o candidato, ele respondeu e nada aconteceu.
Reenvie a enquete depois do wipe.

### Se (c) voltar com linhas

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

Depois que a stack subir:

```bash
# 4.1 Schema do zero (as 26 migrations, em ordem)
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api \
  pnpm --filter @collab/db exec prisma migrate deploy

# 4.2 Baseline: admin + templates de mensagem
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api pnpm --filter @collab/db run seed

# 4.3 Baseline DHO: unidades, centros de custo, cargos, procuradores
$COMPOSE run --rm --no-deps -e NODE_OPTIONS= api pnpm --filter @collab/db run seed:dho
```

O bucket `collab` **não** precisa ser criado à mão — o `StorageService` faz
`HeadBucket` e cria se não existir.

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

### Os três riscos reais

1. **`/etc/hosts` — a que morde todo mundo.** Trocar `/etc/hostname` sem atualizar
   `/etc/hosts` faz **todo `sudo` travar 10–30 s** com `sudo: unable to resolve
   host`, porque a resolução reversa do nome novo falha. Troque os dois juntos.

2. **Zabbix (porta 10050 liberada no firewall).** O agente se identifica ao
   servidor pelo `Hostname=` do `zabbix_agentd.conf`. Se estiver com
   `HostnameItem=system.hostname` (automático), o nome muda, **o servidor Zabbix
   deixa de casar o host e o monitoramento morre em silêncio**. Se estiver
   hardcoded, continua funcionando com o nome velho. Confira antes:
   `grep -E '^\s*(Hostname|HostnameItem)' /etc/zabbix/zabbix_agent*.conf`.
   Monitoramento é da infra — alinhe com eles.

3. **Se a máquina for joined ao domínio AD** (o padrão do nome sugere isso):
   renomear host com SSSD/realmd invalida a conta de máquina e exige sair e
   re-joinar. Verifique com `realm list` e `systemctl status sssd` — se ambos
   vierem vazios/inexistentes, não há esse risco.

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

## 8. Rollback

Depois do passo 3.4 **não há rollback dos dados** — os volumes foram removidos.
O que se desfaz é o código: `git revert` dos commits do rebrand devolve os nomes
antigos, mas aí a stack sobe procurando `uniats_pgdata`, que não existe mais, e
o Postgres nasce vazio de novo. Ou seja: reverter o código não traz a base de
volta, só troca o nome da base vazia.

Antes do 3.4, o rollback é trivial: subir a stack antiga com `-p uniats`.
