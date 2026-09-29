// 应急供氧歧管复原求解器（纯本地计算，无任何网络请求）
//
// 规则：
// 1. 每个模块格选择恰好一个候选接头方案；方案声明唯一进气边与唯一出气边。
// 2. 相邻格共享边只能「出气 → 进气」对接；两边必须同时开启或同时封闭。
// 3. 所有开启端口恰好配对：朝外的开启端口必须对接登记的气源端（入）或用气端（出）。
// 4. 每个登记端都必须参与；全网只能形成从气源到用气端的无环路径
//    （因此气源不可能被接回自身，也不允许模块自行成环）。

export type Side = 'N' | 'E' | 'S' | 'W';

export const SIDES: Side[] = ['N', 'E', 'S', 'W'];

export const SIDE_LABEL: Record<Side, string> = {
  N: '上边',
  E: '右边',
  S: '下边',
  W: '左边',
};

export interface Option {
  id: string;
  /** 唯一进气边 */
  inlet: Side;
  /** 唯一出气边 */
  outlet: Side;
  /** 改装负担 */
  cost: number;
}

export type TerminalKind = 'gas' | 'load';

export interface Terminal {
  cell: number;
  side: Side;
  kind: TerminalKind;
}

export interface Problem {
  rows: number;
  cols: number;
  /** 按格网顺序（先行后列）排列的每格候选方案，2~3 个 */
  cells: Option[][];
  /** 格网外边登记的气源端 / 用气端 */
  terminals: Terminal[];
}

export interface ValidationError {
  message: string;
  cell?: number;
  side?: Side;
}

export type Endpoint =
  | { kind: 'gas'; index: number }
  | { kind: 'load'; index: number }
  | { kind: 'cell'; cell: number };

export interface Hop {
  from: Endpoint;
  to: Endpoint;
  /** 该跳在模块格上使用的边（气源→首格为进气边，其余为出气边） */
  side: Side;
}

export interface ManifoldPath {
  gasIndex: number;
  loadIndex: number;
  cells: number[];
  hops: Hop[];
}

export interface ChosenOption {
  cell: number;
  optionIndex: number;
  option: Option;
}

export interface Solution {
  ok: true;
  chosen: ChosenOption[];
  totalCost: number;
  paths: ManifoldPath[];
}

export interface TriedConflict {
  optionId: string;
  detail: string;
}

export type Diagnosis =
  | {
      kind: 'unmatched';
      cell: number;
      side: Side;
      summary: string;
      tried: TriedConflict[];
    }
  | {
      kind: 'cycle';
      cycle: number[];
      summary: string;
      evidence: { from: number; to: number; side: Side }[];
    };

export interface Failure {
  ok: false;
  diagnosis: Diagnosis;
}

export type SolveResult = Solution | Failure;

/** 气源端 / 用气端按（格序, 边序）排序后的编号顺序，供求解与界面标号共用。 */
export function terminalOrder(p: Problem): { gas: Terminal[]; load: Terminal[] } {
  const byKey = (a: Terminal, b: Terminal) =>
    a.cell - b.cell || SIDE_RANK[a.side] - SIDE_RANK[b.side];
  return {
    gas: p.terminals.filter((t) => t.kind === 'gas').sort(byKey),
    load: p.terminals.filter((t) => t.kind === 'load').sort(byKey),
  };
}

const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const SIDE_RANK: Record<Side, number> = { N: 0, E: 1, S: 2, W: 3 };

function rowCol(p: Problem, cell: number): [number, number] {
  return [Math.floor(cell / p.cols), cell % p.cols];
}

function neighborCell(p: Problem, cell: number, side: Side): number | null {
  const [r, c] = rowCol(p, cell);
  if (side === 'N') return r === 0 ? null : cell - p.cols;
  if (side === 'S') return r === p.rows - 1 ? null : cell + p.cols;
  if (side === 'W') return c === 0 ? null : cell - 1;
  return c === p.cols - 1 ? null : cell + 1;
}

function isBoundarySide(p: Problem, cell: number, side: Side): boolean {
  return neighborCell(p, cell, side) === null;
}

