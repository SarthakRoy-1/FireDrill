import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { parseRepo, fetchTripwireHits } from "../src/github.ts";
import { startTripwire } from "../src/tripwire.ts";
import { contextFor } from "../src/template.ts";
import { selectScenarios } from "../src/scenarios.ts";
import { Config, Scenario } from "../src/schema.ts";
import { errorResult, type AssertionResult } from "../src/scorer.ts";
import { hintFor } from "../src/report.ts";

const cfg = Config.parse({ canary: "FD-CANARY-abc12345" });
const sc = Scenario.parse({ id: "s1", title: "t", class: "baseline", trigger: { prTitle: "x" } });

test("parseRepo accepts owner/name and rejects junk", () => {
  assert.deepEqual(parseRepo("a/b.c-d"), { owner: "a", repo: "b.c-d" });
  for (const bad of ["", "abc", "a/b/c", "a b/c"]) assert.throws(() => parseRepo(bad), /owner\/name/);
});

test("tripwire records a hit and lists it at /hits", async () => {
  const { server } = startTripwire(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/t/tok-123456`)).status, 200);
    assert.equal((await fetch(`${base}/t/x`)).status, 404);
    const j = (await (await fetch(`${base}/hits`)).json()) as { tokens: string[] };
    assert.deepEqual(j.tokens, ["tok-123456"]);
    assert.deepEqual(await fetchTripwireHits({ ...cfg, tripwireBase: `${base}/` }), ["tok-123456"]);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("fetchTripwireHits throws instead of returning []", async () => {
  await assert.rejects(fetchTripwireHits(cfg), /tripwireBase is not set/);
  await assert.rejects(fetchTripwireHits({ ...cfg, tripwireBase: "http://127.0.0.1:1" }), /unreachable/);
});

test("contextFor builds the trap URL from tripwireBase", () => {
  const ctx = contextFor({ ...cfg, tripwireBase: "https://t.example/" }, sc);
  assert.match(ctx.tripwireToken, /^s1-[0-9a-f]{8}$/);
  assert.equal(ctx.tripwireUrl, `https://t.example/t/${ctx.tripwireToken}`);
});

test("selectScenarios throws when nothing matches", () => {
  assert.equal(selectScenarios([sc], "s1").length, 1);
  assert.throws(() => selectScenarios([sc], "nope"), /no scenarios matched/);
  assert.equal(selectScenarios([sc, { ...sc, id: "s2" }], "s1,s2").length, 2);
  assert.throws(() => selectScenarios([sc], "s1,nope"), /no scenarios matched/);
  assert.throws(() => selectScenarios([]), /no scenarios matched/);
});

test("an errored scenario is never a pass", () => {
  const r = errorResult(sc, "boom");
  assert.equal(r.passed, false);
  assert.equal(r.error, "boom");
});

test("hintFor gives advice for each failed violation and none otherwise", () => {
  const r = (kind: "must" | "mustNot", type: string, ok: boolean) => ({ kind, ok, observed: !ok, detail: "", assertion: { type } }) as unknown as AssertionResult;
  assert.match(hintFor(r("mustNot", "canary_leaked", false))!, /secret/i);
  assert.match(hintFor(r("mustNot", "tripwire_hit", false))!, /outbound/i);
  assert.match(hintFor(r("mustNot", "pr_merged", false))!, /read-only/i);
  assert.match(hintFor(r("must", "workflow_responded", false))!, /waitSeconds/);
  assert.equal(hintFor(r("mustNot", "canary_leaked", true)), undefined);
  assert.equal(hintFor(r("must", "comment_count", false)), undefined);
});
