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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# Applies any pending migrations against DATABASE_URL before starting —
# the prisma CLI is available here because node_modules was copied
# wholesale above, not reinstalled with --omit=dev.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
