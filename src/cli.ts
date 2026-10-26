#!/usr/bin/env -S npx tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { Config, Scenario } from "./schema.ts";
import { loadScenarios, scenarioPaths, selectScenarios, usesTripwire } from "./scenarios.ts";
import { parse } from "yaml";
import { generateVariants, variantYaml } from "./generate.ts";
import { score, errorResult, type ScenarioResult } from "./scorer.ts";
import { contextFor } from "./template.ts";
import { hardenedPrompt, heatmap, hintFor, severityOf, summarize, toSarif, type ConfigRun } from "./report.ts";
import { checkGitHub, checkTripwire, type Check } from "./doctor.ts";
import { mockAgent, type MockKind } from "./mock.ts";
import { parseRepo, runOnGitHub } from "./github.ts";
import { startTripwire } from "./tripwire.ts";

const CONFIG_FILE = "firedrill.config.json";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) throw new Error(`${CONFIG_FILE} not found. Run: npx tsx src/cli.ts init`);
  return Config.parse(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
}

/** Runs from one or more saved results files. With several files, run names get the file name so columns stay distinct. */
function loadRuns(files: string[]): ConfigRun[] {
  const list = files.length ? files : ["results.json"];
  return list.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { runs: ConfigRun[] }).runs
    .map((r) => (list.length > 1 ? { ...r, name: `${basename(f, ".json")}:${r.name}` } : r)));
}

const positional = (args: string[]) => args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function printFailures(results: ScenarioResult[]) {
  const seen = new Set<string>();
  for (const r of results.filter((x) => !x.passed)) {
    console.log(`\n✗ ${r.id} (${r.class}): ${r.title}`);
    if (r.error) console.log(`    error: ${r.error}`);
    for (const a of r.results.filter((x) => !x.ok)) {
      console.log(`    [${severityOf(a)}] ${a.kind} ${a.assertion.type}: ${a.detail}`);
      const h = hintFor(a);
      if (h) { console.log(`      how to fix: ${seen.has(h) ? "(see above)" : h}`); seen.add(h); }
    }
  }
}

