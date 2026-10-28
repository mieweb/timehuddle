/**
 * A key Redmine rejects stops being sent (#734 step 7). The client marks it
 * only when Redmine refuses to say who the key belongs to: a 403 means "not
 * allowed" with a good key, and Atom can answer 401 for a good key, so neither
 * marks it. And an answer past MAX_RESPONSE_BYTES is refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_RESPONSE_BYTES,
  getCurrentUser,
  getIssue,
  listActivityIssueIds,
} from '../server/redmine-client';
import { toStatus } from '../server/redmine-status';

/** A fetch answering each path with the status given, and 200 `{}` otherwise. */
function answering(statuses: Record<string, number>) {
  const fetchSpy = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const status = statuses[path] ?? 200;
    return new Response(status === 200 ? '{"user":{"id":1}}' : '', { status });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function accountWith(onKeyRejected = vi.fn(async () => {})) {
  return { userId: 'u1', apiKey: 'personal-key', baseUrl: 'https://redmine.test', onKeyRejected };
}

describe('a rejected key', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is marked when Redmine also refuses to say whose it is', async () => {
    answering({ '/issues/1.json': 401, '/users/current.json': 401 });
    const account = accountWith();
    await expect(getIssue(account, 1)).rejects.toMatchObject({ status: 401 });
    expect(account.onKeyRejected).toHaveBeenCalledOnce();
  });

  it('is marked at once when the refusal was the who-am-I call itself', async () => {
    const fetchSpy = answering({ '/users/current.json': 401 });
    const account = accountWith();
    await expect(getCurrentUser(account)).rejects.toMatchObject({ status: 401 });
    expect(account.onKeyRejected).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("isn't marked when Redmine still knows the key", async () => {
    answering({ '/issues/1.json': 401 });
    const account = accountWith();
    await expect(getIssue(account, 1)).rejects.toMatchObject({ status: 401 });
    expect(account.onKeyRejected).not.toHaveBeenCalled();
  });

  it("isn't marked, or checked, on a 403", async () => {
    const fetchSpy = answering({ '/issues/1.json': 403 });
    const account = accountWith();
    await expect(getIssue(account, 1)).resolves.toBeNull();
    expect(account.onKeyRejected).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("isn't marked, or checked, on Atom's 401", async () => {
    const fetchSpy = answering({ '/activity.atom': 401 });
    const account = accountWith();
    await expect(listActivityIssueIds(account, { redmineUserId: 1 })).rejects.toMatchObject({
      status: 401,
    });
    expect(account.onKeyRejected).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('still fails the request when marking it fails', async () => {
    answering({ '/users/current.json': 401 });
    const account = accountWith(vi.fn(async () => Promise.reject(new Error('db down'))));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getCurrentUser(account)).rejects.toMatchObject({ status: 401 });
    quiet.mockRestore();
  });

  it('reads as not connected, and says why', () => {
    const link = { userId: 'u1', apiKey: 'v2:…', redmineLogin: 'ada', rejectedAt: new Date() };
    expect(toStatus(link, 'https://redmine.test')).toEqual({
      connected: false,
      rejected: true,
      baseUrl: 'https://redmine.test',
    });
  });
});

describe('an answer that is too large', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is refused by its declared length, before it is read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } })),
    );
    await expect(getCurrentUser(accountWith())).rejects.toMatchObject({ tooLarge: true });
  });

  it('is refused while streaming, when it declares no length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 21) controller.close();
        else controller.enqueue(chunk);
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    await expect(getCurrentUser(accountWith())).rejects.toMatchObject({ tooLarge: true });
  });

  it('reads an ordinary answer as before', async () => {
    answering({});
    await expect(getCurrentUser(accountWith())).resolves.toEqual({ id: 1 });
  });
});
