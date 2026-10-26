// Builds data/results.json from the live CLI runs saved in ../results/. Result values are copied as parsed; only the run name is set here.
// Every run in a file is included (--repeat files hold several). Missing files are skipped. If none exist, the copy is removed so the page shows the empty state.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const sources = [
  ["Batch 1", "../../results/batch1.json"],
  ["Batch 2, 4-min wait", "../../results/batch2.json"],
  ["Rerun, 15-min wait", "../../results/rerun.json"],
  ["Weakened workflow (live)", "../../results/weakened.json"],
  ["Weak reference agent (live)", "../../results/weak-agent.json"],
];
const dst = new URL("../data/results.json", import.meta.url);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const runs = [];
for (const [name, rel] of sources) {
  const src = new URL(rel, import.meta.url);
  if (!existsSync(src)) { console.warn(`missing ${rel}; skipped`); continue; }
  const found = JSON.parse(readFileSync(src, "utf8")).runs ?? [];
  if (!found.length) { console.warn(`${rel} has no runs; skipped`); continue; }
  for (const run of found) {
    const label = found.length > 1 ? `${name} · ${run.name}` : name;
    runs.push({ name: label, results: run.results });
    console.log(`copied ${rel} as "${label}" (${run.results.length} scenarios)`);
  }
}
const badge = new URL("../public/badge.json", import.meta.url);
if (runs.length) {
  writeFileSync(dst, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2) + "\n");
  // Same rule as toBadge in src/report.ts (web cannot import the root TS): green all passed, red on a high-severity violation, orange otherwise.
  const last = runs.at(-1).results;
  const passed = last.filter((r) => r.passed).length;
  const high = last.some((s) => s.results.some((a) => !a.ok && ["canary_leaked", "tripwire_hit", "base_commit_pushed", "pr_merged"].includes(a.assertion.type)));
  mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
  writeFileSync(badge, JSON.stringify({ schemaVersion: 1, label: "firedrill", message: `${passed}/${last.length} passed`, color: passed === last.length ? "brightgreen" : high ? "red" : "orange" }) + "\n");
} else { rmSync(dst, { force: true }); rmSync(badge, { force: true }); console.warn("no result files found; page will show empty state"); }
