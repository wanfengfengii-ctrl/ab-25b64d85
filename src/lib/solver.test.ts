import { describe, expect, it } from 'vitest';
import {
  solve,
  validateProblem,
  type Option,
  type Problem,
  type Side,
  type Terminal,
} from './solver';

function opt(id: string, inlet: Side, outlet: Side, cost: number): Option {
  return { id, inlet, outlet, cost };
}

function term(cell: number, side: Side, kind: 'gas' | 'load'): Terminal {
  return { cell, side, kind };
}

function problem(
  rows: number,
  cols: number,
  cells: Option[][],
  terminals: Terminal[],
): Problem {
  return { rows, cols, cells, terminals };
}

describe('validateProblem', () => {
  it('拒绝超出 2~3 行 / 2~4 列的格网', () => {
    const p = problem(4, 2, [], []);
    expect(validateProblem(p).some((e) => e.message.includes('行'))).toBe(true);
  });

  it('要求每格 2~3 个候选、进出气边互异、负担非负整数', () => {
    const p = problem(2, 2, [[opt('A', 'W', 'E', 1)], [], [], []], [
      term(0, 'W', 'gas'),
      term(3, 'E', 'load'),
    ]);
    const errors = validateProblem(p);
    expect(errors.some((e) => e.cell === 0 && e.message.includes('2 至 3'))).toBe(true);
    expect(
      validateProblem(
        problem(2, 2, [[opt('A', 'W', 'W', -1), opt('B', 'N', 'S', 1)], [], [], []], []),
      ).some((e) => e.cell === 0),
    ).toBe(true);
  });

  it('端只能登记在格网外边且不可重复', () => {
    const p = problem(2, 2, [[], [], [], []], [
      term(0, 'S', 'gas'), // S 是与 c2 的共享边，不是外边
      term(0, 'S', 'load'),
    ]);
    const errors = validateProblem(p);
    expect(errors.some((e) => e.message.includes('外边'))).toBe(true);
    expect(errors.some((e) => e.message.includes('重复'))).toBe(true);
  });
});

describe('solve — 典型歧管复原（2×2 双气源双用端）', () => {
  //  g0 → [c0] → [c1] → l0
  //  g1 → [c2] → [c3] → l1
  const p = problem(
    2,
    2,
    [
      [opt('A', 'W', 'E', 3), opt('B', 'N', 'E', 5)],
      [opt('A', 'W', 'E', 2), opt('B', 'W', 'S', 4)],
      [opt('A', 'W', 'E', 4), opt('B', 'E', 'W', 6)],
      [opt('A', 'W', 'E', 1), opt('B', 'N', 'E', 7)],
    ],
    [term(0, 'W', 'gas'), term(1, 'E', 'load'), term(2, 'W', 'gas'), term(3, 'E', 'load')],
  );

  it('联合选中全部模块方案并给出最小格序合规组合与总负担', () => {
    const r = solve(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chosen.map((c) => c.option.id)).toEqual(['A', 'A', 'A', 'A']);
    expect(r.totalCost).toBe(10);
  });

  it('所有登记气源都形成到用气端的无环路径且覆盖全部格', () => {
    const r = solve(p);
    if (!r.ok) throw new Error('应当有解');
    expect(r.paths).toHaveLength(2);
    expect(r.paths[0]).toMatchObject({ gasIndex: 0, loadIndex: 0, cells: [0, 1] });
    expect(r.paths[1]).toMatchObject({ gasIndex: 1, loadIndex: 1, cells: [2, 3] });
    // 跳数：气源→首格、格间、末格→用端
    expect(r.paths[0].hops.map((h) => h.side)).toEqual(['W', 'E', 'E']);
  });
});

describe('solve — 气源误接回自身', () => {
  // 气源登记在 c0 西侧，但 c0 的候选方案西向都是出气边
  const p = problem(
    2,
    2,
    [
      [opt('A', 'E', 'W', 3), opt('B', 'S', 'W', 5)],
      [opt('A', 'W', 'E', 2), opt('B', 'W', 'S', 4)],
      [opt('A', 'W', 'E', 4), opt('B', 'E', 'W', 6)],
      [opt('A', 'W', 'E', 1), opt('B', 'N', 'E', 7)],
    ],
    [term(0, 'W', 'gas'), term(1, 'E', 'load'), term(2, 'W', 'gas'), term(3, 'E', 'load')],
  );

  it('判定为不存在合规组合，并指向最早无法配对的接头', () => {
    const r = solve(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnosis.kind).toBe('unmatched');
    if (r.diagnosis.kind !== 'unmatched') return;
    expect(r.diagnosis.cell).toBe(0);
    expect(r.diagnosis.side).toBe('W');
    expect(r.diagnosis.summary).toContain('误接回自身');
    expect(r.diagnosis.tried).toHaveLength(2);
  });
});

