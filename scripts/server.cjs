// scripts/server.cjs — 零依赖静态服务器：
//   环境变量：
//     PORT         监听端口（默认 8080）
//     SERVE_ROOT   静态根目录（默认 dist，不存在时回退项目根以支持开发模式）
//   GET /healthz 固定返回 200 JSON，供 Docker HEALTHCHECK / compose verify 使用。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PG_PORT || process.env.PORT || 8080);
let ROOT = process.env.SERVE_ROOT
  ? path.resolve(process.env.SERVE_ROOT)
  : path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  ROOT = path.resolve(__dirname, '..'); // 开发模式：直接服务源码与 index.html
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), root: ROOT }));
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[manifold] 静态服务已启动：http://0.0.0.0:${PORT}（根目录 ${ROOT}）`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
