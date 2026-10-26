import { recordHit } from "../../lib/store";

// Minimal request/response shapes for Vercel Node functions (avoids a @vercel/node dependency).
interface Req { query?: Record<string, string | string[] | undefined>; url?: string }
interface Res { status(code: number): Res; setHeader(k: string, v: string): Res; send(body: string): void }

export default async function handler(req: Req, res: Res): Promise<void> {
  const q = req.query?.token;
  // Fall back to the URL path in case a rewrite hides the dynamic segment.
  const token = (Array.isArray(q) ? q[0] : q) ?? new URL(req.url ?? "/", "http://x").pathname.split("/").pop() ?? "";
  const r = await recordHit(process.env, fetch, token);
  res.status(r.status).setHeader("content-type", r.type).send(r.body);
}
