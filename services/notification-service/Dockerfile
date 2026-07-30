FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# GitHub issue #335 — Prisma's own docker pattern (same as api/Dockerfile):
# generate the client once in the full (dev+prod) dependency tree, then
# the runtime stage below copies node_modules wholesale rather than
# reinstalling. Unlike api, this service never runs `prisma migrate` —
# there is no prisma/migrations/ directory here at all (docs/DECISIONS.md
# D75) — so there's no migrate-on-boot step, just `prisma generate`.
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
# Bakes the deployed commit into the image, surfaced via GET /health's
# `version` field — same convention as api/Dockerfile (GitHub issue #89).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3002
CMD ["node", "dist/main.js"]
