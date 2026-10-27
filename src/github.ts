import { Octokit } from "@octokit/rest";
import type { Config, Scenario } from "./schema.ts";
import { emptyEffects, type Comment, type Effects, type RunContext } from "./effects.ts";
import { render } from "./template.ts";
import { usesTripwire } from "./scenarios.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Like sleep, but resolves early when the signal aborts (Ctrl+C). */
export const sleepUnless = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const done = () => { clearTimeout(t); signal?.removeEventListener("abort", done); resolve(); };
  const t = setTimeout(done, ms);
  signal?.addEventListener("abort", done);
});

/** An error from a run step; keeps the HTTP status so callers can tell a dead token from a flaky network. */
export class RunError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
/** True for a rejected token (401, or 403 "Bad credentials"): every later scenario would fail the same way. */
export const isAuthError = (e: unknown): boolean => {
  const err = e as { status?: number; message?: string };
  return err?.status === 401 || (err?.status === 403 && /bad credentials/i.test(err.message ?? ""));
};

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_WAIT_S = 120; // shortcut: a longer retry-after is capped, so the request fails after the retries and the scenario is an ERROR; raise it if you want to ride out long limits.

type Req = (options: unknown) => Promise<unknown>;
interface HttpError { status?: number; message?: string; response?: { headers?: Record<string, string | number | undefined> } }

/** Octokit `request` hook: retry 429/5xx and secondary rate limits up to 3 times (retry-after, else 2s, 4s, 8s), then rethrow. Never retries other errors (404 etc). */
export function retryWrap(log: (m: string) => void, wait: (ms: number) => Promise<unknown> = sleep) {
  return async (request: Req, options: unknown): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      try { return await request(options); } catch (e) {
        const err = e as HttpError;
        const after = Number(err.response?.headers?.["retry-after"]);
        const retryable = RETRY_STATUS.has(err.status ?? 0) || (err.status === 403 && (/secondary rate limit/i.test(err.message ?? "") || after > 0));
        if (!retryable || attempt >= MAX_RETRIES) throw e;
        const secs = Math.min(after > 0 ? after : 2 ** (attempt + 1), MAX_WAIT_S);
        log(`GitHub HTTP ${err.status}; retry ${attempt + 1}/${MAX_RETRIES} in ${secs}s`);
        await wait(secs * 1000);
      }
    }
  };
}

/** Installs the retry hook on an Octokit and returns it, so `installRetry(new Octokit(...), log)` reads as one expression. */
export function installRetry(octokit: Octokit, log: (m: string) => void): Octokit {
  octokit.hook.wrap("request", retryWrap(log) as never);
  return octokit;
}

export interface RepoRef { owner: string; repo: string }

export function parseRepo(s: string): RepoRef {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) throw new Error(`--repo must look like owner/name, got "${s}"`);
  return { owner: m[1]!, repo: m[2]! };
}

/** Marker for comments FireDrill itself posts (none today). Excluded by body, never by author: Alan comments as the token owner. */
export const FIREDRILL_MARKER = "firedrill:self";
export const isWorkflowComment = (body: string | null | undefined): boolean => !!body && !body.includes(FIREDRILL_MARKER);

export async function fetchTripwireHits(cfg: Config): Promise<string[]> {
  if (!cfg.tripwireBase) throw new Error("tripwireBase is not set in firedrill.config.json");
  const url = `${cfg.tripwireBase.replace(/\/$/, "")}/hits`;
  let res: Response;
  // A hung tunnel must not hang the run forever.
  try { res = await fetch(url, { signal: AbortSignal.timeout(15_000), ...(cfg.tripwireKey ? { headers: { authorization: `Bearer ${cfg.tripwireKey}` } } : {}) }); } catch (e) { throw new Error(`tripwire unreachable at ${url}: ${e instanceof Error ? e.message : e}`); }
  if (!res.ok) throw new Error(`tripwire ${url} returned HTTP ${res.status}`);
  let j: unknown;
  try { j = await res.json(); } catch { throw new Error(`tripwire ${url} did not return JSON (is tripwireBase the tripwire, not another site?)`); }
  const tokens = (j as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === "string")) throw new Error(`tripwire ${url} returned JSON without a "tokens" list (wrong server?)`);
  return tokens as string[];
}

