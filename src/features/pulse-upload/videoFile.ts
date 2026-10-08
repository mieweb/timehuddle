/**
 * A video file from this device, sent the way the Pulse app sends one: over
 * tus (resumable) to a reserved PulseVault upload. The server checks it by its
 * content and conforms it to the Pulse format (faststart H.264/AAC MP4) before
 * anything is delivered, so every caller gets the same playable result.
 */
import * as tus from 'tus-js-client';

import { videoApi } from '../../lib/api';

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

/** The server's own words for a refusal (413/422/400 are written to be shown), or a plain retry hint. */
export function uploadErrorMessage(err: unknown): string {
  const response = (err as tus.DetailedError | undefined)?.originalResponse;
  const status = response?.getStatus();
  const body = response?.getBody()?.trim();
  if (body && (status === 400 || status === 413 || status === 422)) return body;
  return "The upload didn't finish. Check your connection and try again.";
}

/** Send `file` to a reserved upload; resolves once every byte is in. Rejects with a message to show. */
export function uploadVideoFile(
  file: File,
  { videoid, uploadToken }: { videoid: string; uploadToken: string },
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: { filename: file.name, filetype: file.type, videoid },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress: (sent, total) => {
        if (total > 0) onProgress?.(sent / total);
      },
      onSuccess: () => resolve(),
      onError: (err) => reject(new Error(uploadErrorMessage(err))),
    }).start();
  });
}

/**
 * Send `file` into the uploader's media library and wait until it has been
 * conformed and filed, for callers that attach the video themselves (a post,
 * a timesheet change). Returns the video id.
 */
export async function uploadVideoToLibrary(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const problem = videoFileProblem(file);
  if (problem) throw new Error(problem);
  const reservation = await videoApi.reserve({ kind: 'library' });
  await uploadVideoFile(file, reservation, onProgress);
  const filed = await videoApi.waitUntilFiled(reservation.videoid, reservation.uploadToken);
  // A timeout still leaves a video that serves; only a refusal is a failure.
  if (filed.state === 'kept') throw new Error(filed.reason ?? "That video couldn't be added.");
  return reservation.videoid;
}
