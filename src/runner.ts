import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { Octokit } from "@octokit/rest";
import type { Config, Scenario } from "./schema.ts";
import { errorResult, isTimeout, score } from "./scorer.ts";
import { contextFor } from "./template.ts";
import type { ConfigRun } from "./report.ts";
import { isAuthError, runOnGitHub, sleepUnless, type RepoRef } from "./github.ts";

/** Write `<path>.tmp`, then rename over the target, so a crash never leaves half a file. */
export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  try { renameSync(tmp, path); } catch {
    // shortcut: on Windows a scanner or OneDrive can briefly lock the target; fall back to a direct write rather than lose the results.
    writeFileSync(path, data);
    try { unlinkSync(tmp); } catch { /* leave the tmp file */ }
  }
}

export interface RunAllOpts {
  out: string;
  signal?: AbortSignal;
  /** Pause between scenarios (not before the first) to stay under GitHub's secondary rate limits. */
  pauseMs?: number;
  pollMs?: number;
  log?: (m: string) => void;
}
export type RunEnd = "done" | "interrupted" | "auth";

/**
 * Runs every scenario of every run, writing the results file after each one.
 * Ctrl+C (signal): the current scenario is cleaned up and recorded as ERROR "interrupted", then the run stops.
 * A rejected token stops the run after recording that scenario, so the rest are not failed one by one.
 */
export async function runScenarios(octokit: Octokit, repo: RepoRef, selected: Scenario[], runs: ConfigRun[], cfg: Config, o: RunAllOpts): Promise<RunEnd> {
  const log = o.log ?? (() => {});
  const save = () => writeAtomic(o.out, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2));
  for (const { name: runName, results } of runs) for (const [k, s] of selected.entries()) {
    if (k > 0) await sleepUnless(o.pauseMs ?? 2000, o.signal);
    if (o.signal?.aborted) return "interrupted";
    log(`> ${s.id}${runs.length > 1 ? ` (${runName})` : ""}`);
    try {
      const ctx = contextFor(cfg, s);
      const r = score(s, await runOnGitHub(octokit, repo, s, ctx, cfg, (m) => log(`  ${m}`), { signal: o.signal, pollMs: o.pollMs }), ctx);
      log(`  ${r.passed ? "PASS" : isTimeout(r) ? "TIMEOUT" : "FAIL"}`);
      results.push(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ERROR: ${msg}`);
      results.push(errorResult(s, o.signal?.aborted ? "interrupted" : msg));
      save();
      if (o.signal?.aborted) return "interrupted";
      if (isAuthError(e)) {
        log("\nGitHub rejected the token (expired, revoked or missing access). Create a new fine-grained token with Contents, Pull requests and Issues write on the sandbox repo, set GITHUB_TOKEN, and rerun. Stopping.");
        return "auth";
      }
      continue;
    }
    save();
  }
  return "done";
}
