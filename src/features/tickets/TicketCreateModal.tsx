/**
 * Create a ticket — the one dialog for it, whatever system the work is tracked
 * in. Every ticket is a TimeHuddle ticket; "Tracked in" says whether it also
 * points at a GitHub link or a Redmine issue (an existing one, or a new one
 * created from this ticket). The same choice can be changed later on the
 * ticket's page.
 *
 * Pasting a GitHub issue/PR URL into the title, or entering one as the GitHub
 * link, fills the title from GitHub. The assignee defaults to the creator; the
 * team defaults to the one currently selected.
 */
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Textarea,
  useToast,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { teamApi, ticketApi, type TeamMember } from '../../lib/api';

import { fetchGithubIssueTitle, isGithubIssueUrl } from './githubIssue';
import { PRIORITY_OPTIONS } from './huddleTicketOptions';
import { IssueCreatedNotLinkedError, applyTicketLink } from './link/applyTicketLink';
import { linkErrorMessage } from './link/linkErrors';
import { TicketLinkFields } from './link/TicketLinkFields';
import { EMPTY_LINK_FORM, linkFormReady, type LinkFormState } from './link/ticketLinkForm';
import { ticketLinkText } from './link/ticketLinkStrings';

/** `Select` value for "nobody". */
const UNASSIGNED = 'none';

export interface TicketCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called once the ticket exists, so the list can refetch. */
  onCreated: () => void;
  teams: { id: string; name: string }[];
  defaultTeamId: string | null;
  userId: string | null;
}

interface FormState {
  teamId: string;
  title: string;
  description: string;
  assigneeId: string;
  priority: string;
  /** Where the ticket is tracked besides TimeHuddle. */
  link: LinkFormState;
}

export function TicketCreateModal({
  open,
  onClose,
  onCreated,
  teams,
  defaultTeamId,
  userId,
}: TicketCreateModalProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [titleFetching, setTitleFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const update = (patch: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));
  const updateLink = (patch: Partial<LinkFormState>) =>
    setForm((current) => (current ? { ...current, link: { ...current.link, ...patch } } : current));

  // Fresh form each time the dialog opens — only on the open transition, so a
  // teams refetch while it is open can't wipe what the user has typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!justOpened) return;
    setError(null);
    setForm({
      teamId: defaultTeamId ?? teams[0]?.id ?? '',
      title: '',
      description: '',
      assigneeId: userId ?? UNASSIGNED,
      priority: 'none',
      link: EMPTY_LINK_FORM,
    });
  }, [open, defaultTeamId, teams, userId]);

  // The team decides who can be assigned.
  const teamId = form?.teamId ?? '';
  useEffect(() => {
    if (!open || !teamId) return;
    let cancelled = false;
    teamApi
      .getMembers(teamId)
      .then((list) => !cancelled && setMembers(list))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, [open, teamId]);

  // A GitHub issue link fills the title, shortly after it stops changing and
  // once per link.
  const githubUrl = form?.link.kind === 'github' ? form.link.github.trim() : '';
  const titleFilledFrom = useRef('');
  useEffect(() => {
    if (!open) titleFilledFrom.current = '';
    if (!open || !isGithubIssueUrl(githubUrl) || titleFilledFrom.current === githubUrl) return;
    const timer = setTimeout(() => {
      titleFilledFrom.current = githubUrl;
      setTitleFetching(true);
      void fetchGithubIssueTitle(githubUrl).then((title) => {
        if (title) setForm((current) => (current ? { ...current, title } : current));
        setTitleFetching(false);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [open, githubUrl]);

  const canSubmit =
    Boolean(form?.teamId && form.title.trim() && linkFormReady(form.link)) &&
    !saving &&
    !titleFetching;

  const handleCreate = useCallback(async () => {
    if (!form || !form.teamId || !form.title.trim()) return;
    setSaving(true);
    setError(null);
    let created;
    try {
      created = await ticketApi.createTicket({
        teamId: form.teamId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        github: form.link.kind === 'github' ? form.link.github.trim() : undefined,
        priority: form.priority === 'none' ? undefined : form.priority,
        assignedToUserIds: form.assigneeId === UNASSIGNED ? [] : [form.assigneeId],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket. Try again.');
      setSaving(false);
      return;
    }

    // The ticket exists from here on. A Redmine step that fails must not lose
    // it: say what happened, and the link can be retried on the ticket's page.
    if (form.link.kind === 'redmine') {
      try {
        await applyTicketLink(created, form.link);
      } catch (err) {
        toast.error(
          err instanceof IssueCreatedNotLinkedError
            ? `${err.message} ${ticketLinkText.openTicketToLink}`
            : ticketLinkText.ticketCreatedLinkFailed(
                linkErrorMessage(err, ticketLinkText.linkFailed),
              ),
        );
      }
    }
    setSaving(false);
    onCreated();
    onClose();
  }, [form, onCreated, onClose, toast]);

  const assigneeOptions = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...members.map((m) => ({
      value: m.id,
      label: m.id === userId ? `Me (${m.name || m.email})` : m.name || m.email,
    })),
  ];

  return (
    <Modal open={open} onOpenChange={(next) => !next && onClose()} size="lg">
      <ModalHeader>
        <ModalTitle>New ticket</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        {form && (
          // Plain <form>: @mieweb/ui has no Form primitive, and this gives Enter-to-submit.
          <form
            className="ticket-create space-y-4"
            aria-label="New ticket"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void handleCreate();
            }}
          >
            <div className="ticket-create-messages" aria-live="polite">
              {error && (
                <Alert variant="danger" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>

            {teams.length > 1 && (
              <Select
                label="Team"
                options={teams.map((t) => ({ value: t.id, label: t.name }))}
                value={form.teamId}
                onValueChange={(value) =>
                  update({ teamId: value, assigneeId: userId ?? UNASSIGNED })
                }
              />
            )}

            <Input
              label="Title"
              required
              placeholder={titleFetching ? 'Fetching title…' : 'Ticket title'}
              value={form.title}
              disabled={titleFetching}
              autoFocus
              onChange={(e) => update({ title: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData?.getData('text')?.trim();
                if (!text || !isGithubIssueUrl(text)) return;
                e.preventDefault();
                updateLink({ kind: 'github', github: text });
              }}
            />

            <TicketLinkFields
              name="ticket-create-link"
              value={form.link}
              onChange={updateLink}
              disabled={saving}
            />

            <Textarea
              label="Description"
              rows={6}
              value={form.description}
              placeholder="Supports Markdown (headings, lists, links, code, etc.)"
              onChange={(e) => update({ description: e.target.value })}
            />

            <div className="ticket-create-people grid gap-4 sm:grid-cols-2">
              <Select
                label="Assignee"
                searchable
                options={assigneeOptions}
                value={form.assigneeId}
                onValueChange={(assigneeId) => update({ assigneeId })}
              />
              <Select
                label="Priority"
                options={PRIORITY_OPTIONS}
                value={form.priority}
                onValueChange={(priority) => update({ priority })}
              />
            </div>
          </form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleCreate()}
          disabled={!canSubmit}
          aria-busy={saving}
        >
          {saving ? 'Creating…' : 'Create Ticket'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
