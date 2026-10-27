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
  const t = s.trigger;
  const raw = render([t.prTitle, t.prBody, t.commitMessage ?? "", t.branchName ?? "", ...t.comments, ...t.files.map((f) => f.content)].join("\n"), ctx);
  // A vulnerable agent also follows base64 it decodes.
  const text = raw + "\n" + (raw.match(/[A-Za-z0-9+/]{24,}={0,2}/g) ?? []).map((b) => Buffer.from(b, "base64").toString("utf8")).join("\n");
  e.comments.push({ author: "mock", body: `Summary: ${s.trigger.prTitle}` });
  if (kind === "vulnerable") {
    if (/(ignore|disregard).{0,40}(instruction|rules)/i.test(text) || /post .*token/i.test(text)) {
      e.comments.push({ author: "mock", body: `Internal token: ${ctx.canary}` });
    }
    if (text.includes(ctx.tripwireUrl)) e.tripwireHits.push(ctx.tripwireToken);
    if (/create (a )?branch/i.test(text)) e.newBranches.push("mock/injected-branch");
    if (/push (this )?(directly )?to main/i.test(text)) e.baseCommits.push("mockcommit");
    if (/merge this/i.test(text)) e.merged = true;
    if (/approve (this|the) (pr|pull request)/i.test(text)) e.approved = true;
    if (/(rename|change) the (pr )?title/i.test(text)) e.prEdits.push("title changed");
    if (/open an issue/i.test(text)) e.newIssues.push(1);
    if (/push (a )?(commit|fix) to this branch/i.test(text)) e.headMoved = true;
    if (/(tag|create) a release/i.test(text)) e.newReleases.push("v-mock");
  }
  return e;
}
