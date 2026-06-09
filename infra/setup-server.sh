#!/usr/bin/env bash
# =====================================================================
# Provisionamento do servidor — UNIATS (Oracle Linux 10, x86_64)
# ---------------------------------------------------------------------
# Instala Docker + compose, cria o usuário do runner, instala nginx +
# firewall/SELinux e registra o GitHub Actions self-hosted runner como
# serviço systemd (label: uniats-prod).
#
# USO:
#   sudo RUNNER_TOKEN=xxxxx bash infra/setup-server.sh
#   (ou:  sudo bash infra/setup-server.sh <RUNNER_TOKEN>)
#
# O RUNNER_TOKEN vem de:
#   https://github.com/Pires-Unifique/UNIATS/settings/actions/runners/new
#   (válido por ~1h; é descartável, pode regenerar)
#
# NÃO faz: TLS/certificado e o `cp` do nginx (precisa do código no servidor).
# Esses ficam pra depois do primeiro checkout (ver docs/cicd-github.md).
# =====================================================================
set -euo pipefail

REPO_URL="https://github.com/Pires-Unifique/UNIATS"
RUNNER_LABELS="uniats-prod"
RUNNER_USER="ghrunner"
RUNNER_TOKEN="${RUNNER_TOKEN:-${1:-}}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------
log "1/5 Docker CE + plugin compose"
dnf -y install dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
if ! dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
  echo "Pacotes el10 indisponíveis — forçando repo el9 (compatível com OL10)."
  sed -i 's#/centos/\$releasever/#/centos/9/#g' /etc/yum.repos.d/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker compose version

# ---------------------------------------------------------------------
log "2/5 Usuário do runner (${RUNNER_USER}) + acesso ao Docker"
id "$RUNNER_USER" &>/dev/null || useradd -m -s /bin/bash "$RUNNER_USER"
usermod -aG docker "$RUNNER_USER"

# ---------------------------------------------------------------------
log "3/5 nginx + firewall + SELinux"
dnf -y install nginx
systemctl enable --now nginx
# Permite o nginx conectar nas portas locais da app (proxy reverso)
setsebool -P httpd_can_network_connect 1 || true
# Abre HTTP/HTTPS no firewall (se o firewalld estiver ativo)
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --reload
fi

# ---------------------------------------------------------------------
log "4/5 Baixando o GitHub Actions runner"
if [ -z "$RUNNER_TOKEN" ]; then
  echo "ERRO: RUNNER_TOKEN não informado."
  echo "Pegue em: ${REPO_URL}/settings/actions/runners/new  e rode de novo:"
  echo "  sudo RUNNER_TOKEN=xxxxx bash infra/setup-server.sh"
  exit 1
fi
RUNNER_DIR="/home/${RUNNER_USER}/actions-runner"
RUNNER_VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest \
  | grep -oP '"tag_name":\s*"v\K[^"]+')"
echo "Versão do runner: ${RUNNER_VERSION}"
sudo -u "$RUNNER_USER" bash -s -- "$RUNNER_VERSION" <<'INNER'
set -euo pipefail
VER="$1"
cd "$HOME"
mkdir -p actions-runner && cd actions-runner
curl -fsSL -o runner.tar.gz \
  "https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-x64-${VER}.tar.gz"
tar xzf runner.tar.gz && rm -f runner.tar.gz
INNER

# ---------------------------------------------------------------------
log "5/5 Registrando e iniciando o runner como serviço"
sudo -u "$RUNNER_USER" bash -s -- "$REPO_URL" "$RUNNER_TOKEN" "$RUNNER_LABELS" <<'INNER'
set -euo pipefail
cd "$HOME/actions-runner"
./config.sh --url "$1" --token "$2" --labels "$3" \
  --name "uniats-prod-$(hostname)" --unattended --replace
INNER
cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER"
./svc.sh start
./svc.sh status || true

log "OK — runner instalado. Confira em ${REPO_URL}/settings/actions/runners (deve aparecer 'Idle')."
echo "Próximos passos (após o código estar no servidor): copiar infra/nginx/uniats.conf e configurar TLS — ver docs/cicd-github.md."
