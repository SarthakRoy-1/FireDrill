import type { Octokit } from "@octokit/rest";

/**
 * In-memory stand-in for the slice of Octokit that src/github.ts, src/doctor.ts and src/cleanup.ts call.
 * Calls go through `hook.wrap("request", ...)` like the real client, so retry behaviour is exercised.
 * A test scripts an "agent" with `onPrOpened` and injects failures with `failNext`.
 */
interface Pr { number: number; title: string; body: string; labels: string[]; ref: string; openedSha: string; state: "open" | "closed"; merged: boolean }
interface Issue { number: number; title: string; body: string; pull_request?: object }
type Hook = (request: (o: unknown) => Promise<unknown>, o: unknown) => Promise<unknown>;

export class HttpError extends Error {
  constructor(readonly status: number, message = `HTTP ${status}`, readonly response?: { headers: Record<string, string> }) { super(message); }
}

export class FakeGitHub {
  readonly calls: string[] = [];
  readonly branches = new Map<string, string>([["main", "base0"]]);
  readonly prs = new Map<number, Pr>();
  readonly issues: Issue[] = [];
  readonly tags: string[] = [];
  readonly releases: { tag_name: string; name: string; body: string }[] = [];
  readonly baseCommits: string[] = ["base0"]; // newest first
  readonly comments = new Map<number, { id: number; body: string; user: { login: string } }[]>();
  readonly reviews = new Map<number, { id: number; body: string; state: string; user: { login: string } }[]>();
  readonly reviewComments = new Map<number, { id: number; body: string; path: string; line: number; user: { login: string } }[]>();
  readonly files = new Map<string, Set<string>>(); // branch -> paths
  /** The scripted agent. Runs `agentDelayMs` after a PR opens. */
  onPrOpened?: (gh: FakeGitHub, pr: Pr) => void | Promise<void>;
  agentDelayMs = 30;
  private n = 100; // shared issue/PR number space starts above existing history
  private ids = 1;
  private sha = 1;
  private hook?: Hook;
  private failures: { method: string; status: number; message?: string; times: number }[] = [];
  private pending: Promise<unknown>[] = [];

  constructor(readonly owner = "o", readonly repo = "r") {}

  /** Make the next `times` calls of `method` (e.g. "pulls.create") throw an HTTP error. */
  failNext(method: string, status: number, times = 1, message?: string) { this.failures.push({ method, status, times, message }); }
  /** Wait for any scripted agent still running. */
  async settle() { await Promise.all(this.pending); }

  // ---- things a scripted agent can do ----
  comment(pr: number, body: string, login = "alan") { const l = this.comments.get(pr) ?? []; l.push({ id: this.ids++, body, user: { login } }); this.comments.set(pr, l); }
  review(pr: number, state: "APPROVED" | "COMMENTED", body = "", login = "alan") { const l = this.reviews.get(pr) ?? []; l.push({ id: this.ids++, body, state, user: { login } }); this.reviews.set(pr, l); }
  inline(pr: number, path: string, line: number, body: string) { const l = this.reviewComments.get(pr) ?? []; l.push({ id: this.ids++, body, path, line, user: { login: "alan" } }); this.reviewComments.set(pr, l); }
  newBranch(name: string) { this.branches.set(name, `s${this.sha++}`); }
  pushTo(branch: string) { this.branches.set(branch, `s${this.sha++}`); }
  pushToBase() { const s = `s${this.sha++}`; this.baseCommits.unshift(s); this.branches.set("main", s); }
  newIssue(title: string, body = "") { this.issues.push({ number: this.n++, title, body }); }
  newTag(name: string) { this.tags.push(name); }
  closePr(pr: number, merged = false) { const p = this.prs.get(pr)!; p.state = "closed"; p.merged = merged; }
  openPrs() { return [...this.prs.values()].filter((p) => p.state === "open"); }

  private async call<T>(method: string, fn: () => T): Promise<T> {
    const run = async () => {
      this.calls.push(method);
      const f = this.failures.find((x) => x.method === method && x.times > 0);
      if (f) { f.times--; throw new HttpError(f.status, f.message ?? `injected ${f.status} on ${method}`); }
      return fn();
    };
    return (this.hook ? this.hook(run as never, { method }) : run()) as Promise<T>;
  }
  private notFound(what: string): never { throw new HttpError(404, `Not Found: ${what}`); }
  private prOf(n: number) { return this.prs.get(n) ?? this.notFound(`PR #${n}`); }
  private shape(p: Pr) {
    return {
      number: p.number, title: p.title, body: p.body, state: p.state, merged: p.merged,
      labels: p.labels.map((name) => ({ name })),
      head: { sha: this.branches.get(p.ref) ?? p.openedSha, ref: p.ref, repo: { full_name: `${this.owner}/${this.repo}` } },
    };
  }

