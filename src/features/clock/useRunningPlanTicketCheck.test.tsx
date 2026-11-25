import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionPlan } from '../../lib/api';
import { type RunningTicketAnswer, useRunningPlanTicketCheck } from './useRunningPlanTicketCheck';

afterEach(cleanup);

const planWith = (runningSince: number | null, checked = false): SessionPlan => ({
  clockEventId: 'ev1',
  initialized: true,
  items: [{ id: 'a', ticketId: 't1', title: 'TH-1: Alpha', checked, seconds: 0, runningSince }],
});

function Harness({
  plan,
  setChecked,
  onAnswer,
}: {
  plan: SessionPlan;
  setChecked: (itemId: string, checked: boolean) => Promise<void>;
  onAnswer: (answer: RunningTicketAnswer) => void;
}) {
  const { confirmClockOut, prompt } = useRunningPlanTicketCheck({ plan, setChecked }, null);
  return (
    <>
      <button onClick={() => void confirmClockOut().then(onAnswer)}>clock out</button>
      {prompt}
    </>
  );
}

describe('clocking out with a plan ticket running (#887)', () => {
  it('goes on without asking when no plan ticket is running', async () => {
    const onAnswer = vi.fn();
    render(<Harness plan={planWith(null)} setChecked={vi.fn()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('clock out'));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ proceed: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('checks the running ticket off before going on', async () => {
    const setChecked = vi.fn().mockResolvedValue(undefined);
    const onAnswer = vi.fn();
    render(<Harness plan={planWith(1)} setChecked={setChecked} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('clock out'));
    fireEvent.click(await screen.findByRole('button', { name: 'Check it off' }));
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({
        proceed: true,
        ticket: { ticketId: 't1', checked: true },
      }),
    );
    expect(setChecked).toHaveBeenCalledWith('a', true);
  });

  it('keeps it for the next session, unchecking one checked by hand', async () => {
    const setChecked = vi.fn().mockResolvedValue(undefined);
    const onAnswer = vi.fn();
    render(<Harness plan={planWith(1, true)} setChecked={setChecked} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('clock out'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep for next session' }));
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({
        proceed: true,
        ticket: { ticketId: 't1', checked: false },
      }),
    );
    expect(setChecked).toHaveBeenCalledWith('a', false);
  });

  it('stays open and does not clock out when the check cannot be saved', async () => {
    const setChecked = vi.fn().mockRejectedValue(new Error('offline'));
    const onAnswer = vi.fn();
    render(<Harness plan={planWith(1)} setChecked={setChecked} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('clock out'));
    fireEvent.click(await screen.findByRole('button', { name: 'Check it off' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
