/**
 * 典型歧管复原冒烟（verify 一次性服务的最后一步，按退出码结束）。
 * 直接调用与浏览器完全相同的本地求解器：
 *  1. 典型 2×3 双气源 → 双用端复原成功；
 *  2. 气源误接回自身时给出最早无法配对接头；
 *  3. 闭环组合给出回路路径证据。
 */
import {
  solve,
  validateProblem,
  type Option,
  type Problem,
  type Side,
  type Terminal,
} from '../src/lib/solver';

function opt(id: string, inlet: Side, outlet: Side, cost: number): Option {
  return { id, inlet, outlet, cost };
}
function t(cell: number, side: Side, kind: 'gas' | 'load'): Terminal {
  return { cell, side, kind };
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- 用例 1：2×3 典型复原 -------------------------------------------------
// g0 → c0 → c1 → c2 → l0
// g1 → c3 → c4 → c5 → l1
const typical: Problem = {
  rows: 2,
  cols: 3,
  cells: [
    [opt('A', 'W', 'E', 3), opt('B', 'N', 'E', 9)],
    [opt('A', 'W', 'E', 2), opt('B', 'N', 'S', 8)],
    [opt('A', 'W', 'E', 4), opt('B', 'W', 'N', 7)],
    [opt('A', 'W', 'E', 1), opt('B', 'N', 'E', 6)],
    [opt('A', 'W', 'E', 5), opt('B', 'E', 'N', 4)],
    [opt('A', 'W', 'E', 2), opt('B', 'N', 'W', 9)],
  ],
  terminals: [
    t(0, 'W', 'gas'),
    t(2, 'E', 'load'),
    t(3, 'W', 'gas'),
    t(5, 'E', 'load'),
  ],
};

console.log('用例 1：典型 2×3 歧管复原');
check('录入数据通过校验', validateProblem(typical).length === 0);
const r1 = solve(typical);
check('存在合规组合', r1.ok);
if (r1.ok) {
  check('全部 6 个模块都选定方案', r1.chosen.length === 6);
  check(
    '形成 2 条气源→用气端路径',
    r1.paths.length === 2 &&
      r1.paths[0].gasIndex === 0 &&
      r1.paths[0].loadIndex === 0 &&
      r1.paths[1].gasIndex === 1 &&
      r1.paths[1].loadIndex === 1,
  );
  const covered = new Set(r1.paths.flatMap((p) => p.cells));
  check('路径覆盖全部模块且无环', covered.size === 6);
  check(
    '总负担为采用方案负担之和',
    r1.totalCost === r1.chosen.reduce((s, c) => s + c.option.cost, 0) && r1.totalCost === 17,
    `total=${r1.totalCost}`,
  );
}

// ---- 用例 2：气源会被误接回自身 -------------------------------------------
console.log('用例 2：气源误接回自身');
const selfBack: Problem = {
  ...typical,
  cells: [
    [opt('A', 'E', 'W', 3), opt('B', 'S', 'W', 9)], // 西向全是出气
    typical.cells[1],
    typical.cells[2],
    typical.cells[3],
    typical.cells[4],
    typical.cells[5],
  ],
};
const r2 = solve(selfBack);
check('判定为无合规组合', !r2.ok);
if (!r2.ok && r2.diagnosis.kind === 'unmatched') {
  check('指向第 1 行第 1 列左边（最早冲突）', r2.diagnosis.cell === 0 && r2.diagnosis.side === 'W');
  check('说明气源会被误接回自身', r2.diagnosis.summary.includes('误接回自身'));
  check('列出两个候选的被拒原因', r2.diagnosis.tried.length === 2);
} else {
  check('诊断类型为 unmatched', false);
}

// ---- 用例 3：闭合回路 ------------------------------------------------------
console.log('用例 3：模块自相闭环');
const cyclic: Problem = {
  rows: 3,
  cols: 3,
  cells: [
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
  terminals: [
    t(0, 'N', 'gas'),
    t(2, 'E', 'load'),
    t(5, 'E', 'gas'),
    t(8, 'E', 'load'),
  ],
};
const r3 = solve(cyclic);
check('判定为无合规组合', !r3.ok);
if (!r3.ok && r3.diagnosis.kind === 'cycle') {
  check('回路包含 c3/c4/c6/c7 四格', new Set(r3.diagnosis.cycle).size === 4);
  const ev = r3.diagnosis.evidence;
  const chained = ev.every((e, i) => e.to === ev[(i + 1) % ev.length].from);
  check('证据首尾相接', chained && ev.length === 4);
} else {
  check('诊断类型为 cycle', false);
}

if (failures > 0) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`);
  process.exit(1);
}
console.log('\n典型歧管复原冒烟全部通过');
