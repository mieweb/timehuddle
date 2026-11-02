import { describe, expect, it, vi } from 'vitest';

vi.mock('@lib/api', () => ({ ApiError: class extends Error {}, videoApi: {} }));

import { composerRefusalMessage } from './composerErrors';

const caps = { limit: '25 MB', maxFiles: 10 };
const file = (name: string, type: string) => new File(['x'], name, { type });

describe('composerRefusalMessage', () => {
  it('says what to do with a HEIC photo', () => {
    expect(
      composerRefusalMessage({ reason: 'file-type', file: file('IMG_1.HEIC', 'image/heic') }, caps),
    ).toMatch(/IMG_1\.HEIC is a HEIC photo.*JPEG/);
  });

  it('names a file it can’t take, and what it can', () => {
    expect(
      composerRefusalMessage(
        { reason: 'file-type', file: file('app.exe', 'application/x-msdownload') },
        caps,
      ),
    ).toBe("app.exe can't be attached. Photos, videos, PDFs, and Word, Excel or text files can.");
  });

  it('points a long video to Pulse, and says the cap for anything else', () => {
    expect(
      composerRefusalMessage(
        { reason: 'file-size', file: file('demo.mov', 'video/quicktime') },
        caps,
      ),
    ).toBe('demo.mov is over 25 MB. Post a longer video with Pulse, which takes up to 500 MB.');
    expect(
      composerRefusalMessage(
        { reason: 'file-size', file: file('scan.pdf', 'application/pdf') },
        caps,
      ),
    ).toBe('scan.pdf is over 25 MB.');
  });

  it('says the attachment cap, and leaves a failed send to its own message', () => {
    expect(composerRefusalMessage({ reason: 'attachment-limit' }, caps)).toBe(
      'A post takes up to 10 files.',
    );
    expect(composerRefusalMessage({ reason: 'send-failed' }, caps)).toBeNull();
  });
});
