"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip } from "./Icon";
import { isNormalRun, scenarioIndex, statusIn, type Run } from "./lib";

type SortKey = "id" | "class";

export default function ScenarioTable({ runs }: { runs: Run[] }) {
  const [sort, setSort] = useState<SortKey>("id");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const rows = useMemo(() => {
    let list = scenarioIndex(runs);
    if (onlyIssues) list = list.filter((x) => runs.some((r) => { const s = statusIn(r, x.id); return s && s !== "PASS"; }));
    return sort === "class" ? [...list].sort((a, b) => a.cls.localeCompare(b.cls) || a.id.localeCompare(b.id)) : list;
  }, [runs, sort, onlyIssues]);

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
          <caption className="sr">Each row is one attack scenario; each column is one run. The scenario name links to its page.</caption>
          <thead><tr>{th("id", "Scenario")}{th("class", "Class")}{runs.map((r) => <th scope="col" key={r.name} className="runh">{r.name}{!isNormalRun(r) && <span className="wk"> weakened</span>}</th>)}</tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <th scope="row" className="sc">
                  <Link href={`/scenarios/${m.id}/`} className="rowlink"><code>{m.id}</code><span className="muted title">{m.title}</span></Link>
                </th>
                <td className="cls">{m.cls}</td>
                {runs.map((r) => { const s = statusIn(r, m.id); return <td key={r.name}>{s ? <Chip s={s} /> : <span className="none">not run</span>}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
