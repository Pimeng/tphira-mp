FROM node:24-alpine AS build-node

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY locales ./locales
COPY server_config.example.yml ./

RUN corepack enable
RUN corepack prepare pnpm@9.15.4 --activate

RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm prune --prod

FROM node:24-alpine AS runtime-node

WORKDIR /app

ARG PHIRA_MP_VERSION

ENV NODE_ENV=production
ENV PHIRA_MP_HOME=/app
ENV PHIRA_MP_VERSION=${PHIRA_MP_VERSION}

RUN apk add --no-cache ca-certificates

COPY --from=build-node /app/dist ./dist
COPY --from=build-node /app/node_modules ./node_modules
COPY --from=build-node /app/locales ./locales
COPY --from=build-node /app/package.json ./package.json
COPY --from=build-node /app/server_config.example.yml ./server_config.example.yml

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 12346
EXPOSE 12347

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/server/main.js"]

FROM node:24-alpine AS build-sea

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY locales ./locales
COPY server_config.example.yml ./
COPY tools ./tools

RUN corepack enable
RUN corepack prepare pnpm@9.15.4 --activate

RUN pnpm install --frozen-lockfile
RUN pnpm run package:sea

FROM alpine:3.20 AS runtime-sea

WORKDIR /app

ARG PHIRA_MP_VERSION

ENV NODE_ENV=production
ENV PHIRA_MP_HOME=/app
ENV PHIRA_MP_VERSION=${PHIRA_MP_VERSION}

RUN apk add --no-cache ca-certificates libstdc++ libgcc

COPY --from=build-sea /app/release/ ./

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chmod +x /app/phira-mp-server

EXPOSE 12346
EXPOSE 12347

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/phira-mp-server"]
