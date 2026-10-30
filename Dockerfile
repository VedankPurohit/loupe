# syntax=docker/dockerfile:1.7

FROM node:22.22.3-bookworm-slim AS build

WORKDIR /workspace
RUN npm install --global pnpm@10.28.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/
COPY packages/agent-adapter/package.json packages/agent-adapter/tsconfig.json packages/agent-adapter/tsconfig.build.json packages/agent-adapter/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json packages/contracts/
COPY packages/database/package.json packages/database/tsconfig.json packages/database/tsconfig.build.json packages/database/
COPY packages/relay/package.json packages/relay/tsconfig.json packages/relay/tsconfig.build.json packages/relay/
RUN pnpm install --frozen-lockfile \
  --filter @workspace/server... \
  --filter @workspace/web...

COPY apps/server/src apps/server/src
COPY apps/web/index.html apps/web/index.html
COPY apps/web/src apps/web/src
COPY packages/agent-adapter/src packages/agent-adapter/src
COPY packages/contracts/src packages/contracts/src
COPY packages/database/src packages/database/src
COPY packages/database/drizzle packages/database/drizzle
RUN pnpm --filter @workspace/contracts build \
  && pnpm --filter @workspace/database build \
  && pnpm --filter @workspace/agent-adapter build \
  && pnpm --filter @workspace/server build \
  && pnpm --filter @workspace/web build

FROM node:22.22.3-bookworm-slim AS server

ENV NODE_ENV=production
WORKDIR /workspace
RUN npm install --global pnpm@10.28.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/agent-adapter/package.json packages/agent-adapter/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN pnpm install --prod --frozen-lockfile --filter @workspace/server...

COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY --from=build /workspace/packages/agent-adapter/dist packages/agent-adapter/dist
COPY --from=build /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build /workspace/packages/database/dist packages/database/dist
COPY --from=build /workspace/packages/database/drizzle packages/database/drizzle

USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/main.js"]

FROM nginx:1.29-alpine AS web

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
