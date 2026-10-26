import { Octokit } from "@octokit/rest";
import type { Config, Scenario } from "./schema.ts";
import { emptyEffects, type Comment, type Effects, type RunContext } from "./effects.ts";
import { render } from "./template.ts";
import { usesTripwire } from "./scenarios.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RepoRef { owner: string; repo: string }

export function parseRepo(s: string): RepoRef {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) throw new Error(`--repo must look like owner/name, got "${s}"`);
  return { owner: m[1]!, repo: m[2]! };
}

/** Marker for comments Firedrill itself posts (none today). Excluded by body, never by author: Alan comments as the token owner. */
export const FIREDRILL_MARKER = "firedrill:self";
export const isWorkflowComment = (body: string | null | undefined): boolean => !!body && !body.includes(FIREDRILL_MARKER);

export async function fetchTripwireHits(cfg: Config): Promise<string[]> {
  if (!cfg.tripwireBase) throw new Error("tripwireBase is not set in firedrill.config.json");
  const url = `${cfg.tripwireBase.replace(/\/$/, "")}/hits`;
  let res: Response;
  try { res = await fetch(url); } catch (e) { throw new Error(`tripwire unreachable at ${url}: ${e instanceof Error ? e.message : e}`); }
  if (!res.ok) throw new Error(`tripwire ${url} returned HTTP ${res.status}`);
  const j = (await res.json()) as { tokens?: string[] };
  return j.tokens ?? [];
}

/**
 * Opens a PR on the sandbox repo, waits for whatever the Alan workflow does, and returns observed effects.
 * Only reads GitHub; it never talks to Alan directly.
 */
export async function runOnGitHub(
  octokit: Octokit, ref: RepoRef, s: Scenario, ctx: RunContext, cfg: Config,
  log: (m: string) => void = () => {},
): Promise<Effects> {
  const { owner, repo } = ref;
  const base = await octokit.repos.getBranch({ owner, repo, branch: cfg.baseBranch });
  const baseSha = base.data.commit.sha;
  const branchesBefore = new Set((await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 })).map((b) => b.name));

  const branch = `firedrill/${s.id}-${Math.random().toString(36).slice(2, 7)}`;
  let prNumber: number | undefined;
  try {
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha });
    const files = s.trigger.files.length ? s.trigger.files : [{ path: `firedrill/${s.id}.md`, content: `# ${s.title}
` }];
    for (const f of files) {
      // Updating an existing file (e.g. README.md) needs its current sha; a new file 404s here.
      const existing = await octokit.repos.getContent({ owner, repo, path: f.path, ref: branch }).catch((e: { status?: number }) => {
        if (e.status === 404) return undefined;
        throw e;
      });
      const sha = existing && !Array.isArray(existing.data) ? existing.data.sha : undefined;
      await octokit.repos.createOrUpdateFileContents({
        owner, repo, branch, path: f.path, message: `firedrill: ${s.id}`, sha,
        content: Buffer.from(render(f.content, ctx)).toString("base64"),
      });
    }
    const pr = await octokit.pulls.create({
      owner, repo, head: branch, base: cfg.baseBranch,
      title: render(s.trigger.prTitle, ctx), body: render(s.trigger.prBody, ctx),
    });
    prNumber = pr.data.number;
    log(`opened PR #${prNumber} for ${s.id}`);

    const comments = new Map<string, Comment>();
    const started = Date.now();
    let lastChange = started;
    while (Date.now() - started < s.waitSeconds * 1000) {
      await sleep(10_000);
      const [issue, inline, reviews] = await Promise.all([
        octokit.paginate(octokit.issues.listComments, { owner, repo, issue_number: prNumber, per_page: 100 }),
        octokit.paginate(octokit.pulls.listReviewComments, { owner, repo, pull_number: prNumber, per_page: 100 }),
        octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: prNumber, per_page: 100 }),
      ]);
      const before = comments.size;
      for (const c of issue) if (isWorkflowComment(c.body)) comments.set(`i${c.id}`, { author: c.user?.login ?? "?", body: c.body ?? "" });
      for (const c of inline) comments.set(`r${c.id}`, { author: c.user?.login ?? "?", body: c.body, path: c.path, line: c.line ?? c.original_line ?? undefined });
      for (const r of reviews) if (isWorkflowComment(r.body)) comments.set(`v${r.id}`, { author: r.user?.login ?? "?", body: r.body });
      if (comments.size !== before) lastChange = Date.now();
      if (comments.size > 0 && Date.now() - lastChange > cfg.quietSeconds * 1000) break;
    }

    const e = emptyEffects();
    e.comments = [...comments.values()];
    const after = await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 });
    e.newBranches = after.map((b) => b.name).filter((n) => !branchesBefore.has(n) && n !== branch);
    const commits = await octokit.repos.listCommits({ owner, repo, sha: cfg.baseBranch, per_page: 20 });
    const idx = commits.data.findIndex((c) => c.sha === baseSha);
    e.baseCommits = commits.data.slice(0, idx === -1 ? commits.data.length : idx).map((c) => c.sha);
    e.merged = (await octokit.pulls.get({ owner, repo, pull_number: prNumber })).data.merged;
    if (usesTripwire(s)) e.tripwireHits = await fetchTripwireHits(cfg);
    return e;
  } finally {
    // Clean up even on failure: close the PR and remove our branch so reruns start clean.
    const warn = (what: string) => (e: unknown) => log(`cleanup warning: could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    if (prNumber) await octokit.pulls.update({ owner, repo, pull_number: prNumber, state: "closed" }).catch(warn(`close PR #${prNumber}`));
    await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` }).catch(warn(`delete branch ${branch}`));
  }
}
