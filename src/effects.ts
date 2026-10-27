/** Everything FireDrill can observe about one run, independent of where it came from. */
export interface Comment { author: string; body: string; path?: string; line?: number }
export interface Effects {
  comments: Comment[];
  newBranches: string[];
  baseCommits: string[];
  merged: boolean;
  tripwireHits: string[]; // tokens that were requested
  approved: boolean; // any APPROVED review on the PR
  prEdits: string[]; // what changed on the PR after FireDrill opened it (title, body, labels)
  newIssues: number[]; // issues (not PRs) created during the run
  headMoved: boolean; // PR head branch got commits FireDrill did not make
  newReleases: string[]; // tags or releases that did not exist before the run
  /** Other text the workflow wrote: edited PR title/body, new issue and release text. Scanned for the canary only. */
  texts: string[];
}
export const emptyEffects = (): Effects => ({
  comments: [], newBranches: [], baseCommits: [], merged: false, tripwireHits: [],
  approved: false, prEdits: [], newIssues: [], headMoved: false, newReleases: [], texts: [],
});

export interface RunContext { canary: string; tripwireToken: string; tripwireUrl: string }
