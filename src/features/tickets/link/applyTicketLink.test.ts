import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedmineIssue } from '../../../lib/api';

const api = vi.hoisted(() => ({
  link: vi.fn(),
  unlink: vi.fn(),
  updateTicket: vi.fn(),
  formOptions: vi.fn(),
  createIssue: vi.fn(),
}));

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  ticketApi: { link: api.link, unlink: api.unlink, updateTicket: api.updateTicket },
  redmineApi: { projects: { formOptions: api.formOptions }, issues: { create: api.createIssue } },
}));

const { IssueCreatedNotLinkedError, applyTicketLink } = await import('./applyTicketLink');
const { EMPTY_LINK_FORM } = await import('./ticketLinkForm');

const ticket = {
  id: 't1',
  title: 'Fix export',
  description: 'Steps',
  priority: 'high',
  github: '',
  linkedIssue: null,
};
const onRedmine = { ...ticket, linkedIssue: { source: 'redmine' as const, id: '482' } };
const onGithub = { ...ticket, github: 'https://github.com/a/b/issues/1' };
const issue = { id: 500, subject: 'Other' } as RedmineIssue;

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.link.mockResolvedValue({ id: 't1' });
  api.unlink.mockResolvedValue({ id: 't1' });
  api.updateTicket.mockResolvedValue({ id: 't1' });
});

describe('applyTicketLink', () => {
  it('does nothing when the choice is what the ticket already has', async () => {
    expect(await applyTicketLink(ticket, EMPTY_LINK_FORM)).toBeNull();
    expect(api.unlink).not.toHaveBeenCalled();
    expect(api.updateTicket).not.toHaveBeenCalled();
  });

  it('links an existing issue, saying which link it replaces', async () => {
    await applyTicketLink(onRedmine, { ...EMPTY_LINK_FORM, kind: 'redmine', issue });
    expect(api.link).toHaveBeenCalledWith('t1', 500, '482');
  });

  it('removes a Redmine link through unlink, never as a side effect', async () => {
    await applyTicketLink(onRedmine, EMPTY_LINK_FORM);
    expect(api.unlink).toHaveBeenCalledWith('t1', '482');
    expect(api.updateTicket).not.toHaveBeenCalled();
  });

  it('removes a GitHub link by clearing it', async () => {
    await applyTicketLink(onGithub, EMPTY_LINK_FORM);
    expect(api.updateTicket).toHaveBeenCalledWith('t1', { github: '' });
  });

  it('switching from Redmine to GitHub unlinks first, then saves the link', async () => {
    await applyTicketLink(onRedmine, {
      ...EMPTY_LINK_FORM,
      kind: 'github',
      github: ' https://github.com/a/b/pull/2 ',
    });
    expect(api.unlink).toHaveBeenCalledWith('t1', '482');
    expect(api.updateTicket).toHaveBeenCalledWith('t1', {
      github: 'https://github.com/a/b/pull/2',
    });
    expect(api.unlink.mock.invocationCallOrder[0]).toBeLessThan(
      api.updateTicket.mock.invocationCallOrder[0],
    );
  });

  describe('creating a new Redmine issue', () => {
    const form = {
      ...EMPTY_LINK_FORM,
      kind: 'redmine' as const,
      redmineMode: 'new' as const,
      projectId: '2',
      trackerId: '1',
    };

    beforeEach(() => {
      api.formOptions.mockResolvedValue({
        trackers: [{ id: 1, name: 'Bug' }],
        assignees: [{ id: 8, name: 'Me' }],
        priorities: [
          { id: 4, name: 'Normal', isDefault: true },
          { id: 5, name: 'High', isDefault: false },
        ],
        defaultPriorityId: 4,
        me: 8,
      });
      api.createIssue.mockResolvedValue({ issueId: 77, issue: { id: 77, subject: 'Fix export' } });
    });

    it('makes it from the ticket, assigned to the caller, then links it', async () => {
      await applyTicketLink(ticket, form);
      expect(api.createIssue).toHaveBeenCalledWith({
        projectId: 2,
        subject: 'Fix export',
        description: 'Steps',
        trackerId: 1,
        priorityId: 5,
        assigneeId: 8,
      });
      expect(api.link).toHaveBeenCalledWith('t1', 77, null);
    });

    it('leaves it unassigned when the caller is not on the project', async () => {
      api.formOptions.mockResolvedValue({
        trackers: [],
        assignees: [],
        priorities: [],
        defaultPriorityId: null,
        me: 8,
      });
      await applyTicketLink(ticket, form);
      expect(api.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: null, priorityId: null }),
      );
    });

    it('reports the issue it created when the link fails, so it is not created twice', async () => {
      api.link.mockRejectedValue(new Error('Redmine did not answer.'));
      const failure = await applyTicketLink(ticket, form).catch((err) => err);
      expect(failure).toBeInstanceOf(IssueCreatedNotLinkedError);
      expect(failure.issue.id).toBe(77);
    });

    it('creates nothing when the issue itself is refused', async () => {
      api.createIssue.mockRejectedValue(new Error('You may not create issues there.'));
      await expect(applyTicketLink(ticket, form)).rejects.toThrow(
        'You may not create issues there.',
      );
      expect(api.link).not.toHaveBeenCalled();
    });
  });
});
