FROM node:24-alpine AS build-sea

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY locales ./locales
COPY src ./src
COPY server_config.example.yml ./
COPY tools ./tools

# 启用 corepack 并安装 package.json 中 packageManager 字段锁定的 pnpm 版本，
# 避免与 lockfile 生成版本不一致（corepack install 读取本地 package.json，无需硬编码版本）
RUN corepack enable && corepack install

# binutils 提供 strip，供 package:sea 注入前去掉符号表减小二进制（镜像同步受益）
RUN apk add --no-cache binutils

RUN pnpm install --frozen-lockfile
RUN pnpm run package:sea
# 由 ftl 生成 release 资产 locales.json（落在构建阶段根目录，不污染源码 locales/）。
RUN node tools/emit-locales-json.mjs locales.json

FROM alpine:3.20 AS runtime-sea

WORKDIR /app

ARG PHIRA_MP_VERSION

ENV NODE_ENV=production
ENV PHIRA_MP_HOME=/app
ENV PHIRA_MP_VERSION=${PHIRA_MP_VERSION}

RUN apk add --no-cache ca-certificates libstdc++ libgcc tzdata

COPY --from=build-sea /app/release/ ./
# release/ 已是单个可执行文件（locales 嵌入二进制、配置首启生成）。
# 容器侧仍显式附带由 ftl 生成的 locales.json，使首次启动直接读盘、无需在线拉取，避免被墙时的等待。
COPY --from=build-sea /app/locales.json ./locales/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chmod +x /app/phira-mp-server

EXPOSE 12346
EXPOSE 12347

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/app/phira-mp-server"]