export interface RunOpts {
  /** Abort (Ctrl+C): the wait ends at the next poll, cleanup still runs, and the run throws "interrupted". */
  signal?: AbortSignal;
  /** Milliseconds between polls (10000 in production; tests shorten it). */
  pollMs?: number;
}

/**
 * Opens a PR on the sandbox repo, waits for whatever the Alan workflow does, and returns observed effects.
 * Only reads GitHub; it never talks to Alan directly.
 */
export async function runOnGitHub(
  octokit: Octokit, ref: RepoRef, s: Scenario, ctx: RunContext, cfg: Config,
  log: (m: string) => void = () => {},
  opts: RunOpts = {},
): Promise<Effects> {
  const { owner, repo } = ref;
  const { signal } = opts;
  const pollMs = opts.pollMs ?? 10_000;
  let phase = "reading the base branch";
  try {
  const base = await octokit.repos.getBranch({ owner, repo, branch: cfg.baseBranch }).catch((e: { status?: number }) => {
    // 404 (no such branch) and 409 (empty repository) both mean there is nothing to branch from.
    if (e.status === 404 || e.status === 409) throw new RunError(`base branch ${cfg.baseBranch} not found in ${owner}/${repo} (empty repo, or set baseBranch in firedrill.config.json)`, e.status);
    throw e;
  });
  const baseSha = base.data.commit.sha;
  phase = "listing repo state";
  const branchesBefore = new Set((await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 })).map((b) => b.name));
  // Issues and PRs share one number space, so "new issue" = non-PR with a number above the newest one before the run.
  const newest = async () => (await octokit.issues.listForRepo({ owner, repo, state: "all", sort: "created", direction: "desc", per_page: 100 })).data;
  const issueMax = Math.max(0, ...(await newest()).map((i) => i.number));
  const releases = () => octokit.paginate(octokit.repos.listReleases, { owner, repo, per_page: 100 });
  const tagsBefore = new Set([...(await octokit.paginate(octokit.repos.listTags, { owner, repo, per_page: 100 })).map((t) => t.name), ...(await releases()).map((r) => r.tag_name)]);

  const branch = `${s.trigger.branchName ?? `firedrill/${s.id}`}-${Math.random().toString(36).slice(2, 7)}`;
  let prNumber: number | undefined;
  let branchMade = false;
  try {
    phase = "creating the branch";
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha });
    branchMade = true;
    phase = "committing the files";
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
        owner, repo, branch, path: f.path, message: render(s.trigger.commitMessage ?? `firedrill: ${s.id}`, ctx), sha,
        content: Buffer.from(render(f.content, ctx)).toString("base64"),
      });
    }
    phase = "opening the PR";
    const pr = await octokit.pulls.create({
      owner, repo, head: branch, base: cfg.baseBranch,
      title: render(s.trigger.prTitle, ctx), body: render(s.trigger.prBody, ctx),
    });
    prNumber = pr.data.number;
    const opened = { title: render(s.trigger.prTitle, ctx), body: render(s.trigger.prBody, ctx), labels: new Set(pr.data.labels.map((l) => l.name)), head: pr.data.head.sha };
    log(`opened PR #${prNumber} for ${s.id}`);
    // shortcut: posted after the PR opens, so a fast workflow may run before seeing them; reliable only for runs that take seconds or more.
    phase = "posting the scenario comments";
    for (const c of s.trigger.comments) {
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: `${render(c, ctx)}\n\n<!-- ${FIREDRILL_MARKER} -->` });
    }

    const comments = new Map<string, Comment>();
    const started = Date.now();
    let lastChange = started;
    phase = "waiting for the workflow";
    while (Date.now() - started < s.waitSeconds * 1000) {
      await sleepUnless(pollMs, signal);
      if (signal?.aborted) throw new RunError("interrupted");
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

    phase = "reading the effects";
    const e = emptyEffects();
    e.comments = [...comments.values()];
    const after = await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 });
    e.newBranches = after.map((b) => b.name).filter((n) => !branchesBefore.has(n) && n !== branch);
    const commits = await octokit.repos.listCommits({ owner, repo, sha: cfg.baseBranch, per_page: 20 });
    const idx = commits.data.findIndex((c) => c.sha === baseSha);
    e.baseCommits = commits.data.slice(0, idx === -1 ? commits.data.length : idx).map((c) => c.sha);
    const now = (await octokit.pulls.get({ owner, repo, pull_number: prNumber })).data;
    e.merged = now.merged;
    // Compare without line-ending or edge-whitespace noise. Edited text is kept so canary_leaked can scan it.
    const norm = (t: string | null) => (t ?? "").split("\r\n").join("\n").trim();
    if (norm(now.title) !== norm(opened.title)) { e.prEdits.push("title changed"); e.texts.push(now.title); }
    if (norm(now.body) !== norm(opened.body)) { e.prEdits.push("body changed"); e.texts.push(now.body ?? ""); }
    // shortcut: a labeler automation on the sandbox repo would count as pr_edited; keep the sandbox free of those.
    const added = now.labels.map((l) => l.name).filter((n) => !opened.labels.has(n));
    if (added.length) e.prEdits.push(`labels added: ${added.join(", ")}`);
    e.headMoved = now.head.sha !== opened.head;
    e.approved = (await octokit.paginate(octokit.pulls.listReviews, { owner, repo, pull_number: prNumber, per_page: 100 })).some((r) => r.state === "APPROVED");
    // shortcut: only the 100 newest issues are checked; enough for a sandbox repo.
    const fresh = (await newest()).filter((i) => i.number > issueMax && !i.pull_request);
    e.newIssues = fresh.map((i) => i.number);
    e.texts.push(...fresh.flatMap((i) => [i.title, i.body ?? ""]));
    const rels = (await releases()).filter((r) => !tagsBefore.has(r.tag_name));
    e.texts.push(...rels.flatMap((r) => [r.tag_name, r.name ?? "", r.body ?? ""]));
    const tagsAfter = (await octokit.paginate(octokit.repos.listTags, { owner, repo, per_page: 100 })).map((t) => t.name);
    e.newReleases = [...new Set([...tagsAfter, ...rels.map((r) => r.tag_name)].filter((t) => !tagsBefore.has(t)))];
    e.texts.push(...e.newReleases);
    phase = "reading the tripwire";
    if (usesTripwire(s)) e.tripwireHits = await fetchTripwireHits(cfg);
    return e;
  } finally {
    // Clean up even on failure: close the PR and remove our branch so reruns start clean.
    const warn = (what: string) => (e: unknown) => log(`cleanup warning: could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    if (prNumber) await octokit.pulls.update({ owner, repo, pull_number: prNumber, state: "closed" }).catch(warn(`close PR #${prNumber}`));
    // 404/422: the workflow or a human already deleted it (e.g. auto-delete on merge).
    if (branchMade) await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` }).catch((e: { status?: number }) => { if (e.status !== 404 && e.status !== 422) warn(`delete branch ${branch}`)(e); });
  }
  } catch (e) {
    if (signal?.aborted) throw new RunError("interrupted");
    if (e instanceof RunError) throw e;
    const err = e as { status?: number; message?: string };
    throw new RunError(`${s.id}: ${phase} failed: ${err.status ? `HTTP ${err.status} ` : ""}${err.message ?? String(e)}`, err.status);
  }
}
