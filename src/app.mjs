// app.mjs — 编辑器状态、本地求解调度与结果渲染（纯浏览器 ES Module）

import { normalizeModel, emptyModel, nextOptionId, SIDES, SIDE_CN } from './solver/model.mjs';
import { solve } from './solver/search.mjs';
import { renderGridSVG, describeOption } from './render.mjs';

const STORE_KEY = 'manifold-draft-v1';

// ---------------- 极简 DOM 构造器 ----------------
function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

// ---------------- 草稿状态 ----------------
function defaultDraft() {
  return emptyModel(2, 2);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultDraft();
    const parsed = JSON.parse(raw);
    const { model, errors } = normalizeModel(parsed);
    // 草稿允许“未完成”，但结构字段要可用；校验失败时仍保留原文数据用于编辑
    if (parsed && [2, 3].includes(Number(parsed.rows)) && [2, 3, 4].includes(Number(parsed.cols))) {
      return sanitizeDraft(parsed);
    }
    return defaultDraft();
  } catch {
    return defaultDraft();
  }
}

function sanitizeDraft(d) {
  const rows = Number(d.rows);
  const cols = Number(d.cols);
  const cells = [];
  for (let i = 0; i < rows * cols; i += 1) {
    const opts = Array.isArray(d.cells?.[i]?.options) ? d.cells[i].options : [];
    const fixed = opts
      .filter((o) => o && SIDES.includes(o.inSide) && SIDES.includes(o.outSide) && o.inSide !== o.outSide)
      .slice(0, 3)
      .map((o) => ({
        id: o.id || nextOptionId(),
        inSide: o.inSide, outSide: o.outSide,
        cost: Number.isFinite(+o.cost) ? Math.max(0, Math.trunc(+o.cost)) : 1,
      }));
    while (fixed.length < 2) {
      fixed.push({ id: nextOptionId(), inSide: 'W', outSide: 'E', cost: 1 });
    }
    cells.push({ options: fixed });
  }
  const terminals = Array.isArray(d.terminals)
    ? d.terminals
      .filter((t) => t && Number.isInteger(+t.row) && Number.isInteger(+t.col) && SIDES.includes(t.side)
        && (t.kind === 'source' || t.kind === 'sink'))
      .map((t, i) => ({
        id: t.id || `t${Date.now()}-${i}`,
        row: +t.row, col: +t.col, side: t.side, kind: t.kind,
        label: typeof t.label === 'string' ? t.label : '',
      }))
    : [];
  return { rows, cols, cells, terminals };
}

function saveDraft() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.draft)); } catch { /* 忽略存储异常 */ }
}

const state = { draft: loadDraft(), lastResult: null };

// ---------------- 示例 ----------------
const O = (inSide, outSide, cost = 1) => ({ id: nextOptionId(), inSide, outSide, cost });
const T = (row, col, side, kind, label) => ({ id: nextOptionId(), row, col, side, kind, label });

const EXAMPLE = {
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
};
// 复原结果：上下两行各一条 W→E 通路；行 1/行 4 采用第二候选（转弯方案虽便宜却会错配）。

// ---------------- 渲染：编辑器 ----------------
const gridMount = document.getElementById('grid-mount');
const terminalList = document.getElementById('terminal-list');

function rerenderEditor() {
  renderGrid();
  renderCellsEditor();
  renderTerminals();
}

function renderGrid() {
  gridMount.innerHTML = '';
  const d = state.draft;
  let highlight = null;
  if (state.lastResult && !state.lastResult.feasible) {
    const reason = state.lastResult.reason || {};
    highlight = (reason.cellIndex != null && reason.side)
      ? { cellIndex: reason.cellIndex, side: reason.side }
      : (reason.evidence?.length ? { cellIndex: reason.evidence[0] } : null);
  }
  const view = {
    rows: d.rows,
    cols: d.cols,
    terminals: d.terminals.map((t) => ({ ...t, label: t.label || defaultTermLabel(t) })),
    optionsByCell: d.cells.map((c) => c.options),
    choice: state.lastResult?.feasible ? state.lastResult.choice : null,
    paths: state.lastResult?.feasible ? state.lastResult.validation.paths : null,
    highlight,
  };
  gridMount.appendChild(renderGridSVG(view));
}

function defaultTermLabel(t) {
  const sameKind = state.draft.terminals.filter((x) => x.kind === t.kind);
  const n = sameKind.indexOf(t) + 1;
  return t.kind === 'source' ? `气源 ${n}` : `用气端 ${n}`;
}

