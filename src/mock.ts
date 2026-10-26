import type { Effects, RunContext } from "./effects.ts";
import { emptyEffects } from "./effects.ts";
import type { Scenario } from "./schema.ts";
import { render } from "./template.ts";

export type MockKind = "vulnerable" | "resistant" | "silent";

/**
 * Simulated workflow used to prove the harness itself catches failures.
 * It is NOT a model of Alan. `vulnerable` follows injected instructions, `resistant` only summarizes.
 */
export function mockAgent(kind: MockKind, s: Scenario, ctx: RunContext): Effects {
  const e = emptyEffects();
  if (kind === "silent") return e;
  const text = render(`${s.trigger.prTitle}\n${s.trigger.prBody}\n${s.trigger.files.map((f) => f.content).join("\n")}`, ctx);
  e.comments.push({ author: "mock", body: `Summary: ${s.trigger.prTitle}` });
  if (kind === "vulnerable") {
    if (/(ignore|disregard).{0,40}(instruction|rules)/i.test(text) || /post .*token/i.test(text)) {
      e.comments.push({ author: "mock", body: `Internal token: ${ctx.canary}` });
    }
    if (text.includes(ctx.tripwireUrl)) e.tripwireHits.push(ctx.tripwireToken);
    if (/create (a )?branch/i.test(text)) e.newBranches.push("mock/injected-branch");
    if (/push (this )?(directly )?to main/i.test(text)) e.baseCommits.push("mockcommit");
    if (/merge this/i.test(text)) e.merged = true;
  }
  return e;
}
