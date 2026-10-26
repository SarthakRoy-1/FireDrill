// Tripwire storage on Upstash Redis over its REST API. Same HTTP contract as src/tripwire.ts.
// No Vercel types and no dependencies, so test/tripwire-vercel.test.ts can run it against a stub.
export interface Env { KV_REST_API_URL?: string; KV_REST_API_TOKEN?: string }
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export interface Reply { status: number; type: string; body: string }

export const TOKEN_RE = /^[\w-]{6,64}$/;
const KEY = "firedrill:hits";
const TTL_SECONDS = 7 * 24 * 3600;
// shortcut: new tokens are ignored past 10000 members so a flood cannot grow storage; raise it if one deployment serves more runs than that in a week.
const MAX_TOKENS = 10_000;

async function cmd(env: Required<Env>, f: Fetch, args: (string | number)[]): Promise<unknown> {
  const res = await f(env.KV_REST_API_URL, { method: "POST", headers: { authorization: `Bearer ${env.KV_REST_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const j = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || j.error) throw new Error(`Upstash ${args[0]} failed: HTTP ${res.status}${j.error ? ` ${j.error}` : ""}`);
  return j.result;
}

const needEnv = (env: Env): Required<Env> | undefined =>
  env.KV_REST_API_URL && env.KV_REST_API_TOKEN ? { KV_REST_API_URL: env.KV_REST_API_URL, KV_REST_API_TOKEN: env.KV_REST_API_TOKEN } : undefined;

const text = (status: number, body: string): Reply => ({ status, type: "text/plain", body });
const MISSING = text(500, "tripwire storage is not configured: set KV_REST_API_URL and KV_REST_API_TOKEN (Vercel Marketplace: Upstash Redis)");

/** GET /t/<token>: record the token (a set with a 7-day TTL) and answer ok. */
export async function recordHit(env: Env, f: Fetch, token: string): Promise<Reply> {
  if (!TOKEN_RE.test(token)) return text(404, "not found");
  const e = needEnv(env);
  if (!e) return MISSING;
  try {
    const known = await cmd(e, f, ["SISMEMBER", KEY, token]);
    if (known !== 1 && Number(await cmd(e, f, ["SCARD", KEY])) >= MAX_TOKENS) return text(200, "ok"); // full: still look normal to the caller
    await cmd(e, f, ["SADD", KEY, token]);
    // shortcut: the TTL is on the whole set and refreshed on each hit, not per token; fine because tokens are per run and only the current run's token counts.
    await cmd(e, f, ["EXPIRE", KEY, TTL_SECONDS]);
    return text(200, "ok");
  } catch (err) {
    return text(500, err instanceof Error ? err.message : String(err));
  }
}

/** GET /hits: {"tokens":[...]}. Never a silent 200 when storage is missing or failing. */
export async function listHits(env: Env, f: Fetch): Promise<Reply> {
  const e = needEnv(env);
  if (!e) return MISSING;
  try {
    const tokens = await cmd(e, f, ["SMEMBERS", KEY]);
    if (!Array.isArray(tokens)) throw new Error("Upstash SMEMBERS returned a non-list");
    return { status: 200, type: "application/json", body: JSON.stringify({ tokens }) };
  } catch (err) {
    return text(500, err instanceof Error ? err.message : String(err));
  }
}
