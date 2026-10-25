# The pnpm version is pinned on purpose. This read `pnpm@latest`, which is
# not a version: upstream wrote it against pnpm 9 and `latest` is now 12,
# which made "ignored build scripts" fatal and broke the build outright.
# A pinned package manager is also one less thing that can change under us
# between two builds of the same commit.
#
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
ARG PNPM_VERSION=9.15.9

# Install pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
ARG PNPM_VERSION=9.15.9

# Install pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the application
RUN pnpm build

# Stage 3: Production
FROM node:22-alpine AS runner
WORKDIR /app
ARG PNPM_VERSION=9.15.9

# Install pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Set NODE_ENV to production
ENV NODE_ENV production

# Copy necessary files for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Add a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs && \
    chown -R nestjs:nodejs /app
USER nestjs

# Expose the port specified by the PORT environment variable (default: 3001).
# This read 300 upstream, which is a typo: a bare `docker run` bound the wrong
# port, and it only went unnoticed because compose overrides PORT at runtime.
ENV PORT 3001
EXPOSE ${PORT}

# Health check to verify app is running
# HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
#   CMD wget -q -O - http://localhost:${PORT}/api/v1/health || exit 1

# Command to run the application
CMD ["node", "dist/main"] 