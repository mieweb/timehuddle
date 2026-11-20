import { describe, expect, it } from 'vitest';
import { PERSON_LINKS, TICKET_LINKS } from './referenceTriggers';

describe('reference links', () => {
  it('reads team tickets, not Redmine issues', () => {
    expect(TICKET_LINKS.fromHref('/app/tickets/abc123')).toBe('abc123');
    expect(TICKET_LINKS.fromHref('/app/tickets/redmine/42')).toBeNull();
    expect(TICKET_LINKS.fromHref('https://example.com/app/tickets/abc123')).toBeNull();
  });

  it('round-trips a teammate id through their profile link', () => {
    const href = PERSON_LINKS.toHref('user 1');
    expect(href).toBe('/app/profile/user%201');
    expect(PERSON_LINKS.fromHref(href)).toBe('user 1');
    expect(PERSON_LINKS.fromHref('/app/profile/%E0%A4%A')).toBeNull();
  });
});
