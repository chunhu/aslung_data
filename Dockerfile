FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node node_modules/next/dist/bin/next build --webpack

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --gid 1001 aslung && useradd --uid 1001 --gid aslung --create-home aslung
COPY --from=builder --chown=aslung:aslung /app/.next/standalone ./
COPY --from=builder --chown=aslung:aslung /app/.next/static ./.next/static
COPY --from=builder --chown=aslung:aslung /app/public ./public
COPY --from=builder --chown=aslung:aslung /app/scripts ./scripts
COPY --from=builder --chown=aslung:aslung /app/lib/store.mjs /app/lib/passwords.mjs ./lib/
RUN mkdir -p /app/data /app/backups && chown -R aslung:aslung /app/data /app/backups
USER aslung
EXPOSE 3000
CMD ["node","server.js"]
