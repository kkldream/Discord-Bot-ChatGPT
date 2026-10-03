FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit && npm cache clean --force
COPY --chown=node:node index.js db.js commands.js constant.js stringValue.js openaiApi.js ./
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node scripts/healthcheck.js ./scripts/healthcheck.js
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "index.js"]
