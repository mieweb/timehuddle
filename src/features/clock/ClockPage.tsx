/**
 * ClockPage — plan-first shift screen.
 *
 * Reads top-to-bottom as a gate rather than a dashboard:
 *   1. Banner — status lamp + one plain sentence that always says what's
 *      blocking you (Ready to work → Plan posted → On shift).
 *   2. Composer — plain textarea with a single combined action: "Post plan
 *      and clock in" / "Post wrap-up and clock out" (⌘/Ctrl+↵ submits).
 *   3. Clock module — compact seven-segment punch clock pinned near the
 *      bottom with a live status readout line.
 *
 * Gate state comes from useClockToggle.planGate (realtime via DDP), so this
 * page never needs a reload. With the team setting off, it's a plain
 * clock-in/out screen.
 */
import { Button, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { huddleApi, type HuddlePost } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { useTeam } from '../../lib/TeamContext';
import { formatTimer, getActiveClockSeconds, toDateString } from '../../lib/timeUtils';
import { useClockToggle } from '../../lib/useClockToggle';
import { MarkdownEditor } from '../huddle/MarkdownEditor';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

// Figure space keeps single-digit hours aligned against the 88:88:88 backdrop.
const FIGURE_SPACE = '\u2007';

function clockParts(now: number) {
  const d = new Date(now);
  let hours = d.getHours() % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, FIGURE_SPACE);
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const meridiem = d.getHours() >= 12 ? 'PM' : 'AM';
  const date = d
    .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
  return { time: `${hh}:${mm}:${ss}`, meridiem, date };
}

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

  const { teamId: gateTeamId, teamName, requirePlan, sessionPost, planMissing, wrapUpMissing } =
    planGate;

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

  const composerMode: 'plan' | 'wrapup' | null = !isClockedIn
    ? planMissing
      ? 'plan'
      : null
    : wrapUpMissing
      ? 'wrapup'
      : null;

  // Load the latest draft when the plan composer opens; prefill once.
  useEffect(() => {
    if (composerMode !== 'plan' || !gateTeamId) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    huddleApi
      .getMyLatestDraft(gateTeamId)
      .then((post) => {
        if (cancelled || !post) return;
        setDraft(post);
        setText((current) => {
          if (current.trim()) return current;
          // Remount the editor so it shows the loaded draft content.
          setEditorKey((k) => k + 1);
          return post.content.text;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [composerMode, gateTeamId]);

  async function saveDraft() {
    const trimmed = text.trim();
    if (!gateTeamId || !trimmed || savingDraft || posting) return;
    setSavingDraft(true);
    setPostError(null);
    try {
      if (draft) {
        await huddleApi.updatePost(draft.id, {
          text: trimmed,
          mentions: draft.content.mentions,
        });
        setDraft({ ...draft, content: { ...draft.content, text: trimmed } });
      } else {
        const created = await huddleApi.saveDraft(gateTeamId, { text: trimmed, mentions: [] });
        setDraft({ id: created.id, content: { text: trimmed, mentions: [] } });
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
    if (!gateTeamId || !trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      let planPostId: string;
      if (draft) {
        // Publishing the draft (with any edits) is this session's plan post.
        await huddleApi.publishPost(draft.id, toDateString(new Date()), {
          text: trimmed,
          mentions: draft.content.mentions,
        });
        planPostId = draft.id;
        setDraft(null);
      } else {
        const created = (await getDdpClient().call('huddle.createPost', {
          teamId: gateTeamId,
          content: { text: trimmed, mentions: [] },
          postDate: toDateString(new Date()),
        })) as { id: string };
        planPostId = created.id;
      }
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
    if (!activeClockEvent || !trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      if (sessionPost) {
        await huddleApi.updatePost(
          sessionPost.id,
          {
            text: `${sessionPost.content.text}\n\n**Wrap-up:** ${trimmed}`,
            mentions: sessionPost.content.mentions,
          },
          { wrapUp: true },
        );
      } else {
        // Recovery: this session has no plan post (e.g. gate was enabled
        // mid-shift). Create one that doubles as the wrap-up, linked to the
        // session so the gate is satisfied.
        await getDdpClient().call('huddle.createPost', {
          teamId: gateTeamId,
          content: { text: `**Wrap-up:** ${trimmed}`, mentions: [] },
          postDate: toDateString(new Date()),
          clockEventId: activeClockEvent.id,
          wrapUp: true,
        });
      }
      setText('');
      await clockOut();
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  // ── Banner copy — always says what's blocking you ──
  const teamSuffix = teamName && gateTeamId !== selectedTeamId ? ` in “${teamName}”` : '';
  let eyebrow: string;
  let headline: string;
  let subline: React.ReactNode = null;
  if (!isClockedIn) {
    eyebrow = 'Ready to work';
    if (composerMode === 'plan') {
      headline = 'Write a plan before starting this session.';
      subline = (
        <>
          Posting starts your shift.{' '}
          <button
            type="button"
            onClick={() => navigate('/app/huddle')}
            className="underline underline-offset-2 hover:text-white"
          >
            Open huddle
          </button>
        </>
      );
    } else if (requirePlan) {
      headline = 'Plan posted — you’re set to clock in.';
    } else {
      headline = 'You’re set to clock in.';
    }
  } else {
    eyebrow = isPaused ? 'On break' : 'On shift';
    if (composerMode === 'wrapup') {
      headline = `Add a wrap-up to this session’s post${teamSuffix} before clocking out.`;
      subline = 'Posting ends your shift.';
    } else {
      headline = `Clocked in — ${formatTimer(sessionSeconds)} this shift.`;
    }
  }

  const { time, meridiem, date } = clockParts(currentTime);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <AppPage fill>
      <div className="clock-screen flex h-full min-h-0 flex-col gap-6">
        {/* ── Banner — the gate, in one sentence ── */}
        <div
          className="clock-banner shrink-0 rounded-2xl border-b-4 border-red-600 bg-neutral-900 px-5 py-4 text-white dark:bg-neutral-950"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">
            <span
              className={[
                'h-2.5 w-2.5 shrink-0 rounded-full',
                isClockedIn ? (isPaused ? 'bg-amber-400' : 'bg-green-500') : 'bg-red-500',
              ].join(' ')}
            />
            {eyebrow}
          </div>
          <Text as="h2" size="xl" weight="semibold" className="mt-1 text-white">
            {headline}
          </Text>
          {subline && <p className="mt-1 text-sm text-white/60">{subline}</p>}
        </div>

        {/* ── Composer — one box, one combined action ── */}
        {composerMode && (
          <div className="clock-plan-composer flex shrink-0 flex-col gap-3">
            <MarkdownEditor
              key={`${composerMode}-${editorKey}`}
              value={composerMode === 'plan' ? (draft?.content.text ?? '') : ''}
              onChange={setText}
              onSubmit={() =>
                void (composerMode === 'plan' ? postPlanAndClockIn() : postWrapUpAndClockOut())
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() =>
                  void (composerMode === 'plan' ? postPlanAndClockIn() : postWrapUpAndClockOut())
                }
                isLoading={posting || clockInLoading || clockOutLoading}
                disabled={!text.trim()}
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
                  disabled={!text.trim()}
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

        {/* ── Plain actions when the gate is satisfied (or off) ── */}
        {!composerMode && (
          <div className="clock-actions flex shrink-0 flex-wrap items-center gap-3">
            {!isClockedIn ? (
              <Button
                variant="primary"
                onClick={() => void clockIn()}
                isLoading={clockInLoading}
                disabled={!selectedTeamId}
                aria-label="Clock in"
              >
                Clock in
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  onClick={() => void clockOut()}
                  isLoading={clockOutLoading}
                  aria-label="Clock out"
                >
                  Clock out
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void (isPaused ? resumeClock() : pauseClock())}
                  isLoading={clockPauseLoading}
                  aria-label={isPaused ? 'Resume work' : 'Start break'}
                >
                  {isPaused ? 'Resume' : 'Break'}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Break/Resume stays reachable while the wrap-up composer is up */}
        {composerMode === 'wrapup' && (
          <div className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void (isPaused ? resumeClock() : pauseClock())}
              isLoading={clockPauseLoading}
              aria-label={isPaused ? 'Resume work' : 'Start break'}
            >
              {isPaused ? 'Resume' : 'Break'}
            </Button>
          </div>
        )}

        {clockOutBlockedReason && (
          <Text variant="warning" size="sm" className="shrink-0" aria-live="polite">
            {clockOutBlockedReason}
          </Text>
        )}

        {/* ── Clock module — compact punch clock near the bottom ── */}
        <div className="clock-module mx-auto mb-4 mt-auto w-fit shrink-0 rounded-2xl bg-neutral-900 px-8 py-5 text-white shadow-xl dark:bg-black">
          <div className="relative font-mono text-4xl font-bold leading-none tabular-nums">
            <span aria-hidden className="absolute inset-0 select-none text-white/10">
              88:88:88
            </span>
            <span className="relative">{time}</span>
            <span className="relative ml-2 align-top text-xs font-semibold text-white/70">
              {meridiem}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">
            <span
              className={[
                'h-2 w-2 shrink-0 rounded-full',
                isClockedIn
                  ? isPaused
                    ? 'bg-amber-400'
                    : 'animate-pulse bg-green-500'
                  : 'bg-red-500',
              ].join(' ')}
            />
            <span>
              {isClockedIn
                ? `${isPaused ? 'On break' : 'On shift'} ${formatTimer(sessionSeconds)}`
                : 'Not clocked in'}
              {' · '}
              {date}
            </span>
          </div>
        </div>
      </div>
    </AppPage>
  );
};
