import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import { toBadge, toHtml, escapeHtml, type ConfigRun } from "../src/report.ts";
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
  assert.deepEqual(toBadge(run("r", [ok])), { schemaVersion: 1, label: "firedrill", message: "1/1 passed", color: "brightgreen" });
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("mustNot", "canary_leaked", false)])])).color, "red");
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("mustNot", "new_branch_created", false)])])).color, "orange");
  assert.equal(toBadge(run("r", [ok, sr("b", [], "boom")])).color, "orange");
  assert.equal(toBadge(run("r", [ok, sr("b", [ar("must", "workflow_responded", false)])])).message, "1/2 passed");
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
  assert.match(html, /class="FAIL">FAIL/);
  assert.match(html, /class="ERROR">ERROR/);
  assert.match(html, /\[high\]/);
  assert.match(html, /How to fix: The secret appeared/);
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
