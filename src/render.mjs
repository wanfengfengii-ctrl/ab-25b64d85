// render.mjs — 将格网/端子/选定方案与路径渲染为 SVG（无框架依赖）

import { SIDES, SIDE_CN } from './solver/model.mjs';

const CELL = 118;
const PAD = 64;
const SIDE_IDX = { N: 0, E: 1, S: 2, W: 3 };

const PATH_COLORS = ['#4cc2ff', '#7ee0a4', '#ffd166', '#c792ea', '#ff9f7f', '#7fdbff'];

function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const ch of children) node.appendChild(ch);
  return node;
}

// side 中点（格内边缘坐标）
function sidePoint(r, c, side) {
  const x0 = PAD + c * CELL;
  const y0 = PAD + r * CELL;
  switch (side) {
    case 'N': return [x0 + CELL / 2, y0];
    case 'S': return [x0 + CELL / 2, y0 + CELL];
    case 'W': return [x0, y0 + CELL / 2];
    default:  return [x0 + CELL, y0 + CELL / 2];
  }
}

function center(r, c) {
  return [PAD + c * CELL + CELL / 2, PAD + r * CELL + CELL / 2];
}

// view:
// { rows, cols, terminals, choice?:number[]|null, optionsByCell, paths?:[...]|null,
//   highlight?: {cellIndex:number, side?:string}|null }
export function renderGridSVG(view) {
  const { rows, cols } = view;
  const W = cols * CELL + PAD * 2;
  const H = rows * CELL + PAD * 2;
  const svg = el('svg', {
    class: 'grid',
    width: W, height: H,
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
  });

  // 箭头标记
  const defs = el('defs');
  for (let i = 0; i < PATH_COLORS.length; i += 1) {
    const m = el('marker', {
      id: `arrow-${i}`, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
    });
    m.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: PATH_COLORS[i] }));
    defs.appendChild(m);
  }
  svg.appendChild(defs);

  // 格体
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = PAD + c * CELL;
      const y = PAD + r * CELL;
      svg.appendChild(el('rect', {
        x: x + 4, y: y + 4, width: CELL - 8, height: CELL - 8, rx: 12,
        fill: '#0e2030', stroke: '#2a4c66', 'stroke-width': 1.5,
      }));
      svg.appendChild(el('text', {
        x: x + 14, y: y + 22, fill: '#5f8199', 'font-size': 11,
        text: `(${r + 1},${c + 1})`,
      }));
    }
  }

  const chosenColor = new Map(); // cellIndex -> path color idx
  if (view.paths) {
    view.paths.forEach((p, pi) => {
      p.cells.forEach((ci) => chosenColor.set(ci, pi % PATH_COLORS.length));
    });
  }

  // 选中方案的管段（进气边→中心→出气边）
  if (view.choice) {
    for (let i = 0; i < rows * cols; i += 1) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const opt = view.optionsByCell[i][view.choice[i]];
      const [ix, iy] = sidePoint(r, c, opt.inSide);
      const [ox, oy] = sidePoint(r, c, opt.outSide);
      const [cx, cy] = center(r, c);
      const color = PATH_COLORS[chosenColor.get(i) ?? 0];

      // 进气管段（外部来流）：柔和蓝
      svg.appendChild(el('line', {
        x1: ix, y1: iy, x2: cx, y2: cy,
        stroke: '#3a86b8', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.85,
      }));
      // 出气管段 + 箭头
      svg.appendChild(el('line', {
        x1: cx, y1: cy, x2: ox, y2: oy,
        stroke: color, 'stroke-width': 5, 'stroke-linecap': 'round',
        'marker-end': `url(#arrow-${chosenColor.get(i) ?? 0})`,
      }));
      // 中心接头节点
      svg.appendChild(el('circle', { cx, cy, r: 6, fill: '#0b1622', stroke: color, 'stroke-width': 2 }));

      // 封闭边标记
      for (const side of SIDES) {
        if (side === opt.inSide || side === opt.outSide) continue;
        const [sx, sy] = sidePoint(r, c, side);
        svg.appendChild(el('rect', {
          x: sx - 4, y: sy - 4, width: 8, height: 8, rx: 2,
          fill: '#22384a', stroke: '#3b5a72', 'stroke-width': 1, transform: `rotate(45 ${sx} ${sy})`,
        }));
      }
    }
  }

  // 端子
  for (const t of view.terminals) {
    const [px, py] = sidePoint(t.row, t.col, t.side);
    const off = { N: [0, -26], S: [0, 26], W: [-26, 0], E: [26, 0] }[t.side];
    const tx = px + off[0];
    const ty = py + off[1];
    const fill = t.kind === 'source' ? '#ff8f6b' : '#7ee0a4';
    svg.appendChild(el('circle', {
      cx: tx, cy: ty, r: 12, fill, stroke: '#0b1622', 'stroke-width': 2,
    }));
    svg.appendChild(el('text', {
      x: tx, y: ty + 4, 'text-anchor': 'middle',
      'font-size': 11, 'font-weight': 700, fill: '#0b1622',
      text: t.kind === 'source' ? '源' : '用',
    }));
    const labOff = { N: [0, -20], S: [0, 28], W: [-44, 4], E: [44, 4] }[t.side];
    const anchor = (t.side === 'W') ? 'end' : (t.side === 'E' ? 'start' : 'middle');
    svg.appendChild(el('text', {
      x: tx + labOff[0], y: ty + labOff[1], 'text-anchor': anchor,
      'font-size': 11, fill: '#cfe3f2', text: t.label,
    }));
  }

  // 问题边高亮（不可行证据）
  if (view.highlight) {
    const { cellIndex, side } = view.highlight;
    const r = Math.floor(cellIndex / cols);
    const c = cellIndex % cols;
    if (side) {
      const [hx, hy] = sidePoint(r, c, side);
      svg.appendChild(el('circle', {
        cx: hx, cy: hy, r: 13, fill: 'none',
        stroke: '#ff6b6b', 'stroke-width': 3, 'stroke-dasharray': '4 3',
      }));
    } else {
      const x = PAD + c * CELL;
      const y = PAD + r * CELL;
      svg.appendChild(el('rect', {
        x: x + 2, y: y + 2, width: CELL - 4, height: CELL - 4, rx: 12,
        fill: 'none', stroke: '#ff6b6b', 'stroke-width': 3, 'stroke-dasharray': '7 4',
      }));
    }
  }

  return svg;
}

export function describeOption(o) {
  return `${SIDE_CN[o.inSide]}进 → ${SIDE_CN[o.outSide]}出`;
}
