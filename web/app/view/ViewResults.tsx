"use client";
import { useState } from "react";
import { Icon } from "../Icon";
import RunCard from "../RunCard";
import { STATUS_HELP, countStatuses, parseResultsFile, statusOf, type Run } from "../lib";

const MAX_BYTES = 5_000_000;

export default function ViewResults() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [file, setFile] = useState("");
  const [error, setError] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setRuns(null); setError(""); setFile(f.name);
    if (f.size > MAX_BYTES) { setError("That file is over 5 MB, so it is not a FireDrill results file."); return; }
    try { setRuns(parseResultsFile(await f.text())); } catch (err) { setError((err as Error).message); }
  }

  const total = runs?.flatMap((r) => r.results) ?? [];
  return (
    <>
      <section aria-labelledby="pick">
        <h2 id="pick">Choose your file</h2>
        <p className="small muted">Run <code>npx tsx src/cli.ts run scenarios/attacks --repo you/your-sandbox --out results.json</code> first, then pick that file here.</p>
        <p><input type="file" accept=".json,application/json" onChange={onPick} aria-label="FireDrill results.json" aria-describedby={error ? "view-err" : undefined} /></p>
        {error && <p id="view-err" className="note" role="alert"><strong>{file}:</strong> {error}</p>}
      </section>

      {runs && (
        <>
          <section aria-labelledby="vsum">
            <h2 id="vsum">Summary: {file}</h2>
            <p className="small muted">{runs.length} run{runs.length === 1 ? "" : "s"}, {total.length} scenario result{total.length === 1 ? "" : "s"}. Counts add up every run in the file.</p>
            <div className="cards">
              {countStatuses(total).map(({ st, n }) => (
                <div className={`stat ${st}${n ? "" : " zero"}`} key={st}>
                  <div className="cap"><Icon s={st} /> {st}</div>
                  <div className="num">{n}</div>
                  <div className="small muted">{STATUS_HELP[st]}</div>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="vruns">
            <h2 id="vruns">By run</h2>
            <ul className="runs">{runs.map((r, i) => <RunCard r={r} key={i} />)}</ul>
          </section>

          {runs.map((r, i) => {
            const bad = r.results.filter((s) => statusOf(s) !== "PASS");
            return (
              <section aria-labelledby={`vd${i}`} key={i}>
                <h2 id={`vd${i}`}>{r.name}: {bad.length ? "what did not pass" : "everything held"}</h2>
                {bad.length === 0 ? <p className="small muted">Every scenario in this run passed.</p> : (
                  <ul className="entries">
                    {bad.map((s) => {
                      const st = statusOf(s);
                      const why = s.error ?? s.results.filter((a) => !a.ok).map((a) => `${a.assertion.type}${a.detail ? `: ${a.detail}` : ""}`).join("; ");
                      return <li key={s.id}><span className="entry"><span className="e-name"><Icon s={st} /> {st} · {s.id}</span><span className="e-meta">{s.title}{s.class ? ` · ${s.class}` : ""}</span><span className="small muted">{why}</span></span></li>;
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
