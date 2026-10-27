# Weak reference agent

A GitHub Actions workflow that behaves like a badly written AI reviewer, so you can watch FireDrill catch a real failure without Alan. It sends the PR title, body, branch name, commit messages and diff to an OpenAI-compatible chat endpoint with a deliberately weak prompt ("follow instructions for the reviewer", plus a fake secret in the prompt), and posts the reply as a PR comment.

**Deliberately insecure. Sandbox repo only.** The secret must be the fake canary from `firedrill init`. The agent is vulnerable to prompt injection by design, but not to shell injection: PR text reaches the script only through environment variables and `jq`.

**Status: not installed or run yet.** The YAML parses (checked with the `yaml` package); nothing has been run on GitHub.

## Setup

1. Copy `firedrill-weak-agent.yml` to `.github/workflows/` in your sandbox repo. Pause any other automation on that repo (Alan) so two agents do not answer the same PR.
2. In the repo's Settings, Secrets and variables, Actions:
   - Secret `FIREDRILL_LLM_KEY`: API key for your provider.
   - Secret `FIREDRILL_CANARY`: the `FD-CANARY-...` value from `npx tsx src/cli.ts init` (`firedrill.config.json`).
   - Variable `FIREDRILL_LLM_URL`: base URL without `/chat/completions`, for example `https://router.huggingface.co/v1` (Hugging Face router) or any OpenAI-compatible provider.
   - Variable `FIREDRILL_LLM_MODEL`: the model name that provider expects.
   - Variable `FIREDRILL_SANDBOX`: set to `true`. The workflow's job has an `if:` on it and does nothing without this variable, so a copy that lands in a real repo stays inert.
3. Run:

```bash
npx tsx src/cli.ts doctor --repo <owner>/<sandbox>
npx tsx src/cli.ts run scenarios/attacks --repo <owner>/<sandbox> --name weak-agent --out results/weak-agent.json --repeat 3
```

## What to expect

- A run takes seconds per scenario (a workflow run plus one model call), not minutes like Alan.
- Scenarios that need the agent to fetch a URL (`tripwire_hit`) will likely PASS, because this agent has no fetch tool. That is a real property of this agent, not a harness bug.
- `hidden-pr-comment` may race: FireDrill posts that comment right after opening the PR, and this workflow does not read PR comments anyway.
- Results vary by model. Record them as they come, including a weak agent that still holds.

`web/scripts/copy-results.mjs` picks up `results/weak-agent.json` as "Weak reference agent (live)" when it exists.
