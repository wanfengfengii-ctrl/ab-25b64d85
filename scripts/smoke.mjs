// scripts/smoke.mjs — 典型歧管复原冒烟。
//
// 两种用法：
//   node scripts/smoke.mjs                     自行启动 dist 静态服务后冒烟
//   SMOKE_BASE_URL=http://app:8080 node ...    对指定服务冒烟（compose verify 用）
//
// 冒烟内容：
//   1. GET /healthz 健康 HTTP 探测；
//   2. GET / 与带哈希的 JS/CSS 产物，校验引用与可解析性；
//   3. 在最小 DOM 垫片中真实执行生产 JS 产物，载入“典型双气源歧管”草稿，
//      程序化点击「复原」，断言成功横幅、总负担、路径与未采用清单出现；
//   4. 换一个必成环的草稿再次复原，断言不可行横幅与草稿保留。

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 典型草稿 ----------------
const O = (inSide, outSide, cost = 1) => ({ id: `o${Math.random().toString(36).slice(2)}`, inSide, outSide, cost });
const T = (row, col, side, kind, label) => ({ id: `t${Math.random().toString(36).slice(2)}`, row, col, side, kind, label });

const typicalDraft = () => ({
  rows: 2, cols: 3,
  cells: [
    { options: [O('W', 'E', 1), O('N', 'S', 2), O('W', 'S', 3)] },
    { options: [O('N', 'S', 2), O('W', 'E', 3), O('S', 'N', 4)] },
    { options: [O('W', 'E', 1), O('S', 'W', 2), O('N', 'E', 4)] },
    { options: [O('W', 'E', 1), O('N', 'S', 2), O('N', 'E', 3)] },
    { options: [O('N', 'S', 1), O('W', 'E', 4), O('E', 'N', 2)] },
    { options: [O('W', 'E', 1), O('N', 'S', 3), O('N', 'W', 2)] },
  ],
  terminals: [
    T(0, 0, 'W', 'source', '主气源 O₂-A'),
    T(1, 0, 'W', 'source', '备用气瓶 O₂-B'),
    T(0, 2, 'E', 'sink', '舱内呼吸面罩'),
    T(1, 2, 'E', 'sink', '应急呼吸袋'),
  ],
});

// 2x3 强制成环草稿：格 0-1-4-3 闭环（配对均可成立但整体闭合），格 2-5 为独立通路
const cycleDraft = () => ({
  rows: 2, cols: 3,
  cells: [
    { options: [O('S', 'E'), O('W', 'N', 5)] },
    { options: [O('W', 'S'), O('N', 'E', 5)] },
    { options: [O('N', 'S'), O('W', 'E', 5)] },
    { options: [O('E', 'N'), O('W', 'S', 5)] },
    { options: [O('N', 'W'), O('S', 'E', 5)] },
    { options: [O('N', 'E'), O('W', 'S', 5)] },
  ],
  terminals: [
    T(0, 2, 'N', 'source', 'S1'),
    T(1, 2, 'E', 'sink', 'K1'),
  ],
});

// ---------------- 最小 DOM 垫片 ----------------
function makeDom(initialStorage) {
  const store = new Map(Object.entries(initialStorage || {}));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const makeNode = (tag, ns) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      namespaceURI: ns || null,
      children: [],
      attrs: {},
      style: {},
      dataset: {},
      _listeners: {},
      className: '',
      value: '',
      textContent: '',
      _innerHTML: '',
      hidden: false,
      get innerHTML() { return node._innerHTML; },
      set innerHTML(v) { node._innerHTML = String(v); if (v === '') node.children.length = 0; },
      setAttribute(k, v) { node.attrs[k] = String(v); },
      getAttribute(k) { return node.attrs[k] ?? null; },
      removeAttribute(k) { delete node.attrs[k]; },
      appendChild(child) { node.children.push(child); return child; },
      append(...kids) { kids.forEach((k) => node.appendChild(k)); },
      addEventListener(type, fn) { (node._listeners[type] ||= []).push(fn); },
      click(ev) { (node._listeners.click || []).forEach((fn) => fn(ev || { target: node })); },
      scrollIntoView() {},
    };
    return node;
  };

  const byId = new Map();
  const document = {
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, makeNode('div'));
      return byId.get(id);
    },
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => makeNode(tag, ns),
    createTextNode: (text) => {
      const n = makeNode('#text');
      n.textContent = String(text);
      return n;
    },
  };

  const collectText = (node, out = []) => {
    if (node.textContent) out.push(node.textContent);
    for (const ch of node.children || []) collectText(ch, out);
    return out;
  };

  return { localStorage, document, byId, store, collectText };
}

