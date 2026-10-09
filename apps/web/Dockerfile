FROM node:20-slim

WORKDIR /repo

RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/types ./packages/types
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile=false

WORKDIR /repo/apps/web
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]
