# The Sendline web UI.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, not
# read at runtime, so the API address has to be a build arg. Change it and you
# must rebuild: `docker compose up -d --build sendline-web`.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` when a lockfile exists, plain install otherwise, so this works
# whether or not the lockfile has been committed.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
