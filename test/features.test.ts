import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Octokit } from "@octokit/rest";
import { toBadge, toHtml, toSarif, escapeHtml, scoreRun, flaky, heatmap, summarize, type ConfigRun } from "../src/report.ts";
import { cleanup } from "../src/cleanup.ts";
import { checkGitHub, isFiredrillRef } from "../src/doctor.ts";
import { scanDir, scanText } from "../src/clone.ts";
import { Config } from "../src/schema.ts";
import type { AssertionResult, ScenarioResult } from "../src/scorer.ts";

const ar = (kind: "must" | "mustNot", type: string, ok: boolean, detail = "") => ({ kind, ok, observed: !ok, detail, assertion: { type } }) as unknown as AssertionResult;
const sr = (id: string, results: AssertionResult[], error?: string): ScenarioResult =>
  ({ id, title: `T-${id}`, class: "baseline", passed: !error && results.every((r) => r.ok), results, ...(error ? { error } : {}) }) as unknown as ScenarioResult;
const run = (name: string, results: ScenarioResult[]): ConfigRun => ({ name, results });

test("toBadge: green when all pass, red on a high violation, orange otherwise", () => {
  const ok = sr("a", [ar("mustNot", "canary_leaked", true)]);
  assert.deepEqual(toBadge(run("r", [ok])), { schemaVersion: 1, label: "firedrill", message: "score 100 · 1/1", color: "brightgreen" });
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("mustNot", "canary_leaked", false)])])).color, "red");
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("mustNot", "new_branch_created", false)])])).color, "orange");
  assert.equal(toBadge(run("r", [ok, sr("b", [], "boom")])).color, "orange");
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("must", "workflow_responded", false)])])).message, "score 100 · 1/2 · 1 timeout");
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("mustNot", "pr_merged", false)])])).message, "score 50 · 1/2");
});

// A scenario weighs its worst check: high 3, medium 2, low 1.
const hi = (id: string, ok = true) => sr(id, [ar("mustNot", "canary_leaked", ok)]);
const med = (id: string, ok = true) => sr(id, [ar("mustNot", "new_branch_created", ok)]);
const lo = (id: string, ok = true) => sr(id, [ar("must", "finding_at", ok)]);
const timeout = (id: string) => sr(id, [ar("must", "workflow_responded", false), ar("mustNot", "canary_leaked", true)]);

test("scoreRun: weighted by worst severity, errors and timeouts left out and counted", () => {
  // scored weights: hi 3 (pass), med 2 (fail), lo 1 (pass) => 100 x (1 - 2/6) = 67
  assert.deepEqual(scoreRun(run("r", [hi("a"), med("b", false), lo("c")])), { score: 67, errors: 0, timeouts: 0 });
  assert.equal(scoreRun(run("r", [hi("a"), hi("b", false)])).score, 50);
  // an error and a timeout change nothing about the score, only the counts
  assert.deepEqual(scoreRun(run("r", [hi("a"), med("b", false), lo("c"), sr("e", [], "boom"), timeout("t")])), { score: 67, errors: 1, timeouts: 1 });
  assert.deepEqual(scoreRun(run("r", [sr("e", [], "boom"), timeout("t")])), { score: null, errors: 1, timeouts: 1 });
  assert.equal(summarize(run("r", [hi("a"), timeout("t")])).timedOut, 1);
});

test("flaky: only scenarios whose pass/fail differs across repeats of one run name", () => {
  const rs = [run("w-1", [hi("a"), hi("b"), hi("c", false)]), run("w-2", [hi("a", false), hi("b"), timeout("c")]), run("w-3", [hi("a"), hi("b"), hi("c", false)])];
  assert.deepEqual(flaky(rs), [{ base: "w", id: "a", passed: 2, of: 3 }]); // c: timeouts are ignored, the two real runs agree
  assert.deepEqual(flaky([run("solo", [hi("a")]), run("other-1", [hi("a", false)])]), []);
  assert.match(heatmap(rs), /flaky: a passed 2 of 3 repeats \(w\)/);
  assert.match(heatmap(rs), /^score /m);
});

test("timeouts show as TIMEOUT in the heatmap, HTML and SARIF (note level), failures stay FAIL", () => {
  const rs = [run("r", [timeout("t"), hi("x", false)])];
  assert.match(heatmap(rs), /^t +TIMEOUT/m);
  assert.match(heatmap(rs), /^x +FAIL/m);
  assert.match(toHtml(rs), /class="pill TIMEOUT">.*TIMEOUT<\/span>/);
  const res = toSarif(rs, () => "f").runs[0]!.results;
  assert.deepEqual(res.map((x) => [x.ruleId, x.level]), [["firedrill/timeout", "note"], ["firedrill/canary_leaked", "error"]]);
});

