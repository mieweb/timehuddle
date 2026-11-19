/**
 * When Pulse's surfaces show, and when Huddle may wake Pulse in the
 * background (PLAN §7.2 visibility rule, AD25 kill switch, AD34 runtime pause).
 *
 * - The Unsent videos surfaces (the Media entry, the section, the "Unsent
 *   videos (n)" links, the "On this phone" rows, the sign-out warning) show
 *   when Pulse is available on this phone and either one of the person's
 *   teams has "Pulse in the app" on, or Pulse holds unsent videos. Turning
 *   the setting off on every team hides the record buttons only: no video is
 *   ever stranded.
 * - `runtimePaused` stops every background Pulse call (resumeOutbox, prewarm,
 *   namespace cleanup) and every record button; the catalog is still read,
 *   so unsent videos stay visible.
 */
import type { PulseTeamSettings } from '../../lib/api';

export interface VisibilityFacts {
  /** `isAvailable()`: the plugin is present and Pulse runs on this device. */
  available: boolean;
  /** `pulseUploadTypes.list().teams`; null before it has answered. */
  teams: Readonly<Record<string, Partial<PulseTeamSettings>>> | null;
  /** `usage().unsent`; null before it has answered. */
  unsent: number | null;
}

/** Any of the person's teams has "Pulse in the app" on. */
export function anyTeamPulseInApp(teams: VisibilityFacts['teams']): boolean {
  return !!teams && Object.values(teams).some((settings) => settings?.pulseInApp === true);
}

/** Whether the Unsent videos surfaces show (§7.2). */
export function pulseSurfacesVisible(facts: VisibilityFacts): boolean {
  if (!facts.available) return false;
  return anyTeamPulseInApp(facts.teams) || (facts.unsent ?? 0) > 0;
}

export interface BackgroundFacts {
  available: boolean;
  /**
   * `pulseUploadTypes.list().runtimePaused`; null while the server hasn't
   * answered. Unknown counts as paused: the pause exists to stop a crash in
   * Pulse's background work, so nothing wakes Pulse before the server says
   * it may.
   */
  runtimePaused: boolean | null;
}

/**
 * Whether Huddle may run Pulse's background work now: `resumeOutbox` on
 * start and resume, `prewarm`, and stale-namespace cleanup. Independent of
 * the `pulseInApp` setting (AD25): videos already sent keep sending.
 */
export function backgroundWorkAllowed(facts: BackgroundFacts): boolean {
  return facts.available && facts.runtimePaused === false;
}

/** Whether record buttons may open Pulse at all (the per-place checks are startPulse's). */
export function recordingAllowed(facts: BackgroundFacts & VisibilityFacts): boolean {
  return backgroundWorkAllowed(facts) && anyTeamPulseInApp(facts.teams);
}
