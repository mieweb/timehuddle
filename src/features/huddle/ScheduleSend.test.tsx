import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HuddlePost } from '@lib/api';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SCHEDULE_TEXT } from './postSchedule';
import { ScheduledPostsButton, ScheduleSendButton } from './ScheduleSend';

beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
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
});

afterEach(cleanup);

const IN_TWO_HOURS = new Date(Date.now() + 2 * 60 * 60 * 1000);

function scheduledPost(overrides: Partial<HuddlePost> = {}): HuddlePost {
  const createdAt = new Date().toISOString();
  return {
    id: 'p1',
    teamId: 't1',
    userId: 'me',
    userName: 'Me',
    userInitials: 'ME',
    content: { text: 'Standup notes for tomorrow', mentions: [] },
    attachments: [],
    likes: [],
    commentCount: 0,
    createdAt,
    updatedAt: createdAt,
    deliverAt: IN_TWO_HOURS.toISOString(),
    deliveryMode: 'silent',
    ...overrides,
  };
}

describe('ScheduleSendButton', () => {
  it('sets a schedule from a quick pick and the chosen mode', async () => {
    const onChange = vi.fn();
    render(<ScheduleSendButton schedule={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.scheduleAria }));
    fireEvent.click(await screen.findByRole('button', { name: SCHEDULE_TEXT.presetTomorrow }));
    fireEvent.click(screen.getByLabelText(SCHEDULE_TEXT.modeHidden));
    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.confirm }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [{ deliverAt, deliveryMode }] = onChange.mock.calls[0];
    expect(deliveryMode).toBe('hidden');
    expect(deliverAt.getHours()).toBe(9);
    expect(deliverAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('shows the scheduled time and can clear it', async () => {
    const onChange = vi.fn();
    render(
      <ScheduleSendButton
        schedule={{ deliverAt: IN_TWO_HOURS, deliveryMode: 'silent' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Scheduled for/ }));
    fireEvent.click(await screen.findByRole('button', { name: SCHEDULE_TEXT.clear }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('ScheduledPostsButton', () => {
  const handlers = () => ({
    onSendNow: vi.fn(async () => {}),
    onReschedule: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
  });

  it('renders nothing with no scheduled posts', () => {
    const { container } = render(<ScheduledPostsButton posts={[]} {...handlers()} />);
    expect(container.childElementCount).toBe(0);
  });

  it('lists waiting posts and sends one now', async () => {
    const h = handlers();
    const post = scheduledPost();
    render(<ScheduledPostsButton posts={[post]} {...h} />);

    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.pendingAria(1) }));
    expect(await screen.findByText('Standup notes for tomorrow')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.sendNow }));
    await waitFor(() => expect(h.onSendNow).toHaveBeenCalledWith(post));
  });

  it('asks before deleting', async () => {
    const h = handlers();
    render(<ScheduledPostsButton posts={[scheduledPost()]} {...h} />);

    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.pendingAria(1) }));
    fireEvent.click(await screen.findByRole('button', { name: SCHEDULE_TEXT.delete }));
    expect(h.onDelete).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole('button', { name: SCHEDULE_TEXT.delete });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(h.onDelete).toHaveBeenCalledTimes(1));
  });
});
