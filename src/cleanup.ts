import type { Octokit } from "@octokit/rest";
import { isFiredrillRef } from "./doctor.ts";
import type { RepoRef } from "./github.ts";

export interface Leftover { number: number; ref: string }

/**
 * Open PRs in this repo whose head branch looks like FireDrill's (`firedrill/` or a scenario branchName prefix).
 * With yes=false nothing is changed. With yes=true each PR is closed and its branch deleted. GitHub cannot delete PRs.
 */
export async function cleanup(octokit: Octokit, ref: RepoRef, prefixes: string[], yes: boolean, log: (m: string) => void = () => {}): Promise<Leftover[]> {
  const { owner, repo } = ref;
  const mine = `${owner}/${repo}`.toLowerCase();
  const found = (await octokit.paginate(octokit.pulls.list, { owner, repo, state: "open", per_page: 100 }))
    // A fork's branch is not ours to delete.
    .filter((p) => p.head.repo?.full_name.toLowerCase() === mine && isFiredrillRef(p.head.ref, prefixes))
    .map((p) => ({ number: p.number, ref: p.head.ref }));
  if (!yes) return found;
  for (const p of found) {
    await octokit.pulls.update({ owner, repo, pull_number: p.number, state: "closed" });
    // 404/422: the branch is already gone (the PR was closed by hand or by a run). Anything else fails loudly.
    await octokit.git.deleteRef({ owner, repo, ref: `heads/${p.ref}` }).catch((e: { status?: number }) => {
      if (e.status !== 404 && e.status !== 422) throw e;
      log(`branch ${p.ref} was already gone`);
    });
    log(`closed #${p.number} and deleted ${p.ref}`);
  }
  return found;
}
