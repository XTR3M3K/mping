FROM node:current-alpine
WORKDIR /app
# iputils gives full-featured ping (matches the agent's ping flags); mtr provides
# per-hop loss for traceroute, with traceroute as the fallback.
RUN apk add --no-cache iputils mtr traceroute ca-certificates
RUN npm install -g pnpm@9.7.0
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile=false
COPY packages/shared packages/shared
COPY packages/agent packages/agent
# mtr needs raw sockets; grant the capability if running unprivileged.
CMD ["pnpm", "--filter", "@mping/agent", "start"]
