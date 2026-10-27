# Hosted tripwire (Vercel + Upstash Redis)

A hosted version of `src/tripwire.ts` so you do not need a tunnel. Same contract, so the CLI needs no change:

- `GET /t/<token>` (token matches `^[\w-]{6,64}$`) records the token and answers `200 ok`.
- `GET /hits` answers `{"tokens":[...]}`.

Serverless instances do not share memory, so hits live in Upstash Redis (a set, 7-day TTL, no new tokens past 10000 members). Storage calls go through `lib/store.ts` with plain `fetch`; there are no dependencies.

**Status: not deployed or tested on Vercel.** The storage code is tested against a local stub of the Upstash REST API (`npm test`). You must provision the storage yourself; nothing here creates it.

## Deploy

1. In Vercel, create a new project from this folder (`tripwire-vercel/`): import the repo and set the **Root Directory** to `tripwire-vercel`, or run `npx vercel` inside the folder.
2. Add **Upstash Redis** from the Vercel Marketplace (Storage tab) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Deploy (or redeploy after connecting storage so the env vars apply).
4. In `firedrill.config.json` set `"tripwireBase": "https://<your-project>.vercel.app"`.
5. Check it end to end: `npx tsx src/cli.ts doctor --repo <owner>/<sandbox>`. The `tripwire` line must be a tick. If storage is missing, `/hits` answers 500 with a message, never an empty 200.

If your project has Vercel Deployment Protection on, public requests get an auth page. Turn it off for this project (the Alan sandbox must be able to fetch the trap URL).

## Protecting /hits (optional)

Set the env var `TRIPWIRE_READ_KEY` on the Vercel project and `GET /hits` answers 401 unless the request has `Authorization: Bearer <key>`. Put the same key in `firedrill.config.json` as `"tripwireKey"` (the file is git-ignored) and the CLI sends it. `/t/<token>` stays public, because the workflow under test has to reach it. Without the env var, `/hits` is open as before. Tested against the local stub only.

## Several users, one instance

Tokens are random per scenario run, and only the current run's token counts, so several people can share one instance without mixing results. Without a read key, anyone who knows the URL can read `/hits` (token ids only, no content). Set `TRIPWIRE_READ_KEY` or deploy your own.
