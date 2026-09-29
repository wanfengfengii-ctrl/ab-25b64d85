// tests/search.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel } from '../src/solver/model.mjs';
import { solve } from '../src/solver/search.mjs';
import { validateSelection } from '../src/solver/validate.mjs';

const O = (inSide, outSide, cost = 1) => ({ inSide, outSide, cost });

function norm(rows, cols, cells, terminals) {
  const { model, errors } = normalizeModel({ rows, cols, cells, terminals });
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' | '));
  return model;
}

test('2x2 蛇形：找到唯一合规组合并给出总负担与路径', () => {
  const model = norm(
    2, 2,
    [
      { options: [O('W', 'E'), O('N', 'S', 5)] },
      { options: [O('W', 'S'), O('N', 'E', 5)] },
      { options: [O('E', 'S'), O('W', 'N', 5)] },
      { options: [O('N', 'W'), O('S', 'E', 5)] },
    ],
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 1, col: 0, side: 'S', kind: 'sink', label: 'K1' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, true, r.reason?.message);
  assert.deepEqual(r.choice, [0, 0, 0, 0]);
  assert.equal(r.totalCost, 4);
  assert.equal(r.validation.ok, true);
  assert.deepEqual(r.validation.paths[0].cells, [0, 1, 3, 2]);
});

