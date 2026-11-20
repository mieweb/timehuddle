import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  pulseUploadApi,
  teamApi,
  type PulseUploadAdmin,
  type PulseUploadMetrics,
  type Team,
} from '../../../lib/api';
import { SUPPORT_ROWS_VAR } from './PulseSupportGrid';
import { PulseSupportSection, teamHasPulse } from './PulseSupportSection';
import { SUPPORT_LIMIT } from './supportRows';
import { SUPPORT_TEXT as T } from './supportStrings';

vi.mock('../../../lib/api', () => ({
  pulseUploadApi: { adminList: vi.fn(), metrics: vi.fn() },
  teamApi: { getMembers: vi.fn() },
}));

// NITRO itself needs a real browser; this stand-in shows the rows the grid
// published on its window variable, as the `local` source reads them.
vi.mock('@mieweb/ui/datavis', async () => {
  const { createContext } = await import('react');
  return {
    DataVisNitroContext: createContext(null),
    DataVisNitroSource: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DataVisNitroGrid: ({ title }: { title: string }) => {
      const rows =
        (window as unknown as Record<string, { data: Array<Record<string, string>> }>)[
          'timehuddlePulseSupportRows'
        ]?.data ?? [];
      return (
        <table aria-label={title}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid="support-row">
                <td>{row.userName}</td>
                <td>{row.place}</td>
                <td>{row.state}</td>
                <td>{row.flags}</td>
                <td>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
  };
});

const TEAM_ID = 'team1';
const TICKET = '64b1f0c2a9e8d7c6b5a49382';
const HOUR = 60 * 60 * 1000;

const team = {
  id: TEAM_ID,
  name: 'Support',
  resolvedSettings: { pulseInApp: { value: true, source: 'team' } },
} as unknown as Team;

const row = (extra: Partial<PulseUploadAdmin>): PulseUploadAdmin => ({
  id: 'up',
  userId: 'u1',
  userName: 'Pat Lee',
  type: 'clock.wrapup',
  targetKey: 'clock:65aa00b1c2d3e4f5a6b7c8d9',
  teamId: TEAM_ID,
  label: 'Wrap-up',
  state: 'uploading',
  name: null,
  durationMs: null,
  sentAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  updatedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  reason: null,
  note: null,
  attachmentId: null,
  mediaId: null,
  ...extra,
});

const metrics: PulseUploadMetrics = {
  teamId: TEAM_ID,
  since: '2026-10-20T12:00:00.000Z',
  until: '2026-11-19T12:00:00.000Z',
  truncated: false,
  counts: {
    total: 4,
    sent: 4,
    canceled: 0,
    inFlight: 1,
    delivered: 2,
    kept: 0,
    failed: 0,
    abandoned: 1,
    overdue: 1,
  },
  rates: { success: 0.5, kept: 0, failed: 0, abandoned: 0.25, overdue: 0.25 },
  timeToAttachMs: { count: 2, p50: 120_000, p95: 600_000 },
  duplicateAttachments: { sets: 0, extra: 0 },
  byType: {},
};

const adminList = vi.mocked(pulseUploadApi.adminList);
const metricsCall = vi.mocked(pulseUploadApi.metrics);

beforeEach(() => {
  metricsCall.mockResolvedValue(metrics);
  adminList.mockResolvedValue({
    uploads: [
      row({ id: 'stuck' }),
      row({ id: 'gone', state: 'abandoned', userName: 'Sam Roe', reason: 'Draft deleted' }),
      row({ id: 'elsewhere', teamId: 'other-team', userName: 'Not Shown' }),
    ],
  });
  vi.mocked(teamApi.getMembers).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const openSection = async () => {
  render(<PulseSupportSection team={team} />);
  fireEvent.click(screen.getByRole('button', { name: T.open }));
  await screen.findByRole('table', { name: T.gridTitle });
};

describe('PulseSupportSection', () => {
  it('loads nothing until the admin opens it', () => {
    render(<PulseSupportSection team={team} />);
    expect(screen.getByText(T.title)).toBeTruthy();
    expect(adminList).not.toHaveBeenCalled();
    expect(metricsCall).not.toHaveBeenCalled();
  });

  it("shows the team's metrics and its recent uploads with their flags", async () => {
    await openSection();
    expect(metricsCall).toHaveBeenCalledWith({ teamId: TEAM_ID });
    // The server keeps the team's rows, so the page isn't spent on other teams.
    expect(adminList).toHaveBeenCalledWith({ teamId: TEAM_ID, limit: SUPPORT_LIMIT });

    await screen.findByText(T.metric.attached);
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('2 min · 10 min')).toBeTruthy();

    const rows = screen.getAllByTestId('support-row');
    // The caller's row in another team stays out.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(T.flags.overdue)).toBeTruthy();
    expect(within(rows[0]).getByText(T.states.uploading)).toBeTruthy();
    // Its state, and its flag.
    expect(within(rows[1]).getAllByText(T.flags.abandoned)).toHaveLength(2);
    expect(within(rows[1]).getByText('Draft deleted')).toBeTruthy();
    expect(screen.queryByText('Not Shown')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(T.found(2));
    expect(screen.queryByText(T.incomplete(SUPPORT_LIMIT))).toBeNull();
  });

  it('says the list may be incomplete when a search filled a whole page', async () => {
    adminList.mockResolvedValue({
      uploads: [
        row({ id: 'stuck' }),
        ...Array.from({ length: SUPPORT_LIMIT - 1 }, (_, i) =>
          row({ id: `elsewhere${i}`, teamId: 'other-team', userName: 'Not Shown' }),
        ),
      ],
    });
    await openSection();
    expect(await screen.findByText(T.incomplete(SUPPORT_LIMIT))).toBeTruthy();
    expect(screen.getAllByTestId('support-row')).toHaveLength(1);
    expect(screen.queryByText('Not Shown')).toBeNull();
  });

  it('finds the uploads of one ticket from a pasted link', async () => {
    await openSection();
    fireEvent.click(screen.getByRole('button', { name: T.modes.ticket }));
    const input = screen.getByLabelText(T.ticketLabel);

    fireEvent.change(input, { target: { value: 'not a ticket' } });
    fireEvent.click(screen.getByRole('button', { name: T.find }));
    expect(await screen.findByText(T.badTicket)).toBeTruthy();
    expect(adminList).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: `https://huddle.example/app/tickets/${TICKET}` } });
    fireEvent.click(screen.getByRole('button', { name: T.find }));
    await waitFor(() =>
      expect(adminList).toHaveBeenLastCalledWith({
        teamId: TEAM_ID,
        targetKey: `ticket:${TICKET}`,
        limit: SUPPORT_LIMIT,
      }),
    );
  });

  it('says when the search failed, and tries again', async () => {
    adminList.mockRejectedValueOnce(new Error('Too many requests'));
    render(<PulseSupportSection team={team} />);
    fireEvent.click(screen.getByRole('button', { name: T.open }));
    expect(await screen.findByText(`${T.loadFailed} Too many requests`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: T.retry }));
    await screen.findByRole('table', { name: T.gridTitle });
    expect(adminList).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('support-row')).toHaveLength(2);
  });

  it('says when the metrics failed, and still lists uploads', async () => {
    metricsCall.mockRejectedValueOnce(new Error('forbidden'));
    await openSection();
    expect(await screen.findByText(`${T.metricsFailed} forbidden`)).toBeTruthy();
    expect(screen.getAllByTestId('support-row')).toHaveLength(2);
  });

  it('clears the rows it put on window when it closes', async () => {
    await openSection();
    const held = () =>
      (window as unknown as Record<string, { data: unknown[] }>)[SUPPORT_ROWS_VAR]?.data;
    expect(held()).toHaveLength(2);
    cleanup();
    expect(held()).toEqual([]);
  });
});

describe('teamHasPulse', () => {
  it('is true only on a server that resolves the Pulse settings', () => {
    expect(teamHasPulse(team)).toBe(true);
    expect(teamHasPulse({ ...team, resolvedSettings: {} } as unknown as Team)).toBe(false);
  });
});
