import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClockEvent } from '../../lib/api';
import { RecentSessionsPanel } from './RecentSessionsPanel';

afterEach(() => {
  cleanup();
});

vi.mock('@mieweb/ui', () => ({
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
  Table: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <table {...rest}>{children}</table>
  ),
  TableHeader: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <thead {...rest}>{children}</thead>
  ),
  TableBody: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <tbody {...rest}>{children}</tbody>
  ),
  TableRow: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <tr {...rest}>{children}</tr>
  ),
  TableHead: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <th {...rest}>{children}</th>
  ),
  TableCell: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <td {...rest}>{children}</td>
  ),
  Spinner: ({ label }: { label?: string }) => <span>{label}</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

let nextId = 0;

function session(overrides: Partial<ClockEvent> & { startTime: number }): ClockEvent {
  nextId += 1;
  return {
    id: `session-${nextId}`,
    userId: 'user-1',
    teamId: 'team-1',
    accumulatedTime: 0,
    endTime: null,
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1000;

describe('RecentSessionsPanel', () => {
  it('shows a loading spinner while sessions are loading', () => {
    render(<RecentSessionsPanel sessions={[]} loading onViewAll={vi.fn()} />);
    expect(screen.getByText('Loading sessions…')).toBeTruthy();
  });

  it('keeps the table on screen while a refresh loads', () => {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const sessions = [session({ startTime: start.getTime(), endTime: start.getTime() + HOUR })];
    render(<RecentSessionsPanel sessions={sessions} loading onViewAll={vi.fn()} />);
    expect(screen.queryByText('Loading sessions…')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('shows an empty state with no sessions', () => {
    render(<RecentSessionsPanel sessions={[]} loading={false} onViewAll={vi.fn()} />);
    expect(screen.getByText('No sessions in the last 7 days.')).toBeTruthy();
  });

  it('calls onViewAll when "View all" is clicked', () => {
    const onViewAll = vi.fn();
    render(<RecentSessionsPanel sessions={[]} loading={false} onViewAll={onViewAll} />);
    fireEvent.click(screen.getByText('View all'));
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it('groups sessions by day, one row per day, most recent day first', () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * HOUR);

    const sessions = [
      session({ startTime: yesterday.getTime(), endTime: yesterday.getTime() + HOUR }),
      session({ startTime: today.getTime(), endTime: today.getTime() + HOUR }),
    ];

    render(<RecentSessionsPanel sessions={sessions} loading={false} onViewAll={vi.fn()} />);

    const rows = screen.getAllByRole('row');
    // Header row + one row per day.
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toMatch(/^Today/);
  });

  it('joins a day’s visible sessions into one time-range line', () => {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const sessions = [
      session({ startTime: start.getTime(), endTime: start.getTime() + HOUR }),
      session({
        startTime: start.getTime() + 2 * HOUR,
        endTime: start.getTime() + 2 * HOUR + 30 * 60 * 1000,
      }),
    ];

    render(<RecentSessionsPanel sessions={sessions} loading={false} onViewAll={vi.fn()} />);

    // Most recent session first, same order as the per-day total it pairs with.
    expect(screen.getByText('11:00 AM – 11:30 AM · 9:00 AM – 10:00 AM')).toBeTruthy();
    expect(screen.getByText('1h 30m')).toBeTruthy();
  });

  it('hides sessions under 1 minute by default and reveals them via "Show"', () => {
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const sessions = [
      session({ startTime: start.getTime(), endTime: start.getTime() + 30 * 1000 }), // 30s
      session({
        startTime: start.getTime() + HOUR,
        endTime: start.getTime() + HOUR + 5 * 60 * 1000,
      }), // 5m
    ];

    render(<RecentSessionsPanel sessions={sessions} loading={false} onViewAll={vi.fn()} />);

    expect(screen.getByText(/1 session under 1 minute hidden/)).toBeTruthy();
    expect(screen.getByText('10:00 AM – 10:05 AM')).toBeTruthy();

    fireEvent.click(screen.getByText('Show'));

    expect(screen.getByText(/10:00 AM – 10:05 AM.*9:00 AM – 9:00 AM/)).toBeTruthy();
    expect(screen.getByText('Hide')).toBeTruthy();
  });
});
