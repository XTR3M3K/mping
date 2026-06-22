# Build the web SPA, then run the server (via tsx) which serves it.
FROM node:current-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@9.7.0
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile=false
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN pnpm --filter @mping/web build

FROM node:current-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@9.7.0
COPY --from=build /app /app
EXPOSE 4420
CMD ["pnpm", "--filter", "@mping/server", "start:prod"]
