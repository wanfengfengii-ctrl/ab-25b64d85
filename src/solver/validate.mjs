// solver/validate.mjs — 给定每格方案选择后的全网校验
//
// 物理语义：格网外的气源向歧管注入，因此气源端子所在外缘边必须是该格的
// 进气边；用气端所在外缘边必须是该格的出气边。内部共享边严格
// “出气 → 进气”对接，两个走向（左→右 / 右→左 等）均可。
//
// 校验四件事：
//   1. 所有开启端口都恰好配对（内部边双侧齐开且方向相反，或双侧齐闭）；
//   2. 共享边方向严格为出气接入进气；
//   3. 每个登记端子参与，且不允许存在未登记的外缘开启端口；
//   4. 全网只形成从气源到用气端的无环路径（每格都落在某条 source→sink 路径上）。

import { neighborOf, opposite } from './model.mjs';

// 生成所有“配对位”：内部共享边（E/S 边发起登记一次）+ 格网外缘边。
export function pairingSlots(model) {
  const slots = [];
  const { rows, cols } = model;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      for (const side of ['N', 'E', 'S', 'W']) {
        const nb = neighborOf(r, c, side, rows, cols);
        if (nb) {
          if (side === 'E' || side === 'S') {
            slots.push({
              kind: 'inner',
              a: { r, c, side },
              b: { r: nb[0], c: nb[1], side: opposite(side) },
            });
          }
        } else {
          slots.push({ kind: 'boundary', a: { r, c, side }, b: null });
        }
      }
    }
  }
  return slots;
}

const SIDE_CN = { N: '上', E: '右', S: '下', W: '左' };
const ROLE_CN = { in: '进气', out: '出气' };

