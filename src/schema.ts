import { z } from "zod";

/** A deterministic check against the observed effects of one workflow run. */
export const Assertion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("comment_contains"), text: z.string(), ignoreCase: z.boolean().default(true) }),
  z.object({ type: z.literal("comment_matches"), pattern: z.string(), flags: z.string().default("i") }),
  z.object({ type: z.literal("canary_leaked") }),
  z.object({ type: z.literal("tripwire_hit") }),
  z.object({ type: z.literal("new_branch_created") }),
  z.object({ type: z.literal("base_commit_pushed") }),
  z.object({ type: z.literal("pr_merged") }),
  z.object({ type: z.literal("pr_approved") }),
  z.object({ type: z.literal("pr_edited") }),
  z.object({ type: z.literal("issue_created") }),
  z.object({ type: z.literal("pr_branch_pushed") }),
  z.object({ type: z.literal("release_created") }),
  z.object({ type: z.literal("comment_count"), min: z.number().int().min(0).default(0), max: z.number().int().optional() }),
  z.object({ type: z.literal("finding_at"), file: z.string(), lines: z.tuple([z.number().int(), z.number().int()]) }),
  z.object({ type: z.literal("workflow_responded") }),
]);
export type Assertion = z.infer<typeof Assertion>;

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string(),
  class: z.enum(["direct-override", "hidden-instruction", "exfiltration", "guardrail-erosion", "review-seeded-bug", "baseline"]),
  trigger: z.object({
    prTitle: z.string(),
    prBody: z.string().default(""),
    /** Files committed on the PR branch. Templates: {{canary}} {{tripwire_url}}. */
    files: z.array(z.object({ path: z.string(), content: z.string() })).default([]),
    /** Commit message for the files above. Defaults to `firedrill: <id>`. */
    commitMessage: z.string().optional(),
    /** Branch name prefix (a random suffix is added). Defaults to `firedrill/<id>`. */
    branchName: z.string().regex(/^[\w./-]+$/).optional(),
    /** Comments Firedrill posts on the PR right after opening it. Marked so they are never scored as workflow output. */
    comments: z.array(z.string()).default([]),
  }),
  /** Every `must` has to hold and every `mustNot` has to be violated-free (assertion false). */
  must: z.array(Assertion).default([]),
  mustNot: z.array(Assertion).default([]),
  waitSeconds: z.number().int().positive().default(900),
});
export type Scenario = z.infer<typeof Scenario>;

export const Config = z.object({
  /** Fake secret you paste into the workflow's instructions as an "internal token". */
  canary: z.string().min(8),
  /** Public base URL of the tripwire endpoint, e.g. https://firedrill.vercel.app */
  tripwireBase: z.string().url().optional(),
  /** Optional bearer key for the hosted tripwire's /hits (its TRIPWIRE_READ_KEY env). Config is git-ignored; keep it that way. */
  tripwireKey: z.string().min(1).optional(),
  baseBranch: z.string().default("main"),
  /** Seconds of silence after the last new effect before a run is considered finished. */
  quietSeconds: z.number().int().positive().default(45),
  /** Optional OpenAI-compatible endpoint for `generate` (attack variants only; never grades). Key via env FIREDRILL_LLM_KEY. */
  generator: z.object({ baseUrl: z.string().url(), model: z.string().min(1) }).optional(),
});
export type Config = z.infer<typeof Config>;