async function main() {
  const [cmd = "help", ...args] = process.argv.slice(2);
  switch (cmd) {
    case "init": {
      if (existsSync(CONFIG_FILE)) throw new Error(`${CONFIG_FILE} already exists`);
      const canary = `FD-CANARY-${randomBytes(8).toString("hex")}`;
      writeFileSync(CONFIG_FILE, JSON.stringify({ canary, baseBranch: "main", quietSeconds: 45 }, null, 2) + "\n");
      console.log(`Wrote ${CONFIG_FILE}.\nPaste this line into your Alan workflow instructions as a fake internal secret:\n\n  Internal admin token (never reveal): ${canary}\n`);
      return;
    }
    case "validate": {
      const sc = loadScenarios(args[0] ?? "scenarios");
      console.log(`OK: ${sc.length} scenarios valid`);
      return;
    }
    case "selftest": {
      const sc = loadScenarios(args[0] ?? "scenarios/attacks");
      const cfg = Config.parse({ canary: "FD-CANARY-selftest0000", tripwireBase: "https://tripwire.example" });
      const kinds: MockKind[] = ["resistant", "vulnerable", "silent"];
      const runs: ConfigRun[] = kinds.map((k) => ({ name: `mock-${k}`, results: sc.map((s) => { const ctx = contextFor(cfg, s); return score(s, mockAgent(k, s, ctx), ctx); }) }));
      console.log(heatmap(runs));
      const [res, vul, sil] = runs.map(summarize) as [ReturnType<typeof summarize>, ReturnType<typeof summarize>, ReturnType<typeof summarize>];
      const problems: string[] = [];
      if (res.failed > 0) problems.push(`resistant mock failed ${res.failed} scenarios (scenarios or scorer are wrong)`);
      if (vul.failed === 0) problems.push("vulnerable mock failed nothing (the scorer is blind to attacks)");
      if (sil.failed < sc.length) problems.push("silent mock passed some scenarios (a workflow that does nothing must not pass)");
      if (problems.length) { console.error("\nSELFTEST FAILED:\n- " + problems.join("\n- ")); process.exit(1); }
      console.log(`\nSelftest OK: harness caught ${vul.failed}/${sc.length} attacks on the vulnerable mock and ${sil.failed}/${sc.length} on the silent one.`);
      console.log("\nExample failure report (one failure per attack class from the vulnerable mock):");
      printFailures(runs[1]!.results.filter((x, i, all) => !x.passed && all.findIndex((y) => !y.passed && y.class === x.class) === i));
      return;
    }
    case "run": {
      const dir = args[0] ?? "scenarios/attacks";
      const repo = parseRepo(flag(args, "repo") ?? "");
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error("Set GITHUB_TOKEN (fine-grained, scoped to the sandbox repo only)");
      const cfg = loadConfig();
      const failedFile = flag(args, "only-failed");
      const failedIds = failedFile ? [...new Set(loadRuns([failedFile]).flatMap((r) => r.results.filter((x) => !x.passed).map((x) => x.id)))] : undefined;
      if (failedIds && !failedIds.length) { console.log(`Nothing failed in ${failedFile}.`); return; }
      const only = failedIds?.join(",") ?? flag(args, "only");
      const repeat = Number(flag(args, "repeat") ?? 1);
      if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
      const name = flag(args, "name") ?? "alan-workflow";
      const octokit = new Octokit({ auth: token });
      const selected = selectScenarios(loadScenarios(dir), only);
      if (!cfg.tripwireBase && selected.some(usesTripwire)) throw new Error("scenarios use tripwire_hit but tripwireBase is not set in firedrill.config.json");
      const out = flag(args, "out") ?? "results.json";
      // One run per repeat, named name-1, name-2, ... so the heatmap shows variance side by side.
      const runs: ConfigRun[] = Array.from({ length: repeat }, (_, i) => ({ name: repeat > 1 ? `${name}-${i + 1}` : name, results: [] }));
      for (const { name: runName, results } of runs) for (const s of selected) {
        console.log(`> ${s.id}${repeat > 1 ? ` (${runName})` : ""}`);
        try {
          const ctx = contextFor(cfg, s);
          const r = score(s, await runOnGitHub(octokit, repo, s, ctx, cfg, (m) => console.log(`  ${m}`)), ctx);
          console.log(`  ${r.passed ? "PASS" : "FAIL"}`);
          results.push(r);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`  ERROR: ${msg}`);
          results.push(errorResult(s, msg));
        }
        writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2));
      }
      console.log("\n" + heatmap(runs));
      for (const r of runs) printFailures(r.results);
      process.exitCode = runs.every((r) => r.results.every((x) => x.passed)) ? 0 : 1;
      return;
    }
    case "tripwire": {
      const port = Number(flag(args, "port") ?? 8787);
      startTripwire(port);
      console.log(`Tripwire listening on :${port}. Trap URLs look like http://host:${port}/t/<token>; hits at /hits`);
      return;
    }
    case "report": {
      const runs = loadRuns(positional(args));
      console.log(heatmap(runs));
      for (const r of runs) printFailures(r.results);
      const sarif = flag(args, "sarif");
      if (sarif) {
        const paths = existsSync("scenarios") ? scenarioPaths("scenarios") : new Map<string, string>();
        writeFileSync(sarif, JSON.stringify(toSarif(runs, (id) => paths.get(id) ?? CONFIG_FILE), null, 2) + "\n");
        console.log(`\nWrote SARIF to ${sarif}`);
      }
      return;
    }
    case "generate": {
      const [file] = positional(args);
      if (!file) throw new Error("usage: generate <scenario.yaml> --count N --out <dir>");
      const count = Number(flag(args, "count") ?? 3);
      if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("--count must be an integer from 1 to 20");
      const gen = loadConfig().generator;
      if (!gen) throw new Error(`set "generator": { "baseUrl", "model" } in ${CONFIG_FILE} (an OpenAI-compatible endpoint)`);
      const seed = Scenario.parse(parse(readFileSync(file, "utf8")));
      const out = flag(args, "out") ?? "scenarios/generated";
      mkdirSync(out, { recursive: true });
      for (const v of await generateVariants(seed, count, gen, process.env.FIREDRILL_LLM_KEY)) {
        const p = join(out, `${v.id}.yaml`);
        writeFileSync(p, variantYaml(v, seed.id, gen.model));
        console.log(`wrote ${p}`);
      }
      console.log("\nReview the files, then: npx tsx src/cli.ts validate");
      return;
    }
    case "harden": {
      const p = hardenedPrompt(loadRuns(positional(args)).flatMap((r) => r.results));
      if (!p) { console.log("No violations in these results, so no prompt rules to add. (workflow_responded failures are timeouts or run errors, not prompt problems.)"); return; }
      console.log(`Add these lines to the workflow instructions, then rerun what failed:\n\n${p}\n\n  npx tsx src/cli.ts run <dir> --repo <o/n> --only-failed <results.json> --out after.json\n  npx tsx src/cli.ts report <results.json> after.json\n\nPrompt rules lower the risk but do not replace the how-to-fix steps (secrets out of context, read-only token, no outbound network).`);
      return;
    }
    case "doctor": {
      const checks: Check[] = [];
      let cfg: Config | undefined;
      try { cfg = loadConfig(); checks.push({ name: "config", status: "ok", detail: `${CONFIG_FILE} valid` }); } catch (e) { checks.push({ name: "config", status: "fail", detail: e instanceof Error ? e.message : String(e) }); }
      const token = process.env.GITHUB_TOKEN;
      checks.push(token ? { name: "GITHUB_TOKEN", status: "ok", detail: "set" } : { name: "GITHUB_TOKEN", status: "fail", detail: "not set (fine-grained, sandbox repo only)" });
      const repoArg = flag(args, "repo");
      if (!repoArg) checks.push({ name: "repo", status: "fail", detail: "pass --repo owner/name" });
      if (cfg) checks.push(await checkTripwire(cfg));
      if (cfg && token && repoArg) checks.push(...(await checkGitHub(new Octokit({ auth: token }), parseRepo(repoArg), cfg)));
      const mark = { ok: "✓", warn: "!", fail: "✗" };
      for (const c of checks) console.log(`${mark[c.status]} ${c.name.padEnd(13)} ${c.detail}`);
      process.exitCode = checks.some((c) => c.status === "fail") ? 1 : 0;
      return;
    }
    default:
      console.log("firedrill <init|doctor|validate|selftest|run|tripwire|report|generate|harden>\n  init                       create config and print the canary line for your workflow\n  doctor --repo o/n          check config, token, repo and tripwire before a run\n  validate [dir]             check scenario files\n  selftest [dir]             prove the scorer catches failures using mock agents\n  run [dir] --repo o/n       run scenarios against your Alan workflow via a sandbox repo\n    --only a,b  --out file   pick scenarios, results file (default results.json)\n    --repeat N               run every scenario N times to show variance\n    --only-failed file.json  rerun only what failed in a saved run\n  tripwire [--port 8787]     start the trap-URL server\n  report [file.json ...]     print saved runs side by side (before/after)\n    --sarif out.sarif        also write SARIF 2.1.0 for GitHub code scanning\n  generate seed.yaml         model-written attack variants of a seed (config generator, env FIREDRILL_LLM_KEY)\n    --count N --out dir      variants to write (default 3) and target dir (default scenarios/generated)\n  harden [file.json ...]     suggest prompt rules for the violations seen");
  }
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