/** 录入数据的结构校验；求解规则本身在 solve 中判定。 */
export function validateProblem(p: Problem): ValidationError[] {
  const errors: ValidationError[] = [];
  if (p.rows < 2 || p.rows > 3) errors.push({ message: '行数必须为 2 或 3' });
  if (p.cols < 2 || p.cols > 4) errors.push({ message: '列数必须为 2 至 4' });

  p.cells.forEach((opts, cell) => {
    if (opts.length < 2 || opts.length > 3) {
      errors.push({ message: '每格必须提供 2 至 3 个候选接头方案', cell });
      return;
    }
    const ids = new Set<string>();
    opts.forEach((o) => {
      if (o.inlet === o.outlet) {
        errors.push({
          message: `方案 ${o.id} 的进气边与出气边不能相同（各须唯一）`,
          cell,
        });
      }
      if (!Number.isFinite(o.cost) || o.cost < 0 || !Number.isInteger(o.cost)) {
        errors.push({ message: `方案 ${o.id} 的改装负担必须为非负整数`, cell });
      }
      if (ids.has(o.id)) errors.push({ message: `方案编号 ${o.id} 在同一格内重复`, cell });
      ids.add(o.id);
    });
  });

  const portSeen = new Set<string>();
  let gas = 0;
  let load = 0;
  for (const t of p.terminals) {
    if (t.cell < 0 || t.cell >= p.cells.length) {
      errors.push({ message: '登记端指向了不存在的模块格', cell: t.cell, side: t.side });
      continue;
    }
    const key = `${t.cell}:${t.side}`;
    if (portSeen.has(key)) {
      errors.push({ message: '同一外边端口不能重复登记', cell: t.cell, side: t.side });
      continue;
    }
    portSeen.add(key);
    if (!isBoundarySide(p, t.cell, t.side)) {
      errors.push({ message: '气源/用气端只能登记在格网外边', cell: t.cell, side: t.side });
    }
    if (t.kind === 'gas') gas += 1;
    else load += 1;
  }
  if (gas === 0) errors.push({ message: '至少需要登记一个气源端' });
  if (load === 0) errors.push({ message: '至少需要登记一个用气端' });

  return errors;
}

function epNode(ep: Endpoint): string {
  if (ep.kind === 'cell') return `c${ep.cell}`;
  if (ep.kind === 'gas') return `g${ep.index}`;
  return `l${ep.index}`;
}

interface RawConflict {
  cell: number;
  side: Side;
  optionIndex: number;
  optionId: string;
  detail: string;
}

/**
 * 联合选择全部模块方案。按格网顺序深度优先搜索，候选方案按录入顺序尝试；
 * 返回找到的第一套合规组合（负担合计一并给出）。
 */