// 主校验。choice: number[]，每格选中的方案下标。
// 返回 { ok, issues:[...已按格网顺序排序...], paths }
export function validateSelection(model, choice) {
  const issues = [];
  const { rows, cols } = model;
  const cellIndexAt = (r, c) => r * cols + c;

  const optionAt = (i) => model.cells[i].options[choice[i]];
  const role = (r, c, side) => {
    const o = optionAt(cellIndexAt(r, c));
    if (o.inSide === side) return 'in';
    if (o.outSide === side) return 'out';
    return null;
  };
  // 格网顺序键：格序 ×4 + 边序（N<E<S<W）
  const orderOf = (p) => cellIndexAt(p.r, p.c) * 4 + { N: 0, E: 1, S: 2, W: 3 }[p.side];

  const terminalAt = new Map();
  for (const t of model.terminals) terminalAt.set(`${t.row},${t.col},${t.side}`, t);

  // ---------- 1/2/3：逐配对位检查 ----------
  const validInnerArcs = new Set(); // "from->to" 方向正确的内部弧
  let structuralErrors = 0;

  for (const slot of pairingSlots(model)) {
    const ra = role(slot.a.r, slot.a.c, slot.a.side);
    if (slot.kind === 'inner') {
      const rb = role(slot.b.r, slot.b.c, slot.b.side);
      if (ra === null && rb === null) continue;
      const openEnd = ra === null ? slot.b : slot.a;
      if (ra === null || rb === null) {
        structuralErrors += 1;
        issues.push({
          code: 'UNPAIRED_PORT',
          order: orderOf(openEnd),
          cellIndex: cellIndexAt(openEnd.r, openEnd.c),
          side: openEnd.side,
          message: `格 (${openEnd.r + 1},${openEnd.c + 1}) 的${SIDE_CN[openEnd.side]}边开启端口，但相邻格对应边封闭，无法配对`,
        });
        continue;
      }
      if (ra === rb) {
        // out-out：两气源侧对吹；in-in：两侧都等待来气
        structuralErrors += 1;
        issues.push({
          code: 'WRONG_DIRECTION',
          order: orderOf(slot.a),
          cellIndex: cellIndexAt(slot.a.r, slot.a.c),
          side: slot.a.side,
          message: `格 (${slot.a.r + 1},${slot.a.c + 1})${SIDE_CN[slot.a.side]}边与格 (${slot.b.r + 1},${slot.b.c + 1})${SIDE_CN[slot.b.side]}边均为${ROLE_CN[ra]}：共享边必须由出气接入进气，对接会把气流反向顶回`,
        });
        continue;
      }
      // 一进一出：记录气流方向
      if (ra === 'out') validInnerArcs.add(`${cellIndexAt(slot.a.r, slot.a.c)}->${cellIndexAt(slot.b.r, slot.b.c)}`);
      else validInnerArcs.add(`${cellIndexAt(slot.b.r, slot.b.c)}->${cellIndexAt(slot.a.r, slot.a.c)}`);
    } else {
      const { r, c, side } = slot.a;
      const key = `${r},${c},${side}`;
      const terminal = terminalAt.get(key);
      if (ra === null) {
        if (terminal) {
          structuralErrors += 1;
          issues.push({
            code: 'TERMINAL_NOT_SERVED',
            order: orderOf(slot.a),
            cellIndex: cellIndexAt(r, c),
            side,
            terminal: terminal.id,
            message: `登记${terminal.kind === 'source' ? '气源' : '用气'}端「${terminal.label}」所在的外缘边封闭，该端未参与供气`,
          });
        }
      } else if (!terminal) {
        structuralErrors += 1;
        issues.push({
          code: 'UNREGISTERED_OPEN',
          order: orderOf(slot.a),
          cellIndex: cellIndexAt(r, c),
          side,
          message: `格 (${r + 1},${c + 1}) 的${SIDE_CN[side]}外缘边有未登记的开启端口，所有开启端口必须恰好配对`,
        });
      } else {
        // 气源侧须为进气（外部注入歧管），用气侧须为出气
        const need = terminal.kind === 'source' ? 'in' : 'out';
        if (ra !== need) {
          structuralErrors += 1;
          issues.push({
            code: 'TERMINAL_WRONG_ROLE',
            order: orderOf(slot.a),
            cellIndex: cellIndexAt(r, c),
            side,
            terminal: terminal.id,
            message: `「${terminal.label}」一侧接头为${ROLE_CN[ra]}：${terminal.kind === 'source' ? '气源由外部注入，该边必须是进气边（否则等于把歧管气流回灌气源）' : '用气端受气，该边必须是出气边'}`,
          });
        }
      }
    }
  }

  // ---------- 4：气流动能图（每格唯一出气边 → 至多一条出弧）----------
  const N = rows * cols;
  const SOURCE = N;
  const SINK = N + 1;
  const adj = Array.from({ length: N + 2 }, () => []);
  for (let i = 0; i < N; i += 1) {
    const o = optionAt(i);
    const r = Math.floor(i / cols);
    const c = i % cols;
    const nb = neighborOf(r, c, o.outSide, rows, cols);
    adj[i].push(nb ? cellIndexAt(nb[0], nb[1]) : SINK);
    if (o.inSide !== o.outSide) {
      const inNb = neighborOf(r, c, o.inSide, rows, cols);
      if (!inNb) adj[SOURCE].push(i);
    }
  }
  // 注意：inSide === outSide（同边直通）时无法在同一物理边上同时进出，
  // 配对位检查必然已报冲突（该边只有一个角色），此处不另建 SOURCE 弧。

  // ---------- 回路检测（每格出度恰为 1 的功能图：走指针即可找环）----------
  let cycle = null;
  if (structuralErrors === 0) {
    const seen = new Array(N).fill(0); // 0 未访问, 1 在当前路径, 2 已完成
    for (let start = 0; start < N && !cycle; start += 1) {
      if (seen[start] !== 0) continue;
      const path = [];
      const pos = new Map();
      let u = start;
      while (u !== SINK && seen[u] === 0) {
        seen[u] = 1;
        pos.set(u, path.length);
        path.push(u);
        u = adj[u][0];
      }
      if (u !== SINK && seen[u] === 1) {
        const s = pos.get(u);
        cycle = path.slice(s).concat(u);
        issues.push({
          code: 'CYCLE',
          order: 1_000_000_000 + u,
          cellIndex: u,
          evidence: cycle,
          message: `形成闭合回路：${cycle.map((i) => `格(${Math.floor(i / cols) + 1},${(i % cols) + 1})`).join(' → ')}，气流必须自气源至用气端无环`,
        });
      }
      path.forEach((x) => { seen[x] = 2; });
    }
  }

  // ---------- 路径追踪与全覆盖核对 ----------
  let paths = null;
  if (structuralErrors === 0 && !cycle) {
    paths = tracePaths(model, choice, adj, SOURCE, SINK);
    for (const p of paths.problems) issues.push(p);
  }

  issues.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { ok: issues.length === 0, issues, paths: paths?.paths || null };
}

