import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket } from '../../lib/api';
import { mergeRows } from '../pulse-embed/mergeRows';
import { pulsePlace } from '../pulse-embed/place';
import { MoveToSheet, type MoveToSheetProps } from './MoveToSheet';
import { PLACES, draftAt, uploadType } from './testRows';
import { UnsentVideoRow } from './UnsentVideoRow';
import { rowFacts } from './rowActions';

const api = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ticketApi: { ...actual.ticketApi, search: api.search } };
});

const ticket = (id: string, title: string, extra: Partial<Ticket> = {}): Ticket => ({
  id,
  teamId: 't1',
  title,
  description: null,
  github: '',
  linkIsIssue: null,
  status: 'open',
  priority: null,
  createdBy: 'me',
  assignedTo: [],
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: null,
  linkedIssue: null,
  ...extra,
});

/** A TimeHuddle ticket carrying a Redmine issue (#736): the kind H5 must offer. */
const REDMINE = ticket('e'.repeat(24), 'Login fails on Safari', {
  linkedIssue: { source: 'redmine', id: '233' },
});
const GITHUB = ticket('f'.repeat(24), 'Login button misaligned', {
  github: 'https://github.com/mieweb/timehuddle/issues/1',
  linkIsIssue: true,
});

const LIBRARY = pulsePlace({
  type: 'library.video',
  userId: 'me',
  label: 'My library',
  uploadType: uploadType('library.video'),
})!;

function renderSheet(over: Partial<MoveToSheetProps> = {}) {
  const props: MoveToSheetProps = {
    open: true,
    name: 'Fix login demo',
    currentKey: PLACES.ticket.context.key,
    userId: 'me',
    ticketType: uploadType('ticket.video'),
    session: PLACES.session,
    library: LIBRARY,
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<MoveToSheet {...props} />);
  return props;
}

describe('MoveToSheet', () => {
  beforeEach(() => {
    api.search.mockReset();
    api.search.mockResolvedValue({ kind: 'text', tickets: [REDMINE, GITHUB] });
  });
  afterEach(cleanup);

  it('offers every ticket the search finds, a Redmine-linked one included (H5)', async () => {
    const props = renderSheet();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
      target: { value: 'login' },
    });
    const redmine = await screen.findByRole('button', { name: 'Login fails on Safari' });
    expect(screen.getByRole('button', { name: 'Login button misaligned' })).toBeTruthy();
    expect(api.search).toHaveBeenCalledWith('login');

    fireEvent.click(redmine);
    expect(props.onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ticket.video',
        target: { kind: 'ticket', id: REDMINE.id },
        context: expect.objectContaining({
          key: `ticket:${REDMINE.id}`,
          label: 'Login fails on Safari',
          uploadType: expect.objectContaining({ id: 'ticket.video' }),
        }),
      }),
    );
  });

  it('offers the open session and My library, not the place it is for now', async () => {
    api.search.mockResolvedValue({
      kind: 'text',
      tickets: [ticket('a'.repeat(24), 'Fix login'), REDMINE],
    });
    const props = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Your open session · Platform session' }));
    expect(props.onPick).toHaveBeenCalledWith(PLACES.session);
    fireEvent.click(screen.getByRole('button', { name: 'My library' }));
    expect(props.onPick).toHaveBeenCalledWith(LIBRARY);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
      target: { value: 'login' },
    });
    await screen.findByRole('button', { name: 'Login fails on Safari' });
    // The ticket it is recorded for isn't offered as a place to move to.
    expect(screen.queryByRole('button', { name: 'Fix login' })).toBeNull();
  });

  it('asks the server only for a query it takes', async () => {
    renderSheet();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
      target: { value: 'lo' },
    });
    expect(screen.getByText('Type at least 3 letters, or a ticket ID.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 350));
    expect(api.search).not.toHaveBeenCalled();
  });

  it('says so when no ticket matches', async () => {
    api.search.mockResolvedValue({ kind: 'text', tickets: [] });
    renderSheet();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
      target: { value: '#999' },
    });
    await waitFor(() => expect(screen.getByText('No tickets match.')).toBeTruthy());
  });

  it('a clock-bound video gets no Move to…: the sheet only says where it belongs', () => {
    renderSheet({ clockNote: 'Belongs to your 17:02 clock-out' });
    expect(screen.getByText('Belongs to your 17:02 clock-out')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /open session|My library/ })).toBeNull();
  });

  it("a clock-bound video's ⋯ menu has no Move to…", () => {
    const bound = draftAt(PLACES.wrapup, 'ready', { name: 'Wrap-up', confirmedAt: 5 });
    const free = draftAt(PLACES.wrapup, 'ready', { name: 'Not yet clocked' });
    const rows = mergeRows([bound, free], []);
    const freeRow = rows.find((r) => r.local?.id === free.id)!;
    render(
      <ul>
        {rows.map((row) => (
          <UnsentVideoRow
            key={row.key}
            row={row}
            facts={rowFacts(row)}
            now={0}
            onOpen={vi.fn()}
            onMenu={vi.fn()}
          />
        ))}
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More for Wrap-up' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Send',
      'Rename',
      'Delete',
    ]);
    cleanup();

    // Before its clock action ran, it can still go somewhere else.
    render(
      <ul>
        <UnsentVideoRow
          row={freeRow}
          facts={rowFacts(freeRow)}
          now={0}
          onOpen={vi.fn()}
          onMenu={vi.fn()}
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More for Not yet clocked' }));
    expect(screen.getByRole('menuitem', { name: /Move to…/ })).toBeTruthy();
  });
});
