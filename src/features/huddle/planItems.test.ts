import { describe, expect, it } from 'vitest';
import {
  appendPlanItem,
  appendPlanTickets,
  editedTicketIds,
  planChecklist,
  planItemWords,
  planMarkdown,
  planTicketItem,
  planTicketName,
  teamTicketIdsInText,
  ticketIdsInText,
} from './planItems';

describe('planItems', () => {
  const item = planTicketItem({ id: 'tkt-1', name: 'TH-1: Fix [beta] login' });

  it('writes a ticket as a link to its page, no checkbox, its name escaped', () => {
    expect(item).toBe('[TH-1: Fix \\[beta\\] login](/app/tickets/tkt-1)');
  });

  it('appends plan tickets in order, each once, skipping ones the text already links', () => {
    const tickets = [
      { id: 'tkt-1', name: 'TH-1: Fix [beta] login' },
      { id: 'tkt-2', name: 'TH-2: Docs' },
      { id: 'tkt-3', name: 'TH-3: Tests' },
      { id: 'tkt-2', name: 'TH-2: Docs' },
    ];
    const ticket2 = planTicketItem(tickets[1]);
    const ticket3 = planTicketItem(tickets[2]);
    expect(appendPlanTickets('', tickets)).toBe(`${item}\n\n${ticket2}\n\n${ticket3}`);
    expect(appendPlanTickets(`Review\n\n${ticket2}`, tickets)).toBe(
      `Review\n\n${ticket2}\n\n${item}\n\n${ticket3}`,
    );
  });

  it('names a ticket by the ID My Board shows: its outside one, else its own', () => {
    const naming = {
      ticketPrefix: 'TH',
      sourcePrefixes: [{ host: 'redmine.example.com', prefix: 'RMX' }],
    };
    const own = { id: 'tkt-7', title: 'Fix login', number: 7 };
    expect(planTicketName(own, naming)).toBe('TH-7: Fix login');
    const onGitHub = { ...own, github: 'https://github.com/mieweb/timehuddle/issues/717' };
    expect(planTicketName(onGitHub, naming)).toBe('timehuddle-717: Fix login');
    expect(planTicketName({ ...onGitHub, linkIsIssue: false }, naming)).toBe('TH-7: Fix login');
    const onRedmine = {
      ...own,
      linkedIssue: { source: 'redmine' as const, id: '150', host: 'redmine.example.com' },
    };
    expect(planTicketName(onRedmine, naming)).toBe('RMX-150: Fix login');
  });

  it('adds a ticket on its own line', () => {
    expect(appendPlanItem('', item)).toBe(item);
    expect(appendPlanItem('Today I will\n', item)).toBe(`Today I will\n\n${item}`);
    expect(appendPlanItem('- [ ] Call Pam', item)).toBe(`- [ ] Call Pam\n\n${item}`);
  });

  it('reads the linked ticket ids back, once each, skipping Redmine issues', () => {
    const text = [
      item,
      '- [x] [TH-2: Scrum](/app/tickets/tkt-2)',
      `- [ ] again ${item}`,
      '- [ ] [RMX-5](/app/tickets/redmine/5)',
    ].join('\n');
    expect(ticketIdsInText(text)).toEqual(['tkt-1', 'tkt-2']);
  });

  it('ignores ticket links quoted in code or used as an image', () => {
    const quoted = [
      '`[a](/app/tickets/in-code)`',
      '```\n[b](/app/tickets/in-fence)\n```',
      '![shot](/app/tickets/as-image)',
      item,
    ].join('\n');
    expect(ticketIdsInText(quoted)).toEqual(['tkt-1']);
  });

  it('skips a link whose id is not valid URL encoding', () => {
    expect(ticketIdsInText(`[x](/app/tickets/%) ${item}`)).toEqual(['tkt-1']);
  });

  it('on edit, keeps picked tickets and follows the links', () => {
    const team = new Set(['tkt-1', 'tkt-2', 'picked']);
    const added = '- [ ] [TH-2](/app/tickets/tkt-2)';
    // tkt-1's link was deleted, tkt-2's added; `picked` was never a link.
    expect(editedTicketIds(['picked', 'tkt-1'], item, added, team)).toEqual(['picked', 'tkt-2']);
  });

  it("keeps only the team's tickets", () => {
    const text = `${item}\n- [ ] [Other](/app/tickets/elsewhere)`;
    expect(teamTicketIdsInText(text, new Set(['tkt-1']))).toEqual(['tkt-1']);
  });
});

describe("today's plan as items (#886)", () => {
  it('writes items back as the text the plan editor opens on, which reads back the same', () => {
    const items = [
      { ticketId: 't1', title: 'TH-1: Alpha' },
      { text: 'Call Pam', checked: false },
      { text: 'Lunch', checked: true },
      { ticketId: 't2', title: 'TH-2: Bravo' },
    ];
    const text = planMarkdown(items);
    expect(text).toBe(
      '[TH-1: Alpha](/app/tickets/t1)\n\n- [ ] Call Pam\n- [x] Lunch\n\n[TH-2: Bravo](/app/tickets/t2)',
    );
    expect(planChecklist(text)).toEqual([
      { ticketId: 't1' },
      { text: 'Call Pam', checked: false },
      { text: 'Lunch', checked: true },
      { ticketId: 't2' },
    ]);
  });

  it('shows a picked mention in a checklist line by its name', () => {
    expect(planItemWords('Call [@Pam \\[PT\\]](/app/profile/u1) now')).toBe('Call @Pam [PT] now');
  });
});
