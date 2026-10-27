"use client";
import { Fragment, useMemo, useState } from "react";
import { Chip, Icon } from "./Icon";
import { statusOf, type Run, type Scenario } from "./lib";

type SortKey = "id" | "class";
const words = (t: string) => t.replace(/_/g, " ");

function Trace({ s }: { s: Scenario }) {
  const st = statusOf(s);
  return (
    <div className="trace">
      <div className="trace-head"><Chip s={st} />{s.error && <span className="small">error: {s.error}</span>}</div>
      {s.results.length > 0 && (
        <ol className="steps">
          {s.results.map((a, i) => (
            <li key={i}>
              <span className={a.ok ? "PASS" : "FAIL"}><Icon s={a.ok ? "PASS" : "FAIL"} /><b>{a.ok ? "Held" : "Violated"}</b></span>
              <span className="step-body"><code>{a.kind === "mustNot" ? "must not " : "must "}{words(a.assertion.type)}</code><span className="muted"> · observed: {String(a.observed)} · {a.detail}</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ScenarioTable({ runs }: { runs: Run[] }) {
  const [sort, setSort] = useState<SortKey>("id");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const m = new Map<string, { id: string; title: string; cls: string }>();
    for (const r of runs) for (const s of r.results) if (!m.has(s.id)) m.set(s.id, { id: s.id, title: s.title, cls: s.class });
    let list = [...m.values()];
    if (onlyIssues) list = list.filter((x) => runs.some((r) => { const s = r.results.find((q) => q.id === x.id); return s && statusOf(s) !== "PASS"; }));
    return list.sort((a, b) => (sort === "class" ? a.cls.localeCompare(b.cls) || a.id.localeCompare(b.id) : a.id.localeCompare(b.id)));
  }, [runs, sort, onlyIssues]);

  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cols = runs.length + 2;
  const th = (k: SortKey, label: string) => (
    <th scope="col" aria-sort={sort === k ? "ascending" : "none"}>
      <button type="button" className="sortbtn" onClick={() => setSort(k)} aria-label={`Sort by ${label.toLowerCase()}`}>{label}<span aria-hidden="true">{sort === k ? " ↑" : ""}</span></button>
    </th>
  );

  return (
    <>
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with a non-PASS result</label>
        <span className="small muted" aria-live="polite">{rows.length} scenario{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="scroll" tabIndex={0} role="region" aria-label="Scenario results table, scrolls horizontally on narrow screens">
        <table>
          <caption className="sr">Each row is one attack scenario; each column is one live run. Use the scenario button to show its assertions.</caption>
          <thead><tr>{th("id", "Scenario")}{th("class", "Class")}{runs.map((r) => <th scope="col" key={r.name} className="runh">{r.name}</th>)}</tr></thead>
          <tbody>
            {rows.map((m) => {
              const isOpen = open.has(m.id);
              return (
                <Fragment key={m.id}>
                  <tr className={isOpen ? "open" : ""}>
                    <th scope="row" className="sc">
                      <button type="button" className="expand" aria-expanded={isOpen} aria-controls={`d-${m.id}`} onClick={() => toggle(m.id)}>
                        <svg className="caret" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                        <span><code>{m.id}</code><span className="muted title">{m.title}</span></span>
                      </button>
                    </th>
                    <td className="cls">{m.cls}</td>
                    {runs.map((r) => { const s = r.results.find((x) => x.id === m.id); return <td key={r.name}>{s ? <Chip s={statusOf(s)} /> : <span className="none">not run</span>}</td>; })}
                  </tr>
                  {isOpen && (
                    <tr className="detail" id={`d-${m.id}`}>
                      <td colSpan={cols}>
                        <div className="traces">
                          {runs.map((r) => { const s = r.results.find((x) => x.id === m.id); return s ? <div key={r.name}><div className="cap">{r.name}</div><Trace s={s} /></div> : null; })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