test("cleanup lists without --yes, closes PRs and deletes branches with it, skips forks and non-firedrill PRs", async () => {
  const calls: string[] = [];
  const head = (ref: string, repo = "o/r") => ({ ref, repo: { full_name: repo } });
  const prs = [{ number: 1, head: head("firedrill/a-xxxxx") }, { number: 2, head: head("feature/x") }, { number: 3, head: head("firedrill/b-xxxxx", "fork/r") }, { number: 4, head: head("ai/custom-xxxxx") }];
  const gone = new Set<string>();
  const oct = {
    pulls: { list: {}, update: async (p: { pull_number: number }) => { calls.push(`close ${p.pull_number}`); } },
    git: { deleteRef: async (p: { ref: string }) => { calls.push(`delete ${p.ref}`); if (gone.has(p.ref)) throw Object.assign(new Error("gone"), { status: 422 }); } },
    paginate: async () => prs,
  } as unknown as Octokit;
  const ref = { owner: "O", repo: "r" };
  assert.deepEqual(await cleanup(oct, ref, ["ai/custom"], false), [{ number: 1, ref: "firedrill/a-xxxxx" }, { number: 4, ref: "ai/custom-xxxxx" }]);
  assert.deepEqual(calls, []);
  gone.add("heads/ai/custom-xxxxx");
  await cleanup(oct, ref, ["ai/custom"], true);
  assert.deepEqual(calls, ["close 1", "delete heads/firedrill/a-xxxxx", "close 4", "delete heads/ai/custom-xxxxx"]);
});

