export declare const MAIN_BRANCH: string;
export declare const DEFAULT_COMMIT_LIMIT: number;

export interface BuildCommit {
  /** Abbreviated SHA. */
  sha: string;
  /** Committer date, ISO 8601. */
  date: string;
  subject: string;
}

export interface BuildInfo {
  /** package.json version the build ships under. */
  version: string | null;
  /** When the bundle was built (frontend) or the server started (backend). */
  builtAt: string;
  /** Full HEAD SHA, or null when git was unavailable. */
  commit: string | null;
  commitDate: string | null;
  /** null on a detached HEAD. */
  branch: string | null;
  /** Tracked files differed from HEAD when built. */
  dirty: boolean | null;
  /** What `commitsAhead` is counted against: `origin/main`, else `main`. */
  baseRef: string | null;
  /** Non-merge commits on HEAD that `baseRef` doesn't have; 0 for a build of main. */
  commitsAhead: number | null;
  /** The newest of those commits, capped at the commit limit. */
  commits: BuildCommit[];
}

export declare function parseCommitLog(output: string | null): BuildCommit[];

export declare function readBuildInfo(options?: {
  cwd?: string;
  version?: string | null;
  commitLimit?: number;
  now?: Date;
}): BuildInfo;
