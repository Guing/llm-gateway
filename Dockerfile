# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app

RUN npm install -g pnpm@11

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/frontend/package.json ./packages/frontend/

RUN pnpm install --frozen-lockfile --filter frontend --ignore-scripts

COPY packages/frontend ./packages/frontend

RUN pnpm --filter frontend build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM node:22-alpine AS backend-build
WORKDIR /app

RUN npm install -g pnpm@11

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile --filter backend --ignore-scripts

COPY packages/backend ./packages/backend

# Generate Prisma client and download engine binary for linux-musl-openssl-3.0.x (Alpine)
RUN cd packages/backend && npx prisma generate

# Compile TypeScript to JavaScript
RUN pnpm --filter backend build

# Create a portable production deployment bundle (flat node_modules, prod deps only)
RUN pnpm deploy --filter backend --prod --legacy /deploy/backend
# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Prisma schema engine requires openssl on Alpine
RUN apk add --no-cache openssl

# Copy flat production node_modules from pnpm deploy
COPY --from=backend-build /deploy/backend/node_modules ./packages/backend/node_modules

# Copy compiled backend JS
COPY --from=backend-build /app/packages/backend/dist ./packages/backend/dist

# Copy Prisma schema + migrations for migrate deploy
COPY --from=backend-build /app/packages/backend/prisma ./packages/backend/prisma

# Copy built frontend static files
COPY --from=frontend-build /app/packages/frontend/dist ./packages/frontend/dist

# Persistent data/log directories
RUN mkdir -p /data /logs

EXPOSE 7500

ENV NODE_ENV=production \
    PORT=7500 \
    DATABASE_URL=file:/data/prod.db

# Migrate and start (engine binary already bundled in image).
CMD ["sh", "-c", \
  "cd /app/packages/backend && \
   node_modules/.bin/prisma migrate deploy && \
   cd /app && \
   node packages/backend/dist/index.js"]
