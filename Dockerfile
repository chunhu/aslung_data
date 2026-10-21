# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=aslung-pnpm-store,target=/pnpm/store,sharing=locked \
    install_started=$(date +%s) && \
    corepack pnpm install --frozen-lockfile --store-dir /pnpm/store && \
    echo "[build timing] pnpm install: $(($(date +%s) - install_started)) seconds"

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ARG NODE_BUILD_HEAP_MB=1024
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}"
RUN --mount=type=cache,id=aslung-next-cache,target=/app/.next/cache,sharing=locked \
    build_started=$(date +%s) && \
    node node_modules/next/dist/bin/next build --webpack && \
    echo "[build timing] Next.js build: $(($(date +%s) - build_started)) seconds"

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --gid 1001 aslung && useradd --uid 1001 --gid aslung --create-home aslung
COPY --from=builder --chown=aslung:aslung /app/.next/standalone ./
COPY --from=builder --chown=aslung:aslung /app/.next/static ./.next/static
COPY --from=builder --chown=aslung:aslung /app/public ./public
COPY --from=builder --chown=aslung:aslung /app/scripts ./scripts
COPY --from=builder --chown=aslung:aslung /app/lib/store.mjs /app/lib/passwords.mjs /app/lib/registration.mjs /app/lib/countries.mjs /app/lib/member-access.mjs /app/lib/permissions.mjs ./lib/
COPY --from=builder --chown=aslung:aslung /app/lib/maintainer-links.mjs /app/lib/alert-policy.mjs ./lib/
COPY --from=builder --chown=aslung:aslung /app/lib/s3-storage.mjs /app/lib/processing-storage.mjs ./lib/
COPY --from=builder --chown=aslung:aslung /app/lib/export-name.mjs ./lib/
COPY --from=builder --chown=aslung:aslung /app/lib/processing-cleanup.mjs /app/lib/processing-cleanup-s3.mjs ./lib/
COPY --from=builder --chown=aslung:aslung /app/lib/processing-jobs.mjs /app/lib/processing-raw.mjs /app/lib/global-processing.mjs /app/lib/measurement-processing.mjs /app/lib/calibration.mjs /app/lib/calibration-dates.mjs /app/lib/calibration-google.mjs /app/lib/fleet-import.mjs ./lib/
RUN mkdir -p /app/data /app/backups && chown -R aslung:aslung /app/data /app/backups
USER aslung
# Verify worker imports in the final image without opening databases or running jobs.
RUN node --input-type=module -e "await Promise.all(['store','processing-jobs','processing-raw','global-processing','calibration-google','processing-cleanup'].map(name => import('./lib/' + name + '.mjs'))); console.log('Calibration worker runtime dependencies OK')"
EXPOSE 3000
CMD ["node","server.js"]
