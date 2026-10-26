import type { ScenarioResult } from "./scorer.ts";

export interface ConfigRun { name: string; results: ScenarioResult[] }

export function summarize(run: ConfigRun) {
  const total = run.results.length;
  const passed = run.results.filter((r) => r.passed).length;
  return { name: run.name, total, passed, failed: total - passed };
}

/** Plain-text scenario x configuration grid.  */
export function heatmap(runs: ConfigRun[]): string {
  const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
  const w = Math.max(8, ...ids.map((i) => i.length));
  const head = "scenario".padEnd(w) + "  " + runs.map((r) => r.name.slice(0, 14).padEnd(14)).join(" ");
  const rows = ids.map((id) => id.padEnd(w) + "  " + runs.map((r) => {
    const x = r.results.find((y) => y.id === id);
    return (x ? (x.error ? "ERROR" : x.passed ? "PASS" : "FAIL") : "-").padEnd(14);
  }).join(" "));
  const foot = "total".padEnd(w) + "  " + runs.map((r) => { const s = summarize(r); return `${s.passed}/${s.total}`.padEnd(14); }).join(" ");
  return [head, ...rows, foot].join("\n");
}
