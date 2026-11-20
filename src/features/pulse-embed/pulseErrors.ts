/**
 * What TimeHuddle says, and offers, for every error Pulse can report (PLAN
 * §5.2: no tap ever ends in a rejected call that shows nothing). One table
 * covers the three code sets of @mieweb/pulse-embed: a call's rejection
 * (CallErrorCode), a flow or upload job's failure (FlowErrorCode), and a
 * HostServices refusal (HostServiceError). The table is typed by those
 * unions, so a code the contract adds fails the typecheck here until it has
 * copy and an action.
 */
import type { CallErrorCode, FlowErrorCode, HostServiceError } from '@mieweb/pulse-embed';
import { PULSE_EMBED_TEXT } from './pulseEmbedStrings';

export type PulseErrorCode = CallErrorCode | FlowErrorCode | HostServiceError['code'];

/** What the person can do about it; the page wires each one to its control. */
export type PulseErrorAction =
  | 'retry'
  | 'settings'
  | 'restart'
  | 'update'
  | 'sign-in'
  | 'trim'
  | 'move'
  | 'free-space'
  | 'dismiss';

export const PULSE_ERROR_ACTIONS: readonly PulseErrorAction[] = [
  'retry',
  'settings',
  'restart',
  'update',
  'sign-in',
  'trim',
  'move',
  'free-space',
  'dismiss',
];

export interface PulseErrorEntry {
  copy: string;
  action: PulseErrorAction;
}

const E = PULSE_EMBED_TEXT.error;
const entry = (copy: string, action: PulseErrorAction): PulseErrorEntry => ({ copy, action });

/** Every code, its copy and its action. */
export const PULSE_ERRORS: Readonly<Record<PulseErrorCode, PulseErrorEntry>> = Object.freeze({
  // A call's rejection (CallErrorCode).
  unavailable: entry(E.unavailable, 'retry'),
  unsupported: entry(E.unsupported, 'dismiss'),
  'contract.unsupported': entry(E.appTooOld, 'update'),
  'method.unsupported': entry(E.appTooOld, 'update'),
  busy: entry(E.busy, 'retry'),
  invalid_options: entry(E.invalidOptions, 'dismiss'),
  not_found: entry(E.notFound, 'dismiss'),
  'draft.locked': entry(E.locked, 'dismiss'),
  'host.unavailable': entry(E.hostUnavailable, 'retry'),
  restart_required: entry(E.restartRequired, 'restart'),
  host_misconfigured: entry(E.hostMisconfigured, 'retry'),
  no_account: entry(E.noAccount, 'sign-in'),
  timeout: entry(E.timeout, 'retry'),
  'storage.full': entry(E.storageFull, 'free-space'),
  'storage.newer_schema': entry(E.newerSchema, 'update'),
  'storage.damaged': entry(E.damaged, 'dismiss'),
  unknown: entry(E.unknown, 'retry'),
  'runtime.paused': entry(E.runtimePaused, 'dismiss'),
  // A flow's or an upload job's failure (FlowErrorCode).
  'permission.camera': entry(E.camera, 'settings'),
  'permission.microphone': entry(E.microphone, 'settings'),
  'export.failed': entry(E.exportFailed, 'retry'),
  'upload.failed': entry(E.uploadFailed, 'retry'),
  'upload.refused': entry(E.uploadRefused, 'move'),
  'destination.gone': entry(E.destinationGone, 'move'),
  'credentials.expired': entry(E.credentialsExpired, 'sign-in'),
  'runtime.error': entry(E.runtimeError, 'retry'),
  'upload.too_large': entry(E.tooLarge, 'trim'),
});

/** Finer reasons inside a code that read differently (PulseErrorInfo.reason). */
const BY_REASON: Readonly<Record<string, PulseErrorEntry>> = Object.freeze({
  'draft.locked:clock_bound': entry(E.clockBound, 'dismiss'),
});

/** The label of an action's control. */
export const PULSE_ERROR_ACTION_LABELS: Readonly<Record<PulseErrorAction, string>> = Object.freeze({
  retry: PULSE_EMBED_TEXT.action.retry,
  settings: PULSE_EMBED_TEXT.action.settings,
  restart: PULSE_EMBED_TEXT.action.restart,
  update: PULSE_EMBED_TEXT.action.update,
  'sign-in': PULSE_EMBED_TEXT.action.signIn,
  trim: PULSE_EMBED_TEXT.action.trim,
  move: PULSE_EMBED_TEXT.action.move,
  'free-space': PULSE_EMBED_TEXT.action.freeSpace,
  dismiss: PULSE_EMBED_TEXT.action.dismiss,
});

export const isPulseErrorCode = (code: unknown): code is PulseErrorCode =>
  typeof code === 'string' && Object.hasOwn(PULSE_ERRORS, code);

export interface PulseErrorCopy extends PulseErrorEntry {
  /** The code the copy is for: `unknown` for anything that isn't a Pulse code. */
  code: PulseErrorCode;
  actionLabel: string;
}

/**
 * What to show for a failure: a PulseError (or its plain info), a
 * HostServiceError, a job's `DraftUpload.error`, or anything else a call
 * rejected with (that reads as `unknown`, never as nothing).
 */
export function pulseErrorCopy(error: unknown): PulseErrorCopy {
  const info = (error && typeof error === 'object' ? error : {}) as {
    code?: unknown;
    reason?: unknown;
  };
  const code: PulseErrorCode = isPulseErrorCode(info.code) ? info.code : 'unknown';
  const reasonKey = typeof info.reason === 'string' ? `${code}:${info.reason}` : null;
  const found =
    reasonKey && Object.hasOwn(BY_REASON, reasonKey) ? BY_REASON[reasonKey] : PULSE_ERRORS[code];
  return { code, ...found, actionLabel: PULSE_ERROR_ACTION_LABELS[found.action] };
}
