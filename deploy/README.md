# Deploying atriumjs.dev + demo.atriumjs.dev

This mirrors the **Capitanias** production pattern: GitHub Actions SSH to the same VPS, **host nginx** on **80 + 443**. If Cloudflare SSL mode is **Full** or **Full (strict)** (recommended), Cloudflare connects to the origin over **HTTPS** — nginx must serve **TLS on 443** for `atriumjs.dev`, `www`, and `demo` (see templates under `deploy/nginx/`). **Flexible** (visitor→Cloudflare HTTPS, Cloudflare→origin HTTP) avoids origin TLS but is weaker; this repo assumes **Full** + Let’s Encrypt on the box.

| Hostname              | What serves it                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **atriumjs.dev**      | Static files from `deploy/landing/index.html` (`deploy/nginx/atrium-landing-host.conf` → `root …/deploy/landing`). |
| **demo.atriumjs.dev** | Node demo (`packages/demo`) on loopback; nginx reverse-proxies (`deploy/nginx/atrium-demo-host.conf`).             |

There is **no Docker** requirement for the landing page or the demo Node process. The **Playwright worker** for `demo.atriumjs.dev` is started automatically by **`deploy/update-demo.sh`** when Docker is available: it runs **`deploy/docker-compose.worker.yml`**, which reads secrets from **`deploy/atrium-demo.env`** (same `ATRIUM_WORKER_SECRET` / `ATRIUM_WORKER_DIAL_BASE` as the demo). Without Docker, run `@atriumjs/worker` yourself so `ATRIUM_WORKER_DIAL_BASE` is reachable (default `ws://127.0.0.1:7070`).

`./deploy/update-demo.sh` refreshes **both** nginx vhosts when their templates change, then runs a single `nginx -t` + `reload`.

## One-time server setup

1. **Unix user** (example `deploy`) and app directory **`/home/atrium`** — clone this repo:

   ```bash
   sudo mkdir -p /home/atrium
   sudo chown deploy:deploy /home/atrium
   sudo -u deploy -H bash -lc 'git clone https://github.com/ohmaseclaro/atrium.git /home/atrium'
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

6. **Docker** (recommended for the worker) — install Docker Engine and add the **`deploy`** user to the **`docker`** group so **`deploy/update-demo.sh`** can run `docker compose` without a password (`sudo usermod -aG docker deploy`). The first worker image build can take several minutes (Playwright base image).

7. **Worker** — on each deploy, **`./deploy/update-demo.sh`** builds and starts the **`atrium-worker`** container from **`deploy/docker-compose.worker.yml`** (loopback **7070**). Ensure **`deploy/atrium-demo.env`** exists with **`ATRIUM_WORKER_SECRET`** matching the container. If you cannot use Docker, run **`ATRIUM_WORKER_SECRET=… npx atrium-worker`** (or `pnpm --filter @atriumjs/worker start`) under systemd instead, and keep **`ATRIUM_WORKER_DIAL_BASE`** pointed at that process.

8. **TLS on the origin (required for Cloudflare Full)** — before the first `nginx -t` with the current templates, obtain a certificate whose SANs include all three hostnames (one cert is enough):

   ```bash
   sudo mkdir -p /var/www/certbot
   sudo certbot certonly --nginx -d atriumjs.dev -d www.atriumjs.dev -d demo.atriumjs.dev
   ```

   Paths in the repo vhosts expect **`/etc/letsencrypt/live/atriumjs.dev/{fullchain.pem,privkey.pem}`** and the standard **`options-ssl-nginx.conf`** / **`ssl-dhparams.pem`** from certbot. HTTP **:80** keeps **`/.well-known/acme-challenge/`** on `root /var/www/certbot` for renewals; other requests redirect to HTTPS.

9. **Passwordless sudo** for `deploy` — `deploy/update-demo.sh` runs as `deploy` and uses `sudo` for `systemctl restart atrium-demo`, copying nginx vhosts into `/etc/nginx/sites-available/`, `nginx -t`, and `systemctl reload nginx`. Add an `/etc/sudoers.d/` drop-in that matches your paths (`command -v nginx systemctl` on the server).

10. **First deploy** — after step 9:

```bash
cd /home/atrium && ./deploy/update-demo.sh
```

If nginx is not installed: `apt install nginx`.

## Nginx files in the repo

| File                                    | Installed as                                |
| --------------------------------------- | ------------------------------------------- |
| `deploy/nginx/atrium-landing-host.conf` | `/etc/nginx/sites-available/atrium-landing` |
| `deploy/nginx/atrium-demo-host.conf`    | `/etc/nginx/sites-available/atrium-demo`    |

`__ATRIUM_REPO_ROOT__` in the landing template is replaced at deploy time with the clone path (e.g. `/home/atrium`). `__ATRIUM_DEMO_PORT__` in the demo template comes from `PORT` in `deploy/atrium-demo.env`.

## GitHub Actions

Workflow: `.github/workflows/deploy-demo.yml` (repository root). On pushes to `main` that touch the demo, libraries, lockfile, or **`deploy/**`**, it runs **lint → test → build**, then **one SSH session** to the VPS: `./deploy/update-demo.sh`, then **in the same connection** (avoids flaky re-dials) it checks:

- **demo** — `GET /atrium/healthz` on loopback (`PORT` from `deploy/atrium-demo.env`).
- **worker** — `GET /healthz` on loopback (HTTP port parsed from `ATRIUM_WORKER_DIAL_BASE`, default **7070**); allow several minutes after the first Docker worker build.
- **landing** — `GET /` over HTTPS to loopback, e.g. `curl --resolve atriumjs.dev:443:127.0.0.1 https://atriumjs.dev/`.

SSH **timeout** is **10m** (dial + session) and **command_timeout** **60m** so `docker compose build` on the server can finish.

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

# Worker internal HTTP (must match ATRIUM_WORKER_DIAL_BASE port, default 7070)
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7070/healthz

# Static landing (via nginx on the box; use -k only if the cert name does not match 127.0.0.1)
curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: atriumjs.dev" http://127.0.0.1/
curl -sS -o /dev/null -w "%{http_code}\n" --resolve atriumjs.dev:443:127.0.0.1 https://atriumjs.dev/
```
