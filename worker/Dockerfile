# Build from the repo root: docker build -f worker/Dockerfile -t app-worker .
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY worker/package.json worker/
RUN npm ci --workspace worker --workspace packages/shared --include-workspace-root=false --omit=dev

COPY packages/shared packages/shared
COPY worker/src worker/src
COPY worker/tsconfig.json worker/

ENV NODE_ENV=production WORKER_TMP_DIR=/tmp/worker
WORKDIR /app/worker
CMD ["npx", "tsx", "src/index.ts"]
