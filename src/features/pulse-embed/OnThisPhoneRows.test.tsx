import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PulseUploadPublic } from '../../lib/api';
import { mergeRows } from './mergeRows';
import { OnThisPhoneRows } from './OnThisPhoneRows';
import { UnsentVideosLink } from './UnsentVideosLink';

const draft = (id: string, state: DraftState, extra: Partial<DraftSummary> = {}): DraftSummary => ({
  id,
  draftKey: `inst:${id}`,
  name: `Fix login ${id}`,
  context: null,
  state,
  clipCount: 1,
  durationMs: 42_000,
  hasCaptions: false,
  poster: { rel: 'p.jpg', path: '/p.jpg', webUrl: `local://${id}.jpg` },
  createdVia: 'host',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const theirs: PulseUploadPublic = {
  id: 't1',
  userId: 'them',
  type: 'ticket.video',
  targetKey: 'ticket:abc',
  state: 'uploading',
  name: null,
  durationMs: null,
  sentAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  reason: null,
  note: null,
  attachmentId: null,
  mediaId: null,
};

const uploading = (progress: number) =>
  draft('d1', 'uploading', { upload: { clientKey: 'k', attempts: 1, sentAt: 2, progress } });

const status = () => screen.getByRole('status');

describe('OnThisPhoneRows', () => {
  afterEach(cleanup);

  it('renders each row with its poster, name, duration and chip', () => {
    render(
      <OnThisPhoneRows
        items={mergeRows([uploading(0.37), draft('d2', 'failed')], [theirs], { userId: 'me' })}
      />,
    );
    const list = screen.getByRole('list', { name: 'Videos on this phone' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(screen.getByText('Uploading 37%')).toBeTruthy();
    expect(screen.getByText("Didn't send")).toBeTruthy();
    expect(screen.getByText('Uploading from iPhone…')).toBeTruthy();
    expect(screen.getAllByText('0:42')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Fix login d1, poster' }).getAttribute('src')).toBe(
      'local://d1.jpg',
    );
    expect(screen.getByRole('heading', { name: 'On this phone' })).toBeTruthy();
  });

  it('announces a change of state in its live region, not each percent', () => {
    const { rerender } = render(<OnThisPhoneRows items={mergeRows([uploading(0.1)], [])} />);
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('');

    rerender(<OnThisPhoneRows items={mergeRows([uploading(0.6)], [])} />);
    expect(status().textContent).toBe('');

    rerender(<OnThisPhoneRows items={mergeRows([draft('d1', 'delivering')], [])} />);
    expect(status().textContent).toBe('Fix login d1: Processing…');
  });

  it("puts the place's own card in a landed row's slot", () => {
    const landed = mergeRows(
      [draft('d1', 'delivering')],
      [{ ...theirs, id: 'u1', userId: 'me', state: 'delivered', draftKey: 'inst:d1' }],
    );
    render(<OnThisPhoneRows items={landed} renderLanded={(row) => <p>Server card {row.key}</p>} />);
    expect(screen.getByText('Server card inst:d1')).toBeTruthy();
    expect(screen.queryByText('Attached ✓')).toBeNull();
  });

  it("keeps this phone's poster on a landed row until the server poster loads", () => {
    const landed = mergeRows(
      [draft('d1', 'delivering')],
      [{ ...theirs, id: 'u1', userId: 'me', state: 'delivered', draftKey: 'inst:d1' }],
    );
    render(<OnThisPhoneRows items={landed} serverPoster={() => 'https://server/poster'} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('local://d1.jpg');
    expect(screen.getByText('Attached ✓')).toBeTruthy();
  });

  it('opens a row from its name', () => {
    const onOpen = vi.fn();
    render(<OnThisPhoneRows items={mergeRows([draft('d1', 'ready')], [])} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Fix login d1' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'inst:d1' }));
  });

  it('says it is loading, or that it failed, before it has rows', () => {
    const { rerender } = render(<OnThisPhoneRows items={[]} loading />);
    expect(screen.getByText('Loading videos on this phone')).toBeTruthy();
    rerender(<OnThisPhoneRows items={[]} error={new Error('x')} />);
    expect(screen.getByText("Couldn't load the videos on this phone.")).toBeTruthy();
  });

  it('renders nothing without rows', () => {
    const { container } = render(<OnThisPhoneRows items={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('UnsentVideosLink', () => {
  afterEach(cleanup);

  it('says how many are unsent, with the attention badge, and opens them', () => {
    const onOpen = vi.fn();
    render(<UnsentVideosLink count={3} attention={1} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unsent videos (3)' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('1 needs attention')).toBeTruthy();
  });

  it('renders nothing at zero', () => {
    const { container } = render(<UnsentVideosLink count={0} onOpen={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
