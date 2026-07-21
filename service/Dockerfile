FROM node:20-alpine AS source-metadata

WORKDIR /source
COPY .git /source/.git
COPY service/read-git-commit.mjs /tools/read-git-commit.mjs
RUN node /tools/read-git-commit.mjs /source/.git > /source-commit

FROM node:20-alpine

LABEL io.lume.component="plugin-market-mirror"

WORKDIR /app
COPY service /app/service
COPY --from=source-metadata /source-commit /app/source-commit
COPY .lume-plugin /market/.lume-plugin
COPY plugins /market/plugins
COPY skills /market/skills

ENV HOST=0.0.0.0 \
    PORT=8787 \
    LUME_MARKET_SOURCE_ROOT=/market \
    LUME_MARKET_DATA_DIR=/data \
    LUME_MARKET_GENERATION_FILE=/app/source-commit

VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "service/server.mjs"]
