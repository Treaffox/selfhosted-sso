FROM node:22-alpine AS base

# ─── Dependencies ────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate

# ─── Build ───────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npx prisma generate
RUN npm run build

# ─── Production ──────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# All node_modules (Prisma CLI + engine + seed deps)
COPY --from=builder /app/prisma ./prisma

# Next.js standalone output (FIRST — brings minimal node_modules)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Full node_modules ON TOP (overrides standalone's minimal set)
COPY --from=deps /app/node_modules ./node_modules

USER nextjs
EXPOSE 8122
ENV PORT=8122
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && npx tsx prisma/seed.ts && node server.js"]
