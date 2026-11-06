import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedmineEntryCard } from './RedmineEntryCard';

afterEach(cleanup);

const renderCard = (props: Partial<React.ComponentProps<typeof RedmineEntryCard>> = {}) =>
  render(
    <RedmineEntryCard
      ticketId="15"
      subject="Fix the clock"
      date="2026-10-29"
      hours={4.75}
      decimalHours={false}
      onToggleHours={() => {}}
      {...props}
    />,
  );

describe('RedmineEntryCard rounding', () => {
  it('says nothing about rounding for an entry sent exact', () => {
    renderCard({ rounding: null });
    expect(screen.queryByText('Rounding')).toBeNull();
  });

  it('states the time worked beside the rounded hours sent', () => {
    renderCard({ rounding: { step: 15, exactHours: 4.7 } });
    expect(screen.getByText('4:42 worked, rounded up to 15 min')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^4:45 on issue 15/ })).toBeTruthy();
  });

  it('says under a minute, not 0:00, for a few seconds rounded up', () => {
    renderCard({ hours: 0.25, rounding: { step: 15, exactHours: 0 } });
    expect(screen.getByText('Under a minute worked, rounded up to 15 min')).toBeTruthy();
  });
});

describe('RedmineEntryCard', () => {
  it('lets the user edit a discovered Billable status without changing its field identity', () => {
    const billable = { id: 7, name: 'Billable status', value: 'Internal Meeting' };
    const onBillableChange = vi.fn();
    renderCard({ billable, onBillableChange });

    fireEvent.change(screen.getByRole('textbox', { name: billable.name }), {
      target: { value: 'Billable' },
    });

    expect(onBillableChange).toHaveBeenCalledWith('Billable');
    expect(billable.value).toBe('Internal Meeting');
  });

  it('preserves multiple statuses, including commas within a status', () => {
    const onBillableChange = vi.fn();
    renderCard({
      billable: { id: 7, name: 'Billable', value: ['Client A, Inc.', 'Client B'] },
      onBillableChange,
    });
    const input = screen.getByRole('textbox', { name: 'Billable' });
    expect((input as HTMLTextAreaElement).value).toBe('Client A, Inc.\nClient B');
    fireEvent.change(input, { target: { value: 'Client C\nClient A, Inc.' } });
    expect(onBillableChange).toHaveBeenCalledWith(['Client C', 'Client A, Inc.']);
  });

  it('disables editing during a send', () => {
    renderCard({
      billable: { id: 7, name: 'Billable', value: '0' },
      onBillableChange: vi.fn(),
      disabled: true,
    });
    expect((screen.getByRole('textbox', { name: 'Billable' }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it('keeps result cards read-only and omits Billable when no field was discovered', () => {
    const { unmount } = renderCard({ billable: { id: 7, name: 'Billable', value: '1' } });
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    unmount();
    renderCard({ onBillableChange: vi.fn() });
    expect(screen.queryByText('Billable')).toBeNull();
  });

  it('lists each timer run behind a collapsed row', () => {
    renderCard({ runSeconds: [60, 90] });
    const toggle = screen.getByRole('button', { name: 'Adds up 2 timer runs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Run 1')).toBeTruthy();
    expect(screen.getByText('00:01:00')).toBeTruthy();
    expect(screen.getByText('Run 2')).toBeTruthy();
    expect(screen.getByText('00:01:30')).toBeTruthy();
  });

  it.each([[[60]], [undefined]])('says nothing for a single run (%s)', (runSeconds) => {
    renderCard({ runSeconds });
    expect(screen.queryByText(/timer run/)).toBeNull();
  });
});
