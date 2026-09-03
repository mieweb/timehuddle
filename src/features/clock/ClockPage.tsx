/**
 * ClockPage — plan-first shift screen.
 *
 * Reads top-to-bottom as a gate rather than a dashboard:
 *   1. Status — eyebrow + a big bold session timer (elapsed time this
 *      shift, not the wall clock) + a "plan required" badge when the team
 *      gate is on. Break/Resume lives here, beside the timer, so it stays
 *      on screen whichever composer is open below.
 *   2. Composer — plan-before-clock-in / wrap-up-before-clock-out, with the
 *      same Photo/Video/Doc/Pulse/Ticket/@Mention bar as the Huddle composer
 *      (⌘/Ctrl+↵ submits).
 *   3. Recent sessions — the user's last completed sessions on this team.
 *
 * Gate state comes from useClockToggle.planGate (realtime via DDP), so this
 * page never needs a reload. With the team setting off, it's a plain
 * clock-in/out screen.
 */
import { faMugHot, faPlay, faStop } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { clockApi, huddleApi, type ClockEvent, type HuddlePost } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import {
  formatDate,
  formatDuration,
  formatTime,
  formatTimer,
  getActiveClockSeconds,
  toDateString,
} from '../../lib/timeUtils';
import { useClockToggle } from '../../lib/useClockToggle';
import { MarkdownEditor } from '../huddle/MarkdownEditor';
import { useAttachmentUpload, useUploadProgress } from '../huddle/useAttachmentUpload';
import { toPostAttachment } from '../huddle/api';
import { clearComposerPulseUpload } from '../huddle/pulseComposerUpload';
import {
  ComposerAttachButtons,
  ComposerChips,
  type MentionRef,
} from '../huddle/ComposerAttachments';
import { ComposerProgress } from '../huddle/ComposerProgress';
import type { MediaItem } from '../huddle/types';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';
import { WorkspaceGreeting } from '../../ui/WorkspaceGreeting';

// ─── ClockPage ────────────────────────────────────────────────────────────────

