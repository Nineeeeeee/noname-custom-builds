# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="/pnpm:$PATH"

RUN set -eux \
    && corepack enable \
    && corepack prepare pnpm@10 --activate \
    && pnpm --version

WORKDIR /app

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    set -eux \
    && pnpm install --prod --frozen-lockfile --config.confirm-modules-purge=false

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    set -eux \
    && pnpm install --frozen-lockfile --config.confirm-modules-purge=false
COPY src ./src
COPY tsup.config.ts ./
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV="production" \
    PORT="8082"

WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "const net=require('node:net');const port=Number(process.env.PORT||8082);const socket=net.connect({host:'127.0.0.1',port},()=>{socket.end();process.exit(0)});socket.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000).unref()"]

CMD ["node", "dist/cli.cjs"]
