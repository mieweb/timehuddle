import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RedmineEntryCard } from './RedmineEntryCard';

afterEach(cleanup);

const renderCard = (runSeconds?: number[]) =>
  render(
    <RedmineEntryCard
      ticketId="445"
      subject="Fix the thing"
      date="2026-10-30"
      hours={0.08}
      decimalHours={false}
      onToggleHours={() => {}}
      runSeconds={runSeconds}
    />,
  );

describe('RedmineEntryCard', () => {
  it('lists each timer run behind a collapsed row', () => {
    renderCard([60, 90]);
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
    renderCard(runSeconds);
    expect(screen.queryByText(/timer run/)).toBeNull();
  });
});