function renderCellsEditor() {
  const host = document.getElementById('cells-editor-mount');
  host.innerHTML = '';
  const d = state.draft;
  d.cells.forEach((cell, i) => {
    const r = Math.floor(i / d.cols);
    const c = i % d.cols;
    const selectedIdx = state.lastResult?.feasible ? state.lastResult.choice[i] : null;

    const head = h('div', { class: 'cell-title' },
      h('span', {}, `格 (${r + 1}, ${c + 1}) 候选接头`),
      h('span', { class: 'cost-line' },
        cell.options.length < 3
          ? h('button', { class: 'btn ghost', onclick: () => addOption(i) }, '＋ 方案')
          : null,
      ),
    );

    const rows = [
      h('div', { class: 'opt-row head' },
        h('span', {}, '采用'), h('span', {}, '唯一进气边'), h('span', {}, '唯一出气边'),
        h('span', {}, '负担'), h('span', {}, '说明'), h('span', {}, '')),
    ];
    cell.options.forEach((o, k) => {
      const sideSelect = (val, onchange) => h('select', { onchange },
        SIDES.map((s) => h('option', { value: s, ...(s === val ? { selected: true } : {}) }, `${s} · ${SIDE_CN[s]}`)));
      rows.push(h('div', { class: `opt-row${selectedIdx === k ? ' chosen' : ''}` },
        h('span', {}, selectedIdx === k ? '✔' : (selectedIdx != null ? '·' : '')),
        sideSelect(o.inSide, (e) => { o.inSide = e.target.value; commit(); }),
        sideSelect(o.outSide, (e) => { o.outSide = e.target.value; commit(); }),
        h('input', {
          class: 'cost-input', type: 'number', min: '0', step: '1', value: String(o.cost),
          oninput: (e) => { o.cost = Math.max(0, Math.trunc(+e.target.value || 0)); },
          onchange: commit,
        }),
        h('span', { class: 'hint' }, describeOption(o)),
        cell.options.length > 2
          ? h('button', { class: 'btn ghost danger', title: '删除该方案', onclick: () => removeOption(i, k) }, '✕')
          : h('span', {}),
      ));
    });

    host.appendChild(h('div', { class: `cell-edit${selectedIdx != null ? ' selected' : ''}` }, head, ...rows));
  });
}

function renderTerminals() {
  terminalList.innerHTML = '';
  const d = state.draft;
  if (d.terminals.length === 0) {
    terminalList.appendChild(h('p', { class: 'hint' }, '尚未登记端子。至少登记 1 个气源端与 1 个用气端。'));
  }
  d.terminals.forEach((t) => {
    const boundaryHint = isOnBoundary(t) ? '' : '⚠ 非外缘';
    terminalList.appendChild(h('div', { class: 'terminal-row' },
      h('span', { class: `tag ${t.kind}` }, t.kind === 'source' ? '气源' : '用气'),
      h('input', {
        type: 'text', value: t.label,
        placeholder: t.kind === 'source' ? '气源名称' : '用气端名称',
        oninput: (e) => { t.label = e.target.value; saveDraft(); },
      }),
      h('span', { class: 'hint', style: boundaryHint ? 'color:var(--warn)' : '' }, boundaryHint || '行/列/边'),
      h('select', { title: '行', onchange: (e) => { t.row = +e.target.value; commit(); } },
        Array.from({ length: d.rows }, (_, k) => h('option', { value: k, ...(k === t.row ? { selected: true } : {}) }, `行${k + 1}`))),
      h('select', { title: '列', onchange: (e) => { t.col = +e.target.value; commit(); } },
        Array.from({ length: d.cols }, (_, k) => h('option', { value: k, ...(k === t.col ? { selected: true } : {}) }, `列${k + 1}`))),
      h('select', { title: '所在边', onchange: (e) => { t.side = e.target.value; commit(); } },
        SIDES.map((s) => h('option', { value: s, ...(s === t.side ? { selected: true } : {}) }, `${SIDE_CN[s]} ${s}`))),
      h('button', {
        class: 'btn ghost danger', title: '删除端子',
        onclick: () => { state.draft.terminals = state.draft.terminals.filter((x) => x !== t); commit(); },
      }, '✕'),
    ));
  });
}

function isOnBoundary(t) {
  const d = state.draft;
  return (t.side === 'N' && t.row === 0) || (t.side === 'S' && t.row === d.rows - 1)
    || (t.side === 'W' && t.col === 0) || (t.side === 'E' && t.col === d.cols - 1);
}

// ---------------- 变更动作 ----------------
function commit() {
  saveDraft();
  state.lastResult = null;
  document.getElementById('result-panel').hidden = true;
  rerenderEditor();
}

