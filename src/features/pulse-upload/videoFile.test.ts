import type * as tus from 'tus-js-client';
import { describe, expect, it } from 'vitest';

import { videoApi } from '../../lib/api';

import {
  filingProblem,
  isVideoFile,
  MAX_VIDEO_BYTES,
  uploadErrorMessage,
  videoFileProblem,
} from './videoFile';

const file = (name: string, type: string, size = 1024) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const tusError = (status: number, body: string) => ({
  originalResponse: { getStatus: () => status, getBody: () => body },
});

describe('isVideoFile', () => {
  it('takes a video by its type, or by its extension when the browser leaves the type empty', () => {
    expect(isVideoFile(file('clip.mov', 'video/quicktime'))).toBe(true);
    expect(isVideoFile(file('screen.mkv', ''))).toBe(true);
    expect(isVideoFile(file('call.3GP', ''))).toBe(true);
    expect(isVideoFile(file('notes.pdf', 'application/pdf'))).toBe(false);
  });
});

describe('videoFileProblem', () => {
  it('refuses a non-video or an oversized file before any bytes go out', () => {
    expect(videoFileProblem(file('photo.jpg', 'image/jpeg'))).toBe("That file isn't a video.");
    expect(videoFileProblem(file('long.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toBe(
      'That file is larger than 500 MB.',
    );
    expect(videoFileProblem(file('recording.webm', 'video/webm'))).toBeNull();
  });
});

describe('uploadErrorMessage', () => {
  it("shows the server's own words for a refusal", () => {
    expect(uploadErrorMessage(tusError(422, "That file isn't a video.\n"))).toBe(
      "That file isn't a video.",
    );
    expect(uploadErrorMessage(tusError(413, 'That file is larger than 500 MB.'))).toBe(
      'That file is larger than 500 MB.',
    );
  });

  it('falls back to a retry hint for anything else', () => {
    const hint = "The upload didn't finish. Check your connection and try again.";
    expect(uploadErrorMessage(tusError(500, 'Internal error'))).toBe(hint);
    expect(uploadErrorMessage(new Error('network'))).toBe(hint);
  });
});

describe('filingProblem', () => {
  it('lets a video through only once it is filed', () => {
    expect(filingProblem({ state: 'done' })).toBeNull();
    expect(filingProblem({ state: 'done', note: 'Added to this ticket' })).toBeNull();
  });

  it("refuses one that may still be converting, or whose status can't be read", () => {
    expect(filingProblem({ state: 'timeout' })).toBe(
      "The video is taking longer than usual to get ready, so it wasn't added. Try again in a few minutes.",
    );
    expect(filingProblem({ state: 'forbidden' })).toBe(
      'This upload expired before the video was ready. Try again.',
    );
  });

  it("gives the server's reason when it kept the video back", () => {
    expect(filingProblem({ state: 'kept', reason: 'That ticket was deleted.' })).toBe(
      'That ticket was deleted.',
    );
    expect(filingProblem({ state: 'kept' })).toBe("That video couldn't be added.");
  });
});

describe('videoApi.shouldRetryUpload', () => {
  const retries = (err: object) => videoApi.shouldRetryUpload(err as tus.DetailedError);

  it('gives up on a refusal, which the same bytes would get again', () => {
    expect(retries(tusError(422, "That file isn't a video."))).toBe(false);
    expect(retries(tusError(413, 'That file is larger than 500 MB.'))).toBe(false);
    expect(retries(tusError(409, 'Upload-Offset conflict'))).toBe(false);
  });

  it('retries a server error or a dropped connection', () => {
    expect(retries(tusError(500, 'Internal error'))).toBe(true);
    expect(retries(new Error('network'))).toBe(true);
  });
});
