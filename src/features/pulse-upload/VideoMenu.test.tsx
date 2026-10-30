import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoMenu } from './VideoMenu';

vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
}));

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

describe('VideoMenu', () => {
  const writeText = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    writeText.mockClear();
  });

  const open = () => fireEvent.click(screen.getByRole('button', { name: 'More for Standup' }));

  it("copies a link to the video's own page, for anyone who can see it", async () => {
    render(<VideoMenu video={VIDEO} name="Standup" label="Standup" />);
    open();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/watch/${VIDEO}`);
  });

  it('offers Rename to its owner and Remove where the host allows it', () => {
    render(
      <VideoMenu video={VIDEO} name="Standup" label="Standup" renamable onRemove={() => {}} />,
    );
    open();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open video page',
      'Copy link',
      'Rename',
      'Remove',
    ]);
  });

  it("doesn't offer the video's page on that page", () => {
    render(<VideoMenu video={VIDEO} name="Standup" label="Standup" openable={false} />);
    open();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Copy link']);
  });
});