function addOption(cellIdx) {
  state.draft.cells[cellIdx].options.push({ id: nextOptionId(), inSide: 'N', outSide: 'S', cost: 1 });
  commit();
}
function removeOption(cellIdx, optIdx) {
  state.draft.cells[cellIdx].options.splice(optIdx, 1);
  commit();
}

function resizeGrid(rows, cols) {
  const old = state.draft;
  const next = { rows, cols, cells: [], terminals: [] };
  for (let i = 0; i < rows * cols; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const oldIdx = r * old.cols + c;
    const oldCell = r < old.rows && c < old.cols ? old.cells[oldIdx] : null;
    next.cells.push(oldCell
      ? { options: oldCell.options.map((o) => ({ ...o })) }
      : { options: [{ id: nextOptionId(), inSide: 'W', outSide: 'E', cost: 1 }, { id: nextOptionId(), inSide: 'N', outSide: 'S', cost: 1 }] });
  }
  next.terminals = old.terminals
    .filter((t) => t.row < rows && t.col < cols)
    .map((t) => ({ ...t }));
  state.draft = next;
  commit();
}

document.getElementById('rows-select').addEventListener('change', (e) => resizeGrid(+e.target.value, state.draft.cols));
document.getElementById('cols-select').addEventListener('change', (e) => resizeGrid(state.draft.rows, +e.target.value));
document.getElementById('load-example').addEventListener('click', () => {
  state.draft = JSON.parse(JSON.stringify(EXAMPLE));
  // 重新生成 id 无关紧要；直接使用
  commit();
  syncSizeSelects();
});
document.getElementById('clear-draft').addEventListener('click', () => {
  if (!confirm('清空当前草稿并恢复 2×2 空模板？')) return;
  state.draft = emptyModel(state.draft.rows, state.draft.cols);
  commit();
});
document.getElementById('add-source').addEventListener('click', () => addTerminal('source'));
document.getElementById('add-sink').addEventListener('click', () => addTerminal('sink'));

function addTerminal(kind) {
  const d = state.draft;
  // 默认放在第一个空闲外缘位
  outer:
  for (let r = 0; r < d.rows; r += 1) {
    for (let c = 0; c < d.cols; c += 1) {
      for (const side of SIDES) {
        const on = (side === 'N' && r === 0) || (side === 'S' && r === d.rows - 1)
          || (side === 'W' && c === 0) || (side === 'E' && c === d.cols - 1);
        if (!on) continue;
        if (d.terminals.some((t) => t.row === r && t.col === c && t.side === side)) continue;
        d.terminals.push({ id: nextOptionId(), row: r, col: c, side, kind, label: '' });
        commit();
        return;
      }
    }
  }
  alert('格网外缘已被端子占满，请先删除一个端子。');
}

document.getElementById('restore-btn').addEventListener('click', runRestore);

