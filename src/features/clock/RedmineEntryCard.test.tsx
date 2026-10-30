import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RedmineEntryCard } from './RedmineEntryCard';

afterEach(cleanup);

const renderCard = (timerRuns?: number) =>
  render(
    <RedmineEntryCard
      ticketId="445"
      subject="Fix the thing"
      date="2026-10-30"
      hours={0.08}
      decimalHours={false}
      onToggleHours={() => {}}
      timerRuns={timerRuns}
    />,
  );

describe('RedmineEntryCard', () => {
  it('says how many timer runs an entry adds up', () => {
    renderCard(5);
    expect(screen.getByText('Adds up 5 timer runs')).toBeTruthy();
  });

  it.each([1, undefined])('says nothing for a single run (%s)', (timerRuns) => {
    renderCard(timerRuns);
    expect(screen.queryByText(/timer run/)).toBeNull();
  });
});
