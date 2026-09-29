# syntax=docker/dockerfile:1

# ---- 依赖 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建 / verify 一次性服务使用此阶段 ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 前端运行时：nginx 静态服务 + 健康检查端点 ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
