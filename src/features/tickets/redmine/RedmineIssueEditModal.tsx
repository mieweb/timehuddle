/**
 * Edit a Redmine issue's status, priority, assignee and description (M6).
 *
 * The save goes out under the user's own Redmine key, so Redmine decides what
 * they may change; the status list is limited to the transitions Redmine
 * reported for this user and issue. The form remembers the `updatedAt` it was
 * opened with, and the server refuses the save as `stale` if someone changed
 * the issue in Redmine meanwhile — Reload then shows their version.
 */
import {
  Alert,
  AlertDescription,
  Button,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Spinner,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { redmineApi, type RedmineFormOptions, type RedmineIssueDetail } from '../../../lib/api';

import {
  UNASSIGNED,
  assigneeOptions,
  isStaleError,
  mismatchWarning,
  redmineErrorMessage,
  toId,
  toOptions,
} from './redmineForm';

export interface RedmineIssueEditModalProps {
  /** The issue to edit; `null` keeps the modal closed. */
  issueId: number | null;
  onClose: () => void;
  /** Called after a save Redmine accepted, so the list can refetch. */
  onSaved: () => void;
}

interface FormState {
  statusId: string;
  priorityId: string;
  assigneeId: string;
  description: string;
}

function formFrom(issue: RedmineIssueDetail): FormState {
  return {
    statusId: issue.status ? String(issue.status.id) : '',
    priorityId: issue.priority ? String(issue.priority.id) : '',
    assigneeId: issue.assignedTo ? String(issue.assignedTo.id) : UNASSIGNED,
    description: issue.description,
  };
}

export function RedmineIssueEditModal({ issueId, onClose, onSaved }: RedmineIssueEditModalProps) {
  const [issue, setIssue] = useState<RedmineIssueDetail | null>(null);
  const [options, setOptions] = useState<RedmineFormOptions | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    setStale(false);
    setWarning(null);
    try {
      const { issue: fresh } = await redmineApi.issues.get(id);
      const formOptions = fresh.project
        ? await redmineApi.projects.formOptions(fresh.project.id)
        : null;
      setIssue(fresh);
      setOptions(formOptions);
      setForm(formFrom(fresh));
    } catch (err) {
      setIssue(null);
      setError(redmineErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (issueId == null) {
      setIssue(null);
      setOptions(null);
      setForm(null);
      setError(null);
      setStale(false);
      setWarning(null);
      return;
    }
    void load(issueId);
  }, [issueId, load]);

  const handleSave = useCallback(async () => {
    if (!issue || !form || !issue.updatedAt) return;
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const statusId = toId(form.statusId);
      const priorityId = toId(form.priorityId);
      const result = await redmineApi.issues.update(issue.id, issue.updatedAt, {
        ...(statusId ? { statusId } : {}),
        ...(priorityId ? { priorityId } : {}),
        assigneeId: toId(form.assigneeId),
        description: form.description,
      });
      onSaved();
      const mismatch = mismatchWarning(result.mismatches);
      if (mismatch && result.issue) {
        // Keep the dialog open on what Redmine actually stored, with the reason.
        setIssue(result.issue);
        setForm(formFrom(result.issue));
        setWarning(mismatch);
        return;
      }
      onClose();
    } catch (err) {
      setStale(isStaleError(err));
      setError(redmineErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [issue, form, onClose, onSaved]);

  const update = (patch: Partial<FormState>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));

  const statusOptions = (issue?.allowedStatuses ?? []).map((status) => ({
    value: String(status.id),
    label: status.isClosed ? `${status.name} (closes the issue)` : status.name,
  }));

  return (
    <Modal open={issueId != null} onOpenChange={(open) => !open && onClose()} size="lg">
      <ModalHeader>
        <ModalTitle>{issue ? `Edit Redmine issue #${issue.id}` : 'Edit Redmine issue'}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div className="redmine-issue-edit space-y-4">
          {loading && (
            <div className="redmine-issue-edit-loading flex justify-center py-6">
              <Spinner size="lg" label="Loading the issue from Redmine" />
            </div>
          )}

          <div className="redmine-issue-edit-messages" aria-live="polite">
            {error && (
              <Alert variant={stale ? 'warning' : 'danger'} role="alert">
                <AlertDescription>
                  {error}
                  {stale && issueId != null && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-3"
                      onClick={() => void load(issueId)}
                    >
                      Reload
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {warning && (
              <Alert variant="warning" role="status">
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            )}
          </div>

          {!loading && issue && form && (
            <>
              <div className="redmine-issue-edit-summary">
                <Text size="sm" weight="medium">
                  {issue.subject}
                </Text>
                <Text size="xs" variant="muted">
                  {[issue.project?.name, issue.tracker?.name].filter(Boolean).join(' · ')}
                </Text>
              </div>

              <div className="redmine-issue-edit-fields grid gap-4 sm:grid-cols-2">
                <Select
                  label="Status"
                  options={statusOptions}
                  value={form.statusId}
                  onValueChange={(statusId) => update({ statusId })}
                  helperText="Only the changes your Redmine role allows are listed."
                />
                <Select
                  label="Priority"
                  options={toOptions(options?.priorities ?? [], issue.priority)}
                  value={form.priorityId}
                  onValueChange={(priorityId) => update({ priorityId })}
                />
                <Select
                  label="Assignee"
                  className="sm:col-span-2"
                  searchable
                  options={assigneeOptions(
                    options?.assignees ?? [],
                    options?.me ?? null,
                    issue.assignedTo,
                  )}
                  value={form.assigneeId}
                  onValueChange={(assigneeId) => update({ assigneeId })}
                />
              </div>

              <Textarea
                label="Description"
                rows={8}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                helperText="Uses Redmine's formatting. Saved as you type it here."
              />
            </>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          {warning ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!issue || !form || loading || saving || stale || Boolean(warning)}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : 'Save to Redmine'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
