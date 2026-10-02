import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTeamMembers } from './api';
import { useTeamMentions } from './useTeamMentions';

vi.mock('./api', () => ({ fetchTeamMembers: vi.fn() }));

const mockFetch = vi.mocked(fetchTeamMembers);

const roster = [
  { id: 'u1', name: 'Priya Sharma', email: 'p@x.com', username: null, image: null },
  { id: 'u2', name: 'Bob Loblaw', email: 'b@x.com', username: null, image: null },
  { id: 'u3', name: 'Bobby Tables', email: 'bt@x.com', username: null, image: null },
];

async function renderWithRoster() {
  mockFetch.mockResolvedValue(roster);
  const hook = renderHook(() => useTeamMentions('team-1'));
  await waitFor(() => expect(hook.result.current.options).toHaveLength(3));
  return hook;
}

describe('useTeamMentions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers every team member as a suggestion, not just thread participants', async () => {
    const { result } = await renderWithRoster();
    expect(result.current.options).toEqual([
      { id: 'u1', label: 'Priya Sharma' },
      { id: 'u2', label: 'Bob Loblaw' },
      { id: 'u3', label: 'Bobby Tables' },
    ]);
  });

  it('resolves a mention of a teammate who has never posted in the thread', async () => {
    const { result } = await renderWithRoster();
    expect(result.current.detect('can you look at this @Priya')).toEqual(['u1']);
  });

  it('matches case-insensitively and ignores surrounding punctuation', async () => {
    const { result } = await renderWithRoster();
    expect(result.current.detect('(@priya) and @Bob, thanks')).toEqual(['u1', 'u2']);
  });

  it('does not match a longer name that merely starts with the token', async () => {
    const { result } = await renderWithRoster();
    // '@Bob' must not also fire 'Bobby', and '@Bobby' must not fire 'Bob'.
    expect(result.current.detect('@Bobby please')).toEqual(['u3']);
  });

  it('ignores an email address rather than reading it as a mention', async () => {
    const { result } = await renderWithRoster();
    expect(result.current.detect('mail priya@bob.com')).toEqual([]);
  });

  it('leaves a first name two teammates share unresolved rather than tagging both', async () => {
    mockFetch.mockResolvedValue([
      ...roster,
      { id: 'u4', name: 'Priya Patel', email: 'pp@x.com', username: null, image: null },
    ]);
    const { result } = renderHook(() => useTeamMentions('team-1'));
    await waitFor(() => expect(result.current.options).toHaveLength(4));
    expect(result.current.detect('@Priya and @Bob')).toEqual(['u2']);
  });

  it('returns nothing without a team', () => {
    const { result } = renderHook(() => useTeamMentions(null));
    expect(result.current.options).toEqual([]);
    expect(result.current.detect('@Priya')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('survives a roster fetch failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTeamMentions('team-1'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current.options).toEqual([]);
  });

  it('drops the previous team’s roster as soon as the team changes', async () => {
    mockFetch.mockResolvedValueOnce(roster);
    mockFetch.mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ teamId }) => useTeamMentions(teamId), {
      initialProps: { teamId: 'team-1' },
    });
    await waitFor(() => expect(result.current.options).toHaveLength(3));

    rerender({ teamId: 'team-2' });
    expect(result.current.options).toEqual([]);
    expect(result.current.detect('@Priya')).toEqual([]);
  });
});
