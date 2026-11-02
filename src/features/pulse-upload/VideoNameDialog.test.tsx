import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VideoMenu } from './VideoMenu';
import { VIDEO_NAME_MAX, VideoNameDialog } from './VideoNameDialog';

const rename = vi.fn((_video: string, name: string) => Promise.resolve(name.trim() || null));
vi.mock('@lib/api', () => ({
  resolveMediaUrl: (path: string) => path,
  METEOR_BASE_URL: 'http://localhost:3100',
  videoApi: { rename: (video: string, name: string) => rename(video, name) },
}));

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

const field = () => screen.getByRole('textbox', { name: 'Video name' }) as HTMLTextAreaElement;

describe('VideoNameDialog', () => {
  afterEach(() => {
    cleanup();
    rename.mockReset();
    rename.mockImplementation((_video: string, name: string) =>
      Promise.resolve(name.trim() || null),
    );
  });

  it('opens from the ⋯ menu, saves on Enter and says what the server kept', async () => {
    const onRenamed = vi.fn();
    render(
      <VideoMenu video={VIDEO} name="Standup" label="Standup" renamable onRenamed={onRenamed} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More for Standup' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByRole('dialog').textContent).toContain('Rename video');
    expect(field().value).toBe('Standup');
    fireEvent.change(field(), { target: { value: 'Morning standup' } });
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' });
    });
    expect(rename).toHaveBeenCalledWith(VIDEO, 'Morning standup');
    expect(onRenamed).toHaveBeenCalledWith('Morning standup');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(field(), { key: 'Escape' })],
    ['Save', () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))],
  ])('returns focus to the ⋯ that opened it, on %s', async (_, close) => {
    render(<VideoMenu video={VIDEO} name="Standup" label="Standup" renamable />);
    const more = screen.getByRole('button', { name: 'More for Standup' });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    field().focus();
    fireEvent.change(field(), { target: { value: 'Morning standup' } });
    await act(async () => close());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('adds a name to a video without one', () => {
    render(<VideoNameDialog video={VIDEO} name={null} open onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog').textContent).toContain('Add a name');
    expect(field().value).toBe('');
  });

  it('takes a long name on several lines, up to the limit, and a pasted line break as a space', () => {
    render(<VideoNameDialog video={VIDEO} name="Standup" open onOpenChange={() => {}} />);
    expect(field().tagName).toBe('TEXTAREA');
    expect(field().maxLength).toBe(VIDEO_NAME_MAX);
    fireEvent.change(field(), { target: { value: 'Sprint demo\nthe onboarding checklist' } });
    expect(field().value).toBe('Sprint demo the onboarding checklist');
  });

  it('leaves the name on Cancel', () => {
    const onOpenChange = vi.fn();
    render(<VideoNameDialog video={VIDEO} name="Standup" open onOpenChange={onOpenChange} />);
    fireEvent.change(field(), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(rename).not.toHaveBeenCalled();
  });

  it('stays open and says so when the save fails', async () => {
    rename.mockRejectedValueOnce(new Error('offline'));
    const onOpenChange = vi.fn();
    render(<VideoNameDialog video={VIDEO} name="Standup" open onOpenChange={onOpenChange} />);
    fireEvent.change(field(), { target: { value: 'Morning standup' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(screen.getByText("The name wasn't saved. Try again.")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
