import { describe, expect, it } from 'vitest';

import { VIDEO_VIA_PULSE_MESSAGE, composerRejectionMessage } from './composerErrors';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('composerRejectionMessage', () => {
  it('points a rejected video at Pulse', () => {
    expect(
      composerRejectionMessage('File type not allowed', {
        reason: 'file-type',
        file: file('clip.mp4', 'video/mp4'),
      }),
    ).toBe(`clip.mp4 — ${VIDEO_VIA_PULSE_MESSAGE}`);
  });

  it("passes other rejections through in the composer's words", () => {
    expect(
      composerRejectionMessage('notes.zip is not allowed', {
        reason: 'file-type',
        file: file('notes.zip', 'application/zip'),
      }),
    ).toBe('notes.zip is not allowed');
    expect(composerRejectionMessage('Too big', { reason: 'file-size' })).toBe('Too big');
    expect(composerRejectionMessage('Something went wrong')).toBe('Something went wrong');
  });

  it("leaves a failed send to the host's own handler", () => {
    expect(composerRejectionMessage('Failed to send', { reason: 'send-failed' })).toBeNull();
  });
});
