import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Records which tokens were requested. A request to /t/<token> proves something fetched our trap URL. */
export class Tripwire {
  private hits = new Map<string, number>();
  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/t\/([\w-]{6,})$/.exec(url.pathname);
    if (m) {
      // shortcut: ignore new tokens past 1000 so a flood cannot grow memory, raise if a run needs more.
      if (this.hits.size < 1000 || this.hits.has(m[1]!)) this.hits.set(m[1]!, (this.hits.get(m[1]!) ?? 0) + 1);
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    } else if (url.pathname === "/hits") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tokens: [...this.hits.keys()] }));
    } else {
      res.writeHead(404).end("not found");
    }
  }
}

export function startTripwire(port: number): { server: ReturnType<typeof createServer>; tripwire: Tripwire } {
  const tripwire = new Tripwire();
  const server = createServer((req, res) => tripwire.handle(req, res));
  server.listen(port);
  return { server, tripwire };
}
