import { describe, expect, it } from 'vitest';

import { checkOffTicket, ticketLink, ticketsInText } from './planTickets';

const ID = '6adfa35627f5a9a328d436a7';
const OTHER = '6adfa35627f5a9a328d436a8';

describe('ticketLink', () => {
  it('links a ticket to its page, leading with its ID', () => {
    expect(ticketLink({ id: ID, title: 'Fix login', ref: 'TH-146' })).toBe(
      `[TH-146 Fix login](/app/tickets/${ID})`,
    );
  });
});

describe('ticketsInText', () => {
  it('reads the linked tickets, in order', () => {
    const text = `- [ ] [TH-146 Fix login](/app/tickets/${ID})\n- [ ] [TH-150 Export](/app/tickets/${OTHER})`;
    expect(ticketsInText(text)).toEqual([
      { id: ID, ref: 'TH-146', title: 'Fix login' },
      { id: OTHER, ref: 'TH-150', title: 'Export' },
    ]);
  });

  it('counts a ticket once', () => {
    const text = `[TH-146 Fix login](/app/tickets/${ID}) and again [TH-146 Fix login](/app/tickets/${ID})`;
    expect(ticketsInText(text)).toHaveLength(1);
  });

  it('accepts an absolute link', () => {
    expect(ticketsInText(`[Fix login](https://huddle.example.org/app/tickets/${ID})`)).toEqual([
      { id: ID, title: 'Fix login' },
    ]);
  });

  it('attaches nothing for an ID typed as text, or a Redmine issue’s page', () => {
    expect(ticketsInText('TH-146 is blocked by TH-150')).toEqual([]);
    expect(ticketsInText('[RM0-214 Report](/app/tickets/redmine/214)')).toEqual([]);
  });
});

describe('checkOffTicket', () => {
  const plan = `- [ ] [TH-146 Fix login](/app/tickets/${ID})\n- [ ] [TH-150 Export](/app/tickets/${OTHER})`;

  it('ticks the ticket’s item and no other', () => {
    expect(checkOffTicket(plan, ID)).toBe(
      `- [x] [TH-146 Fix login](/app/tickets/${ID})\n- [ ] [TH-150 Export](/app/tickets/${OTHER})`,
    );
  });

  it('leaves a plan without that ticket, or with it already ticked, as it was', () => {
    const done = checkOffTicket(plan, ID);
    expect(checkOffTicket(done, ID)).toBe(done);
    expect(checkOffTicket('Notes only', ID)).toBe('Notes only');
  });

  it('ticks other list markers, and leaves a link outside a checklist alone', () => {
    expect(checkOffTicket(`* [ ] [Fix login](/app/tickets/${ID})`, ID)).toBe(
      `* [x] [Fix login](/app/tickets/${ID})`,
    );
    const prose = `See [Fix login](/app/tickets/${ID}) [ ] later`;
    expect(checkOffTicket(prose, ID)).toBe(prose);
  });
});
