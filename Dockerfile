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

# Generate Prisma client for linux-musl (Alpine)
RUN pnpm --filter backend exec prisma generate

# Compile TypeScript �?JavaScript
RUN pnpm --filter backend build

# Create a portable production deployment bundle (flat node_modules, prod deps only)
# Note: We don't use --ignore-scripts here because Prisma needs to run postinstall
# scripts to build the native binaries required for the database client
RUN pnpm deploy --legacy --filter backend --prod /deploy/backend

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Copy flat production node_modules from pnpm deploy
COPY --from=backend-build /deploy/backend/node_modules ./packages/backend/node_modules

# Restore Prisma native binary (not included by pnpm deploy)
COPY --from=backend-build /app/packages/backend/node_modules/.prisma ./packages/backend/node_modules/.prisma

# Copy compiled backend JS
COPY --from=backend-build /app/packages/backend/dist ./packages/backend/dist

# Copy Prisma schema + migrations for migrate deploy
COPY --from=backend-build /app/packages/backend/prisma ./packages/backend/prisma

# Copy built frontend static files
COPY --from=frontend-build /app/packages/frontend/dist ./packages/frontend/dist

# Persistent SQLite data directory
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/prod.db

# Apply DB migrations then start the server
CMD ["sh", "-c", \
  "cd /app/packages/backend && \
   node_modules/.bin/prisma migrate deploy && \
   cd /app && \
   node packages/backend/dist/index.js"]
