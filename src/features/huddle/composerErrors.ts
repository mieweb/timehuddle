/**
 * Turning a thrown failure into something the writer can act on.
 *
 * The composer's failure paths surface whatever `Error.message` they caught,
 * which for the two most common failures is not a sentence anyone can use: a
 * dropped connection arrives as `TypeError: Failed to fetch`, and an over-limit
 * post as the API's own byte arithmetic. Both are mapped here so every composer
 * says the same actionable thing, and anything genuinely specific (an
 * unsupported file type, a rejected ticket) still passes through untouched.
 */
import { ApiError } from '@lib/api';
import type { ChatComposerError } from '@mieweb/ui';

/**
 * A post whose body exceeded the API's 1 MB limit. The backend answers this
 * with `error: 'payload-too-large'`; matching the code rather than the 413
 * status keeps it apart from an oversize *file*, which is also a 413 but whose
 * own message already names the file and the limit.
 */
const PAYLOAD_TOO_LARGE_CODE = 'payload-too-large';

/** Shown when a video is picked, dropped or pasted: videos come from Pulse. */
export const VIDEO_VIA_PULSE_MESSAGE =
  'videos can only be added with Pulse. Use the Pulse button to record or send one.';

const MESSAGES = {
  tooLarge: 'This post is too large to send. Shorten it, or remove an image and attach it instead.',
  offline: 'Could not reach the server. Check your connection and try again.',
} as const;

export function composerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === PAYLOAD_TOO_LARGE_CODE) return MESSAGES.tooLarge;
    // status 0 is the native HTTP bridge's "never got a response".
    if (error.status === 0) return MESSAGES.offline;
    return error.message || fallback;
  }
  // `fetch` rejects with a TypeError for every transport-level failure — DNS,
  // refused connection, and a CORS rejection alike.
  if (error instanceof TypeError) return MESSAGES.offline;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/**
 * What a SuperChat composer's `onError` should show, or null to show nothing.
 * A video turned away as the wrong file type gets the way to post one (Pulse).
 * `send-failed` is skipped: the host's own send handler has already said why.
 */
export function composerRejectionMessage(
  message: string,
  context?: ChatComposerError,
): string | null {
  if (context?.reason === 'send-failed') return null;
  if (context?.reason === 'file-type' && context.file?.type.startsWith('video/')) {
    return `${context.file.name} — ${VIDEO_VIA_PULSE_MESSAGE}`;
  }
  return message;
}
