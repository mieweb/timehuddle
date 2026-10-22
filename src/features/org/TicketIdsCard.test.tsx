import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TicketIdsCard } from './TicketIdsCard';

vi.mock('../../lib/TeamContext', () => ({
  useTeam: () => ({ refetchTeams: vi.fn(), refetchOrganizations: vi.fn() }),
}));
vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  orgApi: { setTicketPrefix: vi.fn(), setSourcePrefixes: vi.fn() },
}));

afterEach(cleanup);

const servers = () => [{ host: 'redmine.example.com', prefix: 'PM' }];
const prefixField = () => screen.getByLabelText('Ticket prefix') as HTMLInputElement;
const hostField = () => screen.getByLabelText('Server address, row 1') as HTMLInputElement;

describe('TicketIdsCard', () => {
  it('keeps unsaved edits when the same org is reloaded with equal values (#689)', () => {
    const { rerender } = render(
      <TicketIdsCard orgId="org-a" ticketPrefix="TH" sourcePrefixes={servers()} />,
    );
    fireEvent.change(prefixField(), { target: { value: 'TJ' } });
    fireEvent.change(hostField(), { target: { value: 'tracker.example.com' } });

    // A member change elsewhere reloads the org: equal values, new arrays.
    rerender(<TicketIdsCard orgId="org-a" ticketPrefix="TH" sourcePrefixes={servers()} />);
    expect(prefixField().value).toBe('TJ');
    expect(hostField().value).toBe('tracker.example.com');
  });

  it('takes a new value into an editor with no unsaved edits', () => {
    const { rerender } = render(
      <TicketIdsCard orgId="org-a" ticketPrefix="TH" sourcePrefixes={servers()} />,
    );
    rerender(
      <TicketIdsCard
        orgId="org-a"
        ticketPrefix="TX"
        sourcePrefixes={[{ host: 'other.example.com', prefix: 'OX' }]}
      />,
    );
    expect(prefixField().value).toBe('TX');
    expect(hostField().value).toBe('other.example.com');
  });

  it('starts afresh for another org, dropping unsaved edits', () => {
    const { rerender } = render(
      <TicketIdsCard orgId="org-a" ticketPrefix="TH" sourcePrefixes={servers()} />,
    );
    fireEvent.change(prefixField(), { target: { value: 'TJ' } });
    fireEvent.change(hostField(), { target: { value: 'tracker.example.com' } });

    rerender(<TicketIdsCard orgId="org-b" ticketPrefix="TH" sourcePrefixes={servers()} />);
    expect(prefixField().value).toBe('TH');
    expect(hostField().value).toBe('redmine.example.com');
  });
});
