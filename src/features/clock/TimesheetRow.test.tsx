import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ClockEvent } from '../../lib/api';
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
  TableCell: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <td {...rest}>{children}</td>
  ),
  TableRow: ({ children, ...rest }: { children: ReactNode; [key: string]: unknown }) => (
    <tr {...rest}>{children}</tr>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

describe('TimesheetRow', () => {
  it('renders work/break rows and does not render marker row text', () => {
    const session = buildSession();

    render(
      <table>
        <tbody>
          <TimesheetRow
            session={session}
            teams={[{ id: 'team-1', name: 'Mobile test' }]}
            onEdit={vi.fn()}
          />
        </tbody>
      </table>,
    );

    expect(screen.getByText('Break Period')).toBeTruthy();
    expect(screen.getAllByText('Completed')).toHaveLength(2);
    expect(screen.getByText('30m')).toBeTruthy();
    expect(screen.getByText('20m')).toBeTruthy();
    expect(screen.getByText('10m')).toBeTruthy();
    expect(screen.queryByText('Break / Resumed')).toBeNull();
  });

  it('shows one edit action and passes the session back on click', () => {
    const session = buildSession();
    const onEdit = vi.fn();

    render(
      <table>
        <tbody>
          <TimesheetRow
            session={session}
            teams={[{ id: 'team-1', name: 'Mobile test' }]}
            onEdit={onEdit}
          />
        </tbody>
      </table>,
    );

    const editButtons = screen.getAllByRole('button', { name: 'Edit session' });
    expect(editButtons).toHaveLength(1);

    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(session);
  });
});
