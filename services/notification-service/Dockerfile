FROM node:22-slim AS base
WORKDIR /app

# No Prisma yet — this issue (#334) only proves the skeleton deploys as
# its own unit, zero consumers wired. #335/#336 will add Prisma (for
# idempotent-consumption tracking) and, with it, api/Dockerfile's
# `prisma generate` build step + openssl runtime dependency.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
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
