/**
 * Huddle's side of Pulse's uploads (HostServices): Pulse asks, Huddle asks
 * the server, Pulse uploads. Each request names its draft's PulseContext,
 * whose `data` (place.ts) says which upload type and target the video is for.
 *
 *  - getUploadTarget → `pulseUploads.begin`: the artifact and a token.
 *  - refreshUploadToken → `pulseUploads.token`.
 *  - releaseUploadTarget → `pulseUploads.cancel` (Cancel sending, Edit, Delete).
 *  - confirmSend → `clock.stopWithVideo` / `clock.startWithPlan` at Send,
 *    before Pulse closes (AD23): Pulse queues the upload only once it answers.
 *
 * A server refusal reaches Pulse as a HostServiceError code (huddle-server
 * §15), the same table as the server's serverErrorToPulseCode
 * (pulse-uploads-core.js). Anything else is `host.unavailable`, which Pulse
 * retries.
 */
import {
  clockApi,
  pulseUploadApi,
  type PulseClockSend,
  type PulseUploadTypeId,
} from '../../lib/api';
import type {
  ConfirmSendRequest,
  HostServiceError,
  HostServices,
  ReleaseRequest,
  TokenRequest,
  UploadTarget,
  UploadTargetRequest,
} from './client';
import { placeData } from './place';

export type HostServiceCode = HostServiceError['code'];

/** How long Send waits on the clock call before it says it couldn't clock (PLAN §5.1 B2). */
export const CONFIRM_SEND_TIMEOUT_MS = 20_000;

/** What a service rejects with: Pulse reads `code` and logs `message`. */
export class HostServiceFailure extends Error implements HostServiceError {
  constructor(
    readonly code: HostServiceCode,
    message: string,
  ) {
    super(message);
    this.name = 'HostServiceFailure';
  }
}

/** The server's refusals (a Meteor.Error's `error`) and the Pulse code each one is. */
export const PULSE_ERROR_CODES: Readonly<Record<string, HostServiceCode>> = Object.freeze({
  'not-found': 'destination.gone',
  forbidden: 'destination.gone',
  'bad-request': 'upload.refused',
  'validation-error': 'upload.refused',
  conflict: 'upload.refused',
  'too-large': 'upload.too_large',
  'not-authorized': 'no_account',
  'too-many-requests': 'host.unavailable',
});

/** An HTTP reply that carries no known `error`, by status. */
export const PULSE_HTTP_STATUS_CODES: Readonly<Record<number, HostServiceCode>> = Object.freeze({
  400: 'upload.refused',
  403: 'destination.gone',
  404: 'destination.gone',
  409: 'upload.refused',
  410: 'destination.gone',
  413: 'upload.too_large',
  422: 'upload.refused',
});

/**
 * The Pulse code for a failed call. A wormhole call fails with an ApiError
 * (`status`, and the Meteor `code` when the server sent one); HTTP 401 is
 * signed out; 429, a 5xx, and a failure with no reply at all (offline, a
 * timeout) are `host.unavailable`.
 */
export function pulseCodeOf(error: unknown): HostServiceCode {
  if (error instanceof HostServiceFailure) return error.code;
  const failure = (error && typeof error === 'object' ? error : {}) as {
    status?: unknown;
    code?: unknown;
  };
  const status = typeof failure.status === 'number' ? failure.status : null;
  if (status === null) return 'host.unavailable';
  if (status === 401) return 'no_account';
  if (status === 429 || status >= 500) return 'host.unavailable';
  const code = failure.code;
  if (typeof code === 'string' && Object.hasOwn(PULSE_ERROR_CODES, code)) {
    return PULSE_ERROR_CODES[code];
  }
  return Object.hasOwn(PULSE_HTTP_STATUS_CODES, status)
    ? PULSE_HTTP_STATUS_CODES[status]
    : 'host.unavailable';
}

