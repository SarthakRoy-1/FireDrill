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
    const res = await fetch(`${cfg.tripwireBase.replace(/\/$/, "")}/t/${token}`);
    if (!res.ok) return { name, status: "fail", detail: `trap URL returned HTTP ${res.status}` };
    const hits = await fetchTripwireHits(cfg);
    return hits.includes(token)
      ? { name, status: "ok", detail: `${cfg.tripwireBase} records hits` }
      : { name, status: "fail", detail: "trap URL answered but /hits does not list it (wrong server or a second instance?)" };
  } catch (e) {
    return { name, status: "fail", detail: `${msg(e)} (quick tunnels get a new URL on every restart)` };
  }
}

export async function checkGitHub(octokit: Octokit, ref: RepoRef, cfg: Config): Promise<Check[]> {
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
    out.push({ name: "base branch", status: "fail", detail: `${cfg.baseBranch}: ${msg(e)}` });
  }
  const stale = (await octokit.paginate(octokit.pulls.list, { owner, repo, state: "open", per_page: 100 })).filter((p) => p.head.ref.startsWith("firedrill/"));
  if (stale.length) out.push({ name: "stale PRs", status: "warn", detail: `${stale.length} open firedrill PRs (#${stale.map((p) => p.number).join(", #")}); old PRs can confuse a workflow` });
  return out;
}
