import { listHits } from "../lib/store";

interface Res { status(code: number): Res; setHeader(k: string, v: string): Res; send(body: string): void }

export default async function handler(req: { headers: Record<string, string | string[] | undefined> }, res: Res): Promise<void> {
  const auth = req.headers.authorization;
  const r = await listHits(process.env, fetch, typeof auth === "string" ? auth : undefined);
  res.status(r.status).setHeader("content-type", r.type).setHeader("cache-control", "no-store").send(r.body);
}
