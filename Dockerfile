# syntax=docker/dockerfile:1

# ---------- 构建/校验阶段：拉源码、跑测试、产出 dist ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY index.html ./

# 镜像构建期即运行代码测试，测试不过则镜像不可交付
RUN node --test tests/*.test.mjs \
  && node scripts/build.mjs \
  && test -f dist/index.html

# ---------- verify 阶段：保留完整源码，供 compose verify 一次性流水线使用 ----------
FROM build AS verify
RUN chmod +x scripts/verify-pipeline.sh
# 由 docker-compose.yml 的 verify 服务通过 command 指定一次性流水线
CMD ["sh", "scripts/verify-pipeline.sh"]

# ---------- 运行时阶段：仅保留生产产物与静态服务器/健康探针 ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY package.json ./
COPY scripts/server.cjs scripts/healthcheck.mjs ./scripts/
COPY --from=build /app/dist ./dist

EXPOSE 8080
USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=4s --retries=5 \
  CMD node scripts/healthcheck.mjs http://127.0.0.1:8080 5 500 || exit 1

CMD ["node", "scripts/server.cjs"]
