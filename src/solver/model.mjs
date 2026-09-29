// solver/model.mjs — 歧管网格模型与校验
//
// 方向约定（屏幕视角）：N=上, E=右, S=下, W=左。
// 每个接头方案有唯一进气边 inSide 与唯一出气边 outSide（允许同一边，
// 表示直通/穿舱接头）；其余两条边为封闭边。

export const SIDES = ['N', 'E', 'S', 'W'];
export const SIDE_INDEX = { N: 0, E: 1, S: 2, W: 3 };

export const SIDE_CN = { N: '上', E: '右', S: '下', W: '左' };

// 对边
export function opposite(side) {
  return { N: 'S', S: 'N', E: 'W', W: 'E' }[side];
}

// 某格某一侧相邻格的格号，越界返回 null
export function neighborOf(r, c, side, rows, cols) {
  if (side === 'N') return r > 0 ? [r - 1, c] : null;
  if (side === 'S') return r < rows - 1 ? [r + 1, c] : null;
  if (side === 'W') return c > 0 ? [r, c - 1] : null;
  return c < cols - 1 ? [r, c + 1] : null;
}

export function isSide(v) {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

export function isPosInt(v) {
  return Number.isInteger(v) && v >= 0;
}

let _uid = 0;
export function nextOptionId() {
  _uid += 1;
  return `o${_uid}`;
}

// 规范化并校验录入模型。返回 { model, errors:[{where,message}] }。
// 输入形态：
// { rows, cols, cells:[{ options:[{id?,inSide,outSide,cost}] }], length rows*cols（行优先）,
//   terminals:[{id?, side, kind:'source'|'sink', label?}] }
// 端子 side 指该格“朝外”的边（格网外缘）。
export function normalizeModel(input) {
  const errors = [];
  const push = (where, message) => errors.push({ where, message });

  const rows = Number(input?.rows);
  const cols = Number(input?.cols);
  if (![2, 3].includes(rows)) push('rows', '行数须为 2 或 3');
  if (![2, 3, 4].includes(cols)) push('cols', '列数须为 2 至 4');
  if (errors.length) return { model: null, errors };

  if (!Array.isArray(input.cells) || input.cells.length !== rows * cols) {
    push('cells', `需要 ${rows * cols} 个格的方案数据`);
    return { model: null, errors };
  }

  const cells = [];
  for (let i = 0; i < rows * cols; i += 1) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const rawOpts = input.cells[i]?.options;
    if (!Array.isArray(rawOpts) || rawOpts.length < 2 || rawOpts.length > 3) {
      push(`cell ${i}`, `格 (${r + 1},${c + 1}) 须提供 2 至 3 个候选方案`);
      cells.push({ options: [] });
      continue;
    }
    const options = [];
    const seen = new Set();
    rawOpts.forEach((o, k) => {
      const where = `cell ${i} option ${k}`;
      if (!o || !isSide(o.inSide)) { push(where, '进气边须为 N/E/S/W'); return; }
      if (!isSide(o.outSide)) { push(where, '出气边须为 N/E/S/W'); return; }
      if (o.inSide === o.outSide) { push(where, '进气边与出气边不能是同一条边（一条物理边无法同时进出）'); return; }
      if (!isPosInt(o.cost)) { push(where, '改装负担须为非负整数'); return; }
      const sig = `${o.inSide}->${o.outSide}`;
      if (seen.has(sig)) { push(where, `重复方案 ${sig}（同格方案须互不相同）`); return; }
      seen.add(sig);
      options.push({ id: o.id || nextOptionId(), inSide: o.inSide, outSide: o.outSide, cost: o.cost });
    });
    cells.push({ options });
  }

  if (!Array.isArray(input.terminals) || input.terminals.length < 2) {
    push('terminals', '至少登记 1 个气源端与 1 个用气端');
    return { model: null, errors: errors.length ? errors : [{ where: 'terminals', message: '端子数据不完整' }] };
  }

  const terminals = [];
  const occupied = new Set(); // 已登记的外缘边 "r,c,side"
  let nSource = 0;
  let nSink = 0;
  input.terminals.forEach((t, k) => {
    const where = `terminal ${k}`;
    const r = Number(t?.row);
    const c = Number(t?.col);
    if (!Number.isInteger(r) || r < 0 || r >= rows) { push(where, '端子行号越界'); return; }
    if (!Number.isInteger(c) || c < 0 || c >= cols) { push(where, '端子列号越界'); return; }
    if (!isSide(t.side)) { push(where, '端子所在边须为 N/E/S/W'); return; }
    const onBoundary
      = (t.side === 'N' && r === 0) || (t.side === 'S' && r === rows - 1)
      || (t.side === 'W' && c === 0) || (t.side === 'E' && c === cols - 1);
    if (!onBoundary) { push(where, `格 (${r + 1},${c + 1}) 的${SIDE_CN[t.side]}边不在格网外缘，不能登记端子`); return; }
    if (t.kind !== 'source' && t.kind !== 'sink') { push(where, '端子类型须为 source 或 sink'); return; }
    const key = `${r},${c},${t.side}`;
    if (occupied.has(key)) { push(where, '同一条外缘边已登记端子，不能重复占用'); return; }
    occupied.add(key);
    if (t.kind === 'source') nSource += 1; else nSink += 1;
    terminals.push({
      id: t.id || `t${k}`,
      row: r, col: c, side: t.side, kind: t.kind,
      label: typeof t.label === 'string' && t.label.trim() ? t.label.trim()
        : (t.kind === 'source' ? `气源 ${nSource}` : `用气端 ${nSink}`),
    });
  });

  if (nSource === 0) push('terminals', '至少需要 1 个气源端');
  if (nSink === 0) push('terminals', '至少需要 1 个用气端');

  if (errors.length) return { model: null, errors };
  return { model: { rows, cols, cells, terminals }, errors: [] };
}

// 空模型（用于初始化编辑器）
export function emptyModel(rows = 2, cols = 2) {
  const cells = [];
  for (let i = 0; i < rows * cols; i += 1) {
    cells.push({
      options: [
        { id: nextOptionId(), inSide: 'W', outSide: 'E', cost: 1 },
        { id: nextOptionId(), inSide: 'N', outSide: 'S', cost: 1 },
      ],
    });
  }
  return { rows, cols, cells, terminals: [] };
}
