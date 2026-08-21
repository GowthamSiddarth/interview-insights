FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Single build stage with the full (dev + prod) dependency tree — the
# runtime stage below copies node_modules wholesale from here instead of
# reinstalling. This is Prisma's own documented Docker pattern: regenerating
# the client in a slimmed-down `npm ci --omit=dev` runtime stage silently
# relies on npx auto-installing the `prisma` CLI (a devDependency) over the
# network, which is what broke here before.
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# Bakes the deployed commit into the image (GitHub issue #89) — surfaced
# via GET /health's `version` field, so a deploy can be confirmed by the
# exact commit running, not just "the rollout reported success". Defaults
# to "unknown" for anyone building without --build-arg GIT_SHA (native
# dev, docker-compose) — deliberately not a required arg.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node package.json ./
# GitHub issue #805 (Phase 55) — node:22-slim already ships a non-root
# `node` user (uid/gid 1000); nothing here needs root at runtime.
USER node
EXPOSE 3001
# scripts/entrypoint.js runs the LocalStack secrets bootstrap (if
# SECRETS_SOURCE=localstack) exactly once, then applies pending
# migrations and starts the app — both see the same resulting env
# (GitHub issue #80; see that script's own comment for why the previous
# `sh -c "npx prisma migrate deploy && node dist/main.js"` silently
# didn't do this). The prisma CLI is available here because node_modules
# was copied wholesale above, not reinstalled with --omit=dev.
CMD ["node", "scripts/entrypoint.js"]
