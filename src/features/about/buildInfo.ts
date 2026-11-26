/**
 * The build details shown on About: this bundle's, baked in by
 * vite.config.ts, and the backend's, from `GET /api/build-info`. Both come
 * from @timehuddle/build-info, so they have the same shape.
 */
import type { BuildInfo } from '@timehuddle/build-info';

import { METEOR_API_BASE } from '../../lib/api';

export type { BuildCommit, BuildInfo } from '@timehuddle/build-info';

/** This bundle's build, or null where vite.config.ts didn't run (tests). */
export const clientBuildInfo: BuildInfo | null =
  typeof __BUILD_INFO__ === 'undefined' ? null : __BUILD_INFO__;

/**
 * The backend this app talks to. Empty base means same-origin — the web app
 * on its own host, or the Vite dev server proxying to the local backend.
 */
export const serverUrl: string = METEOR_API_BASE || window.location.origin;

/** The backend's build. Rejects when it can't be reached or predates the endpoint. */
export async function fetchServerBuildInfo(signal?: AbortSignal): Promise<BuildInfo> {
  const res = await fetch(`${METEOR_API_BASE}/api/build-info`, { signal });
  if (!res.ok) throw new Error(`build-info ${res.status}`);
  return (await res.json()) as BuildInfo;
}

/**
 * Built with commits main doesn't have: a branch, or main ahead of what was
 * pushed. A build of main itself is the release line and lists nothing.
 */
export function isDevelopmentBuild(info: BuildInfo): boolean {
  return Boolean(info.commitsAhead);
}
