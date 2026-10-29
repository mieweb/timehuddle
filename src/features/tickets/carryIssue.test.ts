import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, ticketApi } from '../../lib/api';

import { NoTeamError, carriedKey } from './carryIssue';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ApiError: actual.ApiError, ticketApi: { carryIssue: vi.fn() } };
});

const carryIssue = vi.mocked(ticketApi.carryIssue);

beforeEach(() => {
  vi.resetAllMocks();
  carryIssue.mockResolvedValue({ ticket: { id: 'carrier1' }, created: false } as never);
});

describe('carriedKey (#736)', () => {
  it('turns a Redmine issue into the ticket carrying it in the team', async () => {
    await expect(carriedKey('redmine:482', 'team1')).resolves.toBe('huddle:carrier1');
    expect(carryIssue).toHaveBeenCalledWith('team1', '482');
  });

  it('leaves a TimeHuddle ticket as it is', async () => {
    await expect(carriedKey('huddle:abc', 'team1')).resolves.toBe('huddle:abc');
    expect(carryIssue).not.toHaveBeenCalled();
  });

  it('needs a team for a Redmine issue', async () => {
    await expect(carriedKey('redmine:482', null)).rejects.toBeInstanceOf(NoTeamError);
    expect(carryIssue).not.toHaveBeenCalled();
  });

  it('passes a refusal on', async () => {
    carryIssue.mockRejectedValue(new ApiError('gone', 404, 'issue-unavailable'));
    await expect(carriedKey('redmine:482', 'team1')).rejects.toThrow('gone');
  });
});
