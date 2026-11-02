import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { orgApi } from '../../lib/api';
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

  it("saves each server's rounding with the rest of the server", async () => {
    vi.mocked(orgApi.setSourcePrefixes).mockResolvedValue([]);
    render(
      <TicketIdsCard
        orgId="org-a"
        ticketPrefix="TH"
        sourcePrefixes={[{ host: 'redmine.example.com', prefix: 'PM', rounding: 'up10' }]}
      />,
    );
    fireEvent.change(hostField(), { target: { value: 'tracker.example.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(orgApi.setSourcePrefixes).toHaveBeenCalledWith('org-a', [
      { host: 'tracker.example.com', prefix: 'PM', type: 'redmine', rounding: 'up10' },
    ]);
  });
});
