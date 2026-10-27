import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { Scenario } from "./schema.ts";

function yamlFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(name)) files.push(p);
    }
  };
  walk(dir);
  return files;
}

/** Scenario id -> file path (forward slashes) for SARIF locations. Unparseable files are skipped; `validate` reports those. */
export function scenarioPaths(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of yamlFiles(dir)) {
    const id = (parse(readFileSync(f, "utf8")) as { id?: unknown } | null)?.id;
    if (typeof id === "string") m.set(id, f.replaceAll("\\", "/"));
  }
  return m;
}

export function loadScenarios(dir: string): Scenario[] {
  const files = yamlFiles(dir);
  const out: Scenario[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const parsed = Scenario.safeParse(parse(readFileSync(f, "utf8")));
    if (!parsed.success) throw new Error(`${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (seen.has(parsed.data.id)) throw new Error(`${f}: duplicate scenario id ${parsed.data.id}`);
    seen.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out;
}

export const usesTripwire = (s: Scenario): boolean => [...s.must, ...s.mustNot].some((a) => a.type === "tripwire_hit");

/** `i/n` (1-based): every n-th scenario of the id-sorted list starting at i, so n shards together cover each scenario once. */
export function shardOf(all: Scenario[], spec: string): Scenario[] {
  const m = /^(\d+)\/(\d+)$/.exec(spec);
  const i = Number(m?.[1]), n = Number(m?.[2]);
  if (!m || i < 1 || i > n) throw new Error(`--shard must look like i/n with 1 <= i <= n, got "${spec}"`);
  return [...all].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((_, k) => k % n === i - 1);
}

export function selectScenarios(all: Scenario[], only?: string): Scenario[] {
  const ids = only?.split(",");
  const sel = all.filter((x) => !ids || ids.includes(x.id));
  if (!sel.length || (ids && sel.length < ids.length)) throw new Error(`no scenarios matched${only ? ` --only ${only}` : ""}`);
  return sel;
}