test('总负担最小化：贵方案被剪枝，选择每条最便宜合规路径', () => {
  const model = norm(
    2, 2,
    Array(4).fill(0).map(() => ({ options: [O('W', 'E', 1), O('N', 'S', 9)] })),
    [
      { row: 0, col: 0, side: 'W', kind: 'source' },
      { row: 1, col: 0, side: 'W', kind: 'source' },
      { row: 0, col: 1, side: 'E', kind: 'sink' },
      { row: 1, col: 1, side: 'E', kind: 'sink' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, true);
  assert.equal(r.totalCost, 4);
  assert.ok(r.validation.paths.length === 2);
});

test('3x4 三横通规模（12 格 × 2 方案）快速得解', () => {
  const model = norm(
    3, 4,
    Array(12).fill(0).map(() => ({ options: [O('W', 'E', 1), O('N', 'S', 2)] })),
    [
      { row: 0, col: 0, side: 'W', kind: 'source' },
      { row: 1, col: 0, side: 'W', kind: 'source' },
      { row: 2, col: 0, side: 'W', kind: 'source' },
      { row: 0, col: 3, side: 'E', kind: 'sink' },
      { row: 1, col: 3, side: 'E', kind: 'sink' },
      { row: 2, col: 3, side: 'E', kind: 'sink' },
    ],
  );
  const t0 = Date.now();
  const r = solve(model);
  assert.equal(r.feasible, true);
  assert.equal(r.totalCost, 12);
  assert.ok(Date.now() - t0 < 2000);
});

test('2x3 环网：局部配对全可过但全网成环 → 不可行并给回路路径证据', () => {
  const model = norm(
    2, 3,
    [
      { options: [O('S', 'E'), O('W', 'N', 5)] },
      { options: [O('W', 'S'), O('N', 'E', 5)] },
      { options: [O('N', 'S'), O('W', 'E', 5)] },
      { options: [O('E', 'N'), O('W', 'S', 5)] },
      { options: [O('N', 'W'), O('S', 'E', 5)] },
      { options: [O('N', 'E'), O('W', 'S', 5)] },
    ],
    [
      { row: 0, col: 2, side: 'N', kind: 'source', label: 'S1' },
      { row: 1, col: 2, side: 'E', kind: 'sink', label: 'K1' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, false);
  assert.equal(r.reason.code, 'CYCLE');
  assert.deepEqual(new Set(r.reason.evidence.slice(0, 4)), new Set([0, 1, 4, 3]));
  assert.match(r.reason.message, /回路/);
});

test('内部死接头：格(1,1)东 ↔ 格(1,2)西 永远同出，报告为格序最早不可配对接头', () => {
  const model = norm(
    2, 2,
    [
      { options: [O('W', 'E'), O('N', 'E'), O('S', 'E')] },      // E 恒为出
      { options: [O('E', 'W'), O('N', 'W'), O('S', 'W')] },      // W 恒为出
      { options: [O('W', 'E', 1), O('N', 'S', 1)] },
      { options: [O('W', 'E', 1), O('N', 'S', 1)] },
    ],
    [
      { row: 1, col: 0, side: 'W', kind: 'source' },
      { row: 1, col: 1, side: 'E', kind: 'sink' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, false);
  assert.equal(r.reason.code, 'UNPAIRED_PORT');
  assert.equal(r.reason.edgeKey, 0 * 4 + 1);
  assert.match(r.reason.message, /格 \(1,1\).*格 \(1,2\)/);
});

test('端子死接头：用气端要求出气但该格候选永不在该边出气', () => {
  const model = norm(
    2, 2,
    [
      { options: [O('W', 'E'), O('N', 'S')] },
      { options: [O('W', 'E'), O('E', 'W'), O('N', 'S')] }, // N 只可能闭/进
      { options: [O('W', 'E'), O('N', 'S')] },
      { options: [O('W', 'E'), O('N', 'S')] },
    ],
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 0, col: 1, side: 'N', kind: 'sink', label: 'K1' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, false);
  assert.equal(r.reason.code, 'TERMINAL_EDGE_BLOCKED');
  assert.equal(r.reason.edgeKey, 1 * 4 + 0);
  assert.match(r.reason.message, /K1/);
});

test('可行结果自洽：返回组合必通过完整校验，且负担求和一致', () => {
  // 蛇形模型，打乱方案顺序与负担
  const model = norm(
    2, 2,
    [
      { options: [O('N', 'S', 7), O('W', 'E', 3)] },
      { options: [O('N', 'E', 7), O('W', 'S', 2)] },
      { options: [O('W', 'N', 7), O('E', 'S', 4)] },
      { options: [O('S', 'E', 7), O('N', 'W', 1)] },
    ],
    [
      { row: 0, col: 0, side: 'W', kind: 'source' },
      { row: 1, col: 0, side: 'S', kind: 'sink' },
    ],
  );
  const r = solve(model);
  assert.equal(r.feasible, true);
  const again = validateSelection(model, r.choice);
  assert.equal(again.ok, true, again.issues.map((i) => i.message).join(' | '));
  const sum = r.choice.reduce((acc, ci, i) => acc + model.cells[i].options[ci].cost, 0);
  assert.equal(r.totalCost, sum);
  assert.equal(r.totalCost, 3 + 2 + 4 + 1);
});

test('随机模型：求解结论与穷举校验一致（固定伪随机种子）', () => {
  let seed = 20260929;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const sides = ['N', 'E', 'S', 'W'];
  const pickSide = () => sides[Math.floor(rand() * 4)];

  for (let trial = 0; trial < 60; trial += 1) {
    const rows = 2 + Math.floor(rand() * 2);
    const cols = 2 + Math.floor(rand() * 3);
    const cells = [];
    for (let i = 0; i < rows * cols; i += 1) {
      const n = 2 + Math.floor(rand() * 2);
      const opts = [];
      const used = new Set();
      while (opts.length < n) {
        const a = pickSide();
        let b = pickSide();
        if (a === b || used.has(`${a}->${b}`)) continue;
        used.add(`${a}->${b}`);
        opts.push(O(a, b, 1 + Math.floor(rand() * 5)));
      }
      cells.push({ options: opts });
    }
    // 随机登记 1-2 个源、1-2 个汇，位置在外缘
    const boundary = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      for (const s of sides) {
        const on = (s === 'N' && r === 0) || (s === 'S' && r === rows - 1)
          || (s === 'W' && c === 0) || (s === 'E' && c === cols - 1);
        if (on) boundary.push({ row: r, col: c, side: s });
      }
    }
    const take = () => boundary.splice(Math.floor(rand() * boundary.length), 1)[0];
    const terminals = [];
    const ns = 1 + Math.floor(rand() * 2);
    const nk = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < ns && boundary.length; i += 1) terminals.push({ ...take(), kind: 'source' });
    for (let i = 0; i < nk && boundary.length; i += 1) terminals.push({ ...take(), kind: 'sink' });

    const { model, errors } = normalizeModel({ rows, cols, cells, terminals });
    if (errors.length) continue;
    const r = solve(model);

    // 穷举独立核验
    let anyFeasible = false;
    let minCost = Infinity;
    const choice = new Array(rows * cols).fill(0);
    const enumAll = (i) => {
      if (i === model.cells.length) {
        const v = validateSelection(model, choice);
        if (v.ok) {
          anyFeasible = true;
          let cst = 0;
          choice.forEach((ci, k) => { cst += model.cells[k].options[ci].cost; });
          minCost = Math.min(minCost, cst);
        }
        return;
      }
      for (let k = 0; k < model.cells[i].options.length; k += 1) {
        choice[i] = k;
        enumAll(i + 1);
      }
    };
    enumAll(0);

    assert.equal(r.feasible, anyFeasible, `trial ${trial} 可行性结论不一致`);
    if (anyFeasible) assert.equal(r.totalCost, minCost, `trial ${trial} 非最优`);
  }
});
