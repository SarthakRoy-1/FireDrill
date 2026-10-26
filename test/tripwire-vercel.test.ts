import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { listHits, recordHit, type Env } from "../tripwire-vercel/lib/store.ts";

// Fake Upstash REST API: POST / with a JSON command array, Bearer auth. Supports only what the store uses.
async function withUpstash(fn: (env: Env, sets: Map<string, Set<string>>, cmds: string[]) => Promise<void>, fail = false) {
  const sets = new Map<string, Set<string>>();
  const cmds: string[] = [];
  const server = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)).on("end", () => {
      const reply = (code: number, j: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(j));
      if (req.headers.authorization !== "Bearer secret") return reply(401, { error: "unauthorized" });
      if (fail) return reply(500, { error: "boom" });
      const [c, key, arg] = JSON.parse(b) as [string, string, string];
      cmds.push(c!);
      const set = sets.get(key!) ?? sets.set(key!, new Set()).get(key!)!;
      if (c === "SISMEMBER") reply(200, { result: set.has(arg!) ? 1 : 0 });
      else if (c === "SCARD") reply(200, { result: set.size });
      else if (c === "SADD") { set.add(arg!); reply(200, { result: 1 }); }
      else if (c === "SMEMBERS") reply(200, { result: [...set] });
      else reply(200, { result: 1 }); // EXPIRE
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  try { await fn({ KV_REST_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, KV_REST_API_TOKEN: "secret" }, sets, cmds); }
  finally { server.close(); server.closeAllConnections(); }
}

test("records a hit, sets the TTL and lists it", async () => {
  await withUpstash(async (env, _sets, cmds) => {
    assert.deepEqual(await recordHit(env, fetch, "run-abc123"), { status: 200, type: "text/plain", body: "ok" });
    await recordHit(env, fetch, "run-abc123"); // repeat is a no-op for the set
    assert.ok(cmds.includes("EXPIRE"));
    assert.deepEqual(JSON.parse((await listHits(env, fetch)).body), { tokens: ["run-abc123"] });
  });
});

test("rejects tokens that break the contract without touching storage", async () => {
  await withUpstash(async (env, _s, cmds) => {
    for (const bad of ["short", "has space!", "x".repeat(65), ""]) assert.equal((await recordHit(env, fetch, bad)).status, 404);
    assert.equal(cmds.length, 0);
  });
});

test("missing env and storage errors are 500, never a silent 200", async () => {
  assert.equal((await listHits({}, fetch)).status, 500);
  assert.match((await listHits({}, fetch)).body, /KV_REST_API_URL/);
  assert.equal((await recordHit({ KV_REST_API_URL: "http://x" }, fetch, "run-abc123")).status, 500);
  await withUpstash(async (env) => {
    assert.equal((await listHits(env, fetch)).status, 500);
    assert.equal((await recordHit(env, fetch, "run-abc123")).status, 500);
    assert.equal((await listHits({ ...env, KV_REST_API_TOKEN: "wrong" }, fetch)).status, 500);
  }, true);
});

test("a full set ignores new tokens but still answers ok", async () => {
  await withUpstash(async (env, sets) => {
    await recordHit(env, fetch, "run-first1");
    const set = sets.get("firedrill:hits")!;
    for (let i = 0; set.size < 10_000; i++) set.add(`fill-${i}-pad`);
    assert.equal((await recordHit(env, fetch, "run-newone")).status, 200);
    assert.ok(!set.has("run-newone"));
    assert.equal((await recordHit(env, fetch, "run-first1")).status, 200); // known tokens still count
  });
});
