/** An item of today's plan as the text gives it: a ticket, or a checklist line. */
export type PlanItemInput = { ticketId: string } | { text: string; checked: boolean };

export declare function linkedIds(text: string, pattern: RegExp): string[];
export declare function ticketIdsInText(text: string): string[];
export declare function planChecklist(
  text: string,
  isTeamTicket?: (ticketId: string) => boolean,
): PlanItemInput[];
export declare function planTicketsAsChecklist(
  text: string,
  isTeamTicket?: (ticketId: string) => boolean,
): string;
export declare function withChecks(
  text: string,
  checkedOf: (item: { ticketId: string } | { text: string }) => boolean | undefined,
): string;
