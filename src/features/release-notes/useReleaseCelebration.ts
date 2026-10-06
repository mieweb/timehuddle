/**
 * useReleaseCelebration — confetti on the first few visits to a new release.
 *
 * The marker (`<version>:<visits>`) lives in localStorage rather than on the user, because this is a
 * property of the *install*, not the account: a phone that just took an OTA
 * update should celebrate, and a second browser on the same account should too.
 * It is deliberately separate from `releaseNotesSeenVersion`, which answers a
 * different question (what has this person read) and drives the "New" badges.
 *
 * Unread notes celebrate regardless of the marker: the What's New banner told
 * the user something is new, so the page they land on should agree. That can't
 * repeat — the page marks the notes read as it opens.
 */
import { useEffect } from 'react';

import { RELEASE_CELEBRATED_KEY } from '../../lib/constants';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

/** How many visits to the page celebrate each new version, per browser. */
export const CELEBRATED_VISITS = 3;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Two bursts from the lower corners, so nothing covers the notes being read. */
async function fireConfetti(): Promise<void> {
  const { default: confetti } = await import('canvas-confetti');
  const shared = { particleCount: 60, spread: 70, startVelocity: 45, ticks: 180 };
  void confetti({ ...shared, origin: { x: 0.1, y: 0.9 }, angle: 60 });
  void confetti({ ...shared, origin: { x: 0.9, y: 0.9 }, angle: 120 });
}

/**
 * Counts this visit and says whether it is among the first CELEBRATED_VISITS
 * to this version in this browser. Each page open is one visit. False when the
 * store is unavailable (private mode) — better no confetti than every visit.
 */
function countVisit(): boolean {
  try {
    const [version, count] = (localStorage.getItem(RELEASE_CELEBRATED_KEY) ?? '').split(':');
    const visits = version === APP_VERSION ? Number(count) || 0 : 0;
    if (visits >= CELEBRATED_VISITS) return false;
    localStorage.setItem(RELEASE_CELEBRATED_KEY, `${APP_VERSION}:${visits + 1}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fires on the first CELEBRATED_VISITS visits to this version in this browser,
 * or whenever the page opens with notes the user has not read (`hasUnread`,
 * captured on mount).
 */
export function useReleaseCelebration(hasUnread = false): void {
  useEffect(() => {
    // Always counted, so an unread visit uses up one of the celebrated ones.
    const celebratedVisit = countVisit();
    if (!celebratedVisit && !hasUnread) return;
    if (prefersReducedMotion()) return;
    void fireConfetti();
  }, [hasUnread]);
}
