/**
 * DraftsPanel — manage multiple author-only draft plans.
 *
 * Drafts never appear in the team feed and don't satisfy the clock gate;
 * they're a place to prepare plans ahead of time. Create as many as you like,
 * edit them, delete them, or publish one to the feed. Publishing a draft as a
 * session plan (with clock-in) happens on the Clock page.
 */
import { Button, Spinner, Text } from '@mieweb/ui';
import { useCallback, useEffect, useState } from 'react';

import { huddleApi, type HuddlePost } from '@lib/api';
import { toDateString } from '@lib/timeUtils';
import { HuddleComposer } from './HuddleComposer';
import { MarkdownContent } from './MarkdownContent';
import type { ComposerContent } from './types';

interface DraftsPanelProps {
  teamId: string;
  userInitials: string;
  userColor: 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';
}

export function DraftsPanel({ teamId, userInitials, userColor }: DraftsPanelProps) {
  const [drafts, setDrafts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setDrafts(await huddleApi.getMyDrafts(teamId));
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function createDraft(content: ComposerContent) {
    const mentions = (content.mentions ?? []).map((m) => m.userId);
    await huddleApi.saveDraft(teamId, { text: content.text, mentions });
    await refetch();
  }

  async function updateDraft(id: string, content: ComposerContent) {
    const mentions = (content.mentions ?? []).map((m) => m.userId);
    await huddleApi.updatePost(id, { text: content.text, mentions });
    setEditingId(null);
    await refetch();
  }

  async function publishDraft(id: string) {
    setBusyId(id);
    try {
      await huddleApi.publishPost(id, toDateString(new Date()));
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDraft(id: string) {
    setBusyId(id);
    try {
      await huddleApi.deletePost(id);
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="huddle-drafts flex h-full min-h-0 flex-col gap-4">
      {/* New draft composer */}
      <div className="shrink-0">
        <HuddleComposer
          key="new-draft"
          onPost={createDraft}
          userInitials={userInitials}
          userColor={userColor}
          submitLabel="Save draft"
          collapsedLabel="Start a new draft…"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Spinner size="md" label="Loading drafts…" />
          </div>
        )}

        {!loading && drafts.length === 0 && (
          <div className="flex items-center justify-center py-16 px-4">
            <Text variant="muted" size="sm">
              No drafts yet. Draft a plan above and it stays private until you publish it.
            </Text>
          </div>
        )}

        {!loading &&
          drafts.map((draft) =>
            editingId === draft.id ? (
              <div key={draft.id} className="mb-3">
                <HuddleComposer
                  key={`edit-${draft.id}`}
                  onPost={(content) => void updateDraft(draft.id, content)}
                  userInitials={userInitials}
                  userColor={userColor}
                  initialText={draft.content.text}
                  submitLabel="Save draft"
                />
                <div className="mt-1 px-5">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel edit
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={draft.id}
                className="draft-card mb-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-700 dark:bg-neutral-800"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Text variant="muted" size="xs" weight="semibold" className="uppercase tracking-widest">
                    Draft
                  </Text>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(draft.id)}
                      disabled={busyId === draft.id}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void publishDraft(draft.id)}
                      isLoading={busyId === draft.id}
                    >
                      Publish
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteDraft(draft.id)}
                      disabled={busyId === draft.id}
                      aria-label="Delete draft"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <MarkdownContent content={draft.content.text} />
              </div>
            ),
          )}
      </div>
    </div>
  );
}
