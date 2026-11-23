import { describe, expect, it } from 'vitest';

import { planChecklist, ticketIdsInText } from './index.js';

const PLAN = [
  'Today I will:',
  '',
  '[TH-1: Alpha](/app/tickets/t1)',
  '',
  '- [ ] Call [@Pam](/app/profile/u1)',
  '- [x] Lunch',
  '- [ ] Review [TH-2: Bravo](/app/tickets/t2) with Ann',
  '',
  '```',
  '- [ ] not an item [TH-9](/app/tickets/t9)',
  '```',
  '[TH-1: Alpha](/app/tickets/t1)',
].join('\n');

describe('planChecklist (#886)', () => {
  it('reads each linked ticket once and each checklist line, in order; prose is no item', () => {
    expect(planChecklist(PLAN)).toEqual([
      { ticketId: 't1' },
      { text: 'Call [@Pam](/app/profile/u1)', checked: false },
      { text: 'Lunch', checked: true },
      { ticketId: 't2' },
    ]);
  });

  it("keeps a checklist line whose only ticket is another team's, as text", () => {
    const ours = (id: string) => id === 't1';
    expect(planChecklist(PLAN, ours)).toEqual([
      { ticketId: 't1' },
      { text: 'Call [@Pam](/app/profile/u1)', checked: false },
      { text: 'Lunch', checked: true },
      { text: 'Review [TH-2: Bravo](/app/tickets/t2) with Ann', checked: false },
    ]);
  });
});

describe('ticketIdsInText', () => {
  it('reads ticket links, not Redmine issues or links quoted as code', () => {
    expect(
      ticketIdsInText('[a](/app/tickets/t1) [b](/app/tickets/redmine/5) `[c](/app/tickets/t3)`'),
    ).toEqual(['t1']);
  });
});
