import { describe, expect, it } from 'vitest';

import { isVideoFile, MAX_VIDEO_BYTES, uploadErrorMessage, videoFileProblem } from './videoFile';

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
