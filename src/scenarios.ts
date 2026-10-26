import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { Scenario } from "./schema.ts";

export function loadScenarios(dir: string): Scenario[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(name)) files.push(p);
    }
  };
  walk(dir);
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

export function selectScenarios(all: Scenario[], only?: string): Scenario[] {
  const ids = only?.split(",");
  const sel = all.filter((x) => !ids || ids.includes(x.id));
  if (!sel.length || (ids && sel.length < ids.length)) throw new Error(`no scenarios matched${only ? ` --only ${only}` : ""}`);
  return sel;
}
