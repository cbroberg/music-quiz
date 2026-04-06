FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# Install workspace deps with cache-friendly layer
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/quiz-engine/package.json packages/quiz-engine/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Build all packages via Turbo
FROM deps AS build
COPY packages/ packages/
RUN pnpm build

# Production image
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json /app/turbo.json /app/tsconfig.base.json ./
COPY --from=build /app/packages/ packages/
RUN pnpm install --frozen-lockfile --prod
COPY home/ home/
COPY data/ data/
COPY public/ public/
EXPOSE 3000
CMD ["node", "packages/mcp-server/server.js"]
