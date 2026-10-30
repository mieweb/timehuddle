import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoActions } from './VideoMenu';
import { VideoNameEditor } from './VideoNameEditor';

const rename = vi.fn((_video: string, name: string) => Promise.resolve(name.trim() || null));
vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
  videoApi: { rename: (video: string, name: string) => rename(video, name) },
}));

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

describe('VideoNameEditor', () => {
  afterEach(() => {
    cleanup();
    rename.mockClear();
  });

  it('saves on Enter, in place, and says what the server kept', async () => {
    const onDone = vi.fn();
    render(<VideoNameEditor video={VIDEO} name="Standup" onDone={onDone} />);
    const field = screen.getByRole('textbox', { name: 'Video name' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Morning standup' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });
    expect(rename).toHaveBeenCalledWith(VIDEO, 'Morning standup');
    expect(onDone).toHaveBeenCalledWith('Morning standup');
  });

  it('leaves the name on Escape, and keeps that key from the page around it', () => {
    const onDone = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <VideoNameEditor video={VIDEO} name="Standup" onDone={onDone} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Video name' }), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledWith();
    expect(outer).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('turns the ⋯ menu into the editor on Rename, and back when done', () => {
    render(<VideoActions video={VIDEO} name="Standup" label="Standup" renamable />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Standup' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'More for Standup' })).toBeTruthy();
  });
});
