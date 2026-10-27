/**
 * The driver engine (#734 step 3): a source's answer read into a ticket record
 * by its definition alone, and edits refused before anything is sent unless
 * the field is editable and the issue hasn't changed.
 */
import { readFileSync } from 'node:fs';

import { github, redmine } from '@timehuddle/ticket-sources';
import { describe, it, expect, vi } from 'vitest';

import {
  EngineError,
  fetchRecord,
  fillTemplate,
  readPath,
  statusChoices,
  toRecord,
  writeRecord,
} from '../server/sources/engine';

const rawIssue = {
  id: 214,
  subject: 'Fix the export',
  description: 'Steps\r\nto reproduce',
  project: { id: 7, name: 'Platform' },
  tracker: { id: 1, name: 'Bug' },
  status: { id: 2, name: 'In Progress', is_closed: false },
  priority: { id: 4, name: 'High' },
  assigned_to: { id: 42, name: 'Jane Doe' },
  author: { id: 5, name: 'Sam Reporter' },
  fixed_version: { id: 3, name: 'Sprint 9' },
  created_on: '2026-10-01T09:00:00Z',
  updated_on: '2026-10-20T14:05:00Z',
  due_date: '2026-11-01',
  custom_fields: [
    { id: 9, name: 'Customer', value: 'Acme' },
    { id: 10, name: 'Empty', value: '' },
  ],
  allowed_statuses: [
    { id: 2, name: 'In Progress', is_closed: false },
    { id: 5, name: 'Closed', is_closed: true },
  ],
};

const hooks = {
  redmineIsClosed: (status: { is_closed?: boolean }) => status?.is_closed === true,
  redmineJournals: () => [],
};

describe('readPath and fillTemplate', () => {
  it('reads a dotted path, and nothing past a missing step', () => {
    expect(readPath(rawIssue, 'priority.name')).toBe('High');
    expect(readPath(rawIssue, 'category.name')).toBeUndefined();
    expect(readPath(rawIssue, undefined)).toBeUndefined();
  });

  it('fills an address, encoding each part', () => {
    expect(fillTemplate('/repos/{container}/issues/{key}', { container: 'a b/c', key: '1' })).toBe(
      '/repos/a%20b%2Fc/issues/1',
    );
  });
});

describe('toRecord', () => {
  it("reads a Redmine issue by Redmine's definition", async () => {
    const record = await toRecord(redmine, rawIssue, { hooks });
    expect(record).toMatchObject({
      title: 'Fix the export',
      body: { text: 'Steps\nto reproduce', format: 'textile' },
      status: { id: '2', native: 'In Progress', isClosed: false },
      priority: { id: '4', native: 'High', rank: 3 },
      assignees: [{ id: '42', name: 'Jane Doe' }],
      reporter: { id: '5', name: 'Sam Reporter' },
      labels: [{ name: 'Bug', group: 'tracker' }],
      type: { id: '1', name: 'Bug' },
      container: { id: '7', name: 'Platform' },
      milestone: { id: '3', name: 'Sprint 9' },
      dates: {
        created: '2026-10-01T09:00:00.000Z',
        updated: '2026-10-20T14:05:00.000Z',
        due: '2026-11-01',
      },
      extra: [{ label: 'Customer', value: 'Acme' }],
    });
  });

  it('asks the closed hook, and ranks an unknown priority 0', async () => {
    const record = await toRecord(
      redmine,
      { ...rawIssue, status: { id: 5, name: 'Closed', is_closed: true }, priority: { id: 9, name: 'Whenever' } },
      { hooks },
    );
    expect(record.status.isClosed).toBe(true);
    expect(record.priority).toEqual({ id: '9', native: 'Whenever', rank: 0 });
  });

  it('reads an issue with nothing optional set', async () => {
    const record = await toRecord(redmine, { id: 1, subject: 'Bare' }, { hooks });
    expect(record).toMatchObject({ body: null, priority: null, assignees: [], reporter: null });
  });

  it("reads a GitHub issue by GitHub's, with no hook at all", async () => {
    const record = await toRecord(github, {
      title: 'Crash',
      state: 'closed',
      assignees: [{ id: 1, login: 'octo' }],
      labels: [{ name: 'bug', color: 'd73a4a' }],
    });
    expect(record.status).toEqual({ native: 'closed', isClosed: true });
    expect(record.assignees).toEqual([{ id: '1', name: 'octo' }]);
    expect(record.labels).toEqual([{ name: 'bug', color: 'd73a4a' }]);
  });
});

