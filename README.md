# 深海载人舱 · 应急供氧歧管复原台

更换可拆模块后，在浏览器中复原一套合规的接头朝向。全部计算仅在本地浏览器完成，
**没有后端、不发起任何网络请求**；草稿保存在浏览器 `localStorage`。

## 复原规则

1. 每个模块格从 2–3 个候选接头方案中联合选择恰好一个；每个方案声明
   **唯一进气边**、**唯一出气边**与**改装负担**（非负整数）。
2. 相邻格共享边必须严格「出气 → 进气」对接；两侧必须同时开启或同时封闭，
   开启的端口都要恰好配对，不允许悬空。
3. 格网外边登记气源端（只能对接进气边）与用气端（只能对接出气边），
   每个登记端都必须参与。气源端对接出气边会被明确判为「把气源误接回自身」。
4. 全网只允许形成从气源到用气端的**无环路径**；模块脱离气源自行闭合成环时不合规。
5. 找到合规组合后展示：每格采用方案、逐条气源→用气端路径、全部未采用候选、总改装负担。
6. 不存在合规组合时**保留草稿**，并指出：
   - 按格网顺序（先行后列）**最早无法配对的接头**及该格各候选被拒原因；或
   - 一条**导致回路的路径证据**（沿出气边首尾相接的格序列）。

格网规模：2–3 行、2–4 列。

## 本地开发

```bash
npm install
npm run dev       # 开发服务器
npm test          # vitest 单元测试（求解器 + 界面挂载）
npm run build     # tsc 类型检查 + 生产构建到 dist/
npm run smoke     # 典型歧管复原冒烟（成功 / 误接回自身 / 闭环取证）
```

## Docker

前端为 nginx 静态服务，内置 `GET /healthz` 健康检查端点（返回 `200 ok`）。

```bash
# 宿主机端口可用 HOST_PORT 配置（默认 8080）
HOST_PORT=9090 docker compose up -d --build web
curl -s http://localhost:9090/healthz   # → ok
```

一次性校验服务 `verify` 依次执行：代码测试 → 生产构建 → 对 web 服务的健康 HTTP 探测
→ 典型歧管复原冒烟，任一步失败即以非零退出码结束：

```bash
docker compose run --rm verify
```

`verify` 通过 `depends_on: condition: service_healthy` 等待前端服务健康后才开始探测。

## 目录结构

```
src/lib/solver.ts    复原求解器（纯函数，浏览器与冒烟共用）
src/lib/draft.ts     草稿模型、内置示例、本地持久化
src/components/      格网棋盘等展示组件
src/App.tsx          录入 / 复原 / 结果与诊断页面
scripts/smoke.ts     典型复原冒烟
scripts/verify.sh    verify 服务编排（测试·构建·探测·冒烟）
Dockerfile           deps → build（verify 使用）→ nginx runtime（web 使用）
docker-compose.yml   web（健康检查 + 可配置宿主端口）与 verify
```