export const ClockPage: React.FC = () => {
  const { selectedTeamId, activeClockEvent, currentTime, teamsReady } = useTeam();
  const { navigate } = useRouter();

  const {
    clockIn,
    clockOut,
    pauseClock,
    resumeClock,
    clockInLoading,
    clockOutLoading,
    clockPauseLoading,
    clockOutBlockedReason,
    planGate,
  } = useClockToggle();

  const {
    teamId: gateTeamId,
    teamName,
    requirePlan,
    sessionPost,
    planMissing,
    wrapUpMissing,
  } = planGate;

  const isClockedIn = !!activeClockEvent;
  const isPaused = !!activeClockEvent?.isPaused;
  const sessionSeconds = getActiveClockSeconds(activeClockEvent, currentTime);

  // ── Composer state (plan before clock-in, wrap-up before clock-out) ──
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Bumped to remount the (uncontrolled) editor — clears it after posting and
  // re-seeds it when a draft loads.
  const [editorKey, setEditorKey] = useState(0);

  // ── Drafts — save a plan without publishing/clocking in ──
  type DraftRef = Pick<HuddlePost, 'id' | 'content'>;
  const [draft, setDraft] = useState<DraftRef | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  // ── Attach/ticket/mention controls — same action bar as the Huddle composer ──
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>(undefined);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  // Completed fraction (0–1) of an attachment upload in flight, or null when
  // none is — same single-bar treatment as the Huddle composer, aggregated
  // across the pickers and paste so an overlapping pair can't read as idle.
  const { fraction: uploadFraction, reporterFor } = useUploadProgress();
  // A Pulse recording reserved but not yet attached.
  const [pulsePending, setPulsePending] = useState(false);
  // Posting mid-upload would drop the attachment still on the wire, and posting
  // with a Pulse recording outstanding would clear its reservation and change
  // composer mode — unmounting the watcher before the clip lands. Every submit
  // path stays closed until both have settled.
  const uploadInFlight = uploadFraction !== null || pulsePending;
  // useCallback: identity flows into the paste listener MarkdownEditor binds
  // natively, which would otherwise re-register on every keystroke.
  const handleAttachmentAdd = useCallback(
    (media: MediaItem) => setAttachments((prev) => [...prev, media]),
    [],
  );
  const handleAttachmentRemove = (mediaId: string) => {
    // Removing the Pulse video chip also forgets its persisted upload, so a
    // recording that finishes afterward doesn't reattach itself.
    const removed = attachments.find((m) => m.id === mediaId);
    if (removed?.type === 'video' && composerMode) {
      clearComposerPulseUpload(`clock-${composerMode}`);
    }
    setAttachments((prev) => prev.filter((m) => m.id !== mediaId));
  };
  // Same paste-a-screenshot handling as the Huddle composer — both share the
  // editor, so both must keep base64 images out of the post text.
  const { upload: uploadPastedImages } = useAttachmentUpload({
    onAttachmentAdd: handleAttachmentAdd,
    onUploadProgress: reporterFor('paste'),
  });
  const handleMentionSelect = (userId: string, name: string) =>
    setMentions((prev) =>
      prev.some((m) => m.userId === userId) ? prev : [...prev, { userId, name }],
    );
  const handleMentionRemove = (userId: string) =>
    setMentions((prev) => prev.filter((m) => m.userId !== userId));

  // ── Recent sessions — the user's last completed sessions on this team ──
  const recentSessionsTeamId = gateTeamId ?? selectedTeamId;
  const [recentSessions, setRecentSessions] = useState<ClockEvent[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(true);

  useEffect(() => {
    if (!recentSessionsTeamId) {
      setRecentSessions([]);
      setRecentSessionsLoading(false);
      return;
    }
    let cancelled = false;
    setRecentSessionsLoading(true);
    clockApi
      .getEvents()
      .then((events) => {
        if (cancelled) return;
        const completed = events
          .filter((e) => e.teamId === recentSessionsTeamId && e.endTime != null)
          .sort((a, b) => b.startTime - a.startTime)
          .slice(0, 8);
        setRecentSessions(completed);
      })
      .catch(() => {
        if (!cancelled) setRecentSessions([]);
      })
      .finally(() => {
        if (!cancelled) setRecentSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever a session finishes so the list stays current.
  }, [recentSessionsTeamId, isClockedIn]);

  const composerMode: 'plan' | 'wrapup' | null = !isClockedIn
    ? planMissing
      ? 'plan'
      : null
    : wrapUpMissing
      ? 'wrapup'
      : null;

  // Load the latest draft when the plan composer opens (prefill source below).
  useEffect(() => {
    if (composerMode !== 'plan' || !gateTeamId) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    huddleApi
      .getMyLatestDraft(gateTeamId)
      .then((post) => {
        if (!cancelled && post) setDraft(post);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [composerMode, gateTeamId]);

  // The wrap-up seed normally comes from `sessionPost` (DDP-backed, realtime).
  // Its initial subscription sync is slow over a mobile/LAN connection, so the
  // wrap-up editor visibly loads its plan text late in Capacitor. Fetch the same
  // post directly (one-shot wormhole call) so it seeds immediately; the DDP copy
  // still takes over for realtime once it arrives.
  const [sessionPostFetch, setSessionPostFetch] = useState<DraftRef | null>(null);
  useEffect(() => {
    if (composerMode !== 'wrapup' || !gateTeamId || !activeClockEvent?.id) {
      setSessionPostFetch(null);
      return;
    }
    let cancelled = false;
    setSessionPostFetch(null);
    huddleApi
      .getMyPostForSession(gateTeamId, activeClockEvent.id)
      .then((post) => {
        if (!cancelled) setSessionPostFetch(post);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [composerMode, gateTeamId, activeClockEvent?.id]);

  // Content pre-loaded into the (uncontrolled) editor for the current composer:
  //   • plan   → the latest saved draft, so you keep editing it.
  //   • wrapup → THIS session's plan post, so clocking out continues the same
  //              content you wrote at clock-in instead of a blank box.
  const seedText =
    composerMode === 'plan'
      ? (draft?.content.text ?? '')
      : composerMode === 'wrapup'
        ? (sessionPost?.content.text ?? sessionPostFetch?.content.text ?? '')
        : '';

  // Caches the plan post ID immediately after creation so postWrapUpAndClockOut
  // can update the right post even if the DDP subscription hasn't synced yet.
  const cachedPlanPostIdRef = useRef<string | null>(null);

  // Apply the seed once it becomes available (draft / session post load async),
  // unless the user has already started typing. Remount the uncontrolled editor
  // via `editorKey` so it picks up the seeded value.
  const seededTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!composerMode || !seedText) return;
    const token = `${composerMode}:${seedText}`;
    if (seededTokenRef.current === token) return;
    seededTokenRef.current = token;
    setText((current) => (current.trim() ? current : seedText));
    setEditorKey((k) => k + 1);
  }, [composerMode, seedText]);

  // Clear attach/ticket/mention selections whenever the composer opens fresh
  // (mode switches between plan/wrap-up/hidden, e.g. after a successful post).
  useEffect(() => {
    setAttachments([]);
    setSelectedTicketId(undefined);
    setMentions([]);
  }, [composerMode]);

  async function saveDraft() {
    const trimmed = text.trim();
    if (!gateTeamId || !trimmed || savingDraft || posting || uploadInFlight) return;
    setSavingDraft(true);
    setPostError(null);
    try {
      const mentionUserIds = mentions.length ? mentions.map((m) => m.userId) : undefined;
      const postAttachments = attachments.map(toPostAttachment);
      if (draft) {
        await huddleApi.updatePost(
          draft.id,
          { text: trimmed, mentions: mentionUserIds ?? draft.content.mentions },
          {
            attachments: postAttachments.length ? postAttachments : undefined,
            ticketId: selectedTicketId,
          },
        );
        setDraft({ ...draft, content: { ...draft.content, text: trimmed } });
      } else {
        const created = await huddleApi.createPost({
          teamId: gateTeamId,
          content: { text: trimmed, mentions: mentionUserIds ?? [] },
          ticketId: selectedTicketId,
          attachments: postAttachments,
          draft: true,
        });
        setDraft({ id: created.id, content: { text: trimmed, mentions: mentionUserIds ?? [] } });
      }
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2500);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to save draft. Please try again.');
    } finally {
      setSavingDraft(false);
    }
  }

  async function postPlanAndClockIn() {
    const trimmed = text.trim();
    if (!gateTeamId || !trimmed || posting || uploadInFlight) return;
    setPosting(true);
    setPostError(null);
    try {
      let planPostId: string;
      const mentionUserIds = mentions.length ? mentions.map((m) => m.userId) : undefined;
      const postAttachments = attachments.map(toPostAttachment);
      if (draft) {
        // Publishing the draft (with any edits) is this session's plan post.
        const publishedMentions = mentionUserIds ?? draft.content.mentions;
        await huddleApi.publishPost(draft.id, toDateString(new Date()), {
          text: trimmed,
          mentions: publishedMentions,
        });
        planPostId = draft.id;
        if (postAttachments.length > 0 || selectedTicketId) {
          await huddleApi.updatePost(
            planPostId,
            { text: trimmed, mentions: publishedMentions },
            {
              attachments: postAttachments.length ? postAttachments : undefined,
              ticketId: selectedTicketId,
            },
          );
        }
        setDraft(null);
      } else {
        const created = await huddleApi.createPost({
          teamId: gateTeamId,
          content: { text: trimmed, mentions: mentionUserIds ?? [] },
          ticketId: selectedTicketId,
          attachments: postAttachments,
          postDate: toDateString(new Date()),
        });
        planPostId = created.id;
      }
      // Cache the plan post ID so postWrapUpAndClockOut can find it even if
      // the DDP subscription hasn't synced the new post back to this client yet.
      cachedPlanPostIdRef.current = planPostId;
      clearComposerPulseUpload('clock-plan');
      setText('');
      // Link this plan to the new session so the per-session gate finds it.
      await clockIn({ planJustPosted: true, planPostId });
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  async function postWrapUpAndClockOut() {
    const trimmed = text.trim();
    if (!activeClockEvent || !trimmed || posting || uploadInFlight) return;
    setPosting(true);
    setPostError(null);
    try {
      // Use sessionPost from DDP if available, otherwise fall back to the
      // cached post ID (handles the race where the plan post was just created
      // but hasn't arrived via DDP subscription yet).
      const effectivePostId = sessionPost?.id ?? cachedPlanPostIdRef.current;
      const mentionUserIds = mentions.length ? mentions.map((m) => m.userId) : undefined;
      const postAttachments = attachments.map(toPostAttachment);
      if (effectivePostId) {
        // Normal flow: update the plan post with the wrap-up.
        await huddleApi.updatePost(
          effectivePostId,
          {
            text: trimmed,
            mentions: mentionUserIds ?? sessionPost?.content.mentions ?? [],
          },
          {
            wrapUp: true,
            attachments: postAttachments.length ? postAttachments : undefined,
            ticketId: selectedTicketId,
          },
        );
      } else {
        // Recovery: no plan post exists (gate enabled mid-shift). Create one
        // that doubles as the wrap-up, linked to the session. Unlike the
        // update path above this needs a team, and the wrap-up composer can
        // open without one — surface that instead of posting a teamless post.
        if (!gateTeamId) throw new Error('No team for this session — cannot post a wrap-up.');
        await huddleApi.createPost({
          teamId: gateTeamId,
          content: { text: `**Wrap-up:** ${trimmed}`, mentions: mentionUserIds ?? [] },
          postDate: toDateString(new Date()),
          clockEventId: activeClockEvent.id,
          wrapUp: true,
          ticketId: selectedTicketId,
          attachments: postAttachments,
        });
      }
      setText('');
      cachedPlanPostIdRef.current = null;
      clearComposerPulseUpload('clock-wrapup');
      await clockOut();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  // ── Status card copy ──
  const eyebrow = !isClockedIn ? 'Clocked out' : isPaused ? 'On break' : 'Clocked in';

  // ── Composer card copy — always says what's blocking you ──
  const teamSuffix = teamName && gateTeamId !== selectedTeamId ? ` in “${teamName}”` : '';
  const composerTitle =
    composerMode === 'plan' ? 'Plan before you clock in' : 'Wrap up before you clock out';
  let composerDescription: React.ReactNode = null;
  if (composerMode === 'plan') {
    composerDescription = (
      <>
        This team requires a short plan before clocking in. It's posted to Huddle so your team can
        see what you're working on.{' '}
        <button
          type="button"
          onClick={() => navigate('/app/huddle')}
          className="underline underline-offset-2"
        >
          Open huddle
        </button>
      </>
    );
  } else if (composerMode === 'wrapup') {
    composerDescription = `Add a quick wrap-up of what you did this session${teamSuffix} before clocking out.`;
  }

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage fill>
      <div className="clock-screen flex h-full min-h-0 flex-col gap-3 overflow-y-auto md:gap-6 md:mx-auto md:w-full md:max-w-4xl">
        {/* Names the workspace before you act, not after: hours logged against
            the wrong team are tedious to unpick. */}
        <WorkspaceGreeting
          className="py-3 md:py-4"
          note={
            isClockedIn
              ? 'Your shift is running — the time is being logged here.'
              : 'Any time you track here gets logged to this workspace.'
          }
        />

        {/* ── Status — eyebrow + big bold session timer ──
             The surface is tinted by state rather than being a fixed dark slab
             with a red underline: that read as an error banner on a light page
             and, in dark mode, sank into the background so only the red line
             showed. Tinting carries the state in both themes and gives the
             Break button a surface it contrasts against. Text colour is
             inherited (`opacity-*`, not `text-white/*`) so it follows. */}
        <div
          className={cn(
            'clock-status shrink-0 rounded-2xl border px-4 py-3 text-center transition-colors md:px-5 md:py-6',
            isClockedIn
              ? isPaused
                ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-50'
                : 'border-green-300 bg-green-50 text-green-950 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-50'
              : 'border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50',
          )}
          aria-live="polite"
        >
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] opacity-70">
            <span
              className={cn(
                'h-2.5 w-2.5 shrink-0 rounded-full',
                isClockedIn
                  ? isPaused
                    ? 'bg-amber-500'
                    : 'animate-pulse bg-green-500'
                  : 'bg-neutral-400',
              )}
            />
            {eyebrow}
          </div>
          <div className="mt-1 font-mono text-3xl font-bold tabular-nums md:text-4xl">
            {formatTimer(sessionSeconds)}
          </div>
          {activeClockEvent && (
            <p className="mt-2 text-sm opacity-70">
              since {formatTime(new Date(activeClockEvent.startTime))}
            </p>
          )}
          {/* Break/Resume lives with the timer so it stays visible in every
              state — plain actions, plan composer, wrap-up composer — instead
              of scrolling away below whichever composer happens to be open.
              Filled and full-size on its own line: as a small outline button
              tucked beside the timer it was easy to miss entirely. */}
          {isClockedIn && (
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() => void (isPaused ? resumeClock() : pauseClock())}
                isLoading={clockPauseLoading}
                aria-label={isPaused ? 'Resume work' : 'Start break'}
                leftIcon={<FontAwesomeIcon icon={isPaused ? faPlay : faMugHot} />}
                className="gap-2 rounded-full px-6 font-semibold shadow-md transition-transform hover:scale-105 active:scale-95"
              >
                {isPaused ? 'Resume work' : 'Take a break'}
              </Button>
            </div>
          )}
          {requirePlan && (
            <Badge variant="default" size="sm" className="mt-3">
              Plan required for this team
            </Badge>
          )}
        </div>

        {/* ── Composer — plan before clock-in / wrap-up before clock-out ── */}
        {composerMode && (
          <div className="clock-plan-composer flex shrink-0 flex-col gap-2 md:gap-3">
            <div>
              <Text as="h2" size="base" weight="semibold" className="md:text-lg">
                {composerTitle}
              </Text>
              {composerDescription && (
                <Text variant="muted" size="sm" className="mt-1">
                  {composerDescription}
                </Text>
              )}
            </div>

            <MarkdownEditor
              key={`${composerMode}-${editorKey}`}
              value={seedText}
              onChange={setText}
              onSubmit={() =>
                void (composerMode === 'plan' ? postPlanAndClockIn() : postWrapUpAndClockOut())
              }
              onImagePaste={uploadPastedImages}
            />

            {/* ── Ticket / mention / attachment chips ── */}
            <ComposerChips
              selectedTicketId={selectedTicketId}
              onTicketRemove={() => setSelectedTicketId(undefined)}
              mentions={mentions}
              onMentionRemove={handleMentionRemove}
              attachments={attachments}
              onAttachmentRemove={handleAttachmentRemove}
            />

            {/* ── Attach bar — same Photo/Video/Doc/Pulse/Ticket/@Mention controls as Huddle ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <ComposerAttachButtons
                teamId={gateTeamId}
                pulseScope={`clock-${composerMode}`}
                onAttachmentAdd={handleAttachmentAdd}
                selectedTicketId={selectedTicketId}
                onTicketSelect={setSelectedTicketId}
                onMentionSelect={handleMentionSelect}
                onUploadProgress={reporterFor('picker')}
                onPulsePendingChange={setPulsePending}
              />
            </div>

            <ComposerProgress uploadFraction={uploadFraction} posting={posting} />

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                variant="primary"
                onClick={() =>
                  void (composerMode === 'plan' ? postPlanAndClockIn() : postWrapUpAndClockOut())
                }
                isLoading={posting || clockInLoading || clockOutLoading}
                disabled={!text.trim() || uploadInFlight}
                className="w-full sm:w-auto"
              >
                {composerMode === 'plan'
                  ? draft
                    ? 'Publish plan and clock in'
                    : 'Post plan and clock in'
                  : 'Post wrap-up and clock out'}
              </Button>
              {composerMode === 'plan' && (
                <Button
                  variant="outline"
                  onClick={() => void saveDraft()}
                  isLoading={savingDraft}
                  disabled={!text.trim() || uploadInFlight}
                  className="w-full sm:w-auto"
                >
                  {draft ? 'Update draft' : 'Save draft'}
                </Button>
              )}
              <Text variant="muted" size="sm" className="font-mono">
                {draftSaved
                  ? 'Draft saved — publish to start your shift · '
                  : !text.trim()
                    ? composerMode === 'plan'
                      ? 'Write a plan first · '
                      : 'Write a wrap-up first · '
                    : ''}
                ⌘↵ to post and {composerMode === 'plan' ? 'clock in' : 'clock out'}
              </Text>
            </div>
            {postError && (
              <Text variant="destructive" size="sm">
                {postError}
              </Text>
            )}
          </div>
        )}

        {/* ── Plain actions when the gate is satisfied (or off) ──
             The one thing you came to this page to do, so it's a large pill
             with an icon rather than a default-sized button in a row of them. */}
        {!composerMode && (
          <div className="clock-actions flex shrink-0 flex-col items-center gap-3">
            {!isClockedIn ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void clockIn()}
                isLoading={clockInLoading}
                disabled={!selectedTeamId}
                aria-label="Clock in"
                leftIcon={<FontAwesomeIcon icon={faPlay} />}
                className="w-full gap-3 rounded-full py-4 text-base font-semibold shadow-lg transition-transform hover:scale-[1.02] active:scale-95 sm:w-auto sm:min-w-72"
              >
                Clock in
              </Button>
            ) : (
              <Button
                variant="danger"
                size="lg"
                onClick={() => void clockOut()}
                isLoading={clockOutLoading}
                aria-label="Clock out"
                leftIcon={<FontAwesomeIcon icon={faStop} />}
                className="w-full gap-3 rounded-full py-4 text-base font-semibold shadow-lg transition-transform hover:scale-[1.02] active:scale-95 sm:w-auto sm:min-w-72"
              >
                Clock out
              </Button>
            )}
          </div>
        )}

        {clockOutBlockedReason && (
          <Text variant="warning" size="sm" className="shrink-0" aria-live="polite">
            {clockOutBlockedReason}
          </Text>
        )}

        {/* ── Recent sessions ── */}
        <Card padding="lg" className="clock-recent-sessions mb-4 shrink-0">
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {recentSessionsLoading ? (
              <Spinner size="sm" label="Loading sessions…" />
            ) : recentSessions.length === 0 ? (
              <Text variant="muted" size="sm">
                No sessions yet.
              </Text>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-neutral-800">
                {recentSessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <Text size="sm" weight="medium">
                        {formatDate(new Date(session.startTime))}
                      </Text>
                      <Text variant="muted" size="xs">
                        {formatTime(new Date(session.startTime))} –{' '}
                        {formatTime(new Date(session.endTime as number))}
                      </Text>
                    </div>
                    <Badge variant="secondary" size="sm" className="font-mono">
                      {formatDuration(
                        Math.round((session.endTime! - session.startTime) / 1000) -
                          (session.totalBreakSeconds ?? 0),
                      )}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
};
