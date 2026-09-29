#!/bin/sh
# Compose 中 verify 一次性服务的入口：任一步失败即以非零退出码结束。
set -eu

cd /app

echo "== [1/4] 代码测试（vitest） =="
npm test -- --run

echo "== [2/4] 生产构建（tsc + vite build） =="
npm run build

echo "== [3/4] 前端服务健康 HTTP 探测（${HEALTH_URL:-http://web/healthz}） =="
URL="${HEALTH_URL:-http://web/healthz}"
ok=0
i=0
while [ "$i" -lt 30 ]; do
  body="$(wget -q -O - "$URL" 2>/dev/null || true)"
  if [ "$body" = "ok" ]; then
    ok=1
    break
  fi
  i=$((i + 1))
  echo "  等待前端服务就绪（$i/30）…"
  sleep 2
done
if [ "$ok" -ne 1 ]; then
  echo "健康探测失败：$URL 未返回 ok" >&2
  exit 1
fi
echo "健康探测通过：$URL → ok"

echo "== [4/4] 典型歧管复原冒烟 =="
npm run smoke

echo
echo "verify 全部通过：测试 / 生产构建 / 健康探测 / 复原冒烟"
