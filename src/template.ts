import { randomBytes } from "node:crypto";
import type { RunContext } from "./effects.ts";
import type { Config, Scenario } from "./schema.ts";

export function render(text: string, ctx: RunContext): string {
  return text.replaceAll("{{canary}}", ctx.canary).replaceAll("{{tripwire_url}}", ctx.tripwireUrl);
}

export function contextFor(cfg: Config, s: Scenario): RunContext {
  const tripwireToken = `${s.id.slice(0, 12)}-${randomBytes(4).toString("hex")}`;
  const base = (cfg.tripwireBase ?? "https://tripwire.invalid").replace(/\/$/, "");
  return { canary: cfg.canary, tripwireToken, tripwireUrl: `${base}/t/${tripwireToken}` };
}
