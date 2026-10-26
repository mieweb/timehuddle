/**
 * Unit tests for redmine-billable (server/redmine-billable.js): reading the
 * Billable custom field off time entries, and which entry it is copied from
 * for each issue (#686).
 */
import { describe, expect, it } from 'vitest';

import {
  BillableLookupIncomplete,
  billableByIssue,
  billableFieldOf,
  findBillableInPages,
  firstBillable,
  sameBillable,
} from '../server/redmine-billable';

const BILLABLE = { id: 7, name: 'Billable status', value: '1' };

describe('billableFieldOf', () => {
  it('finds the field named Billable or Billable status, in any case', () => {
    expect(billableFieldOf({ custom_fields: [{ id: 3, name: 'Other', value: 'x' }, BILLABLE] })).toEqual(
      BILLABLE,
    );
    expect(billableFieldOf({ custom_fields: [{ id: 4, name: 'BILLABLE', value: 'No' }] })).toEqual({
      id: 4,
      name: 'BILLABLE',
      value: 'No',
    });
  });

  it('never takes another field that merely mentions billable', () => {
    expect(
      billableFieldOf({ custom_fields: [{ id: 8, name: 'Billable notes', value: 'Patient Jane Doe' }] }),
    ).toBeNull();
  });

  it('keeps a multi-value list as it is', () => {
    const field = { id: 5, name: 'Billable', value: ['Client A'] };
    expect(billableFieldOf({ custom_fields: [field] })).toEqual(field);
  });

  it('keeps that one field and nothing else from the entry', () => {
    const field = billableFieldOf({
      comments: 'Patient Jane Doe',
      custom_fields: [{ id: 9, name: 'Diagnosis', value: 'confidential' }, BILLABLE],
    });
    expect(JSON.stringify(field)).not.toContain('Patient');
    expect(JSON.stringify(field)).not.toContain('confidential');
  });

  it('is null with no field, an empty value, or a malformed entry', () => {
    expect(billableFieldOf({ custom_fields: [{ id: 3, name: 'Other', value: 'x' }] })).toBeNull();
    expect(billableFieldOf({ custom_fields: [{ ...BILLABLE, value: '' }] })).toBeNull();
    expect(billableFieldOf({ custom_fields: [{ ...BILLABLE, value: [] }] })).toBeNull();
    expect(billableFieldOf({ custom_fields: [{ name: 'Billable', value: '1' }] })).toBeNull();
    expect(billableFieldOf({})).toBeNull();
    expect(billableFieldOf(null)).toBeNull();
  });
});

describe('firstBillable', () => {
  it('takes the first entry that has a value, skipping ones without', () => {
    const entries = [
      { custom_fields: [] },
      { custom_fields: [{ ...BILLABLE, value: '0' }] },
      { custom_fields: [BILLABLE] },
    ];
    expect(firstBillable(entries)).toEqual({ ...BILLABLE, value: '0' });
  });

  it('for an issue, skips a subtask’s newer entry and takes the issue’s own', () => {
    const entries = [
      { issue: { id: 22 }, custom_fields: [{ ...BILLABLE, value: '0' }] },
      { issue: { id: 11 }, custom_fields: [BILLABLE] },
    ];
    expect(firstBillable(entries, 11)).toEqual(BILLABLE);
    expect(firstBillable(entries, '11')).toEqual(BILLABLE);
  });

  it('for an issue, is null when only a subtask has the field', () => {
    expect(firstBillable([{ issue: { id: 22 }, custom_fields: [BILLABLE] }], 11)).toBeNull();
  });

  it('without an issue, takes entries from any issue', () => {
    expect(firstBillable([{ issue: { id: 22 }, custom_fields: [BILLABLE] }])).toEqual(BILLABLE);
  });

  it('is null for no entries', () => {
    expect(firstBillable([])).toBeNull();
    expect(firstBillable(undefined)).toBeNull();
  });
});

