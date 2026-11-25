import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionPlan } from '../../lib/api';
import { usePlanTicketStart } from './usePlanTicketStart';

const start = vi.fn().mockResolvedValue('started');
vi.mock('../timers/TicketStartProvider', () => ({
  useTicketStart: () => ({ start, stop: vi.fn(), busyKey: null }),
}));
vi.mock('../../lib/useSession', () => ({ useSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('../tickets/useMyBoardKeys', () => ({
  useMyBoardKeys: () => ({ boardKeys: new Set<string>() }),
}));

afterEach(() => {
  cleanup();
  start.mockClear();
});

const plan: SessionPlan = {
  clockEventId: 'ev1',
  initialized: true,
  items: [
    {
      id: 'a',
      ticketId: 't1',
      title: 'TH-1: Alpha',
      checked: false,
      seconds: 0,
      runningSince: null,
    },
    { id: 'b', text: 'Lunch', checked: true },
  ],
};

function Harness({ setItems }: { setItems: (items: unknown[]) => Promise<void> }) {
  const { togglePlanTicket, addBackPrompt } = usePlanTicketStart(null, { plan, setItems });
  return (
    <>
      <button onClick={() => togglePlanTicket('t1', 'TH-1: Alpha')}>alpha</button>
      <button onClick={() => togglePlanTicket('t9', 'TH-9: Gone')}>gone</button>
      {addBackPrompt}
    </>
  );
}

describe('starting a ticket taken out of today’s plan (#886)', () => {
  it('starts a ticket in the plan straight away', () => {
    render(<Harness setItems={vi.fn()} />);
    fireEvent.click(screen.getByText('alpha'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks first, and adds it back to the end of the plan before starting', async () => {
    const setItems = vi.fn().mockResolvedValue(undefined);
    render(<Harness setItems={setItems} />);
    fireEvent.click(screen.getByText('gone'));
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Add back and start' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(setItems).toHaveBeenCalledWith([
      { ticketId: 't1' },
      { text: 'Lunch', checked: true },
      { ticketId: 't9' },
    ]);
  });

  it('can just start it, leaving the plan as it is', async () => {
    const setItems = vi.fn();
    render(<Harness setItems={setItems} />);
    fireEvent.click(screen.getByText('gone'));
    fireEvent.click(await screen.findByRole('button', { name: 'Just start' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(setItems).not.toHaveBeenCalled();
  });
});
