import type { DraftSummary } from '@mieweb/pulse-embed';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mergeRows } from '../pulse-embed/mergeRows';
import { MEDIA_TEXT } from './mediaStrings';
import { PLACES, draftAt } from './testRows';
import { UnsentVideosSection, type UnsentVideosSectionProps } from './UnsentVideosSection';

// jsdom has no matchMedia, which the filters' SegmentedSwitcher reads.
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

function renderSection(drafts: DraftSummary[], over: Partial<UnsentVideosSectionProps> = {}) {
  const props: UnsentVideosSectionProps = {
    items: mergeRows(drafts, []),
    filter: 'all',
    onFilterChange: vi.fn(),
    now: 1_000 + 5 * 60_000,
    onOpen: vi.fn(),
    onMenu: vi.fn(),
    ...over,
  };
  const view = render(<UnsentVideosSection {...props} />);
  return { ...view, props };
}

describe('UnsentVideosSection', () => {
  afterEach(cleanup);

  it('shows each §5.2 state as its chip, and counts what is unsent', () => {
    const t = PLACES.ticket;
    renderSection([
      draftAt(t, 'draft'),
      draftAt(t, 'ready'),
      draftAt(t, 'preparing'),
      draftAt(t, 'queued'),
      draftAt(t, 'waiting_network'),
      draftAt(t, 'uploading', {
        upload: { clientKey: 'k', attempts: 1, sentAt: 1, progress: 0.37 },
      }),
      draftAt(t, 'delivering'),
      draftAt(t, 'needs_credentials'),
      draftAt(t, 'failed'),
      draftAt(t, 'sent', {
        sent: {
          outcome: 'done',
          uploadId: 'u',
          artifactId: 'a',
          sentAt: 1,
          at: 2,
          expiresAt: 3,
          dismissed: false,
        },
      }),
      draftAt(t, 'sent', {
        sent: {
          outcome: 'kept',
          reason: 'ticket was deleted',
          uploadId: 'u2',
          artifactId: 'a2',
          sentAt: 1,
          at: 2,
          expiresAt: 3,
          dismissed: false,
        },
      }),
    ]);
    for (const text of [
      'Draft',
      'Ready to send',
      'Preparing…',
      'Waiting to send',
      'Waiting for network',
      'Uploading 37%',
      'Processing…',
      'Paused · Tap to resume',
      "Didn't send",
      'Attached ✓',
      'Saved to your library (ticket was deleted)',
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // Nine are unsent; the two receipts are not.
    expect(screen.getByRole('heading', { name: 'Unsent videos (9)' })).toBeTruthy();
  });

  it('groups rows by place, and shows filters only when more than one group has rows', () => {
    const one = renderSection([draftAt(PLACES.ticket, 'draft'), draftAt(PLACES.ticket, 'ready')]);
    expect(screen.getByRole('list', { name: 'Tickets' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    one.unmount();

    renderSection([
      draftAt(PLACES.ticket, 'draft'),
      draftAt(PLACES.session, 'draft'),
      draftAt(PLACES.wrapup, 'draft'),
      draftAt(PLACES.post, 'draft'),
    ]);
    expect(
      within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    // A session video and a wrap-up both go under Clock sessions.
    expect(
      within(screen.getByRole('list', { name: 'Clock sessions' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    const filters = screen.getByRole('radiogroup', { name: MEDIA_TEXT.unsent.filterLabel });
    expect(
      within(filters)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['All', 'Tickets', 'Clock', 'Posts']);
  });

  it('a filter shows its group alone, and says so when picked', () => {
    const drafts = [draftAt(PLACES.ticket, 'draft'), draftAt(PLACES.post, 'draft')];
    const { props } = renderSection(drafts, { filter: 'post' });
    expect(screen.queryByRole('list', { name: 'Tickets' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Posts' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Tickets' }));
    expect(props.onFilterChange).toHaveBeenCalledWith('ticket');
  });

  it('says how videos get here when there are none', () => {
    renderSection([]);
    expect(
      screen.getByText(
        "Videos you record in TimeHuddle stay here until they're sent. " +
          'Videos recorded in the Pulse app stay in that app.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Unsent videos' })).toBeTruthy();
  });

  it('says offline that the list is this phone’s alone', () => {
    renderSection([draftAt(PLACES.ticket, 'waiting_network')], { offline: true });
    const notice = screen.getByText('Offline: showing videos on this phone');
    expect(notice.closest('[aria-live="polite"]')).toBeTruthy();
  });

  it('a tap opens the row, and the ⋯ menu offers what its state allows', () => {
    const ready = draftAt(PLACES.ticket, 'ready', { name: 'Fix login demo' });
    const { props } = renderSection([ready]);
    fireEvent.click(screen.getByRole('button', { name: 'Open Fix login demo' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: ready.draftKey }));

    fireEvent.click(screen.getByRole('button', { name: 'More for Fix login demo' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Send', 'Move to…', 'Rename', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(props.onMenu).toHaveBeenCalledWith(
      'delete',
      expect.objectContaining({ key: ready.draftKey }),
    );
  });

  it('a sending row has no ⋯ menu (it is locked)', () => {
    renderSection([draftAt(PLACES.ticket, 'uploading', { name: 'Busy' })]);
    expect(screen.queryByRole('button', { name: 'More for Busy' })).toBeNull();
  });

  it('shows the row’s place, duration and age', () => {
    renderSection([draftAt(PLACES.ticket, 'draft')]);
    expect(screen.getByText('For Fix login')).toBeTruthy();
    expect(screen.getByText('0:42')).toBeTruthy();
    expect(screen.getByText('5 min ago')).toBeTruthy();
  });

  it('announces a change of state', () => {
    const d = draftAt(PLACES.ticket, 'queued', { name: 'Clip' });
    const { rerender, props } = renderSection([d]);
    rerender(<UnsentVideosSection {...props} items={mergeRows([{ ...d, state: 'failed' }], [])} />);
    const live = screen.getAllByRole('status').find((el) => el.textContent === "Clip: Didn't send");
    expect(live).toBeTruthy();
  });
});
