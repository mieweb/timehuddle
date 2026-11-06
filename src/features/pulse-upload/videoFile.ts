/**
 * A video file from this device, sent the way the Pulse app sends one: over
 * tus (resumable) to a reserved PulseVault upload. The server checks it by its
 * content and conforms it to the Pulse format (faststart H.264/AAC MP4) before
 * anything is delivered. One it can't convert (PulseVault's `skipped`) is
 * delivered as uploaded, and plays wherever its own format does.
 */
import * as tus from 'tus-js-client';

import { mediaApi, videoApi, type PulseDestination } from '../../lib/api';

/** Containers the server accepts; mirrors VIDEO_CONTENT_TYPES in meteor-backend/server/pulsevault.js. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp', '.avi'];

/** `video/*` too, so phone pickers open the camera roll; the server refuses anything else by content. */
export const VIDEO_FILE_ACCEPT = [...VIDEO_EXTENSIONS, 'video/*'].join(',');

/** PulseVault's `maxUploadSize`. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

/** A file's name without its extension: "Screen Recording.mov" → "Screen Recording". */
export function fileBaseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

/** Some browsers leave `type` empty for `.mkv`/`.3gp`, so the extension counts too. */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(extensionOf(file.name));
}

/** Why this file can't be sent, said before any bytes go out; null when it can. */
export function videoFileProblem(file: File): string | null {
  if (!isVideoFile(file)) return "That file isn't a video.";
  if (file.size > MAX_VIDEO_BYTES) return 'That file is larger than 500 MB.';
  return null;
}

/** The server's own words for a refusal (`videoApi.uploadRefusalStatuses`), or a plain retry hint. */
export function uploadErrorMessage(err: unknown): string {
  const response = (err as tus.DetailedError | undefined)?.originalResponse;
  const status = response?.getStatus() ?? 0;
  const body = response?.getBody()?.trim();
  if (body && videoApi.uploadRefusalStatuses.includes(status)) return body;
  return "The upload didn't finish. Check your connection and try again.";
}

/** What a cancelled upload rejects with, so callers can tell it from a failure. */
export const uploadCancelled = () => new DOMException('Upload cancelled', 'AbortError');

/** Whether `err` is a cancelled upload (uploadCancelled) rather than a failure. */
export const isUploadCancelled = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';

/**
 * Send `file` to a reserved upload; resolves once every byte is in. Rejects
 * with a message to show, or with uploadCancelled once `signal` aborts: the
 * upload stops and tus deletes what arrived (a finished one is locked, so
 * callers discard it with `mediaApi.discardUpload`).
 */
export function uploadVideoFile(
  file: File,
  { videoid, uploadToken }: { videoid: string; uploadToken: string },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(uploadCancelled());
      return;
    }
    // A cancel deletes the upload (tus terminate). Not retried: a 403 (finished,
    // so locked) or 404 (gone) is the answer.
    const terminate = () => void upload.abort(true).catch(() => {});
    const onAbort = () => {
      terminate();
      reject(uploadCancelled());
    };
    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: (err) => !signal?.aborted && videoApi.shouldRetryUpload(err),
      // Created after a cancel (the POST was already on its way): delete it too.
      onUploadUrlAvailable: () => {
        if (signal?.aborted) terminate();
      },
      // Every upload has its own reservation and token, so an earlier upload
      // of the same file can never be resumed: don't remember it (tus would
      // probe the old URL first, and its localStorage entries pile up).
      storeFingerprintForResuming: false,
      // `name` as a Pulse draft sends its own: the video starts out called by
      // its file's name, until someone renames it.
      metadata: {
        filename: file.name,
        filetype: file.type,
        videoid,
        name: fileBaseName(file.name),
      },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress: (sent, total) => {
        if (total > 0) onProgress?.(sent / total);
      },
      onSuccess: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      onError: (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(uploadErrorMessage(err)));
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    upload.start();
  });
}

type FilingResult = Awaited<ReturnType<typeof videoApi.waitUntilFiled>>;

/**
 * How long uploadVideoTo waits for a video to be converted and filed: as long
 * as its upload token lives (30 minutes) less the time to send it, since a
 * 4K HDR clip can take minutes to convert and a conversion can queue behind
 * others. A cancel (its signal) stops the wait at any time.
 */
const FILING_WAIT_MS = 25 * 60_000;

/**
 * Why a finished upload can't be attached; null once it's filed. Only `done`
 * means the video is ready: after a timeout it may still be converting, and
 * an expired token means we can no longer tell.
 */
export function filingProblem(filed: FilingResult): string | null {
  switch (filed.state) {
    case 'done':
      return null;
    case 'kept':
      return filed.reason ?? "That video couldn't be added.";
    case 'forbidden':
      return 'This upload expired before the video was ready. Try again.';
    case 'timeout':
      return "The video is taking longer than usual to get ready, so it wasn't added. Try again in a few minutes.";
  }
}

/** Take back an upload that won't be used (the sweep deletes it unless something links it). */
function discard(videoid: string): void {
  void mediaApi.discardUpload({ videoid }).catch(() => {});
}

/**
 * Send `file` to `destination` and wait until it has been conformed and
 * filed: `post` for one added to a Huddle post and `walkthrough` for a
 * timesheet change's (both kept out of the library, attached by the caller),
 * `library` for one that belongs there, a `ticket` or `clock` session the
 * server attaches it to itself. Returns the video id; rejects with a message
 * to show unless the video is ready.
 */
export async function uploadVideoTo(
  destination: PulseDestination,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const problem = videoFileProblem(file);
  if (problem) throw new Error(problem);
  const reservation = await videoApi.reserve(destination);
  try {
    if (signal?.aborted) throw uploadCancelled();
    await uploadVideoFile(file, reservation, onProgress, signal);
    const filed = await videoApi.waitUntilFiled(
      reservation.videoid,
      reservation.uploadToken,
      FILING_WAIT_MS,
      signal,
    );
    // A cancel during the last status check: still taken back (below).
    if (signal?.aborted) throw uploadCancelled();
    const notFiled = filingProblem(filed);
    if (notFiled) {
      // Not ready in time: a video only its caller attaches (a post's, a
      // walkthrough's) would be left unused, so it's taken back now — Retry
      // sends it again. Kept by the server, or headed for a ticket, a session
      // or the library (which file it themselves once ready), it stays.
      const callerAttaches = destination.kind === 'post' || destination.kind === 'walkthrough';
      if (callerAttaches && filed.state !== 'kept') discard(reservation.videoid);
      throw new Error(notFiled);
    }
    return reservation.videoid;
  } catch (err) {
    // Cancelled at any stage: take back whatever arrived (converting, or
    // already filed). Idempotent, so a terminated upload costs a no-op.
    if (isUploadCancelled(err)) discard(reservation.videoid);
    throw err;
  }
}
