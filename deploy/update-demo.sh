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
echo "  Atrium demo — production update"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "ROOT=$ATRIUM_ROOT"
echo ""

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

# --- nginx vhost (needs root) ---
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

NGINX_SRC="$ATRIUM_ROOT/deploy/nginx/atrium-demo-host.conf"
NGINX_TARGET=/etc/nginx/sites-available/atrium-demo
NGINX_LINK=/etc/nginx/sites-enabled/atrium-demo

if [ -f "$NGINX_SRC" ] && command -v nginx >/dev/null 2>&1; then
  TMP_NGINX="$(mktemp)"
  sed "s/__ATRIUM_DEMO_PORT__/${PORT}/g" "$NGINX_SRC" >"$TMP_NGINX"
  if [ ! -f "$NGINX_TARGET" ] || ! cmp -s "$TMP_NGINX" "$NGINX_TARGET" 2>/dev/null; then
    echo "🌐 Updating nginx vhost (demo) → port ${PORT}..."
    sudo cp "$TMP_NGINX" "$NGINX_TARGET"
    sudo ln -sf "$NGINX_TARGET" "$NGINX_LINK"
    if sudo nginx -t 2>&1 | tail -3; then
      sudo systemctl reload nginx && echo -e "${GREEN}✓ nginx reloaded${NC}"
    else
      echo -e "${RED}✗ nginx -t failed — vhost not applied${NC}"
      rm -f "$TMP_NGINX"
      exit 1
    fi
  else
    echo "🌐 nginx vhost already up to date"
  fi
  rm -f "$TMP_NGINX"
elif [ -f "$NGINX_SRC" ] && ! command -v nginx >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠ nginx not installed — skipped vhost sync${NC}"
fi

echo ""
echo -e "${GREEN}✅ update-demo.sh finished${NC}"
