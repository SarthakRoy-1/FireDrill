import { listHits } from "../lib/store";

interface Res { status(code: number): Res; setHeader(k: string, v: string): Res; send(body: string): void }

export default async function handler(_req: unknown, res: Res): Promise<void> {
  const r = await listHits(process.env, fetch);
  res.status(r.status).setHeader("content-type", r.type).setHeader("cache-control", "no-store").send(r.body);
}