function cellLabel(i, cols) {
  return `格(${Math.floor(i / cols) + 1},${(i % cols) + 1})`;
}

// 沿功能图自每个气源追踪至用气端；核对汇合、漏气、未达用气端与全覆盖。
function tracePaths(model, choice, adj, SOURCE, SINK) {
  const { rows, cols } = model;
  const N = rows * cols;
  const problems = [];
  const paths = [];
  const owner = new Map(); // cellIndex -> pathIndex

  const sourceStarts = model.terminals
    .filter((t) => t.kind === 'source')
    .map((t) => ({ terminal: t, cell: t.row * cols + t.col }));

  sourceStarts.forEach(({ terminal: src, cell: startIdx }, pi) => {
    const seq = [];
    let cur = startIdx;
    const localSeen = new Set();
    let endSink = null;
    while (cur !== SINK) {
      if (localSeen.has(cur)) break; // 理论上已被 cycle 检查拦截
      localSeen.add(cur);
      if (owner.has(cur) && owner.get(cur) !== pi) {
        problems.push({
          code: 'PATH_MERGE',
          order: 1_000_001_000 + cur,
          cellIndex: cur,
          evidence: seq.concat(cur),
          message: `${cellLabel(cur, cols)}被多条供气路径汇合共用，全网只能为彼此独立的气源→用气端路径`,
        });
      } else {
        owner.set(cur, pi);
      }
      seq.push(cur);
      const nxt = adj[cur][0];
      if (nxt === SINK) {
        const o = model.cells[cur].options[choice[cur]];
        endSink = model.terminals.find(
          (t) => t.kind === 'sink' && t.row === Math.floor(cur / cols)
            && t.col === cur % cols && t.side === o.outSide,
        ) || null;
        break;
      }
      cur = nxt;
    }
    if (!endSink) {
      problems.push({
        code: 'PATH_NO_SINK',
        order: 1_000_002_000 + startIdx,
        cellIndex: startIdx,
        evidence: seq,
        message: `自气源「${src.label}」的路径未送达任何登记用气端`,
      });
    }
    paths.push({ source: src, sink: endSink, cells: seq });
  });

  // 每个用气端恰被一条路径送达
  const reachedSinks = new Set(paths.map((p) => p.sink?.id).filter(Boolean));
  for (const sn of model.terminals.filter((t) => t.kind === 'sink')) {
    if (!reachedSinks.has(sn.id)) {
      problems.push({
        code: 'SINK_UNREACHED',
        order: 1_000_003_000 + sn.row * cols + sn.col,
        message: `用气端「${sn.label}」未被任何气源路径送达，全部登记气源必须送达指定用气端`,
      });
    }
  }
  // 每个格都必须属于某条路径（无游离管段/独立回路）
  for (let i = 0; i < N; i += 1) {
    if (!owner.has(i)) {
      problems.push({
        code: 'DETACHED_CELL',
        order: 1_000_004_000 + i,
        cellIndex: i,
        message: `${cellLabel(i, cols)}的管路未与任何气源连通，全网只能由气源→用气端路径组成`,
      });
    }
  }

  return { paths, problems };
}
