import { useMemo, useState } from 'react';
import {
  SIDE_LABEL,
  SIDES,
  solve,
  validateProblem,
  type Endpoint,
  type Failure,
  type Option,
  type Side,
  type Solution,
} from './lib/solver';
import {
  cellLabel,
  cellShort,
  exampleDraft,
  isOuterSide,
  loadDraft,
  newUid,
  outerSides,
  saveDraft,
  terminalLabels,
  toProblem,
  type Draft,
} from './lib/draft';
import { Board } from './components/Board';

const ARROW: Record<Side, string> = { N: '↑', E: '→', S: '↓', W: '←' };

function defaultOptions(cell: number): Option[] {
  const a: Side = cell % 2 === 0 ? 'W' : 'N';
  const b: Side = cell % 2 === 0 ? 'E' : 'S';
  return [
    { id: 'A', inlet: a, outlet: b, cost: 3 },
    { id: 'B', inlet: 'N', outlet: 'E', cost: 5 },
  ];
}

function resizeDraft(d: Draft, rows: number, cols: number): Draft {
  const n = rows * cols;
  const options: Option[][] = Array.from({ length: n }, (_, cell) => d.options[cell] ?? defaultOptions(cell));
  // 缩编后越界或不再位于外边的登记端一并移除
  const terminals = d.terminals.filter(
    (t) => t.cell < n && isOuterSide(rows, cols, t.cell, t.side),
  );
  return { rows, cols, options, terminals };
}

