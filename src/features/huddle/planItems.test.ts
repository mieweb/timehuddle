import { describe, expect, it } from 'vitest';
import { appendPlanItem, planTicketItem, teamTicketIdsInText, ticketIdsInText } from './planItems';

describe('planItems', () => {
  const item = planTicketItem({ id: 'tkt-1', name: 'TH-1: Fix [beta] login' });

  it('writes a ticket as an unchecked item linking its page, its name escaped', () => {
    expect(item).toBe('- [ ] [TH-1: Fix \\[beta\\] login](/app/tickets/tkt-1)');
  });

  it('starts a checklist after a paragraph and continues one at the end', () => {
    expect(appendPlanItem('', item)).toBe(item);
    expect(appendPlanItem('Today I will\n', item)).toBe(`Today I will\n\n${item}`);
    expect(appendPlanItem('- [ ] Call Pam', item)).toBe(`- [ ] Call Pam\n${item}`);
  });

  it('reads the linked ticket ids back, once each, skipping Redmine issues', () => {
    const text = [
      item,
      '- [x] [TH-2: Scrum](/app/tickets/tkt-2)',
      `- [ ] again ${item.slice(6)}`,
      '- [ ] [RMX-5](/app/tickets/redmine/5)',
    ].join('\n');
    expect(ticketIdsInText(text)).toEqual(['tkt-1', 'tkt-2']);
  });

  it('skips a link whose id is not valid URL encoding', () => {
    expect(ticketIdsInText(`[x](/app/tickets/%) ${item}`)).toEqual(['tkt-1']);
  });

  it("keeps only the team's tickets once they are known", () => {
    const text = `${item}\n- [ ] [Other](/app/tickets/elsewhere)`;
    expect(teamTicketIdsInText(text, new Set(['tkt-1']))).toEqual(['tkt-1']);
    expect(teamTicketIdsInText(text, null)).toEqual(['tkt-1', 'elsewhere']);
  });
});
