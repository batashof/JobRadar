# Build context is the monorepo root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Install with a warm layer cache: manifests first, sources later.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @jobradar/api --filter @jobradar/shared

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @jobradar/shared build && pnpm --filter @jobradar/api build

# Self-contained production bundle (prod deps only, workspace deps included).
RUN pnpm --filter @jobradar/api deploy --legacy --prod /prod/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api /app
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
