import test from "node:test";
import assert from "node:assert/strict";
import { summarize, timeoutNotes, latestByScenario, normalTripwire, normalTripwireHits, runTripwire, runTripwireHits, tripText, scenarioIndex, statusIn, countStatuses, CLASS_BLURB, type Run, type Scenario } from "./lib";

const ok = (type: string) => ({ assertion: { type }, observed: true, ok: true, kind: "must" as const, detail: "" });
const pass = (id: string): Scenario => ({ id, title: id, class: "c", passed: true, results: [ok("workflow_responded")] });
const fail = (id: string): Scenario => ({ id, title: id, class: "c", passed: false, results: [{ ...ok("canary_leaked"), kind: "mustNot", ok: false }] });
const timeout = (id: string): Scenario => ({ id, title: id, class: "c", passed: false, timedOut: true, results: [{ ...ok("workflow_responded"), observed: false, ok: false }] });
const run = (name: string, generatedAt: string, results: Scenario[], variant?: string): Run => ({ name, generatedAt, results, variant });

const b1 = run("Batch 1", "2026-10-26T11:00:00Z", [pass("a"), pass("b")]);
const b2 = run("Batch 2, 4-min wait", "2026-10-26T18:00:00Z", [pass("a"), timeout("b"), timeout("c")]);
const rr = run("Rerun, 15-min wait", "2026-10-26T19:00:00Z", [pass("b"), pass("c")]);

test("latest result wins across runs; scenarios counted once; 'not run' is skipped", () => {
  const s = summarize([b1, b2, rr]);
  assert.equal(s.scenarios, 3);
  assert.deepEqual(s.counts, { PASS: 3, FAIL: 0, ERROR: 0, TIMEOUT: 0 });
  assert.equal(latestByScenario([b1, b2, rr]).get("a")!.run.name, "Batch 2, 4-min wait"); // rerun did not run "a"
});

test("order comes from timestamps, not array order", () => {
  assert.equal(summarize([rr, b2, b1]).counts.PASS, 3);
});

test("weakened runs never become the latest result", () => {
  const weak = run("Weakened workflow (live)", "2026-10-27T10:00:00Z", [fail("a")], "weakened");
  assert.equal(summarize([b1, b2, rr, weak]).counts.FAIL, 0);
  const untagged = run("Weak reference agent", "2026-10-27T11:00:00Z", [fail("a")]);
  assert.equal(summarize([b1, untagged]).counts.FAIL, 0);
});

test("timeout note for the Batch 2 / rerun pattern, and none without timeouts", () => {
  assert.deepEqual(timeoutNotes([b1, b2, rr]), ['Batch 2, 4-min wait: 2 TIMEOUT (runner\'s wait ran out, no output seen). Re-run in "Rerun, 15-min wait": 2 PASS.']);
  assert.deepEqual(timeoutNotes([b1, rr]), []);
  assert.match(timeoutNotes([b1, b2])[0]!, /Not re-run in a later run/);
});

test("tripwire hits: summary counts normal runs only; weakened run counted on its own", () => {
  const hit = (id: string): Scenario => ({ id, title: id, class: "c", passed: false, results: [{ ...ok("tripwire_hit"), kind: "mustNot", ok: false }] });
  const normal = run("Normal", "2026-10-26T10:00:00Z", [pass("a"), hit("b")]);
  const weak = run("Weakened", "2026-10-27T10:00:00Z", [hit("a"), hit("b"), pass("c")], "weakened");
  assert.equal(normalTripwireHits([normal, weak]), 1);
  assert.equal(runTripwireHits(weak), 2);
  assert.equal(normalTripwireHits([weak]), 0);
});

test("tripwire checked counts only scenarios with a tripwire_hit assertion; distinct ids across normal runs", () => {
  const trip = (id: string, hit: boolean): Scenario => ({ id, title: id, class: "c", passed: !hit, results: [{ ...ok("tripwire_hit"), observed: hit, kind: "mustNot", ok: !hit }] });
  const r1 = run("R1", "2026-10-26T10:00:00Z", [pass("a"), trip("x", false), trip("y", true)]);
  const r2 = run("R2", "2026-10-26T11:00:00Z", [pass("b"), trip("x", false), trip("z", false)]);
  const weak = run("Weak", "2026-10-27T10:00:00Z", [trip("w", true), trip("x", true)], "weakened");
  assert.deepEqual(runTripwire(r1), { hits: 1, checked: 2 });
  assert.deepEqual(normalTripwire([r1, r2, weak]), { hits: 1, checked: 3 }); // x counted once; w and weak hits excluded
  assert.deepEqual(runTripwire(weak), { hits: 2, checked: 2 });
});

test("a run with no tripwire assertions is 'not checked'", () => {
  const r = run("Plain", "2026-10-26T10:00:00Z", [pass("a"), pass("b")]);
  assert.deepEqual(runTripwire(r), { hits: 0, checked: 0 });
  assert.equal(tripText(runTripwire(r)), "not checked");
  assert.equal(tripText({ hits: 0, checked: 4 }), "0 hits in 4 scenarios that check it");
  assert.equal(tripText({ hits: 1, checked: 1 }), "1 hit in 1 scenario that checks it");
});

