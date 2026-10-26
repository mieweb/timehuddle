import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ClockEvent } from '../../lib/api';
import { RouterContext } from '../../ui/router';
import { TimesheetRow } from './TimesheetRow';

afterEach(() => {
  cleanup();
});

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: () => null,
}));

vi.mock('@mieweb/ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  Text: ({
    children,
    className,
    'data-strong': strong,
  }: {
    children: ReactNode;
    className?: string;
    'data-strong'?: string;
  }) => (
    <span className={className} data-strong={strong}>
      {children}
    </span>
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

function buildSession(): ClockEvent {
  const originalStart = new Date('2026-05-19T10:00:00').getTime();
  return {
    id: 'session-1',
    userId: 'u1',
    teamId: 'team-1',
    startTime: new Date('2026-05-19T10:30:00').getTime(),
    originalStartTime: originalStart,
    endTime: new Date('2026-05-19T11:00:00').getTime(),
    accumulatedTime: 50 * 60,
    breaks: [
      {
        startTime: new Date('2026-05-19T10:20:00').getTime(),
        endTime: new Date('2026-05-19T10:30:00').getTime(),
      },
    ],
  };
}

function buildCrossMidnightSession(): ClockEvent {
  return {
    id: 'session-midnight',
    userId: 'u1',
    teamId: 'team-1',
    // Clocked in 7:49 PM May 20, clocked out 2:49 AM May 21
    startTime: new Date('2026-05-20T19:49:00').getTime(),
    endTime: new Date('2026-05-21T02:49:00').getTime(),
    accumulatedTime: 7 * 3600,
    breaks: [],
  };
}

/** Open a session's breaks: the session as it went. */
function openBreaks() {
  fireEvent.click(screen.getByRole('button', { name: /^Show \d+ breaks? in this session$/ }));
}

/** The session's own list item (its open parts and tickets are nested in it). */
function sessionItem() {
  return screen.getAllByRole('listitem')[0];
}

/** What each opened part says it was, oldest first. */
function partLabels(container: HTMLElement) {
  return [...container.querySelectorAll('.session-part-label')].map((el) => el.textContent);
}

describe('TimesheetRow', () => {
  it('shows a session as one item: its day, clock in → clock out, team, work time', () => {
    render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    const item = sessionItem();
    expect(item.textContent).toContain('May 19');
    expect(item.querySelector('.clock-range')?.textContent).toBe('10:00 AM → 11:00 AM');
    expect(item.textContent).toContain('· Mobile test');
    expect(item.textContent).toContain('50m');
    expect(item.textContent).toContain('Completed');
    // Says what it opens: one break, 10 minutes.
    expect(screen.getByRole('button', { name: 'Show 1 break in this session' }).textContent).toBe(
      '1 break · 10m',
    );
  });

  it('opens its breaks: the session as it went, oldest first, then closes', () => {
    const { container } = render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    openBreaks();
    expect(screen.getByRole('list', { name: 'Parts of this session' })).toBeTruthy();
    expect(partLabels(container)).toEqual(['Work', 'Break', 'Work']);
    expect(screen.getByText('20m')).toBeTruthy();
    expect(screen.getByText('10m')).toBeTruthy();
    expect(screen.getByText('30m')).toBeTruthy();
    expect(screen.getAllByText('Completed')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Hide 1 break in this session' }));
    expect(screen.queryByRole('list', { name: 'Parts of this session' })).toBeNull();
  });

  it('makes the clock in and clock out bold, and mutes where a break started and ended', () => {
    const { container } = render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );
    const times = (selector: string) =>
      [...container.querySelectorAll(selector)].map((el) => el.textContent);

    expect(times('.clock-time[data-strong]')).toEqual(['10:00 AM', '11:00 AM']);
    openBreaks();
    // The session row's two, then the same two where its parts show them.
    expect(times('.clock-time[data-strong]')).toEqual([
      '10:00 AM',
      '11:00 AM',
      '10:00 AM',
      '11:00 AM',
    ]);
    expect(times('.clock-time:not([data-strong])')).toEqual([
      '10:20 AM',
      '10:20 AM',
      '10:30 AM',
      '10:30 AM',
    ]);
  });

  it('shows one edit action and passes the session back on click', () => {
    const session = buildSession();
    const onEdit = vi.fn();

    render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={onEdit}
        />
      </ul>,
    );

    const editButtons = screen.getAllByRole('button', { name: 'Edit session' });
    expect(editButtons).toHaveLength(1);

    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(session);
  });

  it('still shows, and can edit, a session that ended the moment it started', () => {
    const at = new Date('2026-05-19T10:00:00').getTime();
    const session: ClockEvent = {
      id: 'session-empty',
      userId: 'u1',
      teamId: 'team-1',
      startTime: at,
      endTime: at,
      accumulatedTime: 0,
      workSeconds: 0,
      breaks: [],
    };
    const onEdit = vi.fn();

    render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={onEdit}
        />
      </ul>,
    );

    const item = sessionItem();
    expect(item.textContent).toContain('May 19');
    expect(item.querySelector('.clock-range')?.textContent).toBe('10:00 AM → 10:00 AM');
    expect(item.textContent).toContain('Completed');
    fireEvent.click(screen.getByRole('button', { name: 'Edit session' }));
    expect(onEdit).toHaveBeenCalledWith(session);
  });

  it('marks a clock out on the next day "+1 day"', () => {
    render(
      <ul>
        <TimesheetRow
          session={buildCrossMidnightSession()}
          teams={[{ id: 'team-1', name: 'Night Crew' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    // Clocked in 7:49 PM May 20, out 2:49 AM May 21: one row, no breaks to open.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(sessionItem().querySelector('.clock-range')?.textContent).toBe(
      '7:49 PM → 2:49 AM+1 day',
    );
    expect(screen.queryByRole('button', { name: /break/ })).toBeNull();
    expect(sessionItem().textContent).toContain('· Night Crew');
  });

  it('puts a divider where a new day starts among its parts', () => {
    const session: ClockEvent = {
      ...buildCrossMidnightSession(),
      breaks: [
        {
          startTime: new Date('2026-05-20T22:00:00').getTime(),
          endTime: new Date('2026-05-20T22:10:00').getTime(),
        },
      ],
    };
    const { container } = render(
      <ul>
        <TimesheetRow session={session} teams={[]} onEdit={vi.fn()} />
      </ul>,
    );
    openBreaks();
    // Work · break · work to midnight, then May 21: the rest of that work.
    expect(partLabels(container)).toEqual(['Work', 'Break', 'Work', 'Work']);
    const dividers = container.querySelectorAll('.session-day');
    expect(dividers).toHaveLength(1);
    expect(dividers[0].textContent).toContain('May 21');
    expect(dividers[0].nextElementSibling?.textContent).toContain('12:00 AM');
  });

  it('shows the edit action on the newest row for a cross-midnight session', () => {
    const session = buildCrossMidnightSession();
    const onEdit = vi.fn();

    render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Night Crew' }]}
          onEdit={onEdit}
        />
      </ul>,
    );

    const editButtons = screen.getAllByRole('button', { name: 'Edit session' });
    expect(editButtons).toHaveLength(1);

    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(session);
  });

  it('renders a shift with no ticket sessions exactly as before — no disclosure', () => {
    render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    expect(screen.queryByRole('button', { name: /ticket timer/i })).toBeNull();
  });

  it('nests ticket sessions under the shift they ran inside', () => {
    const session: ClockEvent = {
      ...buildSession(),
      ticketSessions: [
        {
          id: 'ts1',
          workItemId: 'wi1',
          source: 'huddle',
          ticketId: 'tkt1',
          title: 'Fix the thing',
          url: '/app/tickets/tkt1',
          startTime: new Date('2026-05-19T10:30:00').getTime(),
          endTime: new Date('2026-05-19T10:45:00').getTime(),
          durationSeconds: 900,
        },
        {
          id: 'ts2',
          workItemId: 'wi2',
          source: 'redmine',
          ticketId: '4242',
          title: 'Upstream bug',
          url: 'https://redmine.example.com/issues/4242',
          startTime: new Date('2026-05-19T10:45:00').getTime(),
          endTime: null,
          durationSeconds: null,
        },
      ],
    };

    render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    // Collapsed by default; their own toggle says what it opens.
    expect(screen.queryByText('Fix the thing')).toBeNull();

    const toggle = screen.getByRole('button', { name: /Show 2 ticket timers for this shift/i });
    expect(toggle.textContent).toBe('2 tickets');
    fireEvent.click(toggle);

    // Both open the ticket's page inside TimeHuddle; a Redmine issue's page
    // links on to Redmine itself.
    const huddleLink = screen.getByText('Fix the thing') as HTMLAnchorElement;
    expect(huddleLink.getAttribute('href')).toBe('/app/tickets/tkt1');
    expect(huddleLink.getAttribute('target')).toBeNull();

    const redmineLink = screen.getByText('Upstream bug') as HTMLAnchorElement;
    expect(redmineLink.getAttribute('href')).toBe('/app/tickets/redmine/4242');
    expect(redmineLink.getAttribute('target')).toBeNull();

    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.getByText('Redmine')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Hide 2 ticket timers/i }));
    expect(screen.queryByText('Fix the thing')).toBeNull();

    // Shown, they're a list inside the session's own item, one per timer.
    fireEvent.click(screen.getByRole('button', { name: /Show 2 ticket timers/i }));
    const list = screen.getByRole('list', { name: 'Ticket timers in this session' });
    expect(list.closest('.session-row')).toBe(sessionItem());
    expect(list.querySelectorAll(':scope > li')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Hide 2 ticket timers/i }));
    expect(screen.queryByText('Fix the thing')).toBeNull();
  });

  it('keeps the actions on the top line, whatever is open under it', () => {
    const { container } = render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );
    openBreaks();
    const edit = screen.getAllByRole('button', { name: 'Edit session' });
    expect(edit).toHaveLength(1);
    expect(edit[0].closest('.session-top')).toBeTruthy();
    // The parts are nested in the session's item, after its top line.
    const parts = screen.getByRole('list', { name: 'Parts of this session' });
    expect(parts.closest('.session-row')).toBe(sessionItem());
    expect(container.querySelectorAll('.session-part')).toHaveLength(3);
  });

  it('offers nothing to open on a session with no breaks or tickets', () => {
    const session = { ...buildSession(), breaks: [], originalStartTime: undefined };
    render(
      <ul>
        <TimesheetRow session={session} teams={[]} onEdit={vi.fn()} />
      </ul>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /break|ticket/ })).toBeNull();
  });

  it('rounds duration display to match minute-level timestamps', () => {
    const session: ClockEvent = {
      id: 'session-rounded',
      userId: 'u1',
      teamId: 'team-1',
      startTime: new Date('2026-05-19T10:04:30').getTime(),
      endTime: new Date('2026-05-19T13:04:29').getTime(),
      accumulatedTime: 0,
      breaks: [],
    };

    render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Rounded Crew' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );

    expect(screen.getByText('10:04 AM')).toBeTruthy();
    expect(screen.getByText('1:04 PM')).toBeTruthy();
    expect(screen.getByText('3h 0m')).toBeTruthy();
  });

  it('says "Pending approval" once for the session, not on its pieces', () => {
    render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
          changeStatus="pending"
        />
      </ul>,
    );

    expect(screen.getAllByText('Pending approval')).toHaveLength(1);
    expect(screen.queryByText('Completed')).toBeNull();
    openBreaks();
    expect(screen.getAllByText('Pending approval')).toHaveLength(1);
    for (const part of document.querySelectorAll('.session-part')) {
      expect(part.textContent).not.toMatch(/Completed|Pending/);
    }
  });

  it('reports a declined change in place of the status', () => {
    render(
      <ul>
        <TimesheetRow
          session={buildSession()}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
          changeStatus="rejected"
          changeNote="Times do not match the roster: https://wiki.example.com/roster"
        />
      </ul>,
    );

    // Once for the session, not on each of its pieces.
    expect(screen.getAllByText('Change declined')).toHaveLength(1);
    expect(screen.queryByText('Pending approval')).toBeNull();
    // The reviewer's note is on the page, not in a tooltip, and its link works.
    expect(screen.getAllByText(/Times do not match the roster/)).toHaveLength(1);
    expect(
      screen
        .getAllByRole('link', { name: 'https://wiki.example.com/roster' })[0]
        .getAttribute('href'),
    ).toBe('https://wiki.example.com/roster');
  });

  it("offers the session's videos only where the host passes onVideos", () => {
    const session = buildSession();
    const onVideos = vi.fn();
    const { rerender } = render(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
        />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: 'Videos for this session' })).toBeNull();

    rerender(
      <ul>
        <TimesheetRow
          session={session}
          teams={[{ id: 'team-1', name: 'Mobile test' }]}
          onEdit={vi.fn()}
          onVideos={onVideos}
        />
      </ul>,
    );
    const videos = screen.getAllByRole('button', { name: 'Videos for this session' });
    expect(videos).toHaveLength(1);
    fireEvent.click(videos[0]);
    expect(onVideos).toHaveBeenCalledWith(session);
  });

  it('opens a Redmine ticket session on its TimeHuddle page, not in Redmine', () => {
    const navigate = vi.fn();
    const session: ClockEvent = {
      ...buildSession(),
      ticketSessions: [
        {
          id: 'ts2',
          workItemId: 'wi2',
          source: 'redmine',
          ticketId: '4242',
          title: 'Upstream bug',
          url: 'https://redmine.example.com/issues/4242',
          startTime: new Date('2026-05-19T10:45:00').getTime(),
          endTime: new Date('2026-05-19T11:00:00').getTime(),
          durationSeconds: 900,
        },
      ],
    };

    render(
      <RouterContext.Provider value={{ pathname: '/app', search: '', navigate, replace: vi.fn() }}>
        <ul>
          <TimesheetRow
            session={session}
            teams={[{ id: 'team-1', name: 'Mobile test' }]}
            onEdit={vi.fn()}
          />
        </ul>
      </RouterContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Show 1 ticket timer/i }));

    const link = screen.getByText('Upstream bug');
    // Cmd-click is left to the browser (new tab); a plain click routes in-app.
    fireEvent.click(link, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/app/tickets/redmine/4242');
  });
});
