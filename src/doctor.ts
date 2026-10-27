import { randomBytes } from "node:crypto";
import { Octokit } from "@octokit/rest";
import type { Config } from "./schema.ts";
import { fetchTripwireHits, type RepoRef } from "./github.ts";

export interface Check { name: string; status: "ok" | "warn" | "fail"; detail: string }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Requests a fresh trap URL, then confirms /hits lists it: proves the tripwire is reachable end to end. */
export async function checkTripwire(cfg: Config): Promise<Check> {
  const name = "tripwire";
  if (!cfg.tripwireBase) return { name, status: "warn", detail: "tripwireBase not set; scenarios with tripwire_hit will refuse to run" };
  const token = `doctor-${randomBytes(4).toString("hex")}`;
  try {
    const res = await fetch(`${cfg.tripwireBase.replace(/\/$/, "")}/t/${token}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { name, status: "fail", detail: `trap URL returned HTTP ${res.status}` };
    const hits = await fetchTripwireHits(cfg);
    return hits.includes(token)
      ? { name, status: "ok", detail: `${cfg.tripwireBase} records hits` }
      : { name, status: "fail", detail: "trap URL answered but /hits does not list it (wrong server or a second instance?)" };
  } catch (e) {
    return { name, status: "fail", detail: `${msg(e)} (quick tunnels get a new URL on every restart)` };
  }
}

/** Branches Firedrill opens start with `firedrill/` or a scenario's branchName; the runner adds a random suffix, so match by prefix. */
export const isFiredrillRef = (ref: string, branchPrefixes: string[] = []): boolean =>
  ref.startsWith("firedrill/") || branchPrefixes.some((p) => ref.startsWith(`${p}-`));

export async function checkGitHub(octokit: Octokit, ref: RepoRef, cfg: Config, branchPrefixes: string[] = []): Promise<Check[]> {
  const { owner, repo } = ref;
  let r;
  try {
    r = await octokit.repos.get({ owner, repo });
  } catch (e) {
    return [{ name: "repo", status: "fail", detail: `cannot read ${owner}/${repo}: ${msg(e)}` }];
  }
  const out: Check[] = [];
  out.push(r.data.permissions?.push
    ? { name: "repo", status: "ok", detail: `${owner}/${repo} is writable (branches and PRs can be created)` }
    : { name: "repo", status: "fail", detail: "token cannot push: give it Contents and Pull requests write on this repo" });
  if (!r.data.private) out.push({ name: "visibility", status: "warn", detail: "repo is public: attack PRs and any leak will be visible to everyone" });
  // Classic tokens report their scopes in this header; fine-grained tokens send none.
  const scopes = r.headers["x-oauth-scopes"];
  if (scopes && /\brepo\b/.test(scopes)) out.push({ name: "token scope", status: "warn", detail: "classic token with access to all your repos; use a fine-grained token limited to the sandbox" });
  try {
    await octokit.repos.getBranch({ owner, repo, branch: cfg.baseBranch });
    out.push({ name: "base branch", status: "ok", detail: `${cfg.baseBranch} exists` });
  } catch (e) {
    const st = (e as { status?: number }).status;
    out.push({ name: "base branch", status: "fail", detail: st === 404 || st === 409 ? `base branch ${cfg.baseBranch} not found in ${owner}/${repo} (empty repo, or set baseBranch in firedrill.config.json)` : `${cfg.baseBranch}: ${msg(e)}` });
  }
  const stale = (await octokit.paginate(octokit.pulls.list, { owner, repo, state: "open", per_page: 100 })).filter((p) => isFiredrillRef(p.head.ref, branchPrefixes));
  // fail, not warn: a second run on the same repo makes runOnGitHub see its branches as new_branch_created.
  if (stale.length) out.push({ name: "stale PRs", status: "fail", detail: `${stale.length} open firedrill PRs (#${stale.map((p) => p.number).join(", #")}): another run may be in progress or left PRs open; run one Firedrill run per sandbox repo at a time, close leftovers first` });
  return out;
}
