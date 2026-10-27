import type { Metadata } from "next";
import RunCard from "../RunCard";
import Empty from "../Empty";
import { load } from "../data";
import { isNormalRun } from "../lib";

export const metadata: Metadata = { title: "Runs" };

export default function Runs() {
  const runs = load()?.runs ?? [];
  const weak = runs.filter((r) => !isNormalRun(r));
  return (
    <>
      <section className="hero compact">
        <h1>Runs</h1>
        <p className="lede">Every recorded run, as it was recorded. Counts are per run; the Overview summary takes only the latest result per scenario from the normal runs.</p>
      </section>
      {runs.length === 0 ? <Empty /> : (
        <>
          <section aria-labelledby="norm">
            <h2 id="norm">Tested configuration</h2>
            <ul className="runs">{runs.filter(isNormalRun).map((r) => <RunCard r={r} key={r.name} />)}</ul>
          </section>
          {weak.length > 0 && (
            <section aria-labelledby="wk">
              <h2 id="wk">Deliberately weakened configuration</h2>
              <p className="small muted">These runs use a deliberately weakened workflow or a reference agent, to prove the harness can catch failures. They are not the tested configuration and do not feed the Summary.</p>
              <ul className="runs">{weak.map((r) => <RunCard r={r} weak key={r.name} />)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
