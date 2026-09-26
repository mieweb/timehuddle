/**
 * Create a TimeHuddle ticket — laid out like `RedmineIssueCreateModal`, so
 * both "New Ticket" choices look and behave the same.
 *
 * Pasting a GitHub issue/PR URL into the title (or typing one into the GitHub
 * field) fills the title from GitHub, as the old inline form did. The assignee
 * defaults to the creator; the team defaults to the one currently selected.
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
} from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { teamApi, ticketApi, type TeamMember } from '../../lib/api';

import { fetchGithubIssueTitle, isGithubIssueUrl } from './githubIssue';
import { PRIORITY_OPTIONS } from './huddleTicketOptions';

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
  github: string;
  assigneeId: string;
  priority: string;
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
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (patch: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

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
      github: '',
      assigneeId: userId ?? UNASSIGNED,
      priority: 'none',
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

  useEffect(
    () => () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    },
    [],
  );

  const fillTitleFrom = (url: string) => {
    setTitleFetching(true);
    void fetchGithubIssueTitle(url).then((title) => {
      if (title) update({ title });
      setTitleFetching(false);
    });
  };

  const canSubmit = Boolean(form?.teamId && form.title.trim()) && !saving && !titleFetching;

  const handleCreate = useCallback(async () => {
    if (!form || !form.teamId || !form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await ticketApi.createTicket({
        teamId: form.teamId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        github: form.github.trim() || undefined,
        priority: form.priority === 'none' ? undefined : form.priority,
        assignedToUserIds: form.assigneeId === UNASSIGNED ? [] : [form.assigneeId],
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket. Try again.');
    } finally {
      setSaving(false);
    }
  }, [form, onCreated, onClose]);

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
        <ModalTitle>New TimeHuddle ticket</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        {form && (
          // Plain <form>: @mieweb/ui has no Form primitive, and this gives Enter-to-submit.
          <form
            className="ticket-create space-y-4"
            aria-label="New TimeHuddle ticket"
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
                update({ github: text });
                fillTitleFrom(text);
              }}
            />

            <Textarea
              label="Description"
              rows={6}
              value={form.description}
              placeholder="Supports Markdown (headings, lists, links, code, etc.)"
              onChange={(e) => update({ description: e.target.value })}
            />

            <Input
              label="GitHub URL"
              type="url"
              placeholder="GitHub URL (optional)"
              value={form.github}
              onChange={(e) => {
                const url = e.target.value;
                update({ github: url });
                if (fetchTimer.current) clearTimeout(fetchTimer.current);
                if (isGithubIssueUrl(url)) {
                  fetchTimer.current = setTimeout(() => fillTitleFrom(url), 300);
                }
              }}
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
