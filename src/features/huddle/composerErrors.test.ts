import { describe, expect, it, vi } from 'vitest';

vi.mock('@lib/api', () => ({ ApiError: class extends Error {}, videoApi: {} }));

import { ApiError } from '@lib/api';
import { composerErrorMessage, composerRefusalMessage } from './composerErrors';

const caps = {
  limitOf: (f: File) => (f.type.startsWith('video/') ? '500 MB' : '100 MB'),
  maxFiles: 10,
};
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

  it("says each file's own size cap", () => {
    expect(
      composerRefusalMessage(
        { reason: 'file-size', file: file('demo.mov', 'video/quicktime') },
        caps,
      ),
    ).toBe('demo.mov is over 500 MB.');
    expect(
      composerRefusalMessage(
        { reason: 'file-size', file: file('scan.pdf', 'application/pdf') },
        caps,
      ),
    ).toBe('scan.pdf is over 100 MB.');
  });

  it('says the attachment cap, and leaves a failed send to its own message', () => {
    expect(composerRefusalMessage({ reason: 'attachment-limit' }, caps)).toBe(
      'A post takes up to 10 files.',
    );
    expect(composerRefusalMessage({ reason: 'send-failed' }, caps)).toBeNull();
  });
});

describe('composerErrorMessage', () => {
  it('explains a workday that closed while the post was written, and that the draft is kept (#866)', () => {
    const err = Object.assign(new ApiError('closed', 409), { code: 'conversation-closed' });
    expect(composerErrorMessage(err, 'Failed')).toMatch(
      /closed when the next huddle started.*draft is still here/,
    );
  });
});
