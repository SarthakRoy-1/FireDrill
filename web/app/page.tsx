import Link from "next/link";
import { Icon } from "./Icon";
import RunCard from "./RunCard";
import Empty from "./Empty";
import { load } from "./data";
import { STATUSES, STATUS_HELP, isNormalRun, normalTripwire, scenarioIndex, summarize, tripText, when } from "./lib";

export default function Overview() {
  const data = load();
  const runs = data?.runs ?? [];
  const sum = summarize(runs);
  const trip = normalTripwire(runs);
  const idx = scenarioIndex(runs);
  const classes = new Set(idx.map((x) => x.cls)).size;
  const weak = runs.filter((r) => !isNormalRun(r));
  const stamp = when(data?.generatedAt);

  return (
    <>
      <section className="hero">
        <h1>Firedrill results</h1>
        <p className="lede">An open-source test runner that attacks an Alan workflow with prompt-injection scenarios, then grades what it did with deterministic checks on GitHub and a tripwire. This site shows what <strong>one tested configuration</strong> did, nothing more.</p>
        {runs.length > 0 && (
          <ul className="chips" aria-label="Run metadata">
            <li>{runs.length} live run{runs.length === 1 ? "" : "s"}</li>
            <li>{sum.scenarios} scenarios</li>
            {stamp && <li>Generated {stamp}</li>}
          </ul>
        )}
      </section>

      {runs.flatMap((r) => r.results).length === 0 ? <Empty /> : (
        <>
          <section aria-labelledby="sum">
            <h2 id="sum">Summary</h2>
            <p className="small muted">Latest result per scenario across {sum.normalRuns} run{sum.normalRuns === 1 ? "" : "s"} ({sum.scenarios} scenarios). Runs of a weakened or reference-agent configuration are never used here.</p>
            <div className="cards">
              {STATUSES.map((st) => { const n = sum.counts[st]; return (
                <div className={`stat ${st}${n ? "" : " zero"}`} key={st}>
                  <div className="cap"><Icon s={st} /> {st}</div>
                  <div className="num">{n}</div>
                  <div className="small muted">{STATUS_HELP[st]}</div>
                </div>
              ); })}
              <div className={"stat trip" + (trip.hits ? " hit" : "")}>
                <div className="cap">Tripwire hits, normal runs</div>
                <div className="num">{trip.checked ? trip.hits : "not checked"}</div>
                <div className="small muted">{trip.checked ? `${tripText(trip)}.` : "No scenario in these runs has a tripwire assertion."}{trip.hits ? " A trap URL was requested by the workflow in a normal run." : ""}</div>
              </div>
            </div>
          </section>

          <section aria-labelledby="byrun">
            <h2 id="byrun">By run</h2>
            <ul className="runs">{runs.filter(isNormalRun).map((r) => <RunCard r={r} key={r.name} />)}</ul>
            {weak.length > 0 && <p className="small muted">{weak.length} weakened or reference run{weak.length === 1 ? " is" : "s are"} kept apart, on the <Link href="/runs/">Runs page</Link>.</p>}
          </section>

          <section aria-labelledby="explore">
            <h2 id="explore">Explore</h2>
            <ul className="entries">
              <li><Link href="/scenarios/" className="entry"><span className="e-name">Scenarios</span><span className="e-meta">{idx.length} attacks in {classes} classes</span><span className="small muted">Every scenario with its status per run, and a page for each assertion trace.</span></Link></li>
              <li><Link href="/runs/" className="entry"><span className="e-name">Runs</span><span className="e-meta">{runs.length} runs, {weak.length} weakened</span><span className="small muted">Counts, score and tripwire for every run, including the weakened reference.</span></Link></li>
              <li><Link href="/method/" className="entry"><span className="e-name">Method</span><span className="e-meta">How grading works</span><span className="small muted">Status definitions, the score formula, and the honest limits of this evidence.</span></Link></li>
              <li><Link href="/run/" className="entry"><span className="e-name">Run it yourself</span><span className="e-meta">Generate the CLI commands</span><span className="small muted">Enter your sandbox repo and copy the exact steps. Nothing is sent from this page.</span></Link></li>
            </ul>
            <p className="small links"><a href="/report.html">Standalone report of the live runs</a><a href="https://github.com/SarthakRoy-1/FireDrill/blob/main/docs/EVIDENCE.md">Evidence pack (hashes, selftest, CI)</a></p>
          </section>
        </>
      )}
    </>
  );
}
