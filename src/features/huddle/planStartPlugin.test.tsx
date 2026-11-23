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
  const start = vi.fn();
  const value: PlanStart = {
    postIds: new Set(['plan-post']),
    start,
    isStarting: () => false,
    busy: false,
    runningTicketId: null,
    startLabel: (title) => `Start timer for ${title}`,
    ...plan,
  };
  render(
    <PlanStartProvider value={value}>
      {renderText(PLAN, { messageId, streaming: false, role: 'user' })}
    </PlanStartProvider>,
  );
  return start;
}

describe('starting tickets from the plan post (#886)', () => {
  it('puts a start beside each ticket of the plan post but the one running', () => {
    const start = renderPost('plan-post', { runningTicketId: 't1' });
    expect(screen.queryByRole('button', { name: 'Start timer for TH-1: Alpha' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start timer for TH-2: Bravo' }));
    expect(start).toHaveBeenCalledWith('t2', 'TH-2: Bravo');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('leaves every other post’s ticket links as they were', () => {
    renderPost('another-post');
    expect(screen.getByRole('link', { name: 'TH-1: Alpha' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
