# Build from repository root (requires network for pnpm install):
#   docker build -f docker/worker/Dockerfile .
#
# Headed Chromium needs an X11 display. This image installs **Xvfb** (X Virtual Framebuffer)
# and starts the worker under **xvfb-run** so rendering works without a physical GPU/monitor.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /repo
ENV CI=true
RUN corepack enable pnpm
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install
RUN pnpm --filter @atrium/protocol build && pnpm --filter @atrium/worker build
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb xauth \
  && rm -rf /var/lib/apt/lists/*
COPY docker/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production
ENV ATRIUM_WORKER_PORT=7070
EXPOSE 7070
USER pwuser
WORKDIR /repo
ENTRYPOINT ["/entrypoint.sh"]
