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
import { Button, Spinner, Text, Textarea } from '@mieweb/ui';
import React, { useState } from 'react';

import { huddleApi } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { useTeam } from '../../lib/TeamContext';
import { formatTimer, getActiveClockSeconds, toDateString } from '../../lib/timeUtils';
import { useClockToggle } from '../../lib/useClockToggle';
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

  const { teamId: gateTeamId, teamName, requirePlan, todayPost, planMissing, wrapUpMissing } =
    planGate;

  const isClockedIn = !!activeClockEvent;
  const isPaused = !!activeClockEvent?.isPaused;
  const sessionSeconds = getActiveClockSeconds(activeClockEvent, currentTime);

  // ── Composer state (plan before clock-in, wrap-up before clock-out) ──
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const composerMode: 'plan' | 'wrapup' | null = !isClockedIn
    ? planMissing
      ? 'plan'
      : null
    : wrapUpMissing
      ? 'wrapup'
      : null;

  async function postPlanAndClockIn() {
    const trimmed = text.trim();
    if (!gateTeamId || !trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      await getDdpClient().call('huddle.createPost', {
        teamId: gateTeamId,
        content: { text: trimmed, mentions: [] },
        postDate: toDateString(new Date()),
      });
      setText('');
      await clockIn({ planJustPosted: true });
    } catch (e) {
      setPostError(e instanceof Error ? e.message : 'Failed to post. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  async function postWrapUpAndClockOut() {
    const trimmed = text.trim();
    if (!todayPost || !trimmed || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      await huddleApi.updatePost(
        todayPost.id,
        {
          text: `${todayPost.content.text}\n\n**Wrap-up:** ${trimmed}`,
          mentions: todayPost.content.mentions,
        },
        { wrapUp: true },
      );
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
      headline = 'Write today’s plan before clocking in.';
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
      headline = `Add a wrap-up to today’s post${teamSuffix} before clocking out.`;
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
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                composerMode === 'plan'
                  ? 'What are you working on today? One line per item is plenty.'
                  : 'How did it go? A line or two is plenty.'
              }
              rows={6}
              aria-label={composerMode === 'plan' ? 'Today’s plan' : 'Wrap-up for today’s post'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void (composerMode === 'plan' ? postPlanAndClockIn() : postWrapUpAndClockOut());
                }
              }}
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
                {composerMode === 'plan' ? 'Post plan and clock in' : 'Post wrap-up and clock out'}
              </Button>
              <Text variant="muted" size="sm" className="font-mono">
                {!text.trim() &&
                  (composerMode === 'plan' ? 'Write a plan first · ' : 'Write a wrap-up first · ')}
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
