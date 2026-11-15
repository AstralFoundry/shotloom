FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS harness
WORKDIR /app/harness/host
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY harness/host/package.json harness/host/package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY harness/host/tsconfig.json ./
COPY harness/host/src ./src
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force
COPY server/src ./src
COPY shared /app/shared
COPY renderer/src/config/model-catalog-v2.json /app/renderer/src/config/model-catalog-v2.json
COPY renderer/src/config/model-catalog-v2 /app/renderer/src/config/model-catalog-v2
COPY dist/renderer /app/dist/renderer
COPY --from=harness /app/harness/host/package.json /app/harness/host/package.json
COPY --from=harness /app/harness/host/dist /app/harness/host/dist
COPY --from=harness /app/harness/host/node_modules /app/harness/host/node_modules
COPY renderer/src/agent/content /app/renderer/src/agent/content
COPY AGENTS.md /app/AGENTS.md
RUN mkdir -p /var/cache/shotloom && chown node:node /var/cache/shotloom
USER node
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
