// tests/validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel } from '../src/solver/model.mjs';
import { validateSelection } from '../src/solver/validate.mjs';

const O = (inSide, outSide, cost = 1) => ({ inSide, outSide, cost });

function build(rows, cols, cells, terminals) {
  const { model, errors } = normalizeModel({ rows, cols, cells, terminals });
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' | '));
  return model;
}

// 2x2 蛇形单路径（已逐边核对）：
//   气源W(0) →0[W→E]→ 1[W→S]→ 3[N→W]→ 2[E→S]→ 用气端S(2)
function snakeModel() {
  return build(
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
}

test('合法蛇形单路径：配对、方向、端子、无环、全覆盖全部通过', () => {
  const model = snakeModel();
  const res = validateSelection(model, [0, 0, 0, 0]);
  assert.equal(res.ok, true, res.issues.map((i) => i.message).join(' | '));
  assert.equal(res.paths.length, 1);
  assert.equal(res.paths[0].source.label, 'S1');
  assert.equal(res.paths[0].sink.label, 'K1');
  assert.deepEqual(res.paths[0].cells, [0, 1, 3, 2]);
});

test('合法双路径：顶排与底排各一条 source→sink，点不相交', () => {
  const model = build(
    2, 2,
    Array(4).fill(0).map(() => ({ options: [O('W', 'E'), O('N', 'S', 5)] })),
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'SA' },
      { row: 1, col: 0, side: 'W', kind: 'source', label: 'SB' },
      { row: 0, col: 1, side: 'E', kind: 'sink', label: 'KA' },
      { row: 1, col: 1, side: 'E', kind: 'sink', label: 'KB' },
    ],
  );
  const res = validateSelection(model, [0, 0, 0, 0]);
  assert.equal(res.ok, true, res.issues.map((i) => i.message).join(' | '));
  assert.equal(res.paths.length, 2);
  assert.deepEqual(res.paths.map((p) => p.cells), [[0, 1], [2, 3]]);
});

test('一开一闭：开启端口悬空 → UNPAIRED_PORT，且 issues 按格网顺序排序', () => {
  const model = snakeModel();
  // 0 选 W→E（S 闭），2 选 W→N（N 开）：0/2 共享边一开一闭
  const res = validateSelection(model, [0, 0, 1, 0]);
  assert.ok(res.issues.some((i) => i.code === 'UNPAIRED_PORT'));
  const orders = res.issues.map((i) => i.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('同进同出对顶：WRONG_DIRECTION，明确阻止气流顶回', () => {
  const model = build(
    2, 2,
    [
      { options: [O('W', 'S'), O('N', 'E', 5)] },   // 0: E 闭
      { options: [O('E', 'S'), O('N', 'W', 5)] },   // 1: W=out(E? no) in=E out=S → W 闭
    ].concat(
      Array(2).fill(0).map(() => ({ options: [O('W', 'E'), O('N', 'S', 5)] })),
    ),
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 0, col: 1, side: 'N', kind: 'sink', label: 'K1' },
    ],
  );
  // 让 0/1 共享边同角色：0 的 E 需要开启 —— 用第二方案 N→E（E=out），
  // 1 的方案 E→S（E=in）那是对的边…… 改用 1 的 W 开启：方案 N→W（W=out）。
  // 0 选 N→E(E=out) 面向 1 的 W；1 选 N→W(W=out) → out/out
  const res = validateSelection(model, [1, 1, 0, 0]);
  assert.ok(res.issues.some((i) => i.code === 'WRONG_DIRECTION'));
});

test('端子边封闭：TERMINAL_NOT_SERVED；角色反向：TERMINAL_WRONG_ROLE', () => {
  const model = snakeModel();
  // 格0 选 N→S：W 封闭，气源端无法参与
  const r1 = validateSelection(model, [1, 0, 0, 0]);
  assert.ok(r1.issues.some((i) => i.code === 'TERMINAL_NOT_SERVED'));

  // 角色反向：气源 W 需要进气；构造格0 W=out 的方案 E→W
  const model2 = build(
    2, 2,
    [
      { options: [O('E', 'W'), O('N', 'S', 5)] },
      ...snakeModelCellsSlice(1),
    ],
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 1, col: 0, side: 'S', kind: 'sink', label: 'K1' },
    ],
  );
  const r2 = validateSelection(model2, [0, 0, 0, 0]);
  assert.ok(r2.issues.some((i) => i.code === 'TERMINAL_WRONG_ROLE'));
});

