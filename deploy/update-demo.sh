#!/usr/bin/env bash
#
# Atrium demo production update — run on the VPS as the **deploy** SSH user:
#   cd /home/atrium && ./deploy/update-demo.sh
#
# Uses `sudo` only for systemctl (atrium-demo, nginx) and copying the nginx
# vhost. Requires passwordless sudo for those commands (see deploy/README.md).

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ATRIUM_ROOT="${ATRIUM_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ATRIUM_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Atrium — production update (landing + demo)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "ROOT=$ATRIUM_ROOT"
echo ""

# Non-login SSH (e.g. GitHub Actions → appleboy/ssh-action) does not source
# ~/.bashrc — load nvm so Node 20 + corepack pnpm are on PATH when installed
# under $HOME/.nvm (typical for the `deploy` user on our VPS).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi

# Optional: light Docker cleanup when sharing a box with other apps (same
# invariants as Capitanias: dangling images only, no volume prune).
if command -v docker >/dev/null 2>&1; then
  echo "🧹 Pruning dangling docker images (safe on multi-tenant hosts)..."
  sudo -n docker image prune -f >/dev/null 2>&1 || docker image prune -f >/dev/null 2>&1 || true
fi

echo "📍 Current commit: $(git rev-parse --short HEAD)"
echo "📥 Fetching origin/main..."
git fetch origin main
git reset --hard origin/main
echo "📍 Now at: $(git rev-parse --short HEAD)"
echo ""

# Node / pnpm (match repo packageManager)
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@9.15.0 --activate >/dev/null 2>&1 || true
fi

echo "📦 pnpm install..."
pnpm install --frozen-lockfile

echo "🔨 pnpm build (workspace)..."
pnpm build

echo "🔁 Restarting atrium-demo service..."
if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^atrium-demo\.service'; then
  sudo systemctl restart atrium-demo
  systemctl is-active --quiet atrium-demo && echo -e "${GREEN}✓ atrium-demo is active${NC}" || {
    echo -e "${RED}✗ atrium-demo failed to start — journalctl -u atrium-demo -n 80${NC}"
    exit 1
  }
else
  echo -e "${YELLOW}⚠ atrium-demo.service not installed — skip restart (see deploy/README.md)${NC}"
fi

# --- nginx: demo + marketing landing (single reload if anything changed) ---
ENV_FILE="$ATRIUM_ROOT/deploy/atrium-demo.env"
PORT=7341
if [ -f "$ENV_FILE" ]; then
  LINE=$(grep -E '^PORT=' "$ENV_FILE" | tail -1 || true)
  if [ -n "$LINE" ]; then
    PORT="${LINE#PORT=}"
    PORT="${PORT//\"/}"
    PORT="${PORT//\'/}"
    PORT="${PORT// /}"
  fi
fi
PORT="${PORT:-7341}"

NGINX_DEMO_SRC="$ATRIUM_ROOT/deploy/nginx/atrium-demo-host.conf"
NGINX_DEMO_TARGET=/etc/nginx/sites-available/atrium-demo
NGINX_DEMO_LINK=/etc/nginx/sites-enabled/atrium-demo

NGINX_LANDING_SRC="$ATRIUM_ROOT/deploy/nginx/atrium-landing-host.conf"
NGINX_LANDING_TARGET=/etc/nginx/sites-available/atrium-landing
NGINX_LANDING_LINK=/etc/nginx/sites-enabled/atrium-landing

NGINX_CHANGED=0

if [ -f "$NGINX_DEMO_SRC" ] && command -v nginx >/dev/null 2>&1; then
  TMP_DEMO="$(mktemp)"
  sed "s/__ATRIUM_DEMO_PORT__/${PORT}/g" "$NGINX_DEMO_SRC" >"$TMP_DEMO"
  if [ ! -f "$NGINX_DEMO_TARGET" ] || ! cmp -s "$TMP_DEMO" "$NGINX_DEMO_TARGET" 2>/dev/null; then
    echo "🌐 Updating nginx vhost (demo.atriumjs.dev) → port ${PORT}..."
    sudo cp "$TMP_DEMO" "$NGINX_DEMO_TARGET"
    sudo ln -sf "$NGINX_DEMO_TARGET" "$NGINX_DEMO_LINK"
    NGINX_CHANGED=1
  else
    echo "🌐 nginx demo vhost already up to date"
  fi
  rm -f "$TMP_DEMO"
elif [ -f "$NGINX_DEMO_SRC" ] && ! command -v nginx >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠ nginx not installed — skipped vhost sync${NC}"
fi

if [ -f "$NGINX_LANDING_SRC" ] && command -v nginx >/dev/null 2>&1; then
  TMP_LANDING="$(mktemp)"
  sed "s|__ATRIUM_REPO_ROOT__|${ATRIUM_ROOT}|g" "$NGINX_LANDING_SRC" >"$TMP_LANDING"
  if [ ! -f "$NGINX_LANDING_TARGET" ] || ! cmp -s "$TMP_LANDING" "$NGINX_LANDING_TARGET" 2>/dev/null; then
    echo "🌐 Updating nginx vhost (atriumjs.dev → static landing)..."
    sudo cp "$TMP_LANDING" "$NGINX_LANDING_TARGET"
    sudo ln -sf "$NGINX_LANDING_TARGET" "$NGINX_LANDING_LINK"
    NGINX_CHANGED=1
  else
    echo "🌐 nginx landing vhost already up to date"
  fi
  rm -f "$TMP_LANDING"
fi

if [ "$NGINX_CHANGED" -eq 1 ] && command -v nginx >/dev/null 2>&1; then
  if sudo nginx -t 2>&1 | tail -5; then
    sudo systemctl reload nginx && echo -e "${GREEN}✓ nginx reloaded${NC}"
  else
    echo -e "${RED}✗ nginx -t failed — fix config and redeploy${NC}"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}✅ update-demo.sh finished${NC}"
