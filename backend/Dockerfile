# UtilityHub API — container image for Cloud Run.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ghostscript \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

RUN chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
