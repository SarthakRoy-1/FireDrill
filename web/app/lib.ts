// Types mirror ScenarioResult in ../src/scorer.ts (web cannot import the root TS). Data is read exactly as recorded.
export interface AssertionResult { assertion: { type: string }; observed: boolean; ok: boolean; kind: "must" | "mustNot"; detail: string }
export interface Scenario { id: string; title: string; class: string; passed: boolean; error?: string; timedOut?: boolean; results: AssertionResult[] }
export interface Score { score: number | null; errors: number; timeouts: number }
export interface Run { name: string; results: Scenario[]; score?: Score; generatedAt?: string; variant?: string }
export interface Data { generatedAt?: string; runs: Run[] }

export type Status = "PASS" | "FAIL" | "ERROR" | "TIMEOUT";

// Same rule as isTimeout in src/scorer.ts: only workflow_responded failed and no violation was observed, so the runner's wait ran out.
const isTimeout = (s: Scenario) => {
  if (s.timedOut !== undefined) return s.timedOut;
  const failed = s.results.filter((a) => !a.ok);
  return !s.error && failed.length === 1 && failed[0]!.kind === "must" && failed[0]!.assertion.type === "workflow_responded"
    && s.results.every((a) => a.kind === "must" || !a.observed);
};
// An error is never a pass: s.error wins over everything else.
export const statusOf = (s: Scenario): Status => (s.error ? "ERROR" : isTimeout(s) ? "TIMEOUT" : s.passed ? "PASS" : "FAIL");
export const tripHit = (s: Scenario) => s.results.some((a) => a.assertion.type === "tripwire_hit" && a.observed);

export const STATUS_HELP: Record<Status, string> = {
  PASS: "Every assertion held.",
  FAIL: "An assertion was violated.",
  ERROR: "The run itself failed. Never counted as a pass.",
  TIMEOUT: "Runner stopped waiting; nothing observed. Not a security failure, left out of the score.",
};

// --- Summary and timeout note (pure; unit-tested in lib.test.ts) ---
export const STATUSES: Status[] = ["PASS", "FAIL", "ERROR", "TIMEOUT"];

// Rule: a run is "normal" (counts toward the latest-per-scenario summary) unless copy-results.mjs tagged it with
// a variant other than "normal" (weakened, weak-agent), or its name says weak/mock (fallback for untagged data).
export const isNormalRun = (r: Run) => (r.variant ? r.variant === "normal" : !/weak|mock/i.test(r.name));

// Runs oldest to newest by recorded generatedAt; if any run lacks one, keep file order (never mix the two).
export function chronological(runs: Run[]): Run[] {
  return runs.every((r) => r.generatedAt) ? [...runs].sort((a, b) => Date.parse(a.generatedAt!) - Date.parse(b.generatedAt!)) : [...runs];
}

// Latest result per scenario id: the newest normal run that actually ran it ("not run" = absent from that run).
export function latestByScenario(runs: Run[]): Map<string, { run: Run; s: Scenario }> {
  const m = new Map<string, { run: Run; s: Scenario }>();
  for (const run of chronological(runs.filter(isNormalRun))) for (const s of run.results) m.set(s.id, { run, s });
  return m;
}

export function summarize(runs: Run[]): { counts: Record<Status, number>; scenarios: number; normalRuns: number } {
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, ERROR: 0, TIMEOUT: 0 };
  const latest = latestByScenario(runs);
  for (const { s } of latest.values()) counts[statusOf(s)]++;
  return { counts, scenarios: latest.size, normalRuns: runs.filter(isNormalRun).length };
}

// One sentence group per normal run that has TIMEOUT rows, saying whether a later normal run re-ran those scenarios. Wait length is never
// invented: the results data has no wait field, so the run's own label is the only place it appears.
export function timeoutNotes(runs: Run[]): string[] {
  const ordered = chronological(runs.filter(isNormalRun));
  const notes: string[] = [];
  ordered.forEach((run, i) => {
    const ids = run.results.filter((s) => statusOf(s) === "TIMEOUT").map((s) => s.id);
    if (!ids.length) return;
    let text = `${run.name}: ${ids.length} TIMEOUT (runner's wait ran out, no output seen).`;
    const later = ordered.slice(i + 1);
    const reruns = later.map((r) => ({ r, hit: r.results.filter((s) => ids.includes(s.id)) })).filter((x) => x.hit.length);
    if (!reruns.length) text += " Not re-run in a later run.";
    for (const { r, hit } of reruns) {
      const tally = STATUSES.map((st) => [st, hit.filter((s) => statusOf(s) === st).length] as const).filter(([, n]) => n).map(([st, n]) => `${n} ${st}`).join(", ");
      text += ` Re-run in "${r.name}": ${tally}${hit.length < ids.length ? ` (${ids.length - hit.length} not re-run)` : ""}.`;
    }
    notes.push(text);
  });
  return notes;
}

// A scenario "checks the tripwire" only if it carries a tripwire_hit assertion; others say nothing about it.
export const checksTripwire = (s: Scenario) => s.results.some((a) => a.assertion.type === "tripwire_hit");
export interface Tripwire { hits: number; checked: number }
// Per run: hits = scenarios where a trap URL was requested; checked = scenarios that have the assertion.
export const runTripwire = (r: Run): Tripwire => ({ hits: r.results.filter(tripHit).length, checked: r.results.filter(checksTripwire).length });
export const runTripwireHits = (r: Run) => runTripwire(r).hits;
// Summary card: normal-configuration runs only, so a weakened run's hits never leak in. hits sums every normal run; checked counts distinct scenario ids.
export function normalTripwire(runs: Run[]): Tripwire {
  const normal = runs.filter(isNormalRun);
  const ids = new Set(normal.flatMap((r) => r.results.filter(checksTripwire).map((s) => s.id)));
  return { hits: normal.reduce((n, r) => n + runTripwireHits(r), 0), checked: ids.size };
}
export const normalTripwireHits = (runs: Run[]) => normalTripwire(runs).hits;
// "0 hits in 4 scenarios that check it", or "not checked" when no scenario has the assertion.
export const tripText = ({ hits, checked }: Tripwire) =>
  checked ? `${hits} hit${hits === 1 ? "" : "s"} in ${checked} scenario${checked === 1 ? "" : "s"} that check${checked === 1 ? "s" : ""} it` : "not checked";
