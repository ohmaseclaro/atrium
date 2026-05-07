# Deploying atriumjs.dev + demo.atriumjs.dev

This mirrors the **Capitanias** production pattern: GitHub Actions SSH to the same VPS, **host nginx** on port **80**, TLS terminated at **Cloudflare** (same as other apps on the box).

| Hostname              | What serves it                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **atriumjs.dev**      | Static files from `deploy/landing/index.html` (`deploy/nginx/atrium-landing-host.conf` → `root …/deploy/landing`). |
| **demo.atriumjs.dev** | Node demo (`packages/demo`) on loopback; nginx reverse-proxies (`deploy/nginx/atrium-demo-host.conf`).             |

There is **no Docker** requirement for the landing page or the demo Node process. The **Playwright worker** must still be reachable at `ATRIUM_WORKER_DIAL_BASE` (default `ws://127.0.0.1:7070`) — run it with Docker (`docker/worker/Dockerfile`) or directly.

`./deploy/update-demo.sh` refreshes **both** nginx vhosts when their templates change, then runs a single `nginx -t` + `reload`.

## One-time server setup

1. **Unix user** (example `deploy`) and app directory **`/home/atrium`** — clone this repo:

   ```bash
   sudo mkdir -p /home/atrium
   sudo chown deploy:deploy /home/atrium
   sudo -u deploy -H bash -lc 'git clone https://github.com/atriumjs/atrium.git /home/atrium'
   ```

   Use your real org/repo URL if different.

2. **DNS (Cloudflare)** — create **A** (or proxied **CNAME**) records for **`atriumjs.dev`**, **`www.atriumjs.dev`**, and **`demo.atriumjs.dev`** to this VPS.

3. **Node 20+** and **pnpm** (Corepack):

   ```bash
   corepack enable && corepack prepare pnpm@9.15.0 --activate
   ```

4. **Environment file** (secrets live only on the server):

   ```bash
   sudo -u deploy cp /home/atrium/deploy/atrium-demo.env.example /home/atrium/deploy/atrium-demo.env
   sudo -u deploy chmod 600 /home/atrium/deploy/atrium-demo.env
   # edit: PORT, ATRIUM_WORKER_SECRET, ATRIUM_WORKER_DIAL_BASE
   ```

5. **systemd** (paths assume `/home/atrium` and user `deploy`):

   ```bash
   sudo cp /home/atrium/deploy/atrium-demo.service /etc/systemd/system/atrium-demo.service
   # Edit User=/Group= and paths if your layout differs, then:
   sudo systemctl daemon-reload
   sudo systemctl enable --now atrium-demo
   ```

6. **Worker** — run `@atriumjs/worker` on the host (Docker or systemd) so the dial URL in `atrium-demo.env` works.

7. **Passwordless sudo** for `deploy` — `deploy/update-demo.sh` runs as `deploy` and uses `sudo` for `systemctl restart atrium-demo`, copying nginx vhosts into `/etc/nginx/sites-available/`, `nginx -t`, and `systemctl reload nginx`. Add an `/etc/sudoers.d/` drop-in that matches your paths (`command -v nginx systemctl` on the server).

8. **First deploy** — after step 7:

   ```bash
   cd /home/atrium && ./deploy/update-demo.sh
   ```

   If nginx is not installed: `apt install nginx`. With **Cloudflare Full** to origin HTTP, the repo vhosts listen on **port 80** only (same model as Capitanias’ `capitanias-host.conf`).

## Nginx files in the repo

| File                                    | Installed as                                |
| --------------------------------------- | ------------------------------------------- |
| `deploy/nginx/atrium-landing-host.conf` | `/etc/nginx/sites-available/atrium-landing` |
| `deploy/nginx/atrium-demo-host.conf`    | `/etc/nginx/sites-available/atrium-demo`    |

`__ATRIUM_REPO_ROOT__` in the landing template is replaced at deploy time with the clone path (e.g. `/home/atrium`). `__ATRIUM_DEMO_PORT__` in the demo template comes from `PORT` in `deploy/atrium-demo.env`.

## GitHub Actions

Workflow: `.github/workflows/deploy-demo.yml` (repository root). On pushes to `main` that touch the demo, libraries, lockfile, or **`deploy/**`**, it runs **lint → test → build**, SSHs to the VPS, runs `./deploy/update-demo.sh`, then checks **demo** (`/atrium/healthz` on loopback) and **landing** (`GET /`with`Host: atriumjs.dev`).

**Secrets** — add them on **this** repository (forks do not inherit secrets from other repos). If `SSH_HOST` is missing, the deploy job fails immediately with a clear error (instead of `ssh-action`’s “missing server host”).

| Secret            | Purpose                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `SSH_HOST`        | VPS **IP or DNS name**. Must be non-empty.                                                     |
| `SSH_USER`        | SSH login (e.g. `deploy`)                                                                      |
| `SSH_PRIVATE_KEY` | Private deploy key (PEM) for that user, with access to the app directory (e.g. `/home/atrium`) |

Optional:

| Secret              | Purpose                          |
| ------------------- | -------------------------------- |
| `ATRIUM_DEPLOY_DIR` | Clone path if not `/home/atrium` |

The workflow uses GitHub **environment** `demo` (URL + optional protection rules). You can store secrets as **repository** secrets (Settings → Secrets and variables → Actions) or as **environment** secrets (Settings → Environments → **demo**). If you use the `demo` environment, either inherit repository secrets or duplicate `SSH_HOST` / `SSH_USER` / `SSH_PRIVATE_KEY` under that environment—otherwise they resolve empty and SSH fails.

## Manual deploy

```bash
ssh deploy@$SSH_HOST
cd /home/atrium && ./deploy/update-demo.sh
```

## Smoke checks

```bash
# Demo API (replace 7341 if you changed PORT)
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7341/atrium/healthz
curl -sS -o /dev/null -w "%{http_code}\n" https://demo.atriumjs.dev/atrium/healthz

# Static landing (via nginx on the box)
curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: atriumjs.dev" http://127.0.0.1/
curl -sS -o /dev/null -w "%{http_code}\n" https://atriumjs.dev/
```
