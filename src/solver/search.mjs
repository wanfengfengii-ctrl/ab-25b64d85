// solver/search.mjs — 联合选择每格方案，寻找满足全部硬约束且总负担最小的组合。
//
// 搜索规模：至多 3 行 × 4 列 = 12 格 × 每格 3 方案（3^12 ≈ 53 万）。
// 采用“逐格赋值 + 增量端口配对传播”的回溯：每放置一个方案，立即检查
// 其四条边与已赋值邻格/登记端子的配对状态，并以负担下界做最优剪枝。
//
// 不可行证据分两级：
//   A. 接头级：枚举每条边相邻格的全部局部方案对（≤9 种），若均不成立，
//      则该边“无论全网如何选择都无法配对”，取格网顺序最早者报告；
//   B. 路径级：若每条边局部都有解、但无全局组合，则必有局部全通过的
//      组合死在回路/汇合/未达用气端上，取其一并附路径证据。

import { neighborOf } from './model.mjs';
import { validateSelection } from './validate.mjs';

const IN = 1;
const OUT = 2;
const SIDES = ['N', 'E', 'S', 'W'];
const SIDE_CN = { N: '上', E: '右', S: '下', W: '左' };
const sideIdx = (s) => SIDES.indexOf(s);
const oppositeSide = (s) => ({ N: 'S', S: 'N', E: 'W', W: 'E' }[s]);

function variantsOf(model) {
  return model.cells.map((cell) => cell.options.map((o) => {
    const p = [0, 0, 0, 0];
    p[sideIdx(o.inSide)] = IN;
    p[sideIdx(o.outSide)] = OUT;
    return { port: p, cost: o.cost };
  }));
}

export function solve(model) {
  const { rows, cols } = model;
  const N = rows * cols;
  const variants = variantsOf(model);

  // 端子约束：cellIndex*4+sideIdx -> 需要的端口角色
  const terminalNeed = new Map();
  for (const t of model.terminals) {
    terminalNeed.set(t.row * cols * 4 + t.col * 4 + sideIdx(t.side), t.kind === 'source' ? IN : OUT);
  }

  // 下界（剩余每格最小负担），用于最优剪枝
  const order = [...Array(N).keys()];
  const suffixMin = new Array(N + 1).fill(0);
  for (let k = N - 1; k >= 0; k -= 1) {
    suffixMin[k] = suffixMin[k + 1] + Math.min(...variants[order[k]].map((v) => v.cost));
  }

  const choice = new Array(N).fill(-1);
  const portAt = new Array(N * 4).fill(-1);

  let best = null;
  let bestCost = Infinity;
  let firstCycleIssue = null; // 局部全通过但成环的证据
  let firstGlobalIssue = null; // 汇合 / 未达用气端 / 游离等
  let nodes = 0;
  const pruneHits = new Map(); // edgeKey -> 因该边局部配对失败而剪枝的次数（线索用）

  const dfs = (depth, costSoFar) => {
    if (costSoFar + suffixMin[depth] >= bestCost) return;
    if (depth === N) {
      const res = validateSelection(model, choice);
      if (res.ok) {
        best = choice.slice();
        bestCost = costSoFar;
        return;
      }
      // 能到叶子说明局部配对全部成立，问题必为回路或路径结构
      for (const iss of res.issues) {
        if (iss.code === 'CYCLE' && !firstCycleIssue) firstCycleIssue = iss;
        if (!firstGlobalIssue) firstGlobalIssue = iss;
      }
      return;
    }
    nodes += 1;
    const cell = order[depth];
    const r = Math.floor(cell / cols);
    const c = cell % cols;

    const cand = variants[cell]
      .map((v, idx) => ({ v, idx }))
      .sort((a, b) => a.v.cost - b.v.cost || a.idx - b.idx);

    for (const { v, idx } of cand) {
      const touched = [];
      let ok = true;
      let failEdgeKey = -1;

      for (let s = 0; s < 4; s += 1) {
        const side = SIDES[s];
        const edgeKey = cell * 4 + s;
        const role = v.port[s];
        const nb = neighborOf(r, c, side, rows, cols);

        if (nb) {
          const nbKey = nb[0] * cols * 4 + nb[1] * 4 + sideIdx(oppositeSide(side));
          const other = portAt[nbKey];
          if (other !== -1) {
            if (role === 0 || other === 0) {
              if (role !== other) ok = false; // 一开一闭：无法配对
            } else if (role === other) {
              ok = false; // 同进或同出：气流顶回
            }
          }
        } else {
          const need = terminalNeed.get(edgeKey);
          if (need === undefined) {
            if (role !== 0) ok = false; // 未登记外缘边必须封闭
          } else if (role !== need) {
            ok = false; // 登记端子边角色不符 / 被封闭
          }
        }
        if (!ok) { failEdgeKey = edgeKey; break; }
        portAt[edgeKey] = role;
        touched.push(edgeKey);
      }

      if (ok) {
        choice[cell] = idx;
        dfs(depth + 1, costSoFar + v.cost);
        choice[cell] = -1;
      } else if (failEdgeKey >= 0) {
        pruneHits.set(failEdgeKey, (pruneHits.get(failEdgeKey) || 0) + 1);
      }
      for (const k of touched) portAt[k] = -1;
    }
  };

  dfs(0, 0);

  if (best) {
    return {
      feasible: true,
      choice: best,
      totalCost: bestCost,
      validation: validateSelection(model, best),
      nodes,
    };
  }

  // ---------- 不可行诊断 ----------
  const blocker = earliestPairwiseBlocker(model, variants, terminalNeed);
  let reason;
  if (blocker) {
    reason = blocker;
  } else if (firstCycleIssue) {
    reason = { ...firstCycleIssue, code: 'CYCLE' };
  } else if (firstGlobalIssue) {
    reason = firstGlobalIssue;
  } else if (pruneHits.size > 0) {
    // 无叶子到达但又无结构问题记录（通常是整支被局部配对剪空）：
    // 报告格序最早、在搜索中最早造成整支不可行的接头。
    const earliestKey = Math.min(...pruneHits.keys());
    const cell = Math.floor(earliestKey / 4);
    const side = SIDES[earliestKey % 4];
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    reason = {
      code: 'UNPAIRED_PORT',
      edgeKey: earliestKey,
      cellIndex: cell,
      side,
      message: `按格网顺序最早的配对冲突线索：格 (${r + 1},${c + 1}) 的${SIDE_CN[side]}边在回溯搜索中最先反复无法与邻格/端子闭合（所有更早的接头在局部候选下均存在合法配对，矛盾在该位置之后才被锁死）。调整该格或其邻格候选、端子登记后再试。`,
    };
  } else {
    reason = { code: 'NO_COMBINATION', message: '不存在满足全部约束的方案组合' };
  }

  return { feasible: false, reason, nodes };
}

