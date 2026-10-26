import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HuddlePost } from '@lib/api';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SCHEDULE_TEXT } from './postSchedule';
import { ScheduleDialog, ScheduledPostsButton } from './ScheduleSend';

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
    ...overrides,
  };
}

describe('ScheduleDialog', () => {
  const renderDialog = (props: { onConfirm?: () => void; onClose?: () => void } = {}) => {
    const onConfirm = vi.fn(props.onConfirm);
    const onClose = vi.fn(props.onClose);
    render(
      <ScheduleDialog
        title={SCHEDULE_TEXT.dialogTitle}
        confirmLabel={SCHEDULE_TEXT.confirm}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    return { onConfirm, onClose };
  };

  it('confirms a quick pick', async () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^Tomorrow / }));
    fireEvent.click(screen.getByRole('button', { name: SCHEDULE_TEXT.confirm }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [{ deliverAt }] = onConfirm.mock.calls[0] as unknown as [{ deliverAt: Date }];
    expect(deliverAt.getHours()).toBe(9);
    expect(deliverAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('opens on a valid time and says when it will send', async () => {
    renderDialog();
    expect(await screen.findByText(/^Sends /)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: SCHEDULE_TEXT.confirm }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('closes without confirming on Cancel', async () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: SCHEDULE_TEXT.cancel }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
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