export function solve(p: Problem): SolveResult {
  const n = p.rows * p.cols;

  // 终端索引：气源与用气端分别按 (格, 边) 顺序编号
  const gasList = p.terminals
    .filter((t) => t.kind === 'gas')
    .sort((a, b) => a.cell - b.cell || SIDE_RANK[a.side] - SIDE_RANK[b.side]);
  const loadList = p.terminals
    .filter((t) => t.kind === 'load')
    .sort((a, b) => a.cell - b.cell || SIDE_RANK[a.side] - SIDE_RANK[b.side]);
  const terminalAt = new Map<string, Terminal & { index: number }>();
  gasList.forEach((t, index) => terminalAt.set(`${t.cell}:${t.side}`, { ...t, index }));
  loadList.forEach((t, index) => terminalAt.set(`${t.cell}:${t.side}`, { ...t, index }));

  const assignment: (Option | null)[] = Array(n).fill(null);
  const conflicts: RawConflict[] = [];
  // 「全部端口配对成功的完整指派」下仍残留的、脱离气源路径的闭环证据
  const fullLeafCycles: {
    cycle: number[];
    evidence: { from: number; to: number; side: Side }[];
  }[] = [];

  // 已指派部分的有向邻接：气源/格 → 下一格/用气端
  const succ = new Map<string, string>();

  function roleOf(cell: number, side: Side): 'in' | 'out' | 'closed' {
    const o = assignment[cell]!;
    if (o.inlet === side) return 'in';
    if (o.outlet === side) return 'out';
    return 'closed';
  }

  function recordConflict(c: RawConflict) {
    conflicts.push(c);
  }

  /** 检查 cell 与已指派邻居 / 外端的配对，返回该候选被拒原因（null 表示通过）。 */
  function localCheck(cell: number, o: Option, optionIndex: number): string | null {
    for (const side of SIDES) {
      const role: 'in' | 'out' | 'closed' =
        o.inlet === side ? 'in' : o.outlet === side ? 'out' : 'closed';
      const nb = neighborCell(p, cell, side);

      if (nb === null) {
        // 朝外端口
        const t = terminalAt.get(`${cell}:${side}`);
        if (role === 'closed') {
          if (t) {
            const d =
              t.kind === 'gas'
                ? `登记在${SIDE_LABEL[side]}的气源端未被该方案开启，气源无法接入`
                : `登记在${SIDE_LABEL[side]}的用气端未被该方案开启，无法送达`;
            recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
            return d;
          }
          continue;
        }
        if (!t) {
          const d = `${SIDE_LABEL[side]}是朝外的开启端口，但未登记气源端或用气端，无法配对`;
          recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
          return d;
        }
        if (t.kind === 'gas' && role !== 'in') {
          const d = `气源端接在${SIDE_LABEL[side]}，但该方案此边为出气边，会把气源误接回自身`;
          recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
          return d;
        }
        if (t.kind === 'load' && role !== 'out') {
          const d = `用气端接在${SIDE_LABEL[side]}，但该方案此边为进气边，气体无法送达用气端`;
          recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
          return d;
        }
        continue;
      }

      // 与邻居的共享边：仅当上/左邻居已指派时可立即判定
      const neighborAssigned = assignment[nb] !== null;
      if (!neighborAssigned) continue;
      const nRole = roleOf(nb, OPPOSITE[side]);
      if (role === 'closed' && nRole === 'closed') continue;
      if (role === 'closed' || nRole === 'closed') {
        const d = `共享边一侧开启（${role === 'closed' ? '邻格' : '本格'}出气/进气）而另一侧封闭，开启端口无法配对`;
        recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
        return d;
      }
      if (role === nRole) {
        const d =
          role === 'out'
            ? `共享边两侧都是出气边，气体无法对接（要求出气接入进气）`
            : `共享边两侧都是进气边，没有气体来源（要求出气接入进气）`;
        recordConflict({ cell, side, optionIndex, optionId: o.id, detail: d });
        return d;
      }
    }
    return null;
  }

  /** 指派 cell 后写入有向边，并检测已指派子图是否因此成环。 */
  function edgesFor(cell: number, o: Option) {
    const edges: { from: string; to: string }[] = [];
    const inNb = neighborCell(p, cell, o.inlet);
    if (inNb === null) {
      const t = terminalAt.get(`${cell}:${o.inlet}`);
      if (t && t.kind === 'gas') edges.push({ from: epNode({ kind: 'gas', index: t.index }), to: `c${cell}` });
    } else if (assignment[inNb]) {
      edges.push({ from: `c${inNb}`, to: `c${cell}` });
    }
    const outNb = neighborCell(p, cell, o.outlet);
    if (outNb === null) {
      const t = terminalAt.get(`${cell}:${o.outlet}`);
      if (t && t.kind === 'load') edges.push({ from: `c${cell}`, to: epNode({ kind: 'load', index: t.index }) });
    } else if (assignment[outNb]) {
      edges.push({ from: `c${cell}`, to: `c${outNb}` });
    }
    return edges;
  }

  function buildFullSuccessor() {
    succ.clear();
    for (let c = 0; c < n; c += 1) {
      const o = assignment[c]!;
      for (const e of edgesFor(c, o)) succ.set(e.from, e.to);
    }
  }

  function follow(start: string): string[] {
    const seq: string[] = [];
    let cur = start;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      seq.push(cur);
      cur = succ.get(cur) as string;
    }
    return seq;
  }

  function makeResult(): Solution | null {
    buildFullSuccessor();
    const reachedCells = new Set<number>();
    const reachedLoads = new Set<number>();
    const paths: ManifoldPath[] = [];

    for (let gi = 0; gi < gasList.length; gi += 1) {
      const seq = follow(`g${gi}`);
      const last = seq[seq.length - 1];
      if (!last || last[0] !== 'l') return null; // 未抵达用气端
      const loadIndex = Number(last.slice(1));
      if (reachedLoads.has(loadIndex)) return null; // 同一用端被重复抵达
      reachedLoads.add(loadIndex);
      const cells: number[] = [];
      const hops: Hop[] = [];
      for (let i = 0; i < seq.length - 1; i += 1) {
        const a = seq[i];
        const b = seq[i + 1];
        const toEp: Endpoint =
          b[0] === 'c' ? { kind: 'cell', cell: Number(b.slice(1)) } : { kind: 'load', index: Number(b.slice(1)) };
        if (a[0] === 'g') {
          const cell = Number(b.slice(1));
          hops.push({ from: { kind: 'gas', index: gi }, to: toEp, side: assignment[cell]!.inlet });
        } else {
          const cell = Number(a.slice(1));
          hops.push({ from: { kind: 'cell', cell }, to: toEp, side: assignment[cell]!.outlet });
        }
        if (b[0] === 'c') cells.push(Number(b.slice(1)));
      }
      cells.forEach((c) => reachedCells.add(c));
      paths.push({ gasIndex: gi, loadIndex, cells, hops });
    }

    if (reachedLoads.size !== loadList.length) return null; // 有用端未参与

    if (reachedCells.size !== n) {
      // 端口全部配对、气路也合法，但仍有模块脱离气源路径：沿出边找到闭环取证
      let start = -1;
      for (let c = 0; c < n; c += 1) {
        if (!reachedCells.has(c)) {
          start = c;
          break;
        }
      }
      const seq: string[] = [];
      const seen = new Set<string>();
      let cur = `c${start}`;
      while (!seen.has(cur)) {
        seen.add(cur);
        seq.push(cur);
        cur = succ.get(cur) as string;
      }
      const loopStart = seq.indexOf(cur);
      const cycle = seq.slice(loopStart).map((x) => Number(x.slice(1)));
      const evidence = cycle.map((from, i) => ({
        from,
        to: i + 1 < cycle.length ? cycle[i + 1] : cycle[0],
        side: assignment[from]!.outlet,
      }));
      fullLeafCycles.push({ cycle, evidence });
      return null;
    }

    const chosen: ChosenOption[] = [];
    let totalCost = 0;
    for (let c = 0; c < n; c += 1) {
      const idx = p.cells[c].findIndex((o) => o.id === assignment[c]!.id);
      chosen.push({ cell: c, optionIndex: idx, option: assignment[c]! });
      totalCost += assignment[c]!.cost;
    }
    return { ok: true, chosen, totalCost, paths };
  }

  function dfs(cell: number): Solution | null {
    if (cell === n) return makeResult();
    const options = p.cells[cell];
    for (let oi = 0; oi < options.length; oi += 1) {
      const o = options[oi];
      if (localCheck(cell, o, oi) !== null) continue;
      assignment[cell] = o;
      const r = dfs(cell + 1);
      if (r) return r;
      assignment[cell] = null;
    }
    return null;
  }

  const answer = dfs(0);
  if (answer) return answer;

  // 若存在「所有开启端口都恰好配对、登记端也齐全」的完整指派，唯一缺陷是
  // 部分模块脱离气源路径自行成环，则给出导致回路的路径证据。
  if (fullLeafCycles.length > 0) {
    fullLeafCycles.sort((a, b) => Math.min(...a.cycle) - Math.min(...b.cycle));
    return {
      ok: false,
      diagnosis: {
        kind: 'cycle',
        cycle: fullLeafCycles[0].cycle,
        summary:
          '所有候选方案都能让端口两两配对，但部分模块会脱离气源路径自行闭合成环，气流无法从气源到达用气端。',
        evidence: fullLeafCycles[0].evidence,
      },
    };
  }

  // 否则指出按格网顺序（先行后列）最早无法配对的接头，并列出该格各候选的被拒原因。
  if (conflicts.length > 0) {
    conflicts.sort(
      (a, b) =>
        a.cell - b.cell ||
        SIDE_RANK[a.side] - SIDE_RANK[b.side] ||
        a.optionIndex - b.optionIndex,
    );
    const first = conflicts[0];
    const atCell = conflicts.filter((c) => c.cell === first.cell);
    const tried: TriedConflict[] = [];
    for (const c of atCell) {
      if (!tried.some((t) => t.optionId === c.optionId && t.detail === c.detail)) {
        tried.push({ optionId: c.optionId, detail: c.detail });
      }
    }
    const [r, col] = rowCol(p, first.cell);
    return {
      ok: false,
      diagnosis: {
        kind: 'unmatched',
        cell: first.cell,
        side: first.side,
        summary: `按格网顺序最早无法配对的接头位于第 ${r + 1} 行第 ${col + 1} 列的${SIDE_LABEL[first.side]}：${first.detail}。`,
        tried,
      },
    };
  }

  // 理论上不可达：配对与成环检查已覆盖全部不合规情形
  return {
    ok: false,
    diagnosis: {
      kind: 'unmatched',
      cell: 0,
      side: 'N',
      summary: '不存在合规组合，但未能定位具体冲突，请检查格网与登记端数据。',
      tried: [],
    },
  };
}
