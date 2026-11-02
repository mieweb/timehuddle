import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
