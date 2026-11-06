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
  // Redmine's definition, as an administrator's key reads it: a yes/no field.
  const billableField = {
    id: 7,
    name: 'Billable status',
    required: true,
    multiple: false,
    options: [
      { value: '1', label: 'Yes' },
      { value: '0', label: 'No' },
    ],
  };

  it("picks the Billable status from Redmine's own choices, starting on the copied one", () => {
    const onBillableChange = vi.fn();
    renderCard({
      billable: { id: 7, name: 'Billable status', value: '1' },
      billableField,
      onBillableChange,
    });

    const select = screen.getByRole('combobox', { name: /Billable status/ });
    expect(select.textContent).toContain('Yes');
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: 'No' }));

    expect(onBillableChange).toHaveBeenCalledWith('0');
  });

  it('asks for a status when there is none to start on', () => {
    renderCard({ billableField, onBillableChange: vi.fn() });
    expect(screen.getByRole('combobox', { name: /Billable status/ }).textContent).toContain(
      'Choose a status',
    );
  });

  it('picks several statuses from a field that takes more than one', () => {
    const onBillableChange = vi.fn();
    renderCard({
      billableField: {
        ...billableField,
        multiple: true,
        options: [
          { value: 'Client A, Inc.', label: 'Client A, Inc.' },
          { value: 'Client B', label: 'Client B' },
        ],
      },
      billableValue: ['Client A, Inc.'],
      onBillableChange,
    });

    fireEvent.click(screen.getByRole('combobox', { name: /Billable status/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Client B' }));

    expect(onBillableChange).toHaveBeenCalledWith(['Client A, Inc.', 'Client B']);
  });

  it('states the status sent by its label once the choice is over', () => {
    renderCard({
      billableField: { ...billableField, options: [{ value: 'IM', label: 'Internal Meeting' }] },
      billableValue: 'IM',
    });
    expect(screen.getByText('Internal Meeting')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('disables the choice during a send', () => {
    renderCard({ billableField, onBillableChange: vi.fn(), disabled: true });
    expect(
      (screen.getByRole('combobox', { name: /Billable status/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("states a copied status read-only without Redmine's choices, and omits Billable when there is none", () => {
    const { unmount } = renderCard({
      billable: { id: 7, name: 'Billable', value: '1' },
      onBillableChange: vi.fn(),
    });
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
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
