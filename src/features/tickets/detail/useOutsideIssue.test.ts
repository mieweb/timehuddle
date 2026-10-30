import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ outsideIssue: vi.fn() }));
/** As the real one: a failed call's Meteor.Error code rides on `code`. */
const ApiError = vi.hoisted(
  () =>
    class extends Error {
      readonly code?: string;
      constructor(message: string, _status: number, code?: string) {
        super(message);
        this.code = code;
      }
    },
);
vi.mock('../../../lib/api', () => ({
  ApiError,
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

// A block body: an arrow returning the mock would hand vitest a teardown, which
// it calls after the test, and a rejecting mock would then fail it.
beforeEach(() => {
  api.outsideIssue.mockReset();
});
afterEach(cleanup);

describe('useOutsideIssue', () => {
  it('shows the issue the ticket carries', async () => {
    api.outsideIssue.mockResolvedValue(issueFor('482'));
    const onRelinked = vi.fn();
    const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', onRelinked));

    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));
    expect(onRelinked).not.toHaveBeenCalled();
  });

  it('asks for the ticket again when a teammate has unlinked the issue', async () => {
    api.outsideIssue.mockResolvedValueOnce(issueFor('482'));
    const onRelinked = vi.fn();
    const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', onRelinked));
    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));

    api.outsideIssue.mockImplementation(() =>
      Promise.reject(new ApiError('gone', 400, 'not-linked')),
    );
    await act(() => result.current.reload());

    expect(result.current.state.kind).toBe('loading');
    expect(onRelinked).toHaveBeenCalledOnce();
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

  it.each(['not-connected', 'other-server', 'invalid-key', 'gone'])(
    'is denied when the viewer’s key answers %s (#788)',
    async (code) => {
      api.outsideIssue.mockImplementation(() => Promise.reject(new ApiError('no', 403, code)));
      const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', vi.fn()));

      await waitFor(() => expect(result.current.state.kind).toBe('denied'));
    },
  );

  it('is unreachable, not denied, when the source can’t be reached', async () => {
    api.outsideIssue.mockImplementation(() =>
      Promise.reject(new ApiError('down', 503, 'unreachable')),
    );
    const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', vi.fn()));

    await waitFor(() => expect(result.current.state.kind).toBe('unreachable'));
  });

  it('keeps an issue already shown through a failed background read', async () => {
    api.outsideIssue.mockResolvedValueOnce(issueFor('482'));
    const { result } = renderHook(() => useOutsideIssue('t1', 'redmine:482', vi.fn()));
    await waitFor(() => expect(result.current.state.kind).toBe('loaded'));

    api.outsideIssue.mockImplementation(() =>
      Promise.reject(new ApiError('down', 503, 'too-many-requests')),
    );
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state.kind).toBe('loaded');
  });
});