/** `error` as a HostServiceFailure for Pulse. */
export function toHostServiceFailure(error: unknown): HostServiceFailure {
  if (error instanceof HostServiceFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new HostServiceFailure(pulseCodeOf(error), message || 'Request failed');
}

/** A clock call that succeeded at Send, for the host to show ("Clocked out at 17:02"). */
export interface ClockSendOutcome extends PulseClockSend {
  type: Extract<PulseUploadTypeId, 'clock.wrapup' | 'clock.plan'>;
  draftId: string;
  draftKey: string;
}

export interface GrantOptions {
  /** The calls (tests pass stand-ins). */
  uploads?: Pick<typeof pulseUploadApi, 'begin' | 'token' | 'cancel'>;
  clock?: Pick<typeof clockApi, 'stopWithVideo' | 'startWithPlan'>;
  /** PulseKit's version, contract and platform, for the server's support fields. */
  clientInfo?: () =>
    | { appVersion?: string; contractVersion?: string; platform?: 'ios' | 'android' }
    | null
    | undefined;
  /** Told when a clock call at Send succeeded. */
  onClockSend?: (outcome: ClockSendOutcome) => void;
  /** Default CONFIRM_SEND_TIMEOUT_MS. */
  confirmTimeoutMs?: number;
  now?: () => number;
}

/** Run `call`, turning any failure into the HostServiceFailure Pulse reads. */
async function asPulse<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toHostServiceFailure(error);
  }
}

/** `promise`, or a `host.unavailable` failure once `ms` have passed. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HostServiceFailure('host.unavailable', `${what} timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Huddle's HostServices for Pulse (`client.setHostServices(createGrants())`). */
export function createGrants(options: GrantOptions = {}): HostServices {
  const uploads = options.uploads ?? pulseUploadApi;
  const clock = options.clock ?? clockApi;
  const now = options.now ?? Date.now;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? CONFIRM_SEND_TIMEOUT_MS;

  async function getUploadTarget(r: UploadTargetRequest): Promise<UploadTarget> {
    const place = placeData(r.context);
    if (!place) {
      throw new HostServiceFailure('destination.gone', 'The video has no TimeHuddle place');
    }
    const client = options.clientInfo?.() ?? null;
    const grant = await asPulse(() =>
      uploads.begin({
        clientKey: r.clientKey,
        draftKey: r.draftKey,
        type: place.type,
        target: place.target,
        name: r.name || null,
        sentAt: r.sentAt,
        durationMs: r.durationMs,
        bytes: r.bytes,
        ...(r.renewArtifact ? { renewArtifact: true } : {}),
        ...(client ? { client } : {}),
      }),
    );
    return {
      uploadId: grant.uploadId,
      endpoint: grant.endpoint.replace(/\/+$/, ''),
      artifactId: grant.artifactId,
      token: grant.token,
      expiresAt: grant.expiresAt,
      clientKey: grant.clientKey,
      state: grant.state,
    };
  }

  async function refreshUploadToken(r: TokenRequest) {
    const { token, expiresAt } = await asPulse(() => uploads.token(r.uploadId, r.clientKey));
    return { token, expiresAt };
  }

  async function releaseUploadTarget(r: ReleaseRequest): Promise<void> {
    await asPulse(() =>
      uploads.cancel({ uploadId: r.uploadId, clientKey: r.clientKey, reason: r.reason }),
    );
  }

  /** The clock call a Send of `r` runs, by its upload type. */
  function clockCall(r: ConfirmSendRequest): {
    type: ClockSendOutcome['type'];
    run: () => Promise<PulseClockSend>;
  } {
    const place = placeData(r.context);
    const type = r.uploadType?.id;
    if (!place || place.type !== type) {
      throw new HostServiceFailure('upload.refused', `No clock action for ${String(type)}`);
    }
    const common = { at: r.sentAt, draftKey: r.draftKey, bytes: r.bytes };
    if (type === 'clock.wrapup' && place.target.kind === 'clock' && place.clock) {
      const { teamId, postDate } = place.clock;
      const clockEventId = place.target.id;
      return {
        type,
        run: () => clock.stopWithVideo({ ...common, teamId, clockEventId, postDate }),
      };
    }
    if (type === 'clock.plan' && place.target.kind === 'clock-plan') {
      const { teamId, postDate } = place.target;
      return { type, run: () => clock.startWithPlan({ ...common, teamId, postDate }) };
    }
    throw new HostServiceFailure('upload.refused', `No clock action for ${type}`);
  }

  async function confirmSend(r: ConfirmSendRequest) {
    const call = clockCall(r);
    const result = await asPulse(() => within(call.run(), confirmTimeoutMs, 'The clock call'));
    try {
      options.onClockSend?.({
        ...result,
        type: call.type,
        draftId: r.draftId,
        draftKey: r.draftKey,
      });
    } catch (error) {
      // The clock action is done; what the page makes of it can't undo the Send.
      console.error('[pulse-embed] onClockSend failed:', error);
    }
    return { confirmedAt: now() };
  }

  return { getUploadTarget, refreshUploadToken, releaseUploadTarget, confirmSend };
}
