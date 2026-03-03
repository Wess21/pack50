# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-slim AS deps

WORKDIR /app

# Copy only package files for better layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
# Using npm ci for reproducible builds
RUN npm ci --ignore-scripts

# ============================================
# Stage 2: Builder
# ============================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code and configuration
COPY . .

# Build TypeScript and copy SQL files
RUN npm run build && \
    echo "Build completed successfully" && \
    ls -la dist/

# ============================================
# Stage 3: Production dependencies
# ============================================
FROM node:20-slim AS prod-deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# ============================================
# Stage 4: Production image
# ============================================
FROM node:20-slim AS production

WORKDIR /app

# Install curl for healthcheck (minimal layer)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create non-root user and fix permissions
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check with proper error handling
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
