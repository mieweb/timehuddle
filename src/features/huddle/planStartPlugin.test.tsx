import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMarkdownRenderer } from '@mieweb/ui/components/SuperChat';
import { createReferencesPlugin } from '@mieweb/ui/components/SuperChat/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanStartProvider, withPlanStart, type PlanStart } from './planStartPlugin';
import { PERSON_LINKS, TICKET_LINKS } from './referenceTriggers';

afterEach(cleanup);

const renderText = createMarkdownRenderer({
  plugins: [withPlanStart(createReferencesPlugin({ triggers: [PERSON_LINKS, TICKET_LINKS] }))],
});
const PLAN =
  '[TH-1: Alpha](/app/tickets/t1)\n\n[TH-2: Bravo](/app/tickets/t2)\n\n[@Pam](/app/profile/u1)';

function renderPost(messageId: string, plan: Partial<PlanStart> = {}) {
  const toggle = vi.fn();
  const value: PlanStart = {
    postIds: new Set(['plan-post']),
    toggle,
    isBusy: () => false,
    busy: false,
    running: null,
    startLabel: (title) => `Start timer for ${title}`,
    stopLabel: (title) => `Stop timer for ${title}`,
    ...plan,
  };
  render(
    <PlanStartProvider value={value}>
      {renderText(PLAN, { messageId, streaming: false, role: 'user' })}
    </PlanStartProvider>,
  );
  return toggle;
}

describe('starting tickets from the plan post (#886)', () => {
  it('puts a timer in front of each ticket of the plan post; the running one stops, with its time', () => {
    const toggle = renderPost('plan-post', {
      running: { ticketId: 't1', since: Date.now() - 65_000 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop timer for TH-1: Alpha' }));
    expect(screen.getByText('00:01:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start timer for TH-2: Bravo' }));
    expect(toggle.mock.calls).toEqual([
      ['t1', 'TH-1: Alpha'],
      ['t2', 'TH-2: Bravo'],
    ]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('leaves every other post’s ticket links as they were', () => {
    renderPost('another-post');
    expect(screen.getByRole('link', { name: 'TH-1: Alpha' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
