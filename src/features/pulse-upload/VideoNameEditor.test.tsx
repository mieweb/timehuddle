import { ToastProvider } from '@mieweb/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
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

const inToasts = (node: React.ReactNode) => render(<ToastProvider>{node}</ToastProvider>);

describe('VideoNameEditor', () => {
  afterEach(() => {
    cleanup();
    rename.mockClear();
  });

  it('opens on the name, saves on Enter and says what the server kept', async () => {
    const onEditingChange = vi.fn();
    const onRenamed = vi.fn();
    inToasts(
      <VideoNameEditor
        video={VIDEO}
        name="Standup"
        editing
        onEditingChange={onEditingChange}
        onRenamed={onRenamed}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Video name' }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Standup');
    fireEvent.change(field, { target: { value: 'Morning standup' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    expect(rename).toHaveBeenCalledWith(VIDEO, 'Morning standup');
    expect(onRenamed).toHaveBeenCalledWith('Morning standup');
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it('leaves the name on Escape, and keeps that key from the page around it', () => {
    const onEditingChange = vi.fn();
    const outer = vi.fn();
    inToasts(
      <div onKeyDown={outer}>
        <VideoNameEditor video={VIDEO} name="Standup" editing onEditingChange={onEditingChange} />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Video name' }), { key: 'Escape' });
    expect(onEditingChange).toHaveBeenCalledWith(false);
    expect(outer).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('turns the ⋯ menu into the name field on Rename, and back on ✕', () => {
    inToasts(<VideoActions video={VIDEO} name="Standup" label="Standup" renamable />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Standup' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Video name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'More for Standup' })).toBeTruthy();
  });
});
