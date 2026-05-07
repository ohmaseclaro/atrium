#!/usr/bin/env bash
# Production entry for systemd — keeps Node on PATH when installed via nvm.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/packages/demo"

for NVM_SH in "$HOME/.nvm/nvm.sh" "/home/atrium/.nvm/nvm.sh" "/root/.nvm/nvm.sh"; do
  if [ -s "$NVM_SH" ]; then
    # shellcheck disable=SC1090
    . "$NVM_SH"
    break
  fi
done

exec node dist/server/prod-server.js