test("scenarioIndex lists each id once across all runs, sorted; statusIn is null when not run", () => {
  const w = run("Weakened", "2026-10-27T10:00:00Z", [pass("z")], "weakened");
  const idx = scenarioIndex([b2, w]);
  assert.deepEqual(idx.map((r) => r.id), ["a", "b", "c", "z"]);
  assert.equal(statusIn(w, "a"), null);
  assert.equal(statusIn(b2, "b"), "TIMEOUT");
  assert.equal(countStatuses(b2.results).find((x) => x.st === "TIMEOUT")!.n, 2);
  assert.ok(CLASS_BLURB["exfiltration"]);
});

import { parseRepoRef, repoError, nameError, commandSteps, defaultSandboxName } from "./lib";
const cmds = (a: string, b = "", c = "") => commandSteps(a, b, c).flatMap((s) => s.blocks.map((x) => x.text)).join("\n");

test("repo reference validation", () => {
  for (const ok of ["a/b", "my-org/alan-sandbox", "SarthakRoy-1/alan.sandbox_x"]) assert.ok(parseRepoRef(ok), ok);
  for (const bad of ["nope", "-x/y", "x-/y", "a/..", "a/.", "a b/c", "a/b/c", "a/", "/b", "a/b;rm", "a/b c"]) assert.equal(parseRepoRef(bad), null, bad);
  assert.equal(parseRepoRef("a".repeat(40) + "/b"), null);
  assert.equal(parseRepoRef("a/" + "b".repeat(101)), null);
  assert.equal(repoError(""), null);
  assert.ok(repoError("nope"));
  assert.equal(repoError("a/b"), null);
});

test("command steps: clone only with a source; repo in doctor/run/cleanup; never interpolates bad input", () => {
  const ids = (s: ReturnType<typeof commandSteps>) => s.map((x) => x.id);
  assert.ok(!ids(commandSteps("a/b", "", "")).includes("clone"));
  assert.ok(!ids(commandSteps("a/b", "bad", "")).includes("clone"));
  assert.ok(ids(commandSteps("a/b", "org/app", "")).includes("clone"));
  assert.match(cmds("a/b", "org/app"), /clone org\/app app-sandbox/);
  assert.match(cmds("a/b", "org/app", "mine"), /clone org\/app mine/);
  assert.equal(defaultSandboxName("org/app"), "app-sandbox");
  const t = cmds("my-org/alan-sandbox");
  for (const c of ["doctor", "run scenarios/attacks", "cleanup"]) assert.match(t, new RegExp(`${c}.* --repo my-org/alan-sandbox`));
  assert.match(cmds("nope; rm"), /--repo <owner>\/<sandbox-repo>/);
  assert.doesNotMatch(cmds("nope; rm"), /rm/);
});

test("no step contains a token value or token=", () => {
  const all = JSON.stringify(commandSteps("a/b", "org/app", ""));
  assert.doesNotMatch(all, /token=/);
  assert.doesNotMatch(all, /gh[pous]_|github_pat_/);
});

test("clone step sets a broad token before the clone command; sandbox token step comes later", () => {
  const steps = commandSteps("me/sb", "org/app", "");
  const clone = steps.find((x) => x.id === "clone")!;
  const texts = clone.blocks.map((b) => b.text);
  const iTok = texts.findIndex((t) => /GITHUB_TOKEN/.test(t));
  const iClone = texts.findIndex((t) => /cli\.ts clone /.test(t));
  assert.ok(iTok >= 0 && iClone > iTok);
  assert.ok(texts.some((t) => t.startsWith("export GITHUB_TOKEN=")) && texts.some((t) => t.startsWith("$env:GITHUB_TOKEN = ")));
  assert.ok(clone.notes!.some((n) => /revoke/i.test(n)));
  const ids = steps.map((x) => x.id);
  assert.ok(ids.indexOf("clone") < ids.indexOf("token") && ids.indexOf("token") < ids.indexOf("doctor"));
  const tok = steps.find((x) => x.id === "token")!;
  assert.match(tok.title, /sandbox-only/);
  assert.ok(tok.notes!.some((n) => /Revoke/.test(n)));
  assert.ok(!commandSteps("me/sb", "", "").find((x) => x.id === "token")!.notes!.some((n) => /Revoke/.test(n)));
});

test("input edge cases: trimmed consistently, hostile values never reach a command", () => {
  assert.deepEqual(parseRepoRef("  a/b  "), { owner: "a", name: "b" });
  assert.equal(repoError("  a/b  "), null);
  assert.match(cmds("  a/b  "), /--repo a\/b$/m);
  for (const bad of ["nope", "-x/y", "a/..", "a b/c", "a/b/c", "x/y;rm -rf ~", "a/b\nrm", "$(x)/y", "a/b`x`"]) {
    assert.ok(repoError(bad), bad);
    const t = cmds(bad, bad, bad);
    assert.doesNotMatch(t, /rm -rf|\$\(|`|\.\.|a b|nope/, bad);
    assert.ok(!commandSteps(bad, bad, bad).some((x) => x.id === "clone"));
  }
  assert.equal(nameError(""), null);
  assert.ok(nameError("a/b") && nameError("..") && nameError("x y"));
  assert.match(cmds("a/b", "org/app", "bad name;x"), /clone org\/app app-sandbox/);
  assert.match(cmds("a/b", "org/app", "  mine  "), /clone org\/app mine/);
});

test("init note, doctor note and no token-looking strings with a clone source", () => {
  const all = JSON.stringify(commandSteps("a/b", "org/app", "x"));
  assert.match(all, /already exists/);
  assert.doesNotMatch(all, /gh[pousr]_[A-Za-z0-9]|github_pat_|Bearer /);
});
