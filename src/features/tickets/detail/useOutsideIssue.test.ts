import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ outsideIssue: vi.fn() }));
vi.mock('../../../lib/api', () => ({
  ApiError: class extends Error {},
  outsideIssueKey: () => '',
  ticketApi: { outsideIssue: api.outsideIssue },
}));

const { useOutsideIssue } = await import('./useOutsideIssue');

/** What `tickets.outsideRecord` answers for Redmine issue `key`. */
const issueFor = (key: string) => ({
  kind: 'redmine',
  record: { ref: { server: 'redmine.example.org', key }, dates: {} },
  choices: { status: [] },
  me: null,
});

beforeEach(() => api.outsideIssue.mockReset());
afterEach(cleanup);

describe('useOutsideIssue', () => {
  it('shows the issue the ticket carries', async () => {
    api.outsideIssue.mockResolvedValue(issueFor('482'));
    const onRelinked = vi.fn();
    const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', onRelinked));

    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));
    expect(onRelinked).not.toHaveBeenCalled();
  });

  it('never shows another issue after a relink, and asks for the ticket again', async () => {
    api.outsideIssue.mockResolvedValueOnce(issueFor('482'));
    const onRelinked = vi.fn();
    const { result, rerender } = renderHook(
      ({ linkedKey }) => useOutsideIssue('t1', linkedKey, onRelinked),
      { initialProps: { linkedKey: 'redmine:482' } },
    );
    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));

    // A teammate relinked the ticket to #999; this page still names #482.
    api.outsideIssue.mockResolvedValue(issueFor('999'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.reload();
    });
    expect(ok).toBe(false);
    expect(result.current.state.kind).toBe('loading');
    expect(onRelinked).toHaveBeenCalledTimes(1);

    // The page read the ticket again: now it names #999, and shows it.
    rerender({ linkedKey: 'redmine:999' });
    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));
    expect(onRelinked).toHaveBeenCalledTimes(1);
  });
});
