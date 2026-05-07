# Deploying `demo.atriumjs.dev`

This mirrors the **Capitanias** production pattern: GitHub Actions SSH to the same VPS, host **nginx** proxies to a **loopback** Node process, TLS is handled by **Cloudflare** (same as other apps on the box). There is **no Docker** requirement for the demo web process (unlike Capitanias’ API/UI containers), but the **Playwright worker** must still be reachable at `ATRIUM_WORKER_DIAL_BASE` (default `ws://127.0.0.1:7070`).

## One-time server setup

1. **Unix user** (example `deploy`) and app directory **`/home/atrium`** — clone this repo:

   ```bash
   sudo mkdir -p /home/atrium
   sudo chown deploy:deploy /home/atrium
   sudo -u deploy -H bash -lc 'git clone https://github.com/atriumjs/atrium.git /home/atrium'
   ```

   Use your real org/repo URL if different.

2. **Node 20+** and **pnpm** (Corepack):

   ```bash
   corepack enable && corepack prepare pnpm@9.15.0 --activate
   ```

3. **Environment file** (secrets live only on the server):

   ```bash
   sudo -u deploy cp /home/atrium/deploy/atrium-demo.env.example /home/atrium/deploy/atrium-demo.env
   sudo -u deploy chmod 600 /home/atrium/deploy/atrium-demo.env
   # edit: PORT, ATRIUM_WORKER_SECRET, ATRIUM_WORKER_DIAL_BASE
   ```

4. **systemd** (paths assume `/home/atrium` and user `deploy`):

   ```bash
   sudo cp /home/atrium/deploy/atrium-demo.service /etc/systemd/system/atrium-demo.service
   # Edit User=/Group= and paths if your layout differs, then:
   sudo systemctl daemon-reload
   sudo systemctl enable --now atrium-demo
   ```

5. **Worker** — run `@atriumjs/worker` on the host (Docker or systemd) so the dial URL in `atrium-demo.env` works.

6. **Passwordless sudo** for `deploy` — `deploy/update-demo.sh` runs as `deploy` and uses `sudo` only for `systemctl restart atrium-demo`, copying the generated nginx vhost, `nginx -t`, and `systemctl reload nginx`. Add an `/etc/sudoers.d/` drop-in that matches your paths (use `command -v nginx systemctl` on the server). Until that works, nginx sync and service restart steps will fail.

7. **nginx + DNS** — point `demo.atriumjs.dev` at this host (Cloudflare orange cloud is fine). After step 6, run:

   ```bash
   cd /home/atrium && ./deploy/update-demo.sh
   ```

   If nginx is not installed, install it once (`apt install nginx`). With **Cloudflare Full** to origin HTTP, the included vhost listens on **port 80** only (same model as Capitanias’ `capitanias-host.conf`).

## GitHub Actions

Workflow: `.github/workflows/deploy-demo.yml` (repository root).

**Secrets** (reuse the same as Capitanias on the shared VPS):

| Secret            | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `SSH_HOST`        | VPS hostname or IP                       |
| `SSH_USER`        | SSH login (e.g. `deploy`)                |
| `SSH_PRIVATE_KEY` | Deploy key with access to `/home/atrium` |

Optional:

| Secret              | Purpose                          |
| ------------------- | -------------------------------- |
| `ATRIUM_DEPLOY_DIR` | Clone path if not `/home/atrium` |

Create a **`demo`** (or `production`) environment in GitHub if you want approval gates; the workflow references `environment: demo`.

## Manual deploy

```bash
ssh deploy@$SSH_HOST
cd /home/atrium && ./deploy/update-demo.sh
```

## Smoke checks

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7341/atrium/healthz
curl -sS -o /dev/null -w "%{http_code}\n" https://demo.atriumjs.dev/atrium/healthz
```

Adjust `7341` if you changed `PORT` in `deploy/atrium-demo.env` (nginx upstream is updated automatically from that value on each deploy).
