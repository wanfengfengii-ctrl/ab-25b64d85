import {
  SIDES,
  SIDE_LABEL,
  type Option,
  type Problem,
  type Side,
  type Terminal,
  terminalOrder,
} from './solver';

export interface DraftOption extends Option {}

export interface DraftTerminal {
  uid: string;
  cell: number;
  side: Side;
  kind: 'gas' | 'load';
}

export interface Draft {
  rows: number;
  cols: number;
  /** 按格网顺序排列的每格候选方案 */
  options: DraftOption[][];
  terminals: DraftTerminal[];
}

export const STORAGE_KEY = 'manifold-restorer-draft-v1';

export function cellLabel(cols: number, cell: number): string {
  const r = Math.floor(cell / cols) + 1;
  const c = (cell % cols) + 1;
  return `第${r}行第${c}列`;
}

export function cellShort(cell: number, cols: number): string {
  return `R${Math.floor(cell / cols) + 1}C${(cell % cols) + 1}`;
}

export function isOuterSide(rows: number, cols: number, cell: number, side: Side): boolean {
  const r = Math.floor(cell / cols);
  const c = cell % cols;
  if (side === 'N') return r === 0;
  if (side === 'S') return r === rows - 1;
  if (side === 'W') return c === 0;
  return c === cols - 1;
}

export function outerSides(rows: number, cols: number, cell: number): Side[] {
  return SIDES.filter((s) => isOuterSide(rows, cols, cell, s));
}

export function toProblem(draft: Draft): Problem {
  const terminals: Terminal[] = draft.terminals.map((t) => ({
    cell: t.cell,
    side: t.side,
    kind: t.kind,
  }));
  return { rows: draft.rows, cols: draft.cols, cells: draft.options, terminals };
}

let uidCounter = 0;
export function newUid(prefix = 't'): string {
  uidCounter += 1;
  return `${prefix}${Date.now().toString(36)}${uidCounter}`;
}

function makeOptions(spec: [string, Side, Side, number][]): DraftOption[] {
  return spec.map(([id, inlet, outlet, cost]) => ({ id, inlet, outlet, cost }));
}

/** 内置示例：2×2 双气源双用端，存在合规组合。 */
export function exampleDraft(): Draft {
  return {
    rows: 2,
    cols: 2,
    options: [
      makeOptions([
        ['A', 'W', 'E', 3],
        ['B', 'N', 'E', 5],
      ]),
      makeOptions([
        ['A', 'W', 'E', 2],
        ['B', 'W', 'S', 4],
      ]),
      makeOptions([
        ['A', 'W', 'E', 4],
        ['B', 'E', 'W', 6],
      ]),
      makeOptions([
        ['A', 'W', 'E', 1],
        ['B', 'N', 'E', 7],
      ]),
    ],
    terminals: [
      { uid: newUid(), cell: 0, side: 'W', kind: 'gas' },
      { uid: newUid(), cell: 1, side: 'E', kind: 'load' },
      { uid: newUid(), cell: 2, side: 'W', kind: 'gas' },
      { uid: newUid(), cell: 3, side: 'E', kind: 'load' },
    ],
  };
}

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d && d.options?.length === d.rows * d.cols) return d;
    }
  } catch {
    // 草稿损坏时回退到示例
  }
  return exampleDraft();
}

export function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // 本地存储不可用时静默：草稿仍保留在页面内存中
  }
}

/** 终端对外标号：与求解器的内部编号一致（按格序、边序）。 */
export function terminalLabels(p: Problem) {
  const { gas, load } = terminalOrder(p);
  const gasNo = new Map<string, number>();
  const loadNo = new Map<string, number>();
  gas.forEach((t, i) => gasNo.set(`${t.cell}:${t.side}`, i + 1));
  load.forEach((t, i) => loadNo.set(`${t.cell}:${t.side}`, i + 1));
  const label = (t: Terminal): string => {
    const k = `${t.cell}:${t.side}`;
    const no = t.kind === 'gas' ? gasNo.get(k) : loadNo.get(k);
    return `${t.kind === 'gas' ? '气源' : '用气端'}#${no}（${cellLabel(p.cols, t.cell)}·${SIDE_LABEL[t.side]}）`;
  };
  return { gas, load, gasNo, loadNo, label };
}
