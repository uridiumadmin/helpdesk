FROM node:20-alpine AS builder

RUN corepack enable pnpm

WORKDIR /app

# Copy workspace config and package manifests
COPY pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

# Install dependencies
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# Copy source
COPY packages/contracts/ packages/contracts/
COPY apps/api/ apps/api/

# Build contracts first, then API
RUN pnpm --filter @o3on/contracts build && pnpm --filter @o3on/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tsconfig.build.json sets rootDir=../.. so output mirrors monorepo layout
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