  /** The object to hand to code that expects an Octokit. */
  get octokit(): Octokit {
    const fn = <T>(name: string, f: (a: any) => T) => (a: any) => this.call(name, () => ({ data: f(a) } as { data: T }));
    const api = {
      hook: { wrap: (_name: string, h: Hook) => { this.hook = h; } },
      paginate: async (f: (a: unknown) => Promise<{ data: unknown[] }>, a: unknown) => (await f(a)).data,
      repos: {
        get: (_a: unknown) => this.call("repos.get", () => ({ data: { permissions: { push: true }, private: true }, headers: {} })),
        getBranch: fn("repos.getBranch", (a) => { const sha = this.branches.get(a.branch); return sha ? { commit: { sha } } : this.notFound(`branch ${a.branch}`); }),
        listBranches: fn("repos.listBranches", () => [...this.branches.keys()].map((name) => ({ name }))),
        getContent: fn("repos.getContent", (a) => (this.files.get(a.ref)?.has(a.path) ? { sha: "f1" } : this.notFound(a.path))),
        createOrUpdateFileContents: fn("repos.createOrUpdateFileContents", (a) => {
          if (!this.branches.has(a.branch)) this.notFound(`branch ${a.branch}`);
          const set = this.files.get(a.branch) ?? new Set<string>(); set.add(a.path); this.files.set(a.branch, set);
          this.branches.set(a.branch, `s${this.sha++}`); return {};
        }),
        listCommits: fn("repos.listCommits", () => this.baseCommits.map((sha) => ({ sha }))),
        listTags: fn("repos.listTags", () => this.tags.map((name) => ({ name }))),
        listReleases: fn("repos.listReleases", () => this.releases),
      },
      git: {
        createRef: fn("git.createRef", (a) => { this.branches.set(String(a.ref).replace("refs/heads/", ""), a.sha); return {}; }),
        deleteRef: fn("git.deleteRef", (a) => { const b = String(a.ref).replace("heads/", ""); if (!this.branches.delete(b)) this.notFound(b); return {}; }),
      },
      pulls: {
        create: fn("pulls.create", (a) => {
          const pr: Pr = { number: this.n++, title: a.title, body: a.body ?? "", labels: [], ref: a.head, openedSha: this.branches.get(a.head)!, state: "open", merged: false };
          this.prs.set(pr.number, pr);
          if (this.onPrOpened) this.pending.push(new Promise((r) => setTimeout(r, this.agentDelayMs)).then(() => this.onPrOpened!(this, pr)));
          return { ...this.shape(pr), head: { sha: pr.openedSha, ref: pr.ref } };
        }),
        get: fn("pulls.get", (a) => this.shape(this.prOf(a.pull_number))),
        update: fn("pulls.update", (a) => { const p = this.prOf(a.pull_number); if (p.merged) throw new HttpError(422, "already merged"); if (a.state) p.state = a.state; return this.shape(p); }),
        list: fn("pulls.list", (a) => this.openPrs().filter((p) => !a.state || a.state === "all" || p.state === a.state).map((p) => this.shape(p))),
        listReviews: fn("pulls.listReviews", (a) => this.reviews.get(a.pull_number) ?? []),
        listReviewComments: fn("pulls.listReviewComments", (a) => this.reviewComments.get(a.pull_number) ?? []),
      },
      issues: {
        createComment: fn("issues.createComment", (a) => { this.comment(a.issue_number, a.body, "firedrill-owner"); return {}; }),
        listComments: fn("issues.listComments", (a) => this.comments.get(a.issue_number) ?? []),
        listForRepo: fn("issues.listForRepo", () => [
          ...this.issues, ...[...this.prs.values()].map((p) => ({ number: p.number, title: p.title, body: p.body, pull_request: {} })),
        ].sort((a, b) => b.number - a.number)),
      },
    };
    return api as unknown as Octokit;
  }
}