// 逐条边做“局部全枚举”：若该边在相邻格全部方案对（或本格全部方案）下
// 都不能合法，则它是与全网其余选择无关的必然死接头。返回格序最早者。
// 顺序键统一为 cellIndex*4+sideIdx（N<E<S<W，格内行优先）。
function earliestPairwiseBlocker(model, variants, terminalNeed) {
  const { rows, cols } = model;
  const roleOn = (cell, variantIdx, side) => variants[cell][variantIdx].port[sideIdx(side)];
  const blockers = [];

  // 内部边（以 E/S 侧登记一次，顺序键取发起格的边键）
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edges = [];
      if (c < cols - 1) edges.push({ a: r * cols + c, sa: 'E', b: r * cols + c + 1, sb: 'W' });
      if (r < rows - 1) edges.push({ a: r * cols + c, sa: 'S', b: (r + 1) * cols + c, sb: 'N' });
      for (const e of edges) {
        let anyValid = false;
        let sawMismatchOpen = false;
        let sawSameRole = false;
        for (let va = 0; va < variants[e.a].length && !anyValid; va += 1) {
          for (let vb = 0; vb < variants[e.b].length; vb += 1) {
            const ra = roleOn(e.a, va, e.sa);
            const rb = roleOn(e.b, vb, e.sb);
            if (ra === 0 && rb === 0) { anyValid = true; break; }
            if (ra !== 0 && rb !== 0 && ra !== rb) { anyValid = true; break; }
            if ((ra === 0) !== (rb === 0)) sawMismatchOpen = true;
            if (ra !== 0 && rb !== 0 && ra === rb) sawSameRole = true;
          }
        }
        if (!anyValid) {
          const ar = Math.floor(e.a / cols);
          const ac = e.a % cols;
          const br = Math.floor(e.b / cols);
          const bc = e.b % cols;
          const detail = !sawMismatchOpen && sawSameRole
            ? '两格在该边上的候选接头只可能同为进气或同为出气，无法由出气接入进气'
            : '两格在该边上的候选接头无法做到同开同闭且方向相反，必然出现开启端口悬空';
          blockers.push({
            code: 'UNPAIRED_PORT',
            edgeKey: e.a * 4 + sideIdx(e.sa),
            cellIndex: e.a,
            side: e.sa,
            cells: [e.a, e.b],
            message: `按格网顺序最早无法配对的接头：格 (${ar + 1},${ac + 1})${SIDE_CN[e.sa]}边 ↔ 格 (${br + 1},${bc + 1})${SIDE_CN[e.sb]}边。${detail}`,
          });
        }
      }
    }
  }

  // 外缘边
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      for (const side of SIDES) {
        if (neighborOf(r, c, side, rows, cols)) continue;
        const cell = r * cols + c;
        const key = cell * 4 + sideIdx(side);
        const need = terminalNeed.get(key);
        let anyValid = false;
        let sealed = false;
        let wrongRole = false;
        for (let vi = 0; vi < variants[cell].length; vi += 1) {
          const role = roleOn(cell, vi, side);
          if (need === undefined) {
            if (role === 0) { anyValid = true; break; }
          } else if (role === need) {
            anyValid = true;
            break;
          }
          if (role === 0) sealed = true; else wrongRole = true;
        }
        if (anyValid) continue;
        const t = model.terminals.find(
          (x) => x.row * cols * 4 + x.col * 4 + sideIdx(x.side) === key,
        );
        const detail = t
          ? `登记端「${t.label}」要求该边${need === IN ? '进气（气源由外部注入歧管）' : '出气（向用气端供气）'}，但该格全部候选方案都${sealed && wrongRole ? '将其封闭或角色相反' : sealed ? '将其封闭，端子无法参与' : '角色相反，会把气流误接回气源'}`
          : '该外缘边未登记端子，但该格全部候选方案都在此边开启端口，必然产生无法配对的悬空端口';
        blockers.push({
          code: 'TERMINAL_EDGE_BLOCKED',
          edgeKey: key,
          cellIndex: cell,
          side,
          message: `按格网顺序最早无法配对的接头：格 (${r + 1},${c + 1}) 的${SIDE_CN[side]}外缘边。${detail}`,
        });
      }
    }
  }

  blockers.sort((a, b) => a.edgeKey - b.edgeKey);
  return blockers[0] || null;
}
