/**
 * Whether a "Record with Pulse" tap opens Pulse inside the app (`embed`), or
 * keeps today's Pulse link flow (PLAN §5.1 Fallback modes): the Pulse-app
 * link on a phone (`link`), a QR code or a file upload on a computer
 * (`qr-or-file`). Both fallbacks are today's PulseButton / usePulseUpload,
 * unchanged.
 *
 * Pure: the caller gathers the facts (the device, the Pulse client's info,
 * `pulseUploadTypes.list`) and this decides. Every row of the table names
 * its reason, for logs and tests.
 */
import type { PulseSettingKey, PulseTeamSettings, PulseUploadTypeId } from '../../lib/api';
import { CONTRACT, type PulseInfo } from './client';

export type StartPulseMode = 'embed' | 'link' | 'qr-or-file';

export type StartPulseReason =
  | 'embed'
  /** A computer's browser: a QR code, or a file from this computer. */
  | 'desktop'
  /** A phone's browser: the Pulse-app link. */
  | 'mobile-browser'
  /** The app has no Pulse plugin (an older build), or it isn't answering. */
  | 'no-plugin'
  /** The plugin says Pulse can't run here (an older OS, an iPad, the device). */
  | 'unsupported'
  /** The plugin speaks another major version of the contract. */
  | 'contract'
  /** Pulse in the app is iPhone-only until the Android plugin ships (PR4). */
  | 'platform'
  | 'ipad'
  /** Pulse is paused for everyone (AD34). */
  | 'runtime-paused'
  /** The team's "Pulse in the app" setting is off. */
  | 'setting-off'
  /** The server doesn't offer this kind of video to this person, or the list hasn't loaded. */
  | 'type-unsupported';

export interface StartPulseDecision {
  mode: StartPulseMode;
  reason: StartPulseReason;
}

/** Where Pulse in the app runs today: iOS only, Android after PR4 (its stub reports unavailable). */
export const EMBED_PLATFORMS: readonly PulseInfo['platform'][] = ['ios'];

export interface StartPulseFacts {
  /** Inside the TimeHuddle app (Capacitor), not a browser. */
  isNativeApp: boolean;
  /** A browser on a phone or tablet (only read outside the app). */
  isMobileBrowser: boolean;
  /** The Pulse plugin is present (`isAvailable()`, or the adapter's `present()`). */
  pluginAvailable: boolean;
  /** `getInfo()`, or null when it couldn't be read. */
  info:
    | (Pick<PulseInfo, 'supported' | 'contract' | 'platform'> &
        Partial<Pick<PulseInfo, 'unsupportedReason'>>)
    | null;
  /** The device is an iPad (Pulse in the app is iPhone-only for now). */
  isIPad: boolean;
  /** Pulse is paused for everyone (`pulseUploadTypes.list`'s `runtimePaused`). */
  runtimePaused: boolean;
  /**
   * The place's team has Pulse on for this type: "Pulse in the app", and for
   * a clock type (`clock.wrapup`, `clock.plan`) "Clock in and out with Pulse"
   * as well (Gate 0b, TH-11). Take it from `pulseSettingsOnFor(teams, teamId,
   * type)`, not from `pulseSettingFor` with one key.
   */
  settingOn: boolean;
  /** What is being recorded. */
  type: PulseUploadTypeId;
  /** The type ids `pulseUploadTypes.list` offered; null before it has answered. */
  supportedTypes: readonly string[] | null;
}

const fallback = (facts: Pick<StartPulseFacts, 'isNativeApp' | 'isMobileBrowser'>) =>
  facts.isNativeApp || facts.isMobileBrowser ? 'link' : 'qr-or-file';

/**
 * How a "Record with Pulse" tap starts Pulse. Outside the app: the link on a
 * phone, a QR or a file on a computer. Inside it: Pulse itself only when
 * every check passes, else the link, which opens the standalone Pulse app
 * (or its store page).
 */
export function startPulse(facts: StartPulseFacts): StartPulseDecision {
  const no = (reason: StartPulseReason): StartPulseDecision => ({
    mode: fallback(facts),
    reason,
  });
  if (!facts.isNativeApp) return no(facts.isMobileBrowser ? 'mobile-browser' : 'desktop');
  const { info } = facts;
  if (!facts.pluginAvailable || !info) return no('no-plugin');
  if (info.contract?.major !== CONTRACT.major) return no('contract');
  if (!info.supported) return no(info.unsupportedReason === 'ipad' ? 'ipad' : 'unsupported');
  if (!EMBED_PLATFORMS.includes(info.platform)) return no('platform');
  if (facts.isIPad) return no('ipad');
  if (facts.runtimePaused) return no('runtime-paused');
  if (!facts.settingOn) return no('setting-off');
  if (!facts.supportedTypes?.includes(facts.type)) return no('type-unsupported');
  return { mode: 'embed', reason: 'embed' };
}

/**
 * A Pulse setting for a place (`pulseUploadTypes.list`'s `teams`): the
 * place's own team's value for a team-bound place (a ticket, a session, a
 * plan, a post); for one with no team (the library), on when any team has
 * it on. Off for a team the list doesn't name.
 */
export function pulseSettingFor(
  teams: Readonly<Record<string, PulseTeamSettings>> | null | undefined,
  teamId: string | null,
  key: PulseSettingKey = 'pulseInApp',
): boolean {
  if (!teams) return false;
  if (teamId == null) return Object.values(teams).some((settings) => settings?.[key] === true);
  return Object.hasOwn(teams, teamId) && teams[teamId]?.[key] === true;
}

/** The upload types that are clock buttons, behind `pulseClockInOut` as well as `pulseInApp`. */
export const CLOCK_BUTTON_TYPES: readonly PulseUploadTypeId[] = ['clock.wrapup', 'clock.plan'];

/**
 * The `settingOn` fact for recording `type` in a place: `pulseInApp`, and
 * `pulseClockInOut` too for a clock button type, each read by pulseSettingFor.
 */
export function pulseSettingsOnFor(
  teams: Readonly<Record<string, PulseTeamSettings>> | null | undefined,
  teamId: string | null,
  type: PulseUploadTypeId,
): boolean {
  if (!pulseSettingFor(teams, teamId, 'pulseInApp')) return false;
  return !CLOCK_BUTTON_TYPES.includes(type) || pulseSettingFor(teams, teamId, 'pulseClockInOut');
}

/**
 * Whether a user agent is an iPad's: one that says so, or iPadOS's
 * desktop-class `Macintosh` agent on a touch screen.
 */
export function isIPadAgent(userAgent: string, maxTouchPoints: number): boolean {
  return /ipad/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1);
}
