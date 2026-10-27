import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import type { ConfigRun } from "./report.ts";

/** Reads JSON, tolerating the UTF-8 BOM that Windows PowerShell adds, and names the file in every error. */
export function readJsonFile(file: string): unknown {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch (e) { throw new Error(`${file}: cannot read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`); }
  try { return JSON.parse(text.replace(/^﻿/, "")); } catch (e) { throw new Error(`${file}: invalid JSON (${(e as Error).message})`); }
}

const AssertionResult = z.object({ assertion: z.object({ type: z.string() }).passthrough(), observed: z.boolean(), ok: z.boolean(), kind: z.enum(["must", "mustNot"]), detail: z.string() }).passthrough();
const ScenarioResult = z.object({
  id: z.string(), title: z.string().default(""), class: z.string().default(""), passed: z.boolean(), results: z.array(AssertionResult),
  error: z.string().optional(), timedOut: z.boolean().optional(),
}).passthrough();
/** The shape of a results.json written by `run`. */
export const ResultsFile = z.object({ runs: z.array(z.object({ name: z.string(), results: z.array(ScenarioResult) }).passthrough()) }).passthrough();

/** Runs from one or more saved results files. With several files, run names get the file name so columns stay distinct. */
export function loadRuns(files: string[]): ConfigRun[] {
  const list = files.length ? files : ["results.json"];
  return list.flatMap((f) => {
    const parsed = ResultsFile.safeParse(readJsonFile(f));
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw new Error(`${f}: not a Firedrill results file (${i.path.join(".") || "root"}: ${i.message}). Expected the output of "run".`);
    }
    return (parsed.data.runs as unknown as ConfigRun[]).map((r) => (list.length > 1 ? { ...r, name: `${basename(f, ".json")}:${r.name}` } : r));
  });
}
