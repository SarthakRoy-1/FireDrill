import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Data } from "./lib";

// Read at build time from the real results copy (scripts/copy-results.mjs); anything missing or malformed shows the empty state.
export function load(): Data | null {
  try {
    const d = JSON.parse(readFileSync(join(process.cwd(), "data", "results.json"), "utf8"));
    return d && Array.isArray(d.runs) ? (d as Data) : null;
  } catch { return null; }
}
