import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedmineSuggestions } from './RedmineSuggestions';

vi.mock('../../../lib/device', () => ({ isNativeApp: () => true }));
vi.mock('@mieweb/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mieweb/ui')>()),
  useToast: () => ({ toast: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../lib/TeamContext', () => ({
  useTeam: () => ({ allTeams: [], selectedTeamId: 'team1' }),
}));
vi.mock('../../../ui/router', () => ({ useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock('./useRedmineSuggestions', () => ({
  invalidateSuggestionsCache: vi.fn(),
  useRedmineSuggestions: () => ({
    suggestions: { status: 'idle', issues: [], partial: false },
    search: { status: 'idle' },
    loadSuggestions: vi.fn(),
    retrySuggestions: vi.fn(),
    retrySearch: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock('./useTicketSearch', () => ({
  useTicketSearch: () => ({ tickets: [], settled: true, kind: null }),
}));
vi.mock('./useSourceSearch', () => ({
  useSourceSearch: () => ({ servers: [], settled: true, noteTicket: vi.fn() }),
}));

afterEach(cleanup);

function Harness() {
  const [query, setQuery] = useState('');
  return (
    <>
      <RedmineSuggestions
        userId="u1"
        query={query}
        onQueryChange={setQuery}
        baseUrl={null}
        runningIssueId={null}
        onToggleTimer={vi.fn()}
        runningTicketKey={null}
        onToggleTicketTimer={vi.fn()}
        boardIssueIds={new Set()}
        boardKnown
        onToggleBoard={vi.fn()}
        boardKeys={new Set()}
        onToggleTicketBoard={vi.fn()}
      />
      <button type="button">outside</button>
    </>
  );
}

describe('ticket search in the app', () => {
  it('opens full screen with its field focused, and only Cancel closes it', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('textbox', { name: /Search tickets/ }));
    const sheet = screen.getByRole('dialog', { name: /Search tickets/ });
    const field = screen.getByRole('combobox', { name: /Search tickets/ });
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: 'login' } });
    // Leaving the field or touching outside it keeps the search open.
    fireEvent.blur(field);
    fireEvent.mouseDown(screen.getByText('outside'));
    fireEvent.touchEnd(screen.getByText('outside'));
    expect(sheet.hidden).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Focus goes back to the bar the search was opened from.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Search tickets/ }));
    expect(
      (screen.getByRole('textbox', { name: /Search tickets/ }) as HTMLInputElement).value,
    ).toBe('');
  });
});
