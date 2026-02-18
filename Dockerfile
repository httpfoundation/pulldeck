# Dockerfile for Docker Manager API
# Multi-stage build for optimized image size

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install pnpm and docker-compose (from edge repository for latest versions)
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community docker-cli docker-cli-compose

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Signal to the application that it is running inside a container
ENV DOCKER_MANAGER_RUNNING_IN_CONTAINER=true

# Expose port (default 3000, configurable via PORT env var)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]
