/**
 * Unit tests for redmine-billable (server/redmine-billable.js): reading the
 * Billable custom field off time entries, and which entry it is copied from
 * for each issue (#686).
 */
import { describe, expect, it } from 'vitest';

import { billableByIssue, billableFieldOf, firstBillable } from '../server/redmine-billable';

const BILLABLE = { id: 7, name: 'Billable status', value: '1' };

describe('billableFieldOf', () => {
  it('finds the field by a name containing "billable", in any case', () => {
    expect(billableFieldOf({ custom_fields: [{ id: 3, name: 'Other', value: 'x' }, BILLABLE] })).toEqual(
      BILLABLE,
    );
    expect(billableFieldOf({ custom_fields: [{ id: 4, name: 'BILLABLE', value: 'No' }] })).toEqual({
      id: 4,
      name: 'BILLABLE',
      value: 'No',
    });
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
});
