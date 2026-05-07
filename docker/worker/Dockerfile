# Build from repository root (requires network for pnpm install):
#   docker build -f docker/worker/Dockerfile .
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /repo
ENV CI=true
RUN corepack enable pnpm
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install
RUN pnpm --filter @atrium/protocol build && pnpm --filter @atrium/worker build
ENV NODE_ENV=production
ENV ATRIUM_WORKER_PORT=7070
EXPOSE 7070
USER pwuser
WORKDIR /repo
CMD ["node", "packages/worker/dist/run.js"]
