import { SIDE_LABEL, type Side, type Solution } from '../lib/solver';
import { cellShort, type Draft } from '../lib/draft';

const ARROW: Record<Side, string> = { N: '↑', E: '→', S: '↓', W: '←' };

interface BoardProps {
  draft: Draft;
  result: Solution | null;
  cycleCells?: Set<number>;
}

/** 复原结果棋盘：展示格内气流方向与外接气源/用气端。 */
export function Board({ draft, result, cycleCells }: BoardProps) {
  const { rows, cols, terminals } = draft;
  const chosenByIdx = result ? new Map(result.chosen.map((c) => [c.cell, c])) : null;
  const termAt = new Map(terminals.map((t) => [`${t.cell}:${t.side}`, t]));

  return (
    <div
      className="cells-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(120px, 1fr))` }}
    >
      {Array.from({ length: rows * cols }, (_, cell) => {
        const chosen = chosenByIdx?.get(cell);
        const classes = ['cell-card', 'board-cell'];
        if (cycleCells?.has(cell)) classes.push('flag-cycle');
        else if (chosen) classes.push('flag-good');
        const cellTerms = (['N', 'E', 'S', 'W'] as Side[])
          .map((s) => termAt.get(`${cell}:${s}`))
          .filter(Boolean);
        return (
          <div key={cell} className={classes.join(' ')}>
            <div className="cell-name">
              <span>{cellShort(cell, cols)}</span>
              {chosen && <span className="tag chosen">方案 {chosen.option.id}</span>}
              {cycleCells?.has(cell) && <span className="tag" style={{ color: 'var(--warn)' }}>回路</span>}
            </div>
            <div className="board-flow">
              {chosen ? (
                <>
                  <span className="tag in">入 {ARROW[chosen.option.inlet]}{SIDE_LABEL[chosen.option.inlet]}</span>
                  {'　'}
                  <span className="tag out">出 {ARROW[chosen.option.outlet]}{SIDE_LABEL[chosen.option.outlet]}</span>
                  <br />
                  <span className="muted">负担 {chosen.option.cost}</span>
                </>
              ) : (
                <span className="muted">{cycleCells?.has(cell) ? '该格参与闭合回路' : '待复原'}</span>
              )}
            </div>
            <div className="board-terms">
              {cellTerms.map((t) =>
                t ? (
                  <span key={t.uid} className={`tag ${t.kind}`}>
                    {t.kind === 'gas' ? '气源' : '用端'}·{SIDE_LABEL[t.side]}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
