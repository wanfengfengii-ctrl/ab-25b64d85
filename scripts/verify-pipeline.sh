#!/bin/sh
# scripts/verify-pipeline.sh — compose verify 一次性服务的门禁流水线：
#   代码测试 → 生产构建 → 健康 HTTP 探测 → 典型歧管复原冒烟
# 任一步失败即以非零退出码结束容器。
set -eu

WEB_URL="${VERIFY_TARGET_URL:-http://web:8080}"

echo "──────── [1/4] 代码测试"
node --test tests/*.test.mjs

echo "──────── [2/4] 生产构建"
node scripts/build.mjs
test -f dist/index.html

echo "──────── [3/4] 健康 HTTP 探测：${WEB_URL}/healthz"
node scripts/healthcheck.mjs "${WEB_URL}" 30 500

echo "──────── [4/4] 典型歧管复原冒烟（目标 ${WEB_URL}）"
SMOKE_BASE_URL="${WEB_URL}" node scripts/smoke.mjs

echo "──────── verify 流水线全部通过 ✅"
