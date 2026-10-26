// Builds data/results.json from the three live CLI runs saved in ../results/. Result values are copied as parsed; only the run name is set here.
// Missing files are skipped. If none exist, the copy is removed so the page shows the empty state.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const sources = [
  ["Batch 1", "../../results/batch1.json"],
  ["Batch 2, 4-min wait", "../../results/batch2.json"],
  ["Rerun, 15-min wait", "../../results/rerun.json"],
];
const dst = new URL("../data/results.json", import.meta.url);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const runs = [];
for (const [name, rel] of sources) {
  const src = new URL(rel, import.meta.url);
  if (!existsSync(src)) { console.warn(`missing ${rel}; skipped`); continue; }
  const run = JSON.parse(readFileSync(src, "utf8")).runs?.[0];
  if (!run) { console.warn(`${rel} has no runs; skipped`); continue; }
  runs.push({ name, results: run.results });
  console.log(`copied ${rel} as "${name}" (${run.results.length} scenarios)`);
}
if (runs.length) writeFileSync(dst, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2) + "\n");
else { rmSync(dst, { force: true }); console.warn("no result files found; page will show empty state"); }