// ---------------- 复原 ----------------
function runRestore() {
  const panel = document.getElementById('result-panel');
  const body = document.getElementById('result-body');
  panel.hidden = false;
  body.innerHTML = '';

  const { model, errors } = normalizeModel(state.draft);
  if (errors.length) {
    state.lastResult = null;
    renderGrid();
    body.appendChild(h('div', { class: 'banner fail' }, '⚠️ 草稿数据不完整或不合法，未开始复原：'));
    const ul = h('ul', {}, errors.map((e) => h('li', {}, `${e.where ? `[${e.where}] ` : ''}${e.message}`)));
    body.appendChild(ul);
    body.appendChild(h('p', { class: 'draft-note' }, '草稿已保留，修正标红项后再次点击“复原”。'));
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const result = solve(model);
  state.lastResult = { ...result, model };

  if (result.feasible) renderSuccess(body, model, result);
  else renderFailure(body, model, result);

  rerenderEditor();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSuccess(body, model, result) {
  body.appendChild(h('div', { class: 'banner ok' },
    '✅ 已复原：全部接头配对成功，登记气源均送达指定用气端，全网无环。总改装负担 ',
    h('span', { class: 'big-cost' }, String(result.totalCost)),
    '（已取总负担最小的合规组合）。'));

  const left = h('div', {});
  const svgWrap = h('div', { class: 'path-card' });
  renderInto(svgWrap, model, result);
  left.appendChild(svgWrap);

  // 路径清单
  const pathCards = h('div', { class: 'path-list', style: 'margin-top:12px' });
  result.validation.paths.forEach((p, pi) => {
    const seq = p.cells.map((ci) => {
      const r = Math.floor(ci / model.cols);
      const c = ci % model.cols;
      return `格(${r + 1},${c + 1})`;
    }).join(' → ');
    pathCards.appendChild(h('div', { class: 'path-card' },
      h('div', { class: 'path-head' },
        h('span', {}, `🟢 路径 ${pi + 1}：${p.source.label} → ${p.sink?.label || '（未达用气端！）'}`),
        h('span', { class: 'cost-line' }, `${p.cells.length} 个模块`)),
      h('div', { class: 'path-seq' },
        h('b', {}, p.source.label), `（气源注入） → ${seq} → `, h('b', {}, p.sink?.label || '—'), '（用气受气）')));
  });
  left.appendChild(pathCards);

  // 右侧：采用/未采用清单
  const right = h('div', {});
  right.appendChild(h('h3', {}, '各格采用方案'));
  const adopted = h('div', { class: 'unused-list' });
  model.cells.forEach((cell, i) => {
    const r = Math.floor(i / model.cols);
    const c = i % model.cols;
    const chosen = cell.options[result.choice[i]];
    adopted.appendChild(h('div', { class: 'unused-group' },
      h('div', { class: 'gtitle' }, `格 (${r + 1},${c + 1})`),
      h('div', { class: 'unused-opt' }, `✔ ${describeOption(chosen)}，负担 ${chosen.cost}`)));
  });
  right.appendChild(adopted);

  right.appendChild(h('h3', { style: 'margin-top:14px' }, '未采用候选'));
  const unused = h('div', { class: 'unused-list' });
  let anyUnused = false;
  model.cells.forEach((cell, i) => {
    const r = Math.floor(i / model.cols);
    const c = i % model.cols;
    const items = cell.options
      .map((o, k) => ({ o, k }))
      .filter(({ k }) => k !== result.choice[i]);
    if (!items.length) return;
    anyUnused = true;
    unused.appendChild(h('div', { class: 'unused-group' },
      h('div', { class: 'gtitle' }, `格 (${r + 1},${c + 1})`),
      ...items.map(({ o }) => h('div', { class: 'unused-opt' }, h('strike', {}, `${describeOption(o)}，负担 ${o.cost}`)))));
  });
  if (!anyUnused) unused.appendChild(h('p', { class: 'hint' }, '每格均只有 2 个候选且已采用其一——本实例中无更多未采用项。'));
  right.appendChild(unused);

  body.appendChild(h('div', { class: 'result-grid' }, left, right));
}

function renderInto(host, model, result) {
  host.innerHTML = '';
  host.appendChild(renderGridSVG({
    rows: model.rows,
    cols: model.cols,
    terminals: model.terminals,
    optionsByCell: model.cells.map((c) => c.options),
    choice: result.choice,
    paths: result.validation.paths,
    highlight: null,
  }));
  const legend = h('div', { class: 'legend' },
    h('span', {}, h('span', { class: 'sw', style: 'background:#3a86b8' }), '进气段'),
    h('span', {}, h('span', { class: 'sw', style: 'background:#4cc2ff' }), '出气段（箭头为气流方向）'),
    h('span', {}, h('span', { class: 'sw', style: 'background:#ff8f6b' }), '气源'),
    h('span', {}, h('span', { class: 'sw', style: 'background:#7ee0a4' }), '用气端'),
    h('span', {}, h('span', { class: 'sw', style: 'background:#22384a' }), '封闭边'));
  host.appendChild(legend);
}

function renderFailure(body, model, result) {
  const reason = result.reason || {};
  renderGrid();

  body.appendChild(h('div', { class: 'banner fail' }, '❌ 不存在合规组合：无法在满足全部约束的前提下复原歧管。'));
  const ev = h('div', { class: 'evidence' },
    h('div', { class: 'ev-title' }, '证据（按格网顺序最早的失效位置，图中红圈标注）'),
    h('div', {}, reason.message || '所有候选组合均不成立。'));
  if (reason.evidence?.length) {
    ev.appendChild(h('div', { class: 'ev-path' },
      '回路链：' + reason.evidence.map((ci) => `格(${Math.floor(ci / model.cols) + 1},${(ci % model.cols) + 1})`).join(' → ')));
  }
  body.appendChild(ev);
  body.appendChild(h('p', { class: 'draft-note' }, '📝 你的草稿（格网、候选方案与端子登记）已原样保留，可据此调整候选接头或端子位置后再次复原。'));
}

// ---------------- 启动 ----------------
function syncSizeSelects() {
  document.getElementById('rows-select').value = String(state.draft.rows);
  document.getElementById('cols-select').value = String(state.draft.cols);
}

syncSizeSelects();
rerenderEditor();
