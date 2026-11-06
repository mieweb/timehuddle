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

describe('RedminePushPanel Billable status', () => {
  const billable = { id: 7, name: 'Billable status', value: 'Internal Meeting' };
  const billableField = {
    id: 7,
    name: 'Billable status',
    required: true,
    multiple: false,
    options: ['Billable', 'Non-billable', 'Internal Meeting'].map((value) => ({
      value,
      label: value,
    })),
  };
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
    billableField,
    blockedReason: null,
  };

  const openWith = async (rows: RedmineTimeEntryRow[]) => {
    vi.mocked(redmineApi.timeEntries.preview).mockResolvedValue({
      connected: true,
      idle: true,
      baseUrl: null,
      rows,
    });
    render(<RedminePushPanel isClockedIn={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send work entries to Redmine' }));
    return screen.findAllByRole('combobox', { name: /Billable status/ });
  };

  const pick = (select: HTMLElement, label: string) => {
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: label }));
  };

  it('sends each row with the status picked for it, then shows what went', async () => {
    vi.mocked(redmineApi.timeEntries.push).mockResolvedValue({
      results: ['15', '16'].map((ticketId) => ({ ticketId, date: row.date, ok: true })),
    });
    const selects = await openWith([row, { ...row, ticketId: '16' }]);
    pick(selects[0], 'Billable');
    pick(selects[1], 'Non-billable');
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
    expect(screen.queryByRole('combobox', { name: /Billable status/ })).toBeNull();
  });

  it('holds Send, and says why, until a required status is picked', async () => {
    const [select] = await openWith([{ ...row, billable: null }]);
    const send = screen.getByRole('button', { name: /^Send 1 entry/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText(/Choose a Billable status for every entry/)).toBeTruthy();

    pick(select, 'Billable');
    expect(send.disabled).toBe(false);
  });
});
