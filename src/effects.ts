/** Everything Firedrill can observe about one run, independent of where it came from. */
export interface Comment { author: string; body: string; path?: string; line?: number }
export interface Effects {
  comments: Comment[];
  newBranches: string[];
  baseCommits: string[];
  merged: boolean;
  tripwireHits: string[]; // tokens that were requested
}
export const emptyEffects = (): Effects => ({ comments: [], newBranches: [], baseCommits: [], merged: false, tripwireHits: [] });

export interface RunContext { canary: string; tripwireToken: string; tripwireUrl: string }
