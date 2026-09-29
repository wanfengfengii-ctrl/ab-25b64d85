// tests/model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, emptyModel, neighborOf, opposite } from '../src/solver/model.mjs';

const opt = (inSide, outSide, cost = 1) => ({ inSide, outSide, cost });

test('opposite / neighborOf 方向与邻格', () => {
  assert.equal(opposite('N'), 'S');
  assert.deepEqual(neighborOf(0, 0, 'E', 2, 2), [0, 1]);
  assert.deepEqual(neighborOf(0, 0, 'N', 2, 2), null);
  assert.deepEqual(neighborOf(1, 1, 'S', 2, 2), null);
  assert.deepEqual(neighborOf(0, 1, 'W', 2, 3), [0, 0]);
});

test('合法 2x2 模型通过校验', () => {
  const m = {
    rows: 2, cols: 2,
    cells: [
      { options: [opt('W', 'E'), opt('N', 'S')] },
      { options: [opt('W', 'E'), opt('N', 'S')] },
      { options: [opt('W', 'E'), opt('N', 'S')] },
      { options: [opt('W', 'E'), opt('N', 'S')] },
    ],
    terminals: [
      { row: 0, col: 0, side: 'W', kind: 'source', label: 'A' },
      { row: 0, col: 1, side: 'E', kind: 'sink', label: 'B' },
    ],
  };
  const { model, errors } = normalizeModel(m);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join(';'));
  assert.equal(model.terminals[0].label, 'A');
});

test('拒绝非法行列数 / 方案数 / 边 / 负担', () => {
  const bad = normalizeModel({
    rows: 4, cols: 5,
    cells: [],
    terminals: [],
  });
  assert.ok(bad.errors.length >= 2);

  const oneOpt = normalizeModel({
    rows: 2, cols: 2,
    cells: Array(4).fill({ options: [opt('W', 'E')] }),
    terminals: [],
  });
  assert.ok(oneOpt.errors.some((e) => e.message.includes('2 至 3')));

  const dup = normalizeModel({
    rows: 2, cols: 2,
    cells: Array(4).fill({ options: [opt('W', 'E', 1), opt('W', 'E', 2)] }),
    terminals: [],
  });
  assert.ok(dup.errors.some((e) => e.message.includes('重复方案')));

  const sameSide = normalizeModel({
    rows: 2, cols: 2,
    cells: Array(4).fill({ options: [opt('W', 'W'), opt('N', 'S')] }),
    terminals: [],
  });
  assert.ok(sameSide.errors.some((e) => e.message.includes('同一条边')));
});

test('端子必须在外缘且不可重复占用，且至少各一个', () => {
  const base = (terminals) => ({
    rows: 2, cols: 2,
    cells: Array(4).fill(0).map(() => ({ options: [opt('W', 'E'), opt('N', 'S')] })),
    terminals,
  });
  const inner = normalizeModel(base([
    { row: 0, col: 1, side: 'W', kind: 'source' },
    { row: 1, col: 0, side: 'E', kind: 'sink' },
  ]));
  assert.ok(inner.errors.some((e) => e.message.includes('外缘')));

  const dup = normalizeModel(base([
    { row: 0, col: 0, side: 'W', kind: 'source' },
    { row: 0, col: 0, side: 'W', kind: 'sink' },
  ]));
  assert.ok(dup.errors.some((e) => e.message.includes('重复占用')));

  const noSink = normalizeModel(base([{ row: 0, col: 0, side: 'W', kind: 'source' }]));
  assert.ok(noSink.errors.some((e) => e.message.includes('用气端')));
});

test('emptyModel 产出可用草稿', () => {
  const m = emptyModel(3, 4);
  assert.equal(m.cells.length, 12);
  assert.equal(m.cells[0].options.length, 2);
  const { errors } = normalizeModel(m);
  assert.ok(errors.some((e) => e.message.includes('气源')));
});
