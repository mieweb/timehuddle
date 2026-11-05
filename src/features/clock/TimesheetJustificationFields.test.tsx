import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { uploadVideoTo } from '../pulse-upload/videoFile';

import { TimesheetJustificationFields } from './TimesheetJustificationFields';

vi.mock('../pulse-upload/videoFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pulse-upload/videoFile')>()),
  uploadVideoTo: vi.fn(async () => '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59'),
}));

// jsdom has no matchMedia, which @mieweb/ui asks about reduced motion.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Nor CSS.escape, which @mieweb/ui's Textarea uses.
globalThis.CSS ??= { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') } as typeof CSS;

// Nor ResizeObserver, which the Textarea's Kerebron surface measures its toolbar with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe('TimesheetJustificationFields', () => {
  it("uploads a walkthrough file as the request's own, not into the library", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <TimesheetJustificationFields
        value={{ description: '', videoUrl: null }}
        onChange={onChange}
        videoRequired
        approverCount={1}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'walkthrough.mov', { type: 'video/quicktime' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(uploadVideoTo).toHaveBeenCalledWith({ kind: 'walkthrough' }, file, expect.any(Function));
    expect(onChange).toHaveBeenCalledWith({
      description: '',
      videoUrl: '/pulsevault/artifacts/0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59',
    });
  });
});
