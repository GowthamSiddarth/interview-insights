FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
# Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time —
# setting it as a container *runtime* env var (as infra/docker-compose.yml's
# full profile does) has no effect on an already-built image. Must be a
# build ARG instead, which is why different deploy targets (docker-compose
# full profile vs. k8s Ingress hosts) need their own image build.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
# GitHub issue #805 (Phase 55) — node:22-slim already ships a non-root
# `node` user (uid/gid 1000); nothing here needs root at runtime.
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
