#!/usr/bin/env bash
# Provisions the MatrAIx Playground backend on a fresh Ubuntu VM (written for
# Oracle Cloud's Always Free tier, but works on any Ubuntu 22.04/24.04 box
# with a public IP).
#
# What it does:
#   - opens 80/443 in the OS firewall (OCI Ubuntu images block everything but
#     22 by default, on top of the VCN Security List you configure separately)
#   - installs Python 3.12 + uv, Caddy (automatic HTTPS), and this repo
#   - installs the backend's Python deps (base + packages/playground,
#     packages/harbor-langsmith, packages/rewardkit — the app imports all three)
#   - runs the API as a systemd service (127.0.0.1:8765, single worker — the
#     job registry is in-memory, so it must stay one process)
#   - points Caddy at <public-ip>.nip.io with a Let's Encrypt certificate,
#     reverse-proxying to that service
#   - sets MATRIX_EXTRA_CORS_ORIGINS so the GitHub Pages-hosted frontend can
#     call this API cross-origin
#
# It deliberately does NOT set ANTHROPIC_API_KEY (or any provider key) on the
# server: each person testing the Playground supplies their own key from the
# browser's Settings panel (see docs/quickstart.md and
# ApiKeySettingsPopover.tsx) — it travels per-request as a header and is
# never stored here.
#
# Usage (as root or via sudo):
#   curl -fsSL https://raw.githubusercontent.com/wilkiyoshi/matriAIx_teste/<branch>/application/playground/deploy/oracle-vm-setup.sh | sudo bash
# or, from a checkout:
#   sudo REPO_BRANCH=claude/eloquent-ride-etuq97 bash oracle-vm-setup.sh
#
# Set IMPORT_PERSONA_1M=1 to also download the production Persona 1M coreset
# (~6.8GB from Hugging Face) so "Persona World" can sample from
# matraix-persona-1m instead of just the ~200-persona dev-sample fixture.
# Skipped by default since it's a large one-time download. Re-run later on an
# already-provisioned box with the same command plus that flag to add it.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/wilkiyoshi/matriAIx_teste.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/matriaix}"
CORS_ORIGIN="${CORS_ORIGIN:-https://wilkiyoshi.github.io}"
SERVICE_USER="${SERVICE_USER:-matraix}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo bash oracle-vm-setup.sh)." >&2
  exit 1
fi

PUBLIC_IP="$(curl -fsSL https://ifconfig.me || curl -fsSL https://api.ipify.org)"
if [[ -z "${PUBLIC_IP}" ]]; then
  echo "Could not determine the public IP automatically." >&2
  echo "Set it manually: PUBLIC_IP=1.2.3.4 bash oracle-vm-setup.sh" >&2
  exit 1
fi
DOMAIN="${DOMAIN:-${PUBLIC_IP}.nip.io}"

echo "==> Public IP: ${PUBLIC_IP}"
echo "==> Domain (nip.io):  ${DOMAIN}"
echo "==> Repo: ${REPO_URL} @ ${REPO_BRANCH}"

export DEBIAN_FRONTEND=noninteractive

echo "==> Opening 80/443 in the OS firewall (OCI images block them by default)"
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  apt-get update -y
  apt-get install -y iptables-persistent
  netfilter-persistent save
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo "==> Installing base packages"
apt-get update -y
apt-get install -y git curl ca-certificates build-essential

echo "==> Installing Caddy (automatic HTTPS reverse proxy)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating service user + swap (helps on the 1GB Always Free shape)"
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

echo "==> Cloning ${REPO_URL} (${REPO_BRANCH}) into ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin "${REPO_BRANCH}"
  git -C "${APP_DIR}" checkout "${REPO_BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${REPO_BRANCH}"
else
  git clone --branch "${REPO_BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

echo "==> Installing uv + Python deps as ${SERVICE_USER}"
sudo -u "${SERVICE_USER}" bash -lc "
  set -euo pipefail
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  cd '${APP_DIR}'
  uv venv --python 3.12
  uv sync
  uv pip install -e packages/playground
  uv pip install -e packages/harbor-langsmith
  uv pip install -e packages/rewardkit
"

if [[ "${IMPORT_PERSONA_1M:-0}" == "1" ]]; then
  echo "==> Downloading the Persona 1M coreset (~6.8GB — this can take a while)"
  sudo -u "${SERVICE_USER}" bash -lc "
    set -euo pipefail
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    cd '${APP_DIR}'
    .venv/bin/hf download MatrAIx2026/MatrAIx_Persona_1M_Public_Release \
      --repo-type dataset --local-dir persona/datasets/matraix-persona-1m/release
  "
fi

echo "==> Writing systemd unit"
cat > /etc/systemd/system/matraix-playground.service <<EOF
[Unit]
Description=MatrAIx Playground API
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=PYTHONPATH=${APP_DIR}:${APP_DIR}/application/playground:${APP_DIR}/environment/runtime:${APP_DIR}/packages/playground/src
Environment=MATRIX_EXTRA_CORS_ORIGINS=${CORS_ORIGIN}
Environment=TOKENIZERS_PARALLELISM=false
ExecStart=${APP_DIR}/.venv/bin/uvicorn backend.api.app:app --host 127.0.0.1 --port 8765 --workers 1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "==> Writing Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	reverse_proxy 127.0.0.1:8765
}
EOF

echo "==> Starting services"
systemctl daemon-reload
systemctl enable --now matraix-playground.service
systemctl restart caddy

echo "==> Waiting for the API to answer locally..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if curl -fsS http://127.0.0.1:8765/api/health; then
  echo
else
  echo "Backend did not come up — check: journalctl -u matraix-playground -n 100 --no-pager" >&2
  exit 1
fi

echo
echo "==> Done. Backend should be live at:"
echo "      https://${DOMAIN}/api/health"
echo
echo "If that URL doesn't respond in a minute, check Caddy's own logs:"
echo "  journalctl -u caddy -n 100 --no-pager"
echo
echo "Set this backend as the frontend's target with the PLAYGROUND_API_BASE_URL"
echo "repository variable in GitHub (Settings > Secrets and variables > Actions"
echo "> Variables), value: https://${DOMAIN}"
