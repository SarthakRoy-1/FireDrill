import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, readSync, closeSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { Octokit } from "@octokit/rest";
import type { RepoRef } from "./github.ts";

export interface SecretHit { file: string; line: number; pattern: string }

// shortcut: a regex scan is a guard, not a guarantee; it misses unlabeled or encoded secrets, so skim the code yourself before trusting the copy.
const PATTERNS: [string, RegExp][] = [
  ["github-token", /\b(?:ghp|gho)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["aws-access-key-id", /AKIA[0-9A-Z]{16}/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{8,}/],
  ["stripe-live-key", /sk_live_[A-Za-z0-9]{8,}/],
  ["secret-assignment", /(?:api[_-]?key|secret|password)["']?\s*[:=]\s*["']([^"'\s]{16,})["']/i],
];
const MAX_BYTES = 1024 * 1024;
/** Generated output is never copied or scanned, at any depth. */
export const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", ".next", "coverage", ".vercel", ".turbo"]);

// Identifier-like values (error codes, labels) are not secrets: need a digit and a letter, and not lowercase words joined by - or _.
function looksSecret(v: string): boolean {
  return /\d/.test(v) && /[a-z]/i.test(v) && !/^[a-z]+(?:[-_][a-z]+)*$/.test(v);
}

/** Pure scan of one file's text. Reports file, line and pattern name only, never the matched value. */
export function scanText(file: string, text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  if (/^\.env(\..+)?$/.test(file.split("/").pop()!)) hits.push({ file, line: 1, pattern: "env-file" });
  text.split("\n").forEach((l, i) => {
    for (const [pattern, re] of PATTERNS) {
      const hit = pattern === "secret-assignment"
        ? [...l.matchAll(new RegExp(re.source, re.flags + "g"))].some((m) => looksSecret(m[1]!))
        : re.test(l);
      if (hit) hits.push({ file, line: i + 1, pattern });
    }
  });
  return hits;
}

function isBinary(p: string): boolean {
  const fd = openSync(p, "r");
  try { const b = Buffer.alloc(8000); return b.subarray(0, readSync(fd, b, 0, 8000, 0)).includes(0); } finally { closeSync(fd); }
}

/** Scans every file under dir except .git and SKIP_DIRS (reported via onSkip, not deleted). .env files count by name; binaries and files over 1 MB are skipped. */
export function scanDir(dir: string, onSkip: (path: string) => void = () => {}): SecretHit[] {
  const hits: SecretHit[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(dir, p).replaceAll("\\", "/");
      const st = statSync(p);
      if (st.isDirectory()) { if (SKIP_DIRS.has(name)) onSkip(p); else if (name !== ".git") walk(p); continue; }
      if (st.size > MAX_BYTES || isBinary(p)) { hits.push(...scanText(rel, "")); continue; } // name checks still apply
      hits.push(...scanText(rel, readFileSync(p, "utf8")));
    }
  };
  walk(dir);
  return hits;
}

// Reads the token from the environment at run time, so it never appears in process args.
const AUTH = ["-c", "credential.helper=", "-c", "credential.helper=!f() { echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...AUTH, ...a], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"] });

/** Copies the code of src (no history, no .git) into a new private repo under the token owner. Refuses if the secret scan finds anything. */
export async function cloneSandbox(octokit: Octokit, src: RepoRef, newName: string, log: (m: string) => void = () => {}): Promise<string> {
  if (!/^[\w.-]+$/.test(newName)) throw new Error(`new repo name must match [\w.-]+, got "${newName}"`);
  const me = (await octokit.users.getAuthenticated()).data.login;
  const exists = await octokit.repos.get({ owner: me, repo: newName }).then(() => true, (e: { status?: number }) => { if (e.status === 404) return false; throw e; });
  if (exists) throw new Error(`${me}/${newName} already exists; pick another name (nothing was changed)`);
  const tmp = mkdtempSync(join(tmpdir(), "firedrill-clone-"));
  try {
    log(`cloning ${src.owner}/${src.repo} (depth 1)`);
    git(tmp, "clone", "--depth", "1", `https://github.com/${src.owner}/${src.repo}.git`, "src");
    const dir = join(tmp, "src");
    rmSync(join(dir, ".git"), { recursive: true, force: true, maxRetries: 3 });
    const skipped: string[] = [];
    const hits = scanDir(dir, (p) => skipped.push(p));
    for (const p of skipped) rmSync(p, { recursive: true, force: true, maxRetries: 3 }); // so `git add -A` never sees them
    if (skipped.length) log(`skipped build output: ${[...new Set(skipped.map((p) => basename(p)))].join(", ")}`);
    if (hits.length) throw new Error(`refusing to copy: possible secrets found (values not shown). Remove or rotate them in the source first.\n${hits.map((h) => `  ${h.file}:${h.line} ${h.pattern}`).join("\n")}`);
    await octokit.repos.createForAuthenticatedUser({ name: newName, private: true });
    log(`created private repo ${me}/${newName}`);
    git(dir, "init", "-b", "main");
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=firedrill", "-c", "user.email=firedrill@users.noreply.github.com", "commit", "-m", `Code-only copy of ${src.owner}/${src.repo} (firedrill clone)`);
    git(dir, "remote", "add", "origin", `https://github.com/${me}/${newName}.git`);
    git(dir, "push", "-u", "origin", "main");
    return `${me}/${newName}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}
