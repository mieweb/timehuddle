import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ClockEvent } from '../../lib/api';
import { AdminDayGroup } from './AdminDayGroup';

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
    'aria-label': ariaLabel,
  }: {
    children: ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    'aria-label'?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
  TableRow: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <tr onClick={onClick}>{children}</tr>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('../clock/TimesheetRow', () => ({
  TimesheetRow: ({ session }: { session: ClockEvent }) => (
    <tr data-testid="timesheet-row" data-session-id={session.id} />
  ),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TEAMS = [{ id: 'team-1', name: 'Alpha Team' }];

function buildSession(overrides: Partial<ClockEvent> = {}): ClockEvent {
  return {
    id: 'session-1',
    userId: 'u1',
    teamId: 'team-1',
    startTime: new Date('2026-05-19T09:00:00').getTime(),
    endTime: new Date('2026-05-19T17:00:00').getTime(),
    accumulatedTime: 8 * 3600,
    breaks: [],
    ...overrides,
  };
}

function renderGroup(props: Partial<Parameters<typeof AdminDayGroup>[0]> = {}) {
  const defaults = {
    sessions: [buildSession()],
    teams: TEAMS,
    onEdit: vi.fn(),
    isExpanded: false,
    onToggle: vi.fn(),
  };
  return render(
    <table>
      <tbody>
        <AdminDayGroup {...defaults} {...props} />
      </tbody>
    </table>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminDayGroup', () => {
  describe('summary row (collapsed)', () => {
    it('shows aggregated duration for a single session', () => {
      renderGroup();
      expect(screen.getByText('8h 0m')).toBeTruthy();
    });

    it('sums duration across multiple sessions', () => {
      const s1 = buildSession({
        id: 's1',
        startTime: new Date('2026-05-19T08:00:00').getTime(),
        endTime: new Date('2026-05-19T12:00:00').getTime(),
        accumulatedTime: 4 * 3600,
      });
      const s2 = buildSession({
        id: 's2',
        startTime: new Date('2026-05-19T13:00:00').getTime(),
        endTime: new Date('2026-05-19T17:00:00').getTime(),
        accumulatedTime: 4 * 3600,
      });
      renderGroup({ sessions: [s1, s2] });
      expect(screen.getByText('8h 0m')).toBeTruthy();
    });

    it('shows session count for a completed day', () => {
      renderGroup({ sessions: [buildSession()] });
      expect(screen.getByText('1 session')).toBeTruthy();
    });

    it('shows plural session count for multiple sessions', () => {
      renderGroup({
        sessions: [buildSession({ id: 's1' }), buildSession({ id: 's2' })],
      });
      expect(screen.getByText('2 sessions')).toBeTruthy();
    });

    it('shows Active badge when any session has no endTime', () => {
      renderGroup({ sessions: [buildSession({ endTime: null })] });
      expect(screen.getByText('Active')).toBeTruthy();
      expect(screen.queryByText('1 session')).toBeNull();
    });

    it('shows Active badge when one of multiple sessions is still open', () => {
      const finished = buildSession({ id: 's1' });
      const active = buildSession({ id: 's2', endTime: null, accumulatedTime: 0 });
      renderGroup({ sessions: [finished, active] });
      expect(screen.getByText('Active')).toBeTruthy();
    });

    it('shows team name when all sessions are on the same team', () => {
      renderGroup();
      expect(screen.getByText('Alpha Team')).toBeTruthy();
    });

    it('shows "Multiple" when sessions span more than one team', () => {
      const s1 = buildSession({ id: 's1', teamId: 'team-1' });
      const s2 = buildSession({ id: 's2', teamId: 'team-2' });
      const teams = [
        { id: 'team-1', name: 'Alpha' },
        { id: 'team-2', name: 'Beta' },
      ];
      renderGroup({ sessions: [s1, s2], teams });
      expect(screen.getByText('Multiple')).toBeTruthy();
    });

    it('does not render individual session rows when collapsed', () => {
      renderGroup({ isExpanded: false });
      expect(screen.queryAllByTestId('timesheet-row')).toHaveLength(0);
    });

    it('shows "Expand day" aria-label on chevron when collapsed', () => {
      renderGroup({ isExpanded: false });
      expect(screen.getByRole('button', { name: 'Expand day' })).toBeTruthy();
    });

    it('shows "Collapse day" aria-label on chevron when expanded', () => {
      renderGroup({ isExpanded: true });
      expect(screen.getByRole('button', { name: 'Collapse day' })).toBeTruthy();
    });
  });

  describe('expand / collapse behaviour', () => {
    it('calls onToggle when the summary row is clicked', () => {
      const onToggle = vi.fn();
      renderGroup({ onToggle });
      fireEvent.click(screen.getAllByRole('row')[0]);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('calls onToggle when the chevron button is clicked', () => {
      const onToggle = vi.fn();
      renderGroup({ onToggle, isExpanded: false });
      fireEvent.click(screen.getByRole('button', { name: 'Expand day' }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders one TimesheetRow per session when expanded', () => {
      const sessions = [buildSession({ id: 's1' }), buildSession({ id: 's2' })];
      renderGroup({ sessions, isExpanded: true });
      expect(screen.getAllByTestId('timesheet-row')).toHaveLength(2);
    });

    it('hides session rows when collapsed after being given expanded=false', () => {
      const sessions = [buildSession({ id: 's1' }), buildSession({ id: 's2' })];
      renderGroup({ sessions, isExpanded: false });
      expect(screen.queryAllByTestId('timesheet-row')).toHaveLength(0);
    });

    it('session rows carry the correct session id when expanded', () => {
      const sessions = [buildSession({ id: 'sess-a' }), buildSession({ id: 'sess-b' })];
      renderGroup({ sessions, isExpanded: true });
      const rows = screen.getAllByTestId('timesheet-row');
      const ids = rows.map((r) => r.getAttribute('data-session-id'));
      expect(ids).toContain('sess-a');
      expect(ids).toContain('sess-b');
    });
  });

  describe('onEdit forwarding', () => {
    it('passes onEdit to each expanded TimesheetRow', () => {
      // The mock TimesheetRow renders a data-session-id attribute,
      // confirming the correct session is forwarded via props.
      const session = buildSession({ id: 'target-session' });
      renderGroup({ sessions: [session], isExpanded: true });
      expect(screen.getByTestId('timesheet-row').dataset.sessionId).toBe('target-session');
    });
  });
});
