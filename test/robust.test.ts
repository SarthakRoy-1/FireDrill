import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FakeGitHub } from "./fake-github.ts";
import { Config, Scenario } from "../src/schema.ts";
import { fetchTripwireHits } from "../src/github.ts";
import { loadRuns, readJsonFile } from "../src/results.ts";
import { runScenarios, writeAtomic } from "../src/runner.ts";
import type { ConfigRun } from "../src/report.ts";

const cfg = { ...Config.parse({ canary: "FD-CANARY-0123456789abcdef" }), quietSeconds: 0.1 };
const REPO = { owner: "o", repo: "r" };
const mk = (id: string, wait = 0.3) => ({
  ...Scenario.parse({ id, title: id, class: "baseline", trigger: { prTitle: id }, must: [{ type: "workflow_responded" }], mustNot: [{ type: "canary_leaked" }] }),
  waitSeconds: wait,
});
const tmp = () => mkdtempSync(join(tmpdir(), "fd-robust-"));
const cli = resolve("src/cli.ts");
const runCli = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });

test("writeAtomic leaves no tmp file and replaces the old content whole", () => {
  const d = tmp();
  try {
    const f = join(d, "results.json");
    writeFileSync(f, "old");
    writeAtomic(f, '{"a":1}');
    assert.equal(readFileSync(f, "utf8"), '{"a":1}');
    assert.deepEqual(readdirSync(d), ["results.json"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("runScenarios records results after each scenario, in a valid file", async () => {
  const d = tmp();
  try {
    const gh = new FakeGitHub(); gh.onPrOpened = (g, pr) => g.comment(pr.number, "hi");
    const runs: ConfigRun[] = [{ name: "w", results: [] }];
    const out = join(d, "results.json");
    const end = await runScenarios(gh.octokit, REPO, [mk("a"), mk("b")], runs, cfg, { out, pauseMs: 0, pollMs: 40 });
    assert.equal(end, "done");
    const back = loadRuns([out]);
    assert.deepEqual(back[0]!.results.map((r) => `${r.id}:${r.passed}`), ["a:true", "b:true"]);
    assert.ok(!existsSync(`${out}.tmp`));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a rejected token stops the run after one ERROR instead of failing every scenario", async () => {
  const d = tmp();
  try {
    const gh = new FakeGitHub();
    gh.failNext("repos.getBranch", 401, 99, "Bad credentials");
    const runs: ConfigRun[] = [{ name: "w", results: [] }];
    const logs: string[] = [];
    const end = await runScenarios(gh.octokit, REPO, [mk("a"), mk("b"), mk("c")], runs, cfg, { out: join(d, "r.json"), pauseMs: 0, pollMs: 40, log: (m) => logs.push(m) });
    assert.equal(end, "auth");
    assert.equal(runs[0]!.results.length, 1);
    assert.match(runs[0]!.results[0]!.error!, /HTTP 401/);
    assert.equal(runs[0]!.results[0]!.passed, false);
    assert.ok(logs.some((l) => /token/.test(l) && /Stopping/.test(l)));
    assert.equal(loadRuns([join(d, "r.json")])[0]!.results.length, 1, "the file was written");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an ordinary error (404) is recorded and the run goes on", async () => {
  const d = tmp();
  try {
    const gh = new FakeGitHub(); gh.onPrOpened = (g, pr) => g.comment(pr.number, "hi");
    gh.failNext("pulls.create", 404, 1);
    const runs: ConfigRun[] = [{ name: "w", results: [] }];
    const end = await runScenarios(gh.octokit, REPO, [mk("a"), mk("b")], runs, cfg, { out: join(d, "r.json"), pauseMs: 0, pollMs: 40 });
    assert.equal(end, "done");
    assert.deepEqual(runs[0]!.results.map((r) => [r.id, r.passed, !!r.error]), [["a", false, true], ["b", true, false]]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Ctrl+C mid-scenario: PR closed, branch gone, that scenario is ERROR 'interrupted', file written, later scenarios not run", async () => {
  const d = tmp();
  try {
    const gh = new FakeGitHub();
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 150);
    const runs: ConfigRun[] = [{ name: "w", results: [] }];
    const out = join(d, "r.json");
    const end = await runScenarios(gh.octokit, REPO, [mk("a", 30), mk("b")], runs, cfg, { out, signal: ctl.signal, pauseMs: 0, pollMs: 10_000 });
    assert.equal(end, "interrupted");
    assert.deepEqual(runs[0]!.results.map((r) => [r.id, r.error]), [["a", "interrupted"]]);
    assert.equal(gh.openPrs().length, 0);
    assert.deepEqual([...gh.branches.keys()], ["main"]);
    assert.equal(loadRuns([out])[0]!.results[0]!.error, "interrupted");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("Ctrl+C between scenarios stops without inventing an error", async () => {
  const d = tmp();
  try {
    const gh = new FakeGitHub(); gh.onPrOpened = (g, pr) => g.comment(pr.number, "hi");
    const ctl = new AbortController();
    const runs: ConfigRun[] = [{ name: "w", results: [] }];
    const end = await runScenarios(gh.octokit, REPO, [mk("a"), mk("b")], runs, cfg, { out: join(d, "r.json"), signal: ctl.signal, pauseMs: 5000, pollMs: 40, log: (m) => { if (m === "  PASS") setTimeout(() => ctl.abort(), 50); } });
    assert.equal(end, "interrupted");
    assert.deepEqual(runs[0]!.results.map((r) => r.id), ["a"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("readJsonFile: strips a BOM, names the file on bad JSON or a missing file", () => {
  const d = tmp();
  try {
    writeFileSync(join(d, "ok.json"), "﻿" + '{"x":1}');
    assert.deepEqual(readJsonFile(join(d, "ok.json")), { x: 1 });
    writeFileSync(join(d, "bad.json"), "{nope");
    assert.throws(() => readJsonFile(join(d, "bad.json")), /bad\.json: invalid JSON/);
    assert.throws(() => readJsonFile(join(d, "missing.json")), /missing\.json: cannot read \(ENOENT\)/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("loadRuns rejects files that are not Firedrill results, naming the file and the field", () => {
  const d = tmp();
  try {
    const bad = (name: string, v: unknown) => { writeFileSync(join(d, name), JSON.stringify(v)); return join(d, name); };
    assert.throws(() => loadRuns([bad("a.json", { hello: 1 })]), /a\.json: not a Firedrill results file \(runs: Required\)/);
    assert.throws(() => loadRuns([bad("b.json", [1, 2])]), /b\.json: not a Firedrill results file/);
    assert.throws(() => loadRuns([bad("c.json", { runs: [{ name: "x", results: [{ id: "s", passed: "yes", results: [] }] }] })]), /c\.json: not a Firedrill results file \(runs\.0\.results\.0\.passed/);
    assert.throws(() => loadRuns([bad("d.json", { runs: [{ results: [] }] })]), /d\.json: .*runs\.0\.name/);
    const good = bad("g.json", { runs: [{ name: "x", results: [{ id: "s", title: "t", class: "baseline", passed: true, results: [] }] }] });
    assert.deepEqual(loadRuns([good, good]).map((r) => r.name), ["g:x", "g:x"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("every results file committed in the repo still validates", () => {
  for (const f of readdirSync("results").filter((x) => x.endsWith(".json"))) assert.ok(loadRuns([join("results", f)]).length > 0, f);
});

test("tripwire answering with HTML or the wrong JSON gives a clear error, not a SyntaxError", async () => {
  let body = "<html>Vercel login</html>";
  const server = createServer((_, res) => res.writeHead(200).end(body));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await assert.rejects(fetchTripwireHits({ ...cfg, tripwireBase: base }), /did not return JSON/);
    body = '{"ok":true}';
    await assert.rejects(fetchTripwireHits({ ...cfg, tripwireBase: base }), /without a "tokens" list/);
    body = '{"tokens":["a","b"]}';
    assert.deepEqual(await fetchTripwireHits({ ...cfg, tripwireBase: base }), ["a", "b"]);
  } finally { server.close(); server.closeAllConnections(); }
});

test("scenario limits: a PR body over GitHub's size limit is rejected at validate time", () => {
  const base = { id: "x", title: "t", class: "baseline" as const };
  assert.throws(() => Scenario.parse({ ...base, trigger: { prTitle: "x", prBody: "a".repeat(70000) } }));
  assert.throws(() => Scenario.parse({ ...base, trigger: { prTitle: "x".repeat(300) } }));
  Scenario.parse({ ...base, trigger: { prTitle: "x", prBody: "a".repeat(60000) } });
});

test("CLI: malformed inputs fail with a one-line message naming the file", () => {
  const d = tmp();
  try {
    writeFileSync(join(d, "firedrill.config.json"), "{ not json");
    let r = runCli(d, ["run", ".", "--repo", "o/r"], { GITHUB_TOKEN: "x" });
    assert.equal(r.status, 1);
    assert.match(r.stderr.trim(), /^firedrill\.config\.json: invalid JSON/);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    writeFileSync(join(d, "firedrill.config.json"), "﻿" + JSON.stringify({ canary: "short" }));
    r = runCli(d, ["run", ".", "--repo", "o/r"], { GITHUB_TOKEN: "x" });
    assert.match(r.stderr.trim(), /^firedrill\.config\.json: canary:/);
    writeFileSync(join(d, "notresults.json"), JSON.stringify({ foo: 1 }));
    for (const sub of ["report", "harden"]) {
      r = runCli(d, [sub, "notresults.json"]);
      assert.equal(r.status, 1, sub);
      assert.match(r.stderr.trim(), /^notresults\.json: not a Firedrill results file/);
    }
    r = runCli(d, ["report", "absent.json"]);
    assert.match(r.stderr.trim(), /^absent\.json: cannot read \(ENOENT\)/);
    writeFileSync(join(d, "firedrill.config.json"), JSON.stringify({ canary: "FD-CANARY-0123456789abcdef" }));
    r = runCli(d, ["run", ".", "--repo", "o/r", "--only-failed", "notresults.json"], { GITHUB_TOKEN: "x" });
    assert.match(r.stderr.trim(), /^notresults\.json: not a Firedrill results file/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scenario folder missing or YAML broken: the message names the folder or file", async () => {
  const { loadScenarios } = await import("../src/scenarios.ts");
  const d = tmp();
  try {
    assert.throws(() => loadScenarios(join(d, "nope")), /scenario folder .*nope not found/);
    writeFileSync(join(d, "broken.yaml"), "id: [unclosed\n  title: x");
    assert.throws(() => loadScenarios(d), /broken\.yaml: invalid YAML/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