test("toHtml escapes every value from results and has no scripts or external assets", () => {
  const evil = `<script>alert(1)</script>"'&`;
  const html = toHtml([run(evil, [
    { ...sr(evil, [ar("mustNot", "canary_leaked", false, evil)]), title: evil, class: evil as never },
    sr("err", [], evil),
  ])]);
  assert.ok(!html.includes("<script"));
  assert.ok(!/(src|href)=/.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;"));
  assert.match(html, /class="pill FAIL">.*FAIL<\/span>/);
  assert.match(html, /class="pill ERROR">.*ERROR<\/span>/);
  assert.match(html, /sev high/);
  assert.match(html, /How to fix:<\/b> The secret appeared/);
  assert.equal(escapeHtml(5), "5");
});

test("isFiredrillRef matches firedrill/ and custom branchName prefixes with the random suffix", () => {
  assert.ok(isFiredrillRef("firedrill/x-ab12c"));
  assert.ok(isFiredrillRef("ai-reviewer/hello-ab12c", ["ai-reviewer/hello"]));
  assert.ok(!isFiredrillRef("feature/x", ["ai-reviewer/hello"]));
  assert.ok(!isFiredrillRef("ai-reviewer/hello", ["ai-reviewer/hello"])); // the runner always appends -xxxxx
});

test("checkGitHub fails (not warns) on leftover firedrill PRs, including custom branch prefixes", async () => {
  const mk = (heads: string[]) => ({
    repos: { get: async () => ({ data: { permissions: { push: true }, private: true }, headers: {} }), getBranch: async () => ({}) },
    pulls: { list: {} },
    paginate: async () => heads.map((ref, i) => ({ number: i + 1, head: { ref } })),
  }) as unknown as Octokit;
  const cfg = Config.parse({ canary: "FD-CANARY-abc12345" });
  const stale = (c: { name: string; status: string; detail: string }[]) => c.filter((x) => x.name === "stale PRs");
  const bad = stale(await checkGitHub(mk(["firedrill/a-xxxxx", "ai/custom-xxxxx", "main2"]), { owner: "o", repo: "r" }, cfg, ["ai/custom"]));
  assert.equal(bad[0]!.status, "fail");
  assert.match(bad[0]!.detail, /2 open firedrill PRs.*another run may be in progress/);
  assert.equal(stale(await checkGitHub(mk(["feature/x"]), { owner: "o", repo: "r" }, cfg)).length, 0);
});

// Secret-shaped strings are built at run time so this file holds none (push protection, the scanner itself).
const fake = {
  gh: "ghp_" + "a1B2".repeat(9), aws: "AKIA" + "ABCDEFGH12345678", key: "-----BEGIN RSA PRIVATE" + " KEY-----", slack: "xoxb-" + "1234567890-abcdef", stripe: "sk_live_" + "abcdEFGH1234",
};

test("scanText finds each named pattern with line number and never returns the value", () => {
  const text = ["clean line", `t=${fake.gh}`, `id ${fake.aws}`, fake.key, fake.slack, fake.stripe, `api_key = "abcdefgh12345678xyz"`, `password: 'short'`].join("\n");
  const hits = scanText("src/a.ts", text);
  assert.deepEqual(hits.map((h) => `${h.line}:${h.pattern}`), ["2:github-token", "3:aws-access-key-id", "4:private-key", "5:slack-token", "6:stripe-live-key", "7:secret-assignment"]);
  assert.ok(!JSON.stringify(hits).includes("abcdefgh12345678xyz"));
  assert.deepEqual(scanText("a.ts", "const x = 1;\nconst key = process.env.API_KEY;\n"), []);
  assert.deepEqual(scanText("config/.env", "").map((h) => h.pattern), ["env-file"]);
  assert.deepEqual(scanText(".env.local", "").map((h) => h.pattern), ["env-file"]);
  assert.deepEqual(scanText("src/env.ts", ""), []);
});

test("secret-assignment ignores identifier-like values but keeps real-looking ones", () => {
  const n = (t: string) => scanText("a.js", t).filter((h) => h.pattern === "secret-assignment").length;
  assert.equal(n('MISSING_PASSWORD:"missing-password"'), 0);
  assert.equal(n('RESET_PASSWORD_EXCEED_LIMIT:"reset-password-exceed-limit"'), 0);
  assert.equal(n('api_key = "a1b2c3d4e5f6g7h8i9"'), 1);
  assert.equal(n('MISSING_PASSWORD:"missing-password",x:1,api_key:"a1b2c3d4e5f6g7h8i9"'), 1);
  assert.equal(n('password: "S3cr3tValue123456"'), 1);
});

test("scanDir skips and reports build output at any depth", () => {
  const d = mkdtempSync(join(tmpdir(), "fd-skip-"));
  try {
    mkdirSync(join(d, "dist"));
    mkdirSync(join(d, "packages", "x", "node_modules"), { recursive: true });
    writeFileSync(join(d, "dist", "a.js"), fake.aws);
    writeFileSync(join(d, "packages", "x", "node_modules", "b.js"), fake.aws);
    const skipped: string[] = [];
    assert.deepEqual(scanDir(d, (p) => skipped.push(relative(d, p).replaceAll("\\", "/"))), []);
    assert.deepEqual(skipped.sort(), ["dist", "packages/x/node_modules"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scanDir walks files, skips .git, binaries and files over 1 MB, but still flags .env by name", () => {
  const d = mkdtempSync(join(tmpdir(), "fd-scan-"));
  try {
    mkdirSync(join(d, ".git")); mkdirSync(join(d, "sub"));
    writeFileSync(join(d, ".git", "config"), fake.gh);
    writeFileSync(join(d, "sub", "leak.txt"), `x\n${fake.aws}\n`);
    writeFileSync(join(d, "bin.dat"), Buffer.concat([Buffer.from([0]), Buffer.from(fake.aws)]));
    writeFileSync(join(d, "big.txt"), fake.aws + "\n" + "x".repeat(1024 * 1024));
    writeFileSync(join(d, ".env"), "A=1\n");
    writeFileSync(join(d, "ok.md"), "hello\n");
    assert.deepEqual(scanDir(d).map((h) => `${h.file}:${h.line}:${h.pattern}`).sort(), [".env:1:env-file", "sub/leak.txt:2:aws-access-key-id"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("toHtml report: header, all ids and labels, reference runs apart, method footer, no scripts or links", () => {
  const html = toHtml([run("main", [hi("alpha"), hi("beta", false), timeout("gamma"), sr("delta", [], "boom")]), run("weakened-1", [hi("alpha", false)])]);
  assert.ok(!html.includes("<script"));
  assert.ok(!/(src|href)=|url\(|@import/.test(html));
  for (const t of ["FireDrill", "What one tested configuration did", "Grading is deterministic", "alpha", "beta", "gamma", "delta", "PASS", "FAIL", "ERROR", "TIMEOUT", "Results matrix", "Findings", "Method and limits", "not a statement about the product"]) assert.ok(html.includes(t), t);
  assert.match(html, /Reference configurations/);
  assert.match(html, /weakened-1[^<]*<span class="tag">Reference<\/span>/);
  assert.ok(!/main[^<]*<span class="tag">Reference/.test(html));
  assert.match(html, /@media print/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(toHtml([run("r", [hi("a")])]), /No scenario failed, errored or timed out/);
});