export function App() {
  const [draft, setDraft] = useState<Draft>(() => loadDraft());
  const [result, setResult] = useState<Solution | Failure | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const problem = useMemo(() => toProblem(draft), [draft]);
  const labels = useMemo(() => terminalLabels(problem), [problem]);

  const update = (next: Draft) => {
    setDraft(next);
    saveDraft(next);
  };

  const setDim = (key: 'rows' | 'cols', value: number) => {
    const rows = key === 'rows' ? value : draft.rows;
    const cols = key === 'cols' ? value : draft.cols;
    update(resizeDraft(draft, rows, cols));
    setResult(null);
  };

  const editOption = (cell: number, oi: number, patch: Partial<Option>) => {
    const options = draft.options.map((list, c) =>
      c === cell ? list.map((o, i) => (i === oi ? { ...o, ...patch } : o)) : list,
    );
    update({ ...draft, options });
  };

  const addOption = (cell: number) => {
    if (draft.options[cell].length >= 3) return;
    const options = draft.options.map((list, c) =>
      c === cell ? [...list, { id: 'C', inlet: 'W' as Side, outlet: 'N' as Side, cost: 4 }] : list,
    );
    update({ ...draft, options });
  };

  const removeOption = (cell: number, oi: number) => {
    if (draft.options[cell].length <= 2) return;
    const options = draft.options.map((list, c) =>
      c === cell ? list.filter((_, i) => i !== oi) : list,
    );
    update({ ...draft, options });
  };

  const addTerminal = (kind: 'gas' | 'load') => {
    const first = outerSides(draft.rows, draft.cols, 0)[0];
    update({ ...draft, terminals: [...draft.terminals, { uid: newUid(), cell: 0, side: first, kind }] });
  };

  const editTerminal = (uid: string, patch: Partial<Draft['terminals'][number]>) => {
    const terminals = draft.terminals.map((t) => (t.uid === uid ? { ...t, ...patch } : t));
    update({ ...draft, terminals });
  };

  const removeTerminal = (uid: string) => {
    update({ ...draft, terminals: draft.terminals.filter((t) => t.uid !== uid) });
  };

  const runRestore = () => {
    const errs = validateProblem(problem);
    if (errs.length > 0) {
      setFormErrors(errs.map((e) => (e.cell === undefined ? e.message : `${cellLabel(draft.cols, e.cell)}：${e.message}`)));
      setResult(null);
      return;
    }
    setFormErrors([]);
    setResult(solve(problem));
  };

  const failure: Failure | null = result && !result.ok ? result : null;
  const success: Solution | null = result && result.ok ? result : null;
  const unmatchedDiag =
    failure && failure.diagnosis.kind === 'unmatched' ? failure.diagnosis : null;
  const cycleDiag = failure && failure.diagnosis.kind === 'cycle' ? failure.diagnosis : null;
  const badCell = unmatchedDiag?.cell ?? null;
  const cycleCells = cycleDiag ? new Set(cycleDiag.cycle) : undefined;

  const epName = (ep: Endpoint): string => {
    if (ep.kind === 'cell') return cellShort(ep.cell, draft.cols);
    if (ep.kind === 'gas') return `气源#${ep.index + 1}`;
    return `用气端#${ep.index + 1}`;
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>深海载人舱 · 应急供氧歧管复原台</h1>
        <p>
          录入可拆模块格网与候选接头方案，登记气源端 / 用气端后在本机联合复原：
          共享边严格「出气 → 进气」、开启端口恰好配对、全网只允许气源到用气端的无环路径。全部计算仅在本地浏览器完成。
        </p>
      </header>

      <section className="panel">
        <h2>① 模块格网</h2>
        <div className="row-inline">
          <label>
            行数（2–3）：
            <input type="number" min={2} max={3} value={draft.rows} onChange={(e) => setDim('rows', Number(e.target.value))} />
          </label>
          <label>
            列数（2–4）：
            <input type="number" min={2} max={4} value={draft.cols} onChange={(e) => setDim('cols', Number(e.target.value))} />
          </label>
          <button className="ghost" onClick={() => update(exampleDraft())}>载入内置示例</button>
          <span className="help">每个模块格需 2–3 个候选方案，各声明唯一进气边、唯一出气边与改装负担。</span>
        </div>

        <div className="cells-grid" style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(230px, 1fr))`, marginTop: 14 }}>
          {draft.options.map((list, cell) => (
            <div
              key={cell}
              className={`cell-card${badCell === cell ? ' flag-bad' : ''}${cycleCells?.has(cell) ? ' flag-cycle' : ''}`}
            >
              <div className="cell-name">
                <span>{cellLabel(draft.cols, cell)}</span>
                {success && (
                  <span className="tag chosen">采用 {success.chosen[cell].option.id}</span>
                )}
              </div>
              {list.map((o, oi) => {
                const adopted = success?.chosen[cell].optionIndex === oi;
                return (
                  <div key={oi} className={`opt-row${adopted ? ' adopted' : ''}`}>
                    <input
                      className="opt-id"
                      type="text"
                      value={o.id}
                      title="方案编号"
                      onChange={(e) => editOption(cell, oi, { id: e.target.value })}
                    />
                    <label>
                      进气边
                      <select value={o.inlet} onChange={(e) => editOption(cell, oi, { inlet: e.target.value as Side })}>
                        {SIDES.map((s) => (
                          <option key={s} value={s}>{ARROW[s]} {SIDE_LABEL[s]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      出气边
                      <select value={o.outlet} onChange={(e) => editOption(cell, oi, { outlet: e.target.value as Side })}>
                        {SIDES.map((s) => (
                          <option key={s} value={s}>{ARROW[s]} {SIDE_LABEL[s]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      负担
                      <input type="number" min={0} value={o.cost} onChange={(e) => editOption(cell, oi, { cost: Number(e.target.value) })} />
                    </label>
                    {list.length > 2 && (
                      <button className="danger" onClick={() => removeOption(cell, oi)}>删</button>
                    )}
                    {success && (
                      <span className={`tag ${adopted ? 'chosen' : 'skipped'}`}>{adopted ? '已采用' : '未采用'}</span>
                    )}
                  </div>
                );
              })}
              {list.length < 3 && (
                <button className="ghost" style={{ marginTop: 6 }} onClick={() => addOption(cell)}>
                  + 增加候选方案
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>② 格网外边登记气源端与用气端</h2>
        <div className="term-list">
          {draft.terminals.map((t) => {
            const outer = isOuterSide(draft.rows, draft.cols, t.cell, t.side);
            return (
              <div key={t.uid} className={`term-row${outer ? '' : ' invalid'}`}>
                <span className={`tag ${t.kind}`}>{t.kind === 'gas' ? '气源端' : '用气端'}</span>
                <label>
                  模块格
                  <select value={t.cell} onChange={(e) => editTerminal(t.uid, { cell: Number(e.target.value) })}>
                    {Array.from({ length: draft.rows * draft.cols }, (_, c) => (
                      <option key={c} value={c}>{cellLabel(draft.cols, c)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  外边
                  <select value={t.side} onChange={(e) => editTerminal(t.uid, { side: e.target.value as Side })}>
                    {outerSides(draft.rows, draft.cols, t.cell).map((s) => (
                      <option key={s} value={s}>{ARROW[s]} {SIDE_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  类型
                  <select value={t.kind} onChange={(e) => editTerminal(t.uid, { kind: e.target.value as 'gas' | 'load' })}>
                    <option value="gas">气源端（进气）</option>
                    <option value="load">用气端（出气）</option>
                  </select>
                </label>
                <button className="danger" onClick={() => removeTerminal(t.uid)}>移除</button>
                {!outer && <span style={{ color: 'var(--bad)', fontSize: 12 }}>该边不是格网外边，无法登记</span>}
              </div>
            );
          })}
        </div>
        <div className="row-inline" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={() => addTerminal('gas')}>+ 气源端</button>
          <button className="ghost" onClick={() => addTerminal('load')}>+ 用气端</button>
          <span className="muted">
            已登记气源 {labels.gas.length} 个、用气端 {labels.load.length} 个；每个端都必须参与复原。
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="solve-bar">
          <button onClick={runRestore}>复原接头朝向</button>
          <button className="ghost" onClick={() => { setResult(null); setFormErrors([]); }}>清除结果（保留草稿）</button>
          <span className="muted">草稿自动保存在本浏览器；复原请求不会离开本机。</span>
        </div>
        {formErrors.length > 0 && (
          <ul className="error-list">
            {formErrors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </section>

      {success && (
        <section className="panel result-good">
          <h3>✓ 已复原：{success.paths.length} 条气源→用气端路径，总改装负担 {success.totalCost}</h3>
          <div className="summary-grid">
            <div className="stat"><b>{draft.rows * draft.cols}</b><span className="muted">全部模块已联合选定方案</span></div>
            <div className="stat"><b>{success.paths.length}</b><span className="muted">无环送气路径</span></div>
            <div className="stat"><b>{success.totalCost}</b><span className="muted">改装负担合计</span></div>
          </div>
          <Board draft={draft} result={success} />
          <h2 style={{ marginTop: 16 }}>送气路径</h2>
          {success.paths.map((p) => (
            <div key={p.gasIndex} className="path-box">
              {p.hops.map((h, i) => (
                <span key={i}>
                  <span className="path-node">{epName(h.from)}</span>
                  <span className="path-side"> —{ARROW[h.side]} 经{SIDE_LABEL[h.side]}→ </span>
                  <span className="path-node">{epName(h.to)}</span>
                </span>
              ))}
              <div className="muted">
                途经模块：{p.cells.map((c) => cellShort(c, draft.cols)).join(' → ')}
              </div>
            </div>
          ))}
          <h2 style={{ marginTop: 16 }}>未采用项</h2>
          <div className="path-box">
            {draft.options.some((list) => list.length > 1)
              ? draft.options.flatMap((list, cell) =>
                  list
                    .map((o, oi) => ({ o, oi, cell }))
                    .filter(({ oi }) => oi !== success.chosen[cell].optionIndex)
                    .map(({ o, cell }) => (
                      <span key={`${cell}-${o.id}`} className="tag skipped" style={{ marginRight: 8 }}>
                        {cellShort(cell, draft.cols)}·{o.id}（入{SIDE_LABEL[o.inlet]}/出{SIDE_LABEL[o.outlet]}/负担{o.cost}）
                      </span>
                    )),
                )
              : <span className="muted">无</span>}
          </div>
        </section>
      )}

      {unmatchedDiag && (
        <section className="panel result-bad">
          <h3>✗ 不存在合规组合 —— 草稿已保留，可修改后再次复原</h3>
          <p>{unmatchedDiag.summary}</p>
          <Board draft={draft} result={null} />
          <div className="evidence-box">
            <b>{cellLabel(draft.cols, unmatchedDiag.cell)}·{SIDE_LABEL[unmatchedDiag.side]}</b> 各候选被拒原因：
            <ul style={{ margin: '6px 0' }}>
              {unmatchedDiag.tried.map((t, i) => (
                <li key={i}>方案 {t.optionId}：{t.detail}</li>
              ))}
            </ul>
            该接头是按格网顺序（先行后列）最早无法完成「出气 → 进气」配对或外端配对的位置。
          </div>
        </section>
      )}

      {cycleDiag && (
        <section className="panel result-bad">
          <h3>✗ 不存在合规组合：存在脱离气源的闭合回路 —— 草稿已保留</h3>
          <p>{cycleDiag.summary}</p>
          <Board draft={draft} result={null} cycleCells={cycleCells} />
          <div className="evidence-box">
            <b>导致回路的路径证据（沿出气边追踪，首尾相接）：</b>
            <div style={{ marginTop: 6 }}>
              {cycleDiag.evidence.map((e, i) => (
                <span key={i}>
                  <span className="path-node">{cellShort(e.from, draft.cols)}</span>
                  <span className="path-side"> —{ARROW[e.side]} {SIDE_LABEL[e.side]}出气→ </span>
                  <span className="path-node">{cellShort(e.to, draft.cols)}</span>
                  {i < cycleDiag.evidence.length - 1 ? '　' : '（回到起点，成环）'}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