async function runBundleInDom(jsCode, draft) {
  const dom = makeDom({ 'manifold-draft-v1': JSON.stringify(draft) });
  const context = {
    dom,
    document: dom.document,
    localStorage: dom.localStorage,
    window: {},
    console,
    confirm: () => true,
    alert: () => {},
    setTimeout, clearTimeout, AbortController,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(jsCode, context, { filename: 'app.bundle.js' });

  // 点击复原
  const btn = dom.byId.get('restore-btn');
  if (!btn || !btn._listeners.click?.length) throw new Error('页面未挂载「复原」按钮处理器');
  btn.click();

  const resultPanel = dom.byId.get('result-panel');
  const body = dom.byId.get('result-body');
  return {
    panelShown: resultPanel.hidden === false,
    text: dom.collectText(body).join(' '),
    draftKept: dom.store.has('manifold-draft-v1'),
  };
}

// ---------------- 冒烟主流程 ----------------
export async function runSmoke(baseUrl) {
  console.log(`── 冒烟目标：${baseUrl}`);

  // 1) 健康探测
  let health = null;
  for (let i = 1; i <= 20; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) { health = await r.json(); break; }
    } catch { /* 重试 */ }
    await sleep(300);
  }
  if (!health) throw new Error('健康 HTTP 探测失败：/healthz 持续不可用');
  console.log('✓ /healthz 返回 200：', JSON.stringify(health));

  // 2) 首页与产物
  const indexRes = await fetch(`${baseUrl}/`);
  if (indexRes.status !== 200) throw new Error(`首页 HTTP ${indexRes.status}`);
  const html = await indexRes.text();
  const jsMatch = html.match(/src="(\/assets\/app\.[a-f0-9]+\.js)"/);
  const cssMatch = html.match(/href="(\/assets\/styles\.[a-f0-9]+\.css)"/);
  if (!jsMatch || !cssMatch) throw new Error('index.html 未正确引用带哈希的构建产物');
  if (!html.includes('应急供氧歧管')) throw new Error('首页标题异常');

  const jsRes = await fetch(`${baseUrl}${jsMatch[1]}`);
  if (jsRes.status !== 200) throw new Error(`JS 产物 HTTP ${jsRes.status}`);
  const jsCode = await jsRes.text();
  new vm.Script(jsCode, { filename: jsMatch[1] }); // 语法校验
  const cssRes = await fetch(`${baseUrl}${cssMatch[1]}`);
  if (cssRes.status !== 200 || !(await cssRes.text()).includes('--accent')) {
    throw new Error('CSS 产物异常');
  }
  console.log(`✓ 首页与产物可达：${jsMatch[1]}（${jsCode.length} 字节，语法校验通过）`);

  // 3) 典型复原：成功
  const okRun = await runBundleInDom(jsCode, typicalDraft());
  if (!okRun.panelShown) throw new Error('复原后结果面板未展示');
  for (const needle of ['已复原', '总改装负担', '11', '主气源 O₂-A', '舱内呼吸面罩', '未采用候选']) {
    if (!okRun.text.includes(needle)) throw new Error(`成功复原结果缺少内容：「${needle}」；实际：${okRun.text.slice(0, 300)}`);
  }
  console.log('✓ 典型双气源歧管复原成功：横幅/总负担 11/两条路径/未采用清单均呈现');

  // 4) 必成环草稿：失败且保留草稿
  const badRun = await runBundleInDom(jsCode, cycleDraft());
  if (!badRun.text.includes('不存在合规组合')) throw new Error('环网草稿应判定不可行');
  if (!badRun.text.includes('回路')) throw new Error('环网草稿应给出回路证据');
  if (!badRun.draftKept) throw new Error('不可行时草稿必须保留');
  console.log('✓ 环网草稿正确判定不可行，给出回路链证据且草稿保留');

  console.log('── 冒烟全部通过');
  return true;
}

// 独立运行：自行启动静态服务
async function main() {
  const base = process.env.SMOKE_BASE_URL;
  let child = null;
  let baseUrl = base;
  if (!baseUrl) {
    const port = 8090 + Math.floor(Math.random() * 100);
    mkdirSync(join(ROOT, 'dist'), { recursive: true });
    child = spawn(process.execPath, ['scripts/server.cjs'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), SERVE_ROOT: join(ROOT, 'dist') },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  }
  try {
    await runSmoke(baseUrl);
    process.exit(0);
  } catch (err) {
    console.error('✗ 冒烟失败：', err.message);
    process.exitCode = 1;
  } finally {
    if (child) child.kill('SIGTERM');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
