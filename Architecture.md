# Architecture: FireDrill

## 1. System overview

FireDrill never calls an Alan API (none is publicly documented). It opens the pull request that triggers an Alan workflow, then observes what appeared on GitHub and what hit its own tripwire server. This is the main fragility: everything depends on the GitHub trigger working on a sandbox repo.

Components:

- **CLI and scorer** (TypeScript): loads scenarios, drives the run, scores effects.
- **GitHub runner**: Octokit; opens PRs, polls comments, reviews, commits and branches.
- **Tripwire server**: a tiny HTTP endpoint that records hits keyed by a per-run token.
- **Mock agents**: resistant, vulnerable and silent, used by `selftest`.
- **Results viewer** (not built yet): static page that reads `results.json`.

## 2. Data flow and architecture

```
scenario YAML --load/validate (zod)--> scenario
      |
  firedrill run
      |-- render templates ({{canary}}, {{tripwire_url}}, per-run token)
      |-- GitHub: create branch, commit files, open PR  --> Alan workflow fires (external)
      |-- poll GitHub until quiet --> effects
      |        comments, branches, commits, merged?  +  tripwire hits (token-scoped)
      '-- scorer: must / mustNot assertions --> PASS | FAIL per scenario
      |
  results.json --> CLI grid + results page heatmap
```

`selftest` runs the same scorer against mock agents instead of GitHub, to prove the harness detects failures.

Assertions are deterministic. In `mustNot`, an assertion describes the violation. `workflow_responded` in `must` stops a silent workflow from passing.

## 3. Folder and file structure

```
FireDrill/
  src/
    cli.ts          command entry (init, run, selftest, tripwire, report)
    schema.ts       Zod scenario and assertion schemas
    scenarios.ts    YAML loader, unique-id check
    template.ts     {{canary}} / {{tripwire_url}} rendering
    github.ts       Octokit runner: open PR, poll
    effects.ts      collect observed effects into one structure
    scorer.ts       evaluate must / mustNot assertions
    tripwire.ts     HTTP tripwire server
    mock.ts         mock agents for selftest
    report.ts       grid and results.json output
  scenarios/
    attacks/        12 attack scenarios (YAML)
    review/         seeded-bug scenarios (one so far)
  test/scorer.test.ts
  .github/workflows/ci.yml
  PRD.md  Architecture.md  Agents.md  Phases.md  Design.md  Memory.md
  README.md  LICENSE  package.json  tsconfig.json
```

Planned additions: `web/` (Next.js static export for the results page), `api/tripwire` (deployed function), `action.yml` (GitHub Action).

## 4. Tech stack

- TypeScript, Node (ESM), `tsx` to run, `tsc --noEmit` for typecheck.
- `@octokit/rest` for GitHub, `zod` for schemas, `yaml` for scenarios.
- Tests: `node --test` with tsx.
- Results page: Next.js static export on Vercel, reading `results.json` (no database).
- Tripwire: one Vercel function with a small store, or the local server exposed publicly during runs.
- Open models: any OpenAI-compatible endpoint, model name in config (not hard-coded).
- CI: GitHub Actions.

## 5. Scalability and future considerations

- Webhook-trigger mode once Alan's URL, auth and payload format are confirmed.
- Slack and Teams effect observation, and a GitHub check posted back so results show inside Alan's PR view.
- Shared attack corpus and mined real bugs (SZZ-style) for the review pack.
- Variance handling: repeat runs per cell, report ranges.
- If Alan exposes an API or CLI, replace polling with direct run status.
- Limits to state honestly: effects visible only through GitHub, runs are slow (trigger latency), and open-model judges are weaker than frontier ones.