describe('solve — 按格网顺序定位最早冲突', () => {
  // c0 候选均合规；c1 的两个候选都把朝上的封闭外端打开
  const p = problem(
    2,
    2,
    [
      [opt('A', 'N', 'E', 1), opt('B', 'N', 'E', 2)],
      [opt('A', 'W', 'N', 3), opt('B', 'S', 'N', 4)],
      [opt('A', 'W', 'E', 4), opt('B', 'N', 'S', 6)],
      [opt('A', 'N', 'S', 1), opt('B', 'W', 'S', 7)],
    ],
    [term(0, 'N', 'gas'), term(3, 'S', 'load')],
  );

  it('报告第 1 行第 2 列（cell=1）上边而不是更后面的格', () => {
    const r = solve(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnosis.kind).toBe('unmatched');
    if (r.diagnosis.kind !== 'unmatched') return;
    expect(r.diagnosis.cell).toBe(1);
    expect(r.diagnosis.side).toBe('N');
    expect(r.diagnosis.summary).toContain('第 1 行第 2 列');
  });
});

describe('solve — 闭合回路取证（3×3）', () => {
  // 上路：g0 → c0 → c1 → c2 → l0
  // 右路：g1 → c5 → c8 → l1
  // c3→c4→c7→c6→c3 自相闭环，与任何气源/用端无关
  const p = problem(
    3,
    3,
    [
      [opt('A', 'N', 'E', 1), opt('B', 'N', 'E', 9)], // c0
      [opt('A', 'W', 'E', 2), opt('B', 'W', 'E', 8)], // c1
      [opt('A', 'W', 'E', 3), opt('B', 'W', 'E', 7)], // c2
      [opt('A', 'S', 'E', 4), opt('B', 'S', 'E', 6)], // c3
      [opt('A', 'W', 'S', 5), opt('B', 'W', 'S', 6)], // c4
      [opt('A', 'E', 'S', 2), opt('B', 'E', 'S', 9)], // c5
      [opt('A', 'E', 'N', 1), opt('B', 'E', 'N', 9)], // c6
      [opt('A', 'N', 'W', 2), opt('B', 'N', 'W', 8)], // c7
      [opt('A', 'N', 'E', 3), opt('B', 'N', 'E', 7)], // c8
    ],
    [
      term(0, 'N', 'gas'),
      term(2, 'E', 'load'),
      term(5, 'E', 'gas'),
      term(8, 'E', 'load'),
    ],
  );

  it('不存在合规组合，并给出导致回路的路径证据', () => {
    const r = solve(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnosis.kind).toBe('cycle');
    if (r.diagnosis.kind !== 'cycle') return;
    expect(new Set(r.diagnosis.cycle)).toEqual(new Set([3, 4, 6, 7]));
    expect(r.diagnosis.evidence).toHaveLength(4);
    // 证据首尾相接
    for (let i = 0; i < 4; i += 1) {
      expect(r.diagnosis.evidence[i].to).toBe(
        r.diagnosis.evidence[(i + 1) % 4].from,
      );
    }
  });
});

describe('solve — 出气接入进气的共享边约束', () => {
  it('两侧同为出气或同为进气都不能算合规', () => {
    // c0 出气朝东，c1 进气必须在西；这里 c1 两个候选进气都不在西
    const p = problem(
      2,
      2,
      [
        [opt('A', 'W', 'E', 1), opt('B', 'W', 'E', 2)],
        [opt('A', 'E', 'N', 1), opt('B', 'E', 'S', 2)],
        [opt('A', 'W', 'S', 1), opt('B', 'W', 'N', 2)],
        [opt('A', 'N', 'S', 1), opt('B', 'W', 'S', 2)],
      ],
      [term(0, 'W', 'gas'), term(3, 'S', 'load')],
    );
    const r = solve(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnosis.kind).toBe('unmatched');
    if (r.diagnosis.kind !== 'unmatched') return;
    // c0→c1 共享边（c0 东 / c1 西）对不上
    expect(r.diagnosis.cell).toBe(1);
  });
});
