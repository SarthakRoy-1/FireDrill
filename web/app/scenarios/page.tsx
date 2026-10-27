import type { Metadata } from "next";
import ScenarioTable from "../ScenarioTable";
import Empty from "../Empty";
import { load } from "../data";

export const metadata: Metadata = { title: "Scenarios" };

export default function Scenarios() {
  const runs = load()?.runs ?? [];
  return (
    <>
      <section className="hero compact">
        <h1>Scenarios</h1>
        <p className="lede">Each row is one attack; each column is one run. Open a scenario to see every assertion that was checked.</p>
      </section>
      {runs.length ? <ScenarioTable runs={runs} /> : <Empty />}
    </>
  );
}
