import { cleanup, render, screen } from '@testing-library/react';
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
});
