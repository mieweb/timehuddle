import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTeamMembers } from './api';
import { detectGroupMentions, detectMentions, useTeamMentions } from './useTeamMentions';

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

  it('returns nothing without a team', () => {
    const { result } = renderHook(() => useTeamMentions(null));
    expect(result.current.options).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('survives a roster fetch failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTeamMentions('team-1'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current.options).toEqual([]);
  });

  it('reads the roster again after a failed load, sharing a read in flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTeamMentions('team-1'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await expect(result.current.loadRoster()).resolves.toEqual([]);

    mockFetch.mockResolvedValue(roster);
    const first = result.current.loadRoster();
    expect(result.current.loadRoster()).toBe(first);
    await expect(first).resolves.toEqual(roster);
    await waitFor(() => expect(result.current.options).toHaveLength(3));
  });

  it('keeps the current team’s roster when the previous team’s answers late', async () => {
    let answerTeamOne: (members: typeof roster) => void = () => {};
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => (answerTeamOne = resolve)));
    mockFetch.mockResolvedValueOnce([roster[0]]);
    const { result, rerender } = renderHook(({ teamId }) => useTeamMentions(teamId), {
      initialProps: { teamId: 'team-1' },
    });
    rerender({ teamId: 'team-2' });
    await waitFor(() => expect(result.current.options).toHaveLength(1));

    answerTeamOne(roster);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.options).toEqual([{ id: 'u1', label: 'Priya Sharma' }]);
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
  });
});

describe('detectMentions', () => {
  it('resolves a teammate by first name', () => {
    expect(detectMentions('can you look at this @Priya', roster)).toEqual(['u1']);
  });

  it('matches case-insensitively and ignores surrounding punctuation', () => {
    expect(detectMentions('(@priya) and @Bob, thanks', roster)).toEqual(['u1', 'u2']);
  });

  it('does not match a longer name that merely starts with the token', () => {
    // '@Bob' must not also fire 'Bobby', and '@Bobby' must not fire 'Bob'.
    expect(detectMentions('@Bobby please', roster)).toEqual(['u3']);
  });

  it('ignores an email address rather than reading it as a mention', () => {
    expect(detectMentions('mail priya@bob.com', roster)).toEqual([]);
  });

  it('leaves a first name two teammates share unresolved rather than tagging both', () => {
    const shared = [
      ...roster,
      { id: 'u4', name: 'Priya Patel', email: 'pp@x.com', username: null, image: null },
    ];
    expect(detectMentions('@Priya and @Bob', shared)).toEqual(['u2']);
  });
});

describe('group mentions', () => {
  it('finds @team and @here as whole words, any case', () => {
    expect(detectGroupMentions('Standup in 5 @team')).toEqual(['team']);
    expect(detectGroupMentions('@HERE anyone free?')).toEqual(['here']);
    expect(detectGroupMentions('@team and @here')).toEqual(['team', 'here']);
  });

  it('ignores longer words and email addresses', () => {
    expect(detectGroupMentions('@teamwork and ops@team.com')).toEqual([]);
  });

  it('reads a teammate’s profile link as that person, not the group', () => {
    expect(detectGroupMentions('[@Team Support](/app/profile/u9) and @here')).toEqual(['here']);
  });
});
