import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { redmineApi, type RedmineTimeEntryRow } from '../../lib/api';

import { RedminePushPanel } from './RedminePushPanel';

vi.mock('../../lib/api', () => ({
  redmineApi: { timeEntries: { preview: vi.fn(), push: vi.fn() } },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('RedminePushPanel Billable edits', () => {
  it('sends each row with its own edit and original snapshot, then shows the edited result', async () => {
    const billable = { id: 7, name: 'Billable status', value: 'Internal Meeting' };
    const row: RedmineTimeEntryRow = {
      ticketId: '15',
      date: '2026-11-06',
      seconds: 600,
      alreadySentSeconds: 0,
      runSeconds: [600],
      hours: 0.17,
      subject: 'Fix the clock',
      trackerName: 'Bug',
      issueMissing: false,
      activityId: 9,
      activityName: 'Development',
      activityReason: 'tracker',
      activityOptions: [{ id: 9, name: 'Development' }],
      billable,
      blockedReason: null,
    };
    vi.mocked(redmineApi.timeEntries.preview).mockResolvedValue({
      connected: true,
      idle: true,
      baseUrl: null,
      rows: [row, { ...row, ticketId: '16' }],
    });
    vi.mocked(redmineApi.timeEntries.push).mockResolvedValue({
      results: ['15', '16'].map((ticketId) => ({ ticketId, date: row.date, ok: true })),
    });
    render(<RedminePushPanel isClockedIn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send work entries to Redmine' }));
    const inputs = await screen.findAllByRole('textbox', { name: billable.name });
    fireEvent.change(inputs[0], { target: { value: 'Billable' } });
    fireEvent.change(inputs[1], { target: { value: 'Non-billable' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send 2 entries/ }));

    await waitFor(() =>
      expect(redmineApi.timeEntries.push).toHaveBeenCalledWith(
        ['Billable', 'Non-billable'].map((billableValue, index) => ({
          ticketId: String(15 + index),
          date: row.date,
          activityId: 9,
          comment: undefined,
          billable,
          billableValue,
          hours: row.hours,
        })),
      ),
    );
    expect(await screen.findByText('Non-billable')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: billable.name })).toBeNull();
  });
});
