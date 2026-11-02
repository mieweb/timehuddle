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
import type { ChatComposerError } from '@mieweb/ui';
import { ApiError } from '@lib/api';
import { isVideoFile } from '../pulse-upload/videoFile';

/**
 * A post whose body exceeded the API's 1 MB limit. The backend answers this
 * with `error: 'payload-too-large'`; matching the code rather than the 413
 * status keeps it apart from an oversize *file*, which is also a 413 but whose
 * own message already names the file and the limit.
 */
const PAYLOAD_TOO_LARGE_CODE = 'payload-too-large';

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

/** Why the composer refused a file, in words the writer can act on. */
const REFUSALS = {
  heic: (name: string) =>
    `${name} is a HEIC photo, which most browsers can't show. Save it as JPEG, or pick it from your photo library, which converts it.`,
  type: (name: string) =>
    `${name} can't be attached. Photos, videos, PDFs, and Word, Excel or text files can.`,
  videoSize: (name: string, limit: string) =>
    `${name} is over ${limit}. Post a longer video with Pulse, which takes up to 500 MB.`,
  size: (name: string, limit: string) => `${name} is over ${limit}.`,
  limit: (max: number) => `A post takes up to ${max} files.`,
} as const;

const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/**
 * The composer's refusal (`onComposerError`) as the writer should read it:
 * which file, why, and what to do instead. `limit` is the size cap as said
 * ("100 MB"), `maxFiles` the attachment cap. Null for a reason this doesn't
 * word (a failed send has its own message).
 */
export function composerRefusalMessage(
  context: ChatComposerError | undefined,
  { limit, maxFiles }: { limit: string; maxFiles: number },
): string | null {
  const file = context?.file;
  switch (context?.reason) {
    case 'file-type':
      return file ? (isHeic(file) ? REFUSALS.heic(file.name) : REFUSALS.type(file.name)) : null;
    case 'file-size':
      if (!file) return null;
      return isVideoFile(file)
        ? REFUSALS.videoSize(file.name, limit)
        : REFUSALS.size(file.name, limit);
    case 'attachment-limit':
      return REFUSALS.limit(maxFiles);
    default:
      return null;
  }
}
