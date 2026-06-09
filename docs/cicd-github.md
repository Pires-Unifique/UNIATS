# CI/CD — GitHub Actions + runner self-hosted (Oracle Linux 10)

A **mesma máquina** roda o pipeline e hospeda a aplicação. O runner do GitHub
Actions executa os passos direto no host, onde também vive o nginx (TLS + proxy
reverso, ver [infra/nginx/README.md](../infra/nginx/README.md)).

```
GitHub (push)
      │  job dispatch
      ▼
actions-runner (self-hosted, labels: self-hosted, uniats-prod)
      │  docker build / compose up
      ▼
stack local ── api :13001 (127.0.0.1) ── web :13000 (127.0.0.1) ── postgres / redis / minio
                                                       ▲
                                    nginx (host, :443) ┘  TLS + proxy
```

Workflow ([.github/workflows/cicd.yml](../.github/workflows/cicd.yml)):
`test` (lint+typecheck+unit no build Docker) → `build` (imagens api/web) →
`deploy` (migra Prisma + `compose up`, **só na `main`**).

---

## 1. Docker + plugin compose

Oracle Linux 10 é RHEL-compatível (use o repo `centos` do Docker, que cobre `el10`):

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker compose version
```

> Se o repo ainda não publicou pacotes `el10`, troque `$releasever` por `9` na URL do
> repo (`.../centos/9/...`) — os binários de el9 funcionam em OL10. Alternativa:
> `sudo dnf install podman-docker` + `podman-compose`.

## 2. Instalar o GitHub Actions runner

> **Não rode o runner como root.** Crie (ou use) um usuário dedicado e o adicione ao
> grupo `docker` para que ele fale com o daemon:

```bash
sudo useradd -m -s /bin/bash ghrunner
sudo usermod -aG docker ghrunner
sudo -iu ghrunner          # entra como o usuário do runner
```

No GitHub: **repositório → Settings → Actions → Runners → New self-hosted runner →
Linux / x64**. A página mostra os comandos exatos com a versão e o **token** atuais.
Eles seguem este formato (use os da página, que trazem o hash de verificação):

```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner.tar.gz -L https://github.com/actions/runner/releases/download/v2.XXX.X/actions-runner-linux-x64-2.XXX.X.tar.gz
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/ORG/REPO --token SEU_TOKEN --labels uniats-prod --unattended
```

> A label `uniats-prod` é o que o workflow usa em `runs-on: [self-hosted, uniats-prod]`.

## 3. Rodar o runner como serviço (systemd)

Ainda como `ghrunner`, dentro de `actions-runner`:

```bash
sudo ./svc.sh install ghrunner   # instala o serviço rodando como ghrunner
sudo ./svc.sh start
sudo ./svc.sh status
```

Valide em **Settings → Actions → Runners** (deve aparecer **Idle**) e que o Docker
funciona sem sudo: `sudo -u ghrunner docker ps`.

## 4. Configurar o segredo de produção

Em vez de deixar o `.env` no servidor, o workflow o gera a partir de um **secret**.
Cadastre em **Settings → Secrets and variables → Actions → New repository secret**:

- **Nome:** `ENV_PRODUCTION`
- **Valor:** o conteúdo inteiro do seu `.env.production` (baseado em
  [infra/.env.production.example](../infra/.env.production.example))

Para gerar os segredos internos:

```bash
openssl rand -base64 48   # JWT_SECRET / SESSION_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY
```

> Lembre que `DATABASE_URL`, `REDIS_URL` e `STORAGE_ENDPOINT` usam os **nomes dos
> serviços** do compose (`postgres`, `redis`, `minio`), não `localhost`. E
> `POSTGRES_PASSWORD` precisa casar com a senha embutida na `DATABASE_URL`.

## 5. nginx (TLS + proxy) no host

Já documentado em [infra/nginx/README.md](../infra/nginx/README.md). Em OL10 o nginx
usa `conf.d` (não `sites-available`):

```bash
sudo dnf -y install nginx
sudo cp infra/nginx/uniats.conf /etc/nginx/conf.d/uniats.conf
sudo nginx -t && sudo systemctl enable --now nginx
# SELinux: permite o nginx conectar nas portas locais da app
sudo setsebool -P httpd_can_network_connect 1
# firewall:
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

Certificado TLS: opções A/B/C no README do nginx.

## 6. Primeiro deploy

Valide manualmente uma vez (como `ghrunner`, com um `.env.production` local):

```bash
cp infra/.env.production.example infra/.env.production   # preencha os segredos
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml up -d --build
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml \
  run --rm --no-deps api pnpm --filter @uniats/db exec prisma migrate deploy
curl -s http://127.0.0.1:13001/health   # {"status":"ok",...}
curl -sI http://127.0.0.1:13000          # 200/307
```

Depois disso, todo push roda `test` + `build`; push na **`main`** roda também o
`deploy` automaticamente (gerando o `.env.production` a partir do secret).

## Operação do dia a dia

```bash
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs -f api
docker compose -f infra/docker-compose.prod.yml restart web
```
