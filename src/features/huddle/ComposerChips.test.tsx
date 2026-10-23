import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerChips } from './ComposerAttachments';
import type { TicketRef } from './useTicketSelection';

afterEach(cleanup);

function renderChips(selectedTickets: TicketRef[], onTicketRemove = vi.fn()) {
  render(
    <ComposerChips
      selectedTickets={selectedTickets}
      onTicketRemove={onTicketRemove}
      mentions={[]}
      onMentionRemove={() => {}}
      attachments={[]}
      onAttachmentRemove={() => {}}
    />,
  );
  return onTicketRemove;
}

describe('ComposerChips — ticket chips', () => {
  it('names each ticket by its title, with the full title on hover', () => {
    renderChips([{ id: 'abc123', title: 'Fix the login redirect' }]);

    expect(screen.getByText('Fix the login redirect')).toHaveProperty(
      'title',
      'Fix the login redirect',
    );
    expect(screen.queryByText(/abc123/)).toBeNull();
  });

  it('labels the remove button with the title and removes by id', () => {
    const onTicketRemove = renderChips([{ id: 'abc123', title: 'Fix the login redirect' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove ticket Fix the login redirect' }));
    expect(onTicketRemove).toHaveBeenCalledWith('abc123');
  });

  it('falls back to the id when the title is unknown', () => {
    renderChips([
      { id: 'gone1', title: null },
      { id: 'gone2', title: '  ' },
    ]);

    expect(screen.getByText('Ticket #gone1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove ticket Ticket #gone2' })).toBeTruthy();
  });
});
