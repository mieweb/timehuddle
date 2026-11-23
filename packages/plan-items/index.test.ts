import { describe, expect, it } from 'vitest';

import { planChecklist, planTicketsAsChecklist, ticketIdsInText, withChecks } from './index.js';

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

describe('planTicketsAsChecklist (#886)', () => {
  const t = (id: string) => `[TH-${id}: T${id}](/app/tickets/t${id})`;

  it('makes each ticket a checklist line; a line of tickets alone splits; prose stays', () => {
    const text = [
      'Today:',
      '',
      `${t('1')} ${t('2')}`,
      '',
      `Review ${t('3')} with Ann`,
      '- [ ] Lunch',
    ].join('\n');
    expect(planTicketsAsChecklist(text)).toBe(
      [
        'Today:',
        '',
        `- [ ] ${t('1')}`,
        `- [ ] ${t('2')}`,
        '',
        `- [ ] Review ${t('3')} with Ann`,
        '- [ ] Lunch',
      ].join('\n'),
    );
  });

  it("leaves another team's ticket as written, and code alone", () => {
    const text = [`${t('1')} ${t('9')}`, '```', t('1'), '```'].join('\n');
    expect(planTicketsAsChecklist(text, (id) => id !== 't9')).toBe(
      [`- [ ] ${t('1')}`, t('9'), '```', t('1'), '```'].join('\n'),
    );
  });

  it('reads back as the same items', () => {
    expect(planChecklist(planTicketsAsChecklist(`${t('1')} ${t('2')}`))).toEqual([
      { ticketId: 't1' },
      { ticketId: 't2' },
    ]);
  });
});

describe('withChecks (#886)', () => {
  it('sets each checklist box from the plan, and leaves the rest', () => {
    const text = '- [ ] [TH-1](/app/tickets/t1)\n- [x] Lunch\n- [ ] Other\nWrap-up';
    const plan: Record<string, boolean> = { t1: true, Lunch: false };
    expect(
      withChecks(text, (item) => ('ticketId' in item ? plan[item.ticketId] : plan[item.text])),
    ).toBe('- [x] [TH-1](/app/tickets/t1)\n- [ ] Lunch\n- [ ] Other\nWrap-up');
  });
});
