# --- deps: install dependencies (needs build tools for better-sqlite3's
# native addon) -------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: compile the Next.js app --------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: minimal production image ---------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/src/db/migrations ./src/db/migrations
COPY --from=builder /app/src/db/client.ts ./src/db/client.ts
COPY --from=builder /app/src/db/schema.ts ./src/db/schema.ts
COPY --from=builder /app/scripts/migrate.ts ./scripts/migrate.ts

RUN mkdir -p /app/data

# Runs as root: the persistent volume Railway (or any host) mounts at
# /app/data at container start gets its own ownership, which would shadow
# whatever a build-time `chown` set for a non-root user — running as root
# sidesteps that mismatch rather than fighting it with an entrypoint script.
# Acceptable trade-off for a single-user, self-hosted personal tool.

EXPOSE 3000
ENV PORT=3000
ENV DATABASE_URL=/app/data/reader.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "npm run db:migrate && npm start"]