describe('statusChoices', () => {
  it('lists the moves the source allows, current first and once', async () => {
    const choices = await statusChoices(redmine, rawIssue, { hooks });
    expect(choices.map((s) => [s.id, s.isClosed])).toEqual([
      ['2', false],
      ['5', true],
    ]);
  });

  it('is empty for a source whose status is not edited by allowed moves', async () => {
    expect(await statusChoices(github, { state: 'open' })).toEqual([]);
  });
});

describe('fetchRecord', () => {
  it("asks the definition's address and reads the issue out of the answer", async () => {
    const request = vi.fn(async () => ({ issue: rawIssue }));
    const result = await fetchRecord({
      definition: redmine,
      ref: { server: 'redmine.example', key: '214' },
      request,
      hooks,
      url: 'https://redmine.example/issues/214',
    });
    expect(request).toHaveBeenCalledWith('/issues/214.json?include=allowed_statuses,journals');
    expect(result?.record.ref).toEqual({ server: 'redmine.example', key: '214' });
    expect(result?.record.url).toBe('https://redmine.example/issues/214');
    expect(result?.choices.status).toHaveLength(2);
  });

  it('is null when the issue is missing or hidden from the member', async () => {
    const result = await fetchRecord({
      definition: redmine,
      ref: { server: 'redmine.example', key: '214' },
      request: async () => null,
      hooks,
    });
    expect(result).toBeNull();
  });
});

describe('writeRecord', () => {
  const ref = { server: 'redmine.example', key: '214' };
  const expectedUpdatedAt = '2026-10-20T14:05:00.000Z';

  type WriteCtx = { userId?: string; reload?: () => unknown };
  function setup(
    write = vi.fn(async ({ raw }: { raw: unknown }, _ctx: WriteCtx) => ({ raw, mismatches: [] })),
  ) {
    const request = vi.fn(async () => ({ issue: rawIssue }));
    return { request, write, hooks: { ...hooks, redmineWrite: write } };
  }

  it('hands the current issue and the edits to the write hook', async () => {
    const { request, write, hooks: all } = setup();
    const result = await writeRecord({
      definition: redmine,
      ref,
      request,
      hooks: all,
      ctx: { userId: 'u1' },
      expectedUpdatedAt,
      edits: { status: '5' },
    });
    expect(write).toHaveBeenCalledTimes(1);
    const [arg, ctx] = write.mock.calls[0];
    expect(arg).toEqual({ raw: rawIssue, edits: { status: '5' } });
    expect(ctx.userId).toBe('u1');
    expect(typeof ctx.reload).toBe('function');
    expect(result.record.title).toBe('Fix the export');
    expect(result.mismatches).toEqual([]);
  });

  it('builds the record, conversation and all, once per write', async () => {
    const { request, hooks: all } = setup();
    const redmineJournals = vi.fn(() => []);
    await writeRecord({
      definition: redmine,
      ref,
      request,
      hooks: { ...all, redmineJournals },
      expectedUpdatedAt,
      edits: { status: '5' },
    });
    expect(redmineJournals).toHaveBeenCalledTimes(1);
  });

  it('refuses a field the definition does not mark editable, before any request', async () => {
    const { request, write, hooks: all } = setup();
    const attempt = writeRecord({
      definition: redmine,
      ref,
      request,
      hooks: all,
      expectedUpdatedAt,
      edits: { labels: ['x'] },
    });
    await expect(attempt).rejects.toMatchObject({ code: 'bad-request' });
    expect(request).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses when the issue changed since it was read', async () => {
    const { request, write, hooks: all } = setup();
    const attempt = writeRecord({
      definition: redmine,
      ref,
      request,
      hooks: all,
      expectedUpdatedAt: '2026-10-19T00:00:00.000Z',
      edits: { status: '5' },
    });
    await expect(attempt).rejects.toBeInstanceOf(EngineError);
    await expect(attempt).rejects.toMatchObject({ code: 'stale' });
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a source with no write hook, and an empty edit', async () => {
    const { request, hooks: all } = setup();
    const base = { ref, request, hooks: all, expectedUpdatedAt };
    await expect(
      writeRecord({ ...base, definition: github, edits: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'bad-request' });
    await expect(writeRecord({ ...base, definition: redmine, edits: {} })).rejects.toMatchObject({
      code: 'bad-request',
    });
  });

  it('is gone when the issue is no longer there', async () => {
    const { hooks: all } = setup();
    const attempt = writeRecord({
      definition: redmine,
      ref,
      request: async () => null,
      hooks: all,
      expectedUpdatedAt,
      edits: { status: '5' },
    });
    await expect(attempt).rejects.toMatchObject({ code: 'gone' });
  });
});

describe('the engine serves every source the same way', () => {
  it('never asks which source it is serving', () => {
    const source = readFileSync(new URL('../server/sources/engine.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bkind\s*===|redmine|github/i);
  });
});
