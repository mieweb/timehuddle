/**
 * Create a Redmine issue from TimeHuddle (M6).
 *
 * The issue is created under the user's own Redmine key, so they are its
 * author and Redmine enforces whether they may add issues to the project.
 * The assignee defaults to the user themself; anyone on the project can be
 * picked instead. Tracker and priority start on the project's first tracker
 * and the instance's default priority.
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
  Spinner,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { redmineApi, type RedmineFormOptions, type RedmineNamed } from '../../../lib/api';

import {
  UNASSIGNED,
  assigneeOptions,
  mismatchWarning,
  redmineErrorMessage,
  toId,
  toOptions,
} from './redmineForm';

/** Redmine's own limit for `subject`. */
const MAX_SUBJECT_LENGTH = 255;

export interface RedmineIssueCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new issue id once Redmine has created it. */
  onCreated: (issueId: number, warning: string | null) => void;
}

interface FormState {
  projectId: string;
  trackerId: string;
  subject: string;
  description: string;
  assigneeId: string;
  priorityId: string;
}

const EMPTY_FORM: FormState = {
  projectId: '',
  trackerId: '',
  subject: '',
  description: '',
  assigneeId: UNASSIGNED,
  priorityId: '',
};

export function RedmineIssueCreateModal({
  open,
  onClose,
  onCreated,
}: RedmineIssueCreateModalProps) {
  const [projects, setProjects] = useState<RedmineNamed[] | null>(null);
  const [options, setOptions] = useState<RedmineFormOptions | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  // Fresh form and project list each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setOptions(null);
    setError(null);
    setLoadingProjects(true);
    redmineApi.projects
      .list()
      .then(({ projects: list }) => {
        setProjects(list);
        if (list.length === 1) setForm((f) => ({ ...f, projectId: String(list[0].id) }));
      })
      .catch((err) => setError(redmineErrorMessage(err)))
      .finally(() => setLoadingProjects(false));
  }, [open]);

  // A project decides which trackers and assignees exist; defaults follow it.
  useEffect(() => {
    const projectId = toId(form.projectId);
    if (!open || !projectId) return;
    let cancelled = false;
    setLoadingOptions(true);
    setError(null);
    redmineApi.projects
      .formOptions(projectId)
      .then((next) => {
        if (cancelled) return;
        setOptions(next);
        const meIsMember = next.assignees.some((a) => a.id === next.me);
        setForm((f) => ({
          ...f,
          trackerId: next.trackers[0] ? String(next.trackers[0].id) : '',
          priorityId: next.defaultPriorityId ? String(next.defaultPriorityId) : '',
          assigneeId: meIsMember ? String(next.me) : UNASSIGNED,
        }));
      })
      .catch((err) => !cancelled && setError(redmineErrorMessage(err)))
      .finally(() => !cancelled && setLoadingOptions(false));
    return () => {
      cancelled = true;
    };
  }, [open, form.projectId]);

  const projectId = toId(form.projectId);
  const subject = form.subject.trim();
  const canSubmit = Boolean(projectId && subject) && !loadingOptions && !saving;

  const handleCreate = useCallback(async () => {
    if (!projectId || !subject) return;
    setSaving(true);
    setError(null);
    try {
      const result = await redmineApi.issues.create({
        projectId,
        subject,
        trackerId: toId(form.trackerId),
        description: form.description,
        assigneeId: toId(form.assigneeId),
        priorityId: toId(form.priorityId),
      });
      onCreated(result.issueId, mismatchWarning(result.mismatches));
      onClose();
    } catch (err) {
      setError(redmineErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [projectId, subject, form, onCreated, onClose]);

  return (
    <Modal open={open} onOpenChange={(next) => !next && onClose()} size="lg">
      <ModalHeader>
        <ModalTitle>New Redmine issue</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        {/* Plain <form>: @mieweb/ui has no Form primitive, and this gives Enter-to-submit. */}
        <form
          className="redmine-issue-create space-y-4"
          aria-label="New Redmine issue"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void handleCreate();
          }}
        >
          <div className="redmine-issue-create-messages" aria-live="polite">
            {error && (
              <Alert variant="danger" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {loadingProjects ? (
            <div className="redmine-issue-create-loading flex justify-center py-6">
              <Spinner size="lg" label="Loading your Redmine projects" />
            </div>
          ) : (
            <>
              <div className="redmine-issue-create-scope grid gap-4 sm:grid-cols-2">
                <Select
                  label="Project"
                  searchable
                  placeholder="Choose a project"
                  options={toOptions(projects ?? [])}
                  value={form.projectId}
                  onValueChange={(value) => update({ projectId: value })}
                />
                <Select
                  label="Tracker"
                  options={toOptions(options?.trackers ?? [])}
                  value={form.trackerId}
                  onValueChange={(trackerId) => update({ trackerId })}
                  disabled={!options || loadingOptions}
                />
              </div>

              <Input
                label="Subject"
                required
                maxLength={MAX_SUBJECT_LENGTH}
                value={form.subject}
                onChange={(e) => update({ subject: e.target.value })}
                placeholder="What needs doing?"
              />

              <Textarea
                label="Description"
                rows={6}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                helperText="Optional. Uses Redmine's formatting."
              />

              <div className="redmine-issue-create-people grid gap-4 sm:grid-cols-2">
                <Select
                  label="Assignee"
                  searchable
                  options={assigneeOptions(options?.assignees ?? [], options?.me ?? null)}
                  value={form.assigneeId}
                  onValueChange={(assigneeId) => update({ assigneeId })}
                  disabled={!options || loadingOptions}
                />
                <Select
                  label="Priority"
                  options={toOptions(options?.priorities ?? [])}
                  value={form.priorityId}
                  onValueChange={(priorityId) => update({ priorityId })}
                  disabled={!options || loadingOptions}
                />
              </div>
            </>
          )}
        </form>
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
          {saving ? 'Creating…' : 'Create in Redmine'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