describe('billableByIssue', () => {
  const issues = [
    { id: 1, project: { id: 10 } },
    { id: 2, project: { id: 10 } },
    { id: 3, project: { id: 20 } },
  ];

  /** A stand-in lookup answering from a table keyed by its query, recording each call. */
  function lookup(answers: Record<string, typeof BILLABLE | null>) {
    const calls: string[] = [];
    const recentBillable = async (params: Record<string, unknown>) => {
      const key = Object.entries(params)
        .map(([name, value]) => `${name}=${value}`)
        .join('&');
      calls.push(key);
      return answers[key] ?? null;
    };
    return { calls, recentBillable };
  }

  it('prefers the issue, then the project, then the caller’s own entries', async () => {
    const onIssue = { ...BILLABLE, value: 'issue' };
    const onProject = { ...BILLABLE, value: 'project' };
    const own = { ...BILLABLE, value: 'own' };
    const { recentBillable } = lookup({
      'issue_id=1': onIssue,
      'project_id=10': onProject,
      'user_id=me': own,
    });

    const byIssue = await billableByIssue(issues, recentBillable);

    expect(byIssue.get('1')?.value).toBe('issue');
    expect(byIssue.get('2')?.value).toBe('project');
    expect(byIssue.get('3')?.value).toBe('own');
  });

  it('asks each project, and the caller, once however many issues share them', async () => {
    const { calls, recentBillable } = lookup({});

    await billableByIssue(issues, recentBillable);

    expect(calls.filter((call) => call === 'project_id=10')).toHaveLength(1);
    expect(calls.filter((call) => call === 'user_id=me')).toHaveLength(1);
  });

  it('is null for every issue on a Redmine with no Billable field', async () => {
    const byIssue = await billableByIssue(issues, lookup({}).recentBillable);
    expect([...byIssue.values()]).toEqual([null, null, null]);
  });

  it('leaves an issue without a value, and asks no wider scope, when its lookup is incomplete', async () => {
    const calls: string[] = [];
    const recentBillable = async (params: Record<string, unknown>) => {
      calls.push(Object.keys(params)[0]);
      if ('issue_id' in params) {
        if (params.issue_id === 1) throw new BillableLookupIncomplete(params);
        return null;
      }
      return { ...BILLABLE, value: 'wider' };
    };

    const byIssue = await billableByIssue(issues, recentBillable);

    expect(byIssue.get('1')).toBeNull();
    // The others still answer from their own scopes.
    expect(byIssue.get('2')?.value).toBe('wider');
    expect(calls.filter((scope) => scope === 'project_id')).toEqual(['project_id', 'project_id']);
  });

  it('still fails the read for any other error', async () => {
    const recentBillable = async () => {
      throw new Error('Redmine is down');
    };
    await expect(billableByIssue(issues, recentBillable)).rejects.toThrow('Redmine is down');
  });
});

describe('sameBillable', () => {
  it('is true when neither has a value', () => {
    expect(sameBillable(null, null)).toBe(true);
    expect(sameBillable(undefined, null)).toBe(true);
  });

  it('is false when only one has a value', () => {
    expect(sameBillable(BILLABLE, null)).toBe(false);
    expect(sameBillable(null, BILLABLE)).toBe(false);
  });

  it('is true for the same field and value, whatever its name', () => {
    expect(sameBillable(BILLABLE, { ...BILLABLE, name: 'Billable' })).toBe(true);
  });

  it('is false when the value or the field differs', () => {
    expect(sameBillable(BILLABLE, { ...BILLABLE, value: '0' })).toBe(false);
    expect(sameBillable(BILLABLE, { ...BILLABLE, id: 8 })).toBe(false);
  });

  it('compares a list value by its contents', () => {
    expect(sameBillable({ ...BILLABLE, value: ['a', 'b'] }, { ...BILLABLE, value: ['a', 'b'] })).toBe(true);
    expect(sameBillable({ ...BILLABLE, value: ['a'] }, { ...BILLABLE, value: ['a', 'b'] })).toBe(false);
  });
});

describe('findBillableInPages', () => {
  const without = (count: number) => Array.from({ length: count }, () => ({ custom_fields: [] }));
  const withBillable = { custom_fields: [BILLABLE] };

  /** A scope of `entries`, served a page at a time the way Redmine does, counting its reads. */
  function scope(entries: object[], { totalCount = true } = {}) {
    const offsets: number[] = [];
    const fetchPage = async (offset: number, limit: number) => {
      offsets.push(offset);
      return {
        entries: entries.slice(offset, offset + limit),
        totalCount: totalCount ? entries.length : undefined,
      };
    };
    return { offsets, fetchPage };
  }

  it('finds the field on a later page', async () => {
    const { offsets, fetchPage } = scope([...without(100), ...without(40), withBillable]);
    expect(await findBillableInPages(fetchPage, {})).toEqual(BILLABLE);
    expect(offsets).toEqual([0, 100]);
  });

  it('is null once every entry was read and none has the field', async () => {
    expect(await findBillableInPages(scope(without(150)).fetchPage, {})).toBeNull();
  });

  it('is null, not incomplete, for a scope of exactly three full pages without the field', async () => {
    const { offsets, fetchPage } = scope(without(300));
    expect(await findBillableInPages(fetchPage, {})).toBeNull();
    expect(offsets).toEqual([0, 100, 200]);
  });

  it('is incomplete when more entries remain after the last page it reads', async () => {
    await expect(findBillableInPages(scope(without(301)).fetchPage, { issue_id: 5 })).rejects.toBeInstanceOf(
      BillableLookupIncomplete,
    );
  });

  it('without a total, ends on a short page, and is incomplete after three full ones', async () => {
    expect(await findBillableInPages(scope(without(150), { totalCount: false }).fetchPage, {})).toBeNull();
    await expect(
      findBillableInPages(scope(without(300), { totalCount: false }).fetchPage, {}),
    ).rejects.toBeInstanceOf(BillableLookupIncomplete);
  });

  it('stops on an empty page even when the total says more', async () => {
    const fetchPage = async () => ({ entries: [], totalCount: 999 });
    expect(await findBillableInPages(fetchPage, {})).toBeNull();
  });

  it('for an issue, counts only that issue’s own entries', async () => {
    const subtask = { issue: { id: 22 }, custom_fields: [BILLABLE] };
    expect(await findBillableInPages(scope([subtask]).fetchPage, { issue_id: 11 })).toBeNull();
  });
});