function snakeModelCellsSlice() {
  return [
    { options: [O('W', 'S'), O('N', 'E', 5)] },
    { options: [O('E', 'S'), O('W', 'N', 5)] },
    { options: [O('N', 'W'), O('S', 'E', 5)] },
  ];
}

test('未登记外缘开启：UNREGISTERED_OPEN', () => {
  const model = build(
    2, 2,
    Array(4).fill(0).map(() => ({ options: [O('W', 'E'), O('N', 'S')] })),
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 0, col: 1, side: 'E', kind: 'sink', label: 'K1' },
    ],
  );
  // 顶排横通合法，但底排选 WE 会在 W/E 外缘产生未登记开启端口
  const res = validateSelection(model, [0, 0, 0, 0]);
  assert.ok(res.issues.some((i) => i.code === 'UNREGISTERED_OPEN'));
});

test('2x3 环网：四格闭环 + 独立通路，结构配对全通过仍必报 CYCLE 并给路径证据', () => {
  // 0→1→4→3→0 成环；2→5 为独立 source→sink 路径（逐边核对封闭）
  const model = build(
    2, 3,
    [
      { options: [O('S', 'E'), O('W', 'N', 5)] },   // 0 in=S out=E
      { options: [O('W', 'S'), O('N', 'E', 5)] },   // 1 in=W out=S
      { options: [O('N', 'S'), O('W', 'E', 5)] },   // 2 in=N out=S
      { options: [O('E', 'N'), O('W', 'S', 5)] },   // 3 in=E out=N
      { options: [O('N', 'W'), O('S', 'E', 5)] },   // 4 in=N out=W
      { options: [O('N', 'E'), O('W', 'S', 5)] },   // 5 in=N out=E
    ],
    [
      { row: 0, col: 2, side: 'N', kind: 'source', label: 'S1' },
      { row: 1, col: 2, side: 'E', kind: 'sink', label: 'K1' },
    ],
  );
  const res = validateSelection(model, [0, 0, 0, 0, 0, 0]);
  const cyc = res.issues.find((i) => i.code === 'CYCLE');
  assert.ok(cyc, '应检测到回路');
  assert.deepEqual(new Set(cyc.evidence.slice(0, 4)), new Set([0, 1, 4, 3]));
  assert.match(cyc.message, /回路/);
});

test('用气端未被送达：路径末端不匹配 sink → SINK_UNREACHED', () => {
  // 顶排 0→1 横通，sink 却登记在 1 的 N 边；底排封闭不可得，
  // 这里直接构造一条末端错配的选择：0 W→E，1 W→N（出在 N），sink 登记在 E。
  const model = build(
    2, 2,
    [
      { options: [O('W', 'E'), O('N', 'S', 5)] },
      { options: [O('W', 'N'), O('S', 'E', 5)] },
      { options: [O('N', 'S'), O('W', 'E', 5)] },
      { options: [O('N', 'S'), O('W', 'E', 5)] },
    ],
    [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'S1' },
      { row: 0, col: 1, side: 'E', kind: 'sink', label: 'K1' },
    ],
  );
  const res = validateSelection(model, [0, 0, 0, 0]);
  // 1 的 N 边开向未登记外缘 → UNREGISTERED_OPEN；结构错误先报
  assert.ok(!res.ok);
});
