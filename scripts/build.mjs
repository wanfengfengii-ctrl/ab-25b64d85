// scripts/build.mjs — 零依赖生产构建：
//   1. 递归收集 src 下 ES 模块，做一次极简打包（import/export 改写，按依赖序求值）；
//   2. 产物写入 dist/，文件名带内容哈希，供长期缓存；
//   3. index.html 改写为带哈希的产物引用。
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

function hash(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 10);
}

// ---------- 模块收集与改写 ----------
function loadModule(file, registry) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  if (registry.has(rel)) return registry.get(rel);
  let code = readFileSync(file, 'utf8');
  const deps = [];

  // import { a, b as c } from './x.mjs'
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?/g, (m, names, spec) => {
    const depFile = resolve(dirname(file), spec);
    const depRel = relative(SRC, depFile).replace(/\\/g, '/');
    deps.push(depRel);
    const destruct = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.split(/\s+as\s+/).map((x) => x.trim()).join(': ').replace(/^(\w+)$/, '$1'))
      .join(', ');
    return `const { ${destruct} } = __modules[${JSON.stringify(depRel)}];`;
  });

  // export function/const/class  → 去掉 export 前缀，名字记入导出表
  const exported = [];
  code = code.replace(/export\s+(async\s+)?(function|const|let|class)\s+([A-Za-z0-9_$]+)/g, (m, asyncKw, kind, name) => {
    exported.push(name);
    return `${asyncKw || ''}${kind} ${name}`;
  });
  // export { a, b }; 形式
  code = code.replace(/export\s*\{([^}]*)\}\s*;?/g, (m, names) => {
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
      exported.push(alias || orig);
    });
    return '';
  });
  // export default（本项目不用，稳妥拒绝）
  if (/export\s+default/.test(code)) throw new Error(`暂不支持 export default：${rel}`);

  const rec = { rel, file, code, deps, exported };
  registry.set(rel, rec);
  for (const d of deps) loadModule(join(SRC, d), registry);
  return rec;
}

function topoOrder(registry) {
  const order = [];
  const state = new Map();
  const visit = (rel) => {
    const s = state.get(rel);
    if (s === 2) return;
    if (s === 1) throw new Error('模块存在循环依赖：' + rel);
    state.set(rel, 1);
    for (const d of registry.get(rel).deps) visit(d);
    state.set(rel, 2);
    order.push(rel);
  };
  for (const rel of registry.keys()) visit(rel);
  return order;
}

function bundle(entryRel, registry) {
  const order = topoOrder(registry).filter((rel) => {
    // 只打包从入口可达的模块
    return reachable(entryRel, registry).has(rel);
  });
  let out = '// 自动生成，请勿手改。由 scripts/build.mjs 打包。\n';
  out += 'const __modules = {};\n';
  for (const rel of order) {
    const m = registry.get(rel);
    out += `\n// ===== module: ${rel} =====\n`;
    out += `__modules[${JSON.stringify(rel)}] = (() => {\n`;
    out += m.code.replace(/^\n/, '') + '\n';
    out += `return { ${[...new Set(m.exported)].join(', ')} };\n`;
    out += '})();\n';
  }
  return out;
}

function reachable(entryRel, registry) {
  const seen = new Set([entryRel]);
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    for (const d of registry.get(rel).deps) {
      if (!seen.has(d)) { seen.add(d); stack.push(d); }
    }
  }
  return seen;
}

// ---------- 执行 ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'assets'), { recursive: true });

const registry = new Map();
const entry = join(SRC, 'app.mjs');
loadModule(entry, registry);
const js = bundle('app.mjs', registry);
const jsName = `app.${hash(js)}.js`;
writeFileSync(join(DIST, 'assets', jsName), js);

const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
const cssName = `styles.${hash(css)}.css`;
writeFileSync(join(DIST, 'assets', cssName), css);

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
html = html.replace('/src/styles.css', `/assets/${cssName}`);
html = html.replace('/src/app.mjs', `/assets/${jsName}`);
writeFileSync(join(DIST, 'index.html'), html);

// 健康检查端点由服务器内置；附带静态副本说明
writeFileSync(join(DIST, 'BUILD-INFO.txt'),
  `build=${new Date().toISOString()}\nentry=${jsName}\ncss=${cssName}\nmodules=${[...registry.keys()].join(',')}\n`);

console.log(`✓ 构建完成：dist/assets/${jsName}（${registry.size} 个模块，${js.length} 字节）`);
console.log(`✓ 样式：dist/assets/${cssName}`);
