// scripts/healthcheck.mjs — 对运行中的前端服务做 HTTP 健康探测。
// 用法：node scripts/healthcheck.mjs [baseUrl] [次数] [间隔ms]
// 退出码：探测成功 0；超时/非 200 非 0（供 Docker HEALTHCHECK 使用）。
const base = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 8080}`;
const tries = Number(process.argv[3] || 10);
const gapMs = Number(process.argv[4] || 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastErr = '';
for (let i = 1; i <= tries; i += 1) {
  try {
    const res = await fetch(`${base}/healthz`, { signal: AbSignal(2000) });
    if (res.ok) {
      const body = await res.text();
      console.log(`✓ 健康探测成功（第 ${i}/${tries} 次）：${base}/healthz → ${body.trim()}`);
      process.exit(0);
    }
    lastErr = `HTTP ${res.status}`;
  } catch (err) {
    lastErr = err.message;
  }
  process.stdout.write(`… 等待服务就绪（${i}/${tries}，${lastErr}）\n`);
  await sleep(gapMs);
}
console.error(`✗ 健康探测失败：${base}/healthz 在 ${tries} 次尝试后仍不可用（${lastErr}）`);
process.exit(1);

function AbSignal(ms) {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  return ctl.signal;
}
