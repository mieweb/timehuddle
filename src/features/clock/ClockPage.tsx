/**
 * ClockPage — plan-first shift screen.
 *
 * Reads top-to-bottom as a gate rather than a dashboard:
 *   1. Status — eyebrow + a big bold session timer (elapsed time this
 *      shift, not the wall clock) + either the active ticket badge (when a
 *      ticket timer is running) or a "plan required" badge when the team
 *      gate is on and no ticket is running. Break/Resume lives here, beside
 *      the timer, so it stays on screen whichever composer is open below.
 *   2. Composer — plan-before-clock-in / wrap-up-before-clock-out, with the
 *      same Photo/Video/Doc/Ticket/@Mention bar as the Huddle composer
 *      (⌘/Ctrl+↵ submits).
 *   3. Recent sessions — the user's last completed sessions on this team.
 *
 * Gate state comes from useClockToggle.planGate (realtime via DDP), so this
 * page never needs a reload. With the team setting off, it's a plain
 * clock-in/out screen.
 */
import { faMugHot, faPlay, faStop, faTicket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Button, cn, Input, Spinner, Text } from '@mieweb/ui';
import type { RichEditorHandle } from '@mieweb/ui/kerebron';
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import { huddleApi, type HuddlePost, type PulseUploadStatus } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import {
  formatDuration,
  formatTime,
  formatTimer,
  getActiveClockSeconds,
  toDateString,
} from '../../lib/timeUtils';
import { useClockToggle } from '../../lib/useClockToggle';
import { useRunningTicket } from '../../lib/useRunningTicket';
import { ticketDetailPath } from '../tickets/sources/types';
import { useAttachmentUpload, useUploadProgress } from '../huddle/useAttachmentUpload';
import { useTicketSelection } from '../huddle/useTicketSelection';
import {
  appendImageMarkdown,
  isInlineImage,
  restoreImageAltText,
  toPostAttachment,
} from '../huddle/api';
import {
  ComposerAttachButtons,
  ComposerChips,
  type MentionRef,
} from '../huddle/ComposerAttachments';
import { ComposerProgress } from '../huddle/ComposerProgress';
import { ComposerError } from '../huddle/ComposerError';
import type { MediaItem } from '../huddle/types';
import { useTicketStart } from '../timers/TicketStartProvider';
import { ticketTimerText as timerText, timerLabel } from '../timers/ticketTimerStrings';
import { PulseChip } from '../pulse-upload/PulseButton';
import { PulseUploadModal } from '../pulse-upload/PulseUploadModal';
import { usePulseUpload, type PulseUpload } from '../pulse-upload/usePulseUpload';
import { CLOCK_LOCALE, HUDDLE_LINK_TOKEN, clockText, type ComposerMode } from './clockStrings';
import { RecentSessionsPanel } from './RecentSessionsPanel';
import { RedminePushPanel } from './RedminePushPanel';
import { useRecentSessions } from './useRecentSessions';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

// ─── ClockPage ────────────────────────────────────────────────────────────────

/** The compact "X or Y" pair beside the plan/wrap-up input — the submit
 *  button and the Pulse chip share this exact class list so the two read as
 *  equal alternatives rather than a primary action and an afterthought. `h-10`
 *  is explicit because Pulse's chip is always rendered at Button `size="lg"`
 *  (h-12) internally — without overriding the height directly, matching
 *  padding alone still left it visibly taller than the plan/wrap-up button. */
const COMPACT_PILL = 'h-10 gap-2 rounded-full px-4 text-sm font-semibold shrink-0';

/** "or Clock in/out with Pulse" — beside every way this page clocks in or out. */
const PulseAlternative: React.FC<{ pulse: PulseUpload | null; label: string }> = ({
  pulse,
  label,
}) =>
  pulse && (
    <>
      <Text variant="muted" size="sm" className="shrink-0 text-center">
        {clockText.or}
      </Text>
      <PulseChip pulse={pulse} ariaLabel={label} main={{ label, className: COMPACT_PILL }} />
    </>
  );

// The rich editor is most of this page's code and only shows while a plan or
// wrap-up is being written, so it loads on demand.
const MarkdownEditor = lazy(() =>
  import('../huddle/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
);

export const ClockPage: React.FC = () => {
  const { selectedTeamId, activeClockEvent, currentTime, teamsReady, refetchClock } = useTeam();
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

  // Active ticket under the session timer — shared hook (getRunning + getDay).
  const runningTicket = useRunningTicket(isClockedIn);
  // A timer started while clocked out, waiting for this clock-in (#586).
  const { pending: pendingStart, cancelPending: cancelPendingStart } = useTicketStart();

  // ── Composer state (plan before clock-in, wrap-up before clock-out) ──
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Bumped to remount the (uncontrolled) editor — clears it after posting and
  // re-seeds it when the wrap-up's plan text loads.
  const [editorKey, setEditorKey] = useState(0);
  // Composer-first: a single-line stand-in until focused, so the page reads
  // as "what are you working on?" rather than opening on a full toolbar.
  // Focusing it swaps in the real (rich-text) editor and moves focus there.
  // A composer that already holds something (a wrap-up seeded with the plan's
  // text and tickets) starts expanded instead — see `showEditor` below.
  const [composerExpanded, setComposerExpanded] = useState(false);
  // Only an expand the person asked for moves focus into the editor; one that
  // happens on its own (seeded content) must not pop the keyboard on mobile.
  const focusEditorOnMountRef = useRef(false);
  const expandComposer = () => {
    focusEditorOnMountRef.current = true;
    setComposerExpanded(true);
  };

  // ── Attach/ticket/mention controls — same action bar as the Huddle composer ──
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const {
    tickets: selectedTickets,
    ticketIds: selectedTicketIds,
    setTickets: setSelectedTickets,
    addTicket,
    removeTicket,
  } = useTicketSelection();
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  // Completed fraction (0–1) of an attachment upload in flight, or null when
  // none is — same single-bar treatment as the Huddle composer, aggregated
  // across the pickers and paste so an overlapping pair can't read as idle.
  const { fraction: uploadFraction, reporterFor } = useUploadProgress();
  // Posting mid-upload would drop the attachment still on the wire, so every
  // submit path stays closed until it has settled.
  const uploadInFlight = uploadFraction !== null;
  // One failure notice for the composer, whichever step produced it — see
  // {@link ComposerError}. Reported here rather than via `alert()`.
  const [composerError, setComposerError] = useState<string | null>(null);
  // useCallback: identity flows into the paste/drop listeners MarkdownEditor
  // binds natively, which would otherwise re-register on every keystroke.
  const handleAttachmentAdd = useCallback(
    (media: MediaItem) => setAttachments((prev) => [...prev, media]),
    [],
  );
  const handleAttachmentRemove = (mediaId: string) =>
    setAttachments((prev) => prev.filter((m) => m.id !== mediaId));
  // Same paste/drop-a-screenshot handling as the Huddle composer — both share
  // the editor, so both must keep base64 images out of the post text.
  // Pasted/dropped images are written back into the document so the writer sees
  // the preview inline, and stay attachments too — same handling as the Huddle
  // composer, which shares this editor.
  const handlePastedMediaAdd = useCallback(
    (media: MediaItem) => {
      handleAttachmentAdd(media);
      if (!isInlineImage(media)) return;
      setText((prev) => appendImageMarkdown(prev, media));
    },
    [handleAttachmentAdd],
  );

  const { upload: uploadDroppedMedia } = useAttachmentUpload({
    onAttachmentAdd: handlePastedMediaAdd,
    onUploadProgress: reporterFor('paste'),
    onError: setComposerError,
  });
  // The editor strips alt text off image nodes as it serializes, so every path
  // that persists this composer's text restores the filenames first.
  const composerText = () => restoreImageAltText(text.trim(), attachments);

  const handleMentionSelect = (userId: string, name: string) =>
    setMentions((prev) =>
      prev.some((m) => m.userId === userId) ? prev : [...prev, { userId, name }],
    );
  const handleMentionRemove = (userId: string) =>
    setMentions((prev) => prev.filter((m) => m.userId !== userId));

  // ── Recent sessions — the user's last completed sessions on this team ──
  const recentSessionsTeamId = gateTeamId ?? selectedTeamId;
  const {
    sessions: recentSessions,
    loading: recentSessionsLoading,
    todaySeconds,
    last7DaysSeconds,
  } = useRecentSessions(recentSessionsTeamId, activeClockEvent, currentTime);

  // The composer being submitted stays on screen until its post and clock
  // action have both finished. Otherwise the gate flips first — a posted
  // wrap-up already satisfies it — and the plain Clock out button flashes in,
  // spinning, for the moment clock-out takes.
  const [submittingMode, setSubmittingMode] = useState<ComposerMode | null>(null);
  const composerMode: ComposerMode | null =
    submittingMode ??
    (!isClockedIn ? (planMissing ? 'plan' : null) : wrapUpMissing ? 'wrapup' : null);

  // The wrap-up seed normally comes from `sessionPost` (DDP-backed, realtime).
  // Its initial subscription sync is slow over a mobile/LAN connection, so the
  // wrap-up editor visibly loads its plan text late in Capacitor. Fetch the same
  // post directly (one-shot wormhole call) so it seeds immediately; the DDP copy
  // still takes over for realtime once it arrives.
  const [sessionPostFetch, setSessionPostFetch] = useState<Pick<
    HuddlePost,
    'id' | 'content' | 'tickets'
  > | null>(null);
  // Whether the wrap-up seed lookup has settled (resolved or failed). The
  // editor must not mount before this: RichEditor reads `value` on mount only,
  // and since 0.8.0 it no longer picks up a later value even when remounted via
  // `key`. Mounting empty and remounting once the plan text arrives therefore
  // left the wrap-up composer blank, and submitting it overwrote the plan post
  // with wrap-up-only text — silent loss of what the user wrote at clock-in.
  const [seedSettled, setSeedSettled] = useState(false);
  // The plan this page just posted to clock in. The wrap-up that follows
  // starts from it straight away, rather than showing a spinner while the
  // lookup above fetches the same post back.
  // The draft that plan was posted from (exactly as the editor last reported
  // it) and the plan text as posted. Clock-in leaves the draft untouched in
  // the editor and the wrap-up opens on it; changing it here instead would
  // start a reload in the plan editor, which — when clock-in isn't confirmed
  // and that editor stays — can land after the draft is cleared and put the
  // posted plan back, ready to post twice.
  const handedOverRef = useRef<{ draft: string; plan: string } | null>(null);
  const [postedPlan, setPostedPlan] = useState<Pick<
    HuddlePost,
    'id' | 'content' | 'tickets'
  > | null>(null);
  // What the editor was actually mounted with. The wrap-up submit overwrites
  // the plan post, so if the editor never received the plan text we must not
  // let that overwrite drop it — see the guard in postWrapUpAndClockOut.
  const shownSeedRef = useRef<string>('');
  // Only good for the shift it clocked in: dropped once clocked out (a failed
  // clock-in included), so a later shift never starts from it. The plan text
  // handed over for the wrap-up goes with it: if clock-in posted the plan but
  // the page still reads clocked out (its clock read failed), that text would
  // sit in an active plan composer, and submitting it again would post the
  // plan twice and restart the shift.
  useEffect(() => {
    if (isClockedIn || submittingMode || !postedPlan) return;
    const handedOver = handedOverRef.current;
    setText((current) => (current === handedOver?.draft ? '' : current));
    handedOverRef.current = null;
    seededTokenRef.current = null;
    setPostedPlan(null);
  }, [isClockedIn, submittingMode, postedPlan]);
  // A composer being submitted keeps its editor: once clock-out lands, the
  // lookup above resets for a session that has just ended.
  const editorMounted =
    composerMode !== 'wrapup' || seedSettled || !!postedPlan || !!submittingMode;
  // Shown while the plan seed settles and while the editor's code downloads.
  const composerLoading = (
    <div
      className="markdown-editor flex items-center justify-center rounded-lg border border-gray-200 py-10 dark:border-neutral-700"
      data-testid="composer-seed-loading"
    >
      <Spinner size="sm" label={clockText.loadingPlan} />
    </div>
  );
  // Focuses the editor whenever an instance actually mounts after the person
  // expanded the composer. It only renders inside the expanded composer, and
  // its code is lazy-loaded, so mount time isn't known up front: it can follow
  // the seed lookup, the chunk download, or an `editorKey` remount once the
  // fetched plan text arrives. Each mount hands over a new handle, so keying
  // the effect on it catches all of those. It has to be an effect rather than
  // the ref callback itself: RichEditor's `focus()` waits on a load it starts
  // in its own mount effect, which hasn't run yet when the ref is attached.
  const [editorHandle, setEditorHandle] = useState<RichEditorHandle | null>(null);
  useEffect(() => {
    if (focusEditorOnMountRef.current) editorHandle?.focus();
  }, [editorHandle]);
  useEffect(() => {
    if (composerMode !== 'wrapup' || !gateTeamId || !activeClockEvent?.id) {
      setSessionPostFetch(null);
      setSeedSettled(composerMode !== 'wrapup');
      return;
    }
    let cancelled = false;
    setSessionPostFetch(null);
    setSeedSettled(false);
    huddleApi
      .getMyPostForSession(gateTeamId, activeClockEvent.id)
      .then((post) => {
        if (!cancelled) setSessionPostFetch(post);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSeedSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [composerMode, gateTeamId, activeClockEvent?.id]);

  // Content pre-loaded into the (uncontrolled) wrap-up editor: THIS session's
  // plan post, so clocking out continues the same content you wrote at
  // clock-in instead of a blank box. The plan composer starts empty.
  const seedText =
    composerMode === 'wrapup'
      ? (sessionPost?.content.text ??
        sessionPostFetch?.content.text ??
        postedPlan?.content.text ??
        '')
      : '';

  // Remember what the editor was actually mounted with, for the wrap-up guard.
  // Snapshot `text` (what the editor is given) at each (re)mount — not
  // `seedText`, which differs once the user has typed before the plan arrives.
  useEffect(() => {
    if (editorMounted) shownSeedRef.current = text;
  }, [editorMounted, composerMode, editorKey]);

  // Caches the plan post ID immediately after creation so postWrapUpAndClockOut
  // can update the right post even if the DDP subscription hasn't synced yet.
  const cachedPlanPostIdRef = useRef<string | null>(null);

  // Apply the seed once it becomes available (the session post loads async),
  // unless the user has already started typing. Remount the uncontrolled editor
  // via `editorKey` so it picks up the seeded value.
  // Not while submitting: posting the wrap-up rewrites the session's post,
  // and clocking out drops it, so the seed changes twice mid-submit — each a
  // remount that blanked the editor and could tear it down mid-setup.
  const seededTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!composerMode || !seedText || submittingMode) return;
    const token = `${composerMode}:${seedText}`;
    if (seededTokenRef.current === token) return;
    seededTokenRef.current = token;
    setText((current) => (current.trim() ? current : seedText));
    setEditorKey((k) => k + 1);
  }, [composerMode, seedText, submittingMode]);

  // Or record it: a Pulse video *is* the plan (clocks you in) or the wrap-up
  // (clocks you out) — the server does both when the upload lands. Owned here,
  // not by a button: clocking in or out swaps the section's pill, while the
  // modal still has to say the video landed.
  // A landed plan or wrap-up swaps the composer; what the editor held was for
  // the step the video has just done, so the next one starts clean. The mode
  // change itself remounts the editor (it is in the editor's key), so no
  // extra remount here: one on top of it unmounted the editor mid-setup.
  // Only the draft held when that link was handed out is cleared: anything
  // written since (a plan posted by hand, then a wrap-up begun) is kept. The
  // generation advances on each hand post, so equal text in a later draft
  // still counts as later.
  const textRef = useRef(text);
  textRef.current = text;
  const draftGenRef = useRef(0);
  type DraftSnapshot = { text: string; gen: number } | null;
  const planDraftRef = useRef<DraftSnapshot>(null);
  const wrapUpDraftRef = useRef<DraftSnapshot>(null);
  const refreshClockFor =
    (draftRef: React.MutableRefObject<DraftSnapshot>) => (status: PulseUploadStatus) => {
      const draft = draftRef.current;
      if (
        status.state === 'done' &&
        draft?.gen === draftGenRef.current &&
        draft.text === textRef.current
      ) {
        setText('');
        seededTokenRef.current = null;
      }
      draftRef.current = null;
      refetchClock();
    };
  // The hooks compare destinations by value and drop a link whose destination
  // changed, so the date, team and session a link was reserved for hold still
  // while it is waiting: midnight passing, a team switch, or a newer shift
  // opened by hand must not stop the watch on a video that will still land
  // where it said.
  const todayStr = toDateString(new Date());
  const [postDate, setPostDate] = useState(todayStr);
  const [planTeamId, setPlanTeamId] = useState(gateTeamId ?? '');
  const planPulse = usePulseUpload(
    { kind: 'clock-plan', teamId: planTeamId, postDate },
    { onSettled: refreshClockFor(planDraftRef) },
  );
  // The session a wrap-up is for, kept after it ends: the wrap-up landing is
  // what clocks you out, and its link must still be the one being watched.
  const [wrapUpSessionId, setWrapUpSessionId] = useState(activeClockEvent?.id ?? '');
  const wrapUpPulse = usePulseUpload(
    { kind: 'clock-wrapup', clockEventId: wrapUpSessionId, postDate },
    { onSettled: refreshClockFor(wrapUpDraftRef) },
  );
  const planLinkId = planPulse.link?.videoid;
  const wrapUpLinkId = wrapUpPulse.link?.videoid;
  useEffect(() => {
    if (planLinkId) planDraftRef.current = { text: textRef.current, gen: draftGenRef.current };
  }, [planLinkId]);
  useEffect(() => {
    if (wrapUpLinkId) wrapUpDraftRef.current = { text: textRef.current, gen: draftGenRef.current };
  }, [wrapUpLinkId]);
  // Each link holds its own destination still while it is waiting and while
  // its result is on screen: a plan still uploading must not keep the wrap-up
  // from adopting a shift clocked in by hand, and a wrap-up's modal must not
  // be cleared from under the person by a newer shift.
  const busy = (pulse: typeof planPulse) => pulse.status?.state === 'waiting' || pulse.modalOpen;
  const planBusy = busy(planPulse);
  const wrapUpBusy = busy(wrapUpPulse);
  const activeSessionId = activeClockEvent?.id;
  useEffect(() => {
    // The date is shared by both links, so it moves only when neither is.
    if (!planBusy && !wrapUpBusy && postDate !== todayStr) setPostDate(todayStr);
  }, [planBusy, wrapUpBusy, postDate, todayStr]);
  useEffect(() => {
    if (!wrapUpBusy && activeSessionId && activeSessionId !== wrapUpSessionId) {
      setWrapUpSessionId(activeSessionId);
    }
  }, [wrapUpBusy, activeSessionId, wrapUpSessionId]);
  useEffect(() => {
    if (!planBusy && (gateTeamId ?? '') !== planTeamId) setPlanTeamId(gateTeamId ?? '');
  }, [planBusy, gateTeamId, planTeamId]);
  // The one the Pulse section offers now: clock in with a plan, or out with a
  // wrap-up. Null without a team to clock in to.
  const clockPulse = isClockedIn ? wrapUpPulse : gateTeamId ? planPulse : null;
  const clockPulseLabel = clockText.pulse(isClockedIn);

  // Clear attach/ticket/mention selections whenever the composer opens fresh
  // (mode switches between plan/wrap-up/hidden, e.g. after a successful post).
  useEffect(() => {
    setAttachments([]);
    setSelectedTickets([]);
    setMentions([]);
    setComposerExpanded(false);
    focusEditorOnMountRef.current = false;
  }, [composerMode, setSelectedTickets]);

  // The wrap-up starts with the tickets the plan linked at clock-in, so
  // clocking out keeps them unless removed here. Declared after the reset
  // above so a same-commit mode switch can't clear the seed.
  const sessionPlan =
    composerMode === 'wrapup' ? (sessionPost ?? sessionPostFetch ?? postedPlan) : null;
  const ticketsSeededForRef = useRef<string | null>(null);
  useEffect(() => {
    // Leaving wrap-up clears the selection (above), so the same plan must
    // reseed when the composer reopens — else its wrap-up would send `[]`.
    if (composerMode !== 'wrapup') ticketsSeededForRef.current = null;
    if (!sessionPlan || ticketsSeededForRef.current === sessionPlan.id) return;
    ticketsSeededForRef.current = sessionPlan.id;
    // Seed with the plan's titles too, so the chips can name its tickets.
    const planTickets = sessionPlan.tickets ?? [];
    setSelectedTickets((prev) => [
      ...planTickets,
      ...prev.filter((t) => !planTickets.some((p) => p.id === t.id)),
    ]);
  }, [composerMode, sessionPlan, setSelectedTickets]);

  const showEditor =
    composerExpanded || !!text.trim() || selectedTickets.length > 0 || attachments.length > 0;
  // Editing pins it open: a seeded wrap-up shows only because it has content,
  // so clearing that content to start over would otherwise collapse the
  // editor mid-typing. It stays open until the composer resets.
  const handleEditorChange = (value: string) => {
    setText(value);
    setComposerExpanded(true);
  };

  async function postPlanAndClockIn() {
    const trimmed = composerText();
    if (!gateTeamId || !trimmed || posting || uploadInFlight) return;
    setPosting(true);
    setSubmittingMode('plan');
    setPostError(null);
    let planPosted = false;
    const draft = text;
    try {
      const mentionUserIds = mentions.length ? mentions.map((m) => m.userId) : undefined;
      const created = await huddleApi.createPost({
        teamId: gateTeamId,
        content: { text: trimmed, mentions: mentionUserIds ?? [] },
        ticketIds: selectedTicketIds,
        attachments: attachments.map(toPostAttachment),
        postDate: toDateString(new Date()),
      });
      const planPostId = created.id;
      planPosted = true;
      // Cache the plan post ID so postWrapUpAndClockOut can find it even if
      // the DDP subscription hasn't synced the new post back to this client yet.
      cachedPlanPostIdRef.current = planPostId;
      handedOverRef.current = { draft, plan: trimmed };
      setPostedPlan({
        id: planPostId,
        content: { text: trimmed, mentions: mentionUserIds ?? [] },
        tickets: selectedTickets,
      });
      draftGenRef.current += 1;
      // Link this plan to the new session so the per-session gate finds it.
      await clockIn({ planJustPosted: true, planPostId });
      // The editor keeps showing the plan while it posts, and the wrap-up
      // that replaces it opens on that same draft. Marked as seeded so it
      // doesn't remount to load the posted copy of the same text.
      seededTokenRef.current = `wrapup:${trimmed}`;
    } catch (e) {
      // Once the plan is posted, clear it even if clocking in failed, so a
      // retry can't post it twice.
      if (planPosted) setText('');
      setPostError(e instanceof Error ? e.message : clockText.postFailed);
    } finally {
      setPosting(false);
      setSubmittingMode(null);
    }
  }

  async function postWrapUpAndClockOut() {
    const trimmed = composerText();
    if (!activeClockEvent || !trimmed || posting || uploadInFlight) return;
    setPosting(true);
    setSubmittingMode('wrapup');
    setPostError(null);
    try {
      // Use sessionPost from DDP if available, otherwise fall back to the
      // cached post ID (handles the race where the plan post was just created
      // but hasn't arrived via DDP subscription yet).
      const effectivePostId = sessionPost?.id ?? cachedPlanPostIdRef.current;
      const mentionUserIds = mentions.length ? mentions.map((m) => m.userId) : undefined;
      const postAttachments = attachments.map(toPostAttachment);
      if (effectivePostId) {
        // Safety net against losing the plan.
        //
        // This update REPLACES the plan post's text. If the editor never
        // received the plan (seed lookup failed, or RichEditor ignored it),
        // submitting would silently destroy what the user wrote at clock-in.
        // Only merge when the editor demonstrably never showed the plan —
        // `shownSeedRef` is what it actually mounted with — so text the user
        // deliberately edited or deleted is left exactly as they left it.
        const planText = (
          sessionPost?.content.text ??
          sessionPostFetch?.content.text ??
          postedPlan?.content.text ??
          ''
        ).trim();
        // The draft handed over at clock-in is the plan, even where the
        // editor's copy differs from the posted one (image alt text).
        const editorNeverSawPlan =
          planText !== '' &&
          handedOverRef.current?.plan !== planText &&
          !shownSeedRef.current.includes(planText);
        const textToSave =
          editorNeverSawPlan && !trimmed.includes(planText) ? `${planText}\n\n${trimmed}` : trimmed;

        await huddleApi.updatePost(
          effectivePostId,
          {
            text: textToSave,
            mentions: mentionUserIds ?? sessionPost?.content.mentions ?? [],
          },
          {
            wrapUp: true,
            attachments: postAttachments.length ? postAttachments : undefined,
            // The list replaces the plan's, so send it only once it was seeded
            // from the plan — otherwise just what was picked, if anything.
            ticketIds:
              ticketsSeededForRef.current === effectivePostId || selectedTicketIds.length
                ? selectedTicketIds
                : undefined,
          },
        );
      } else {
        // Recovery: no plan post exists (gate enabled mid-shift). Create one
        // that doubles as the wrap-up, linked to the session. Unlike the
        // update path above this needs a team, and the wrap-up composer can
        // open without one — surface that instead of posting a teamless post.
        if (!gateTeamId) throw new Error(clockText.noWrapUpTeam);
        await huddleApi.createPost({
          teamId: gateTeamId,
          content: { text: `**Wrap-up:** ${trimmed}`, mentions: mentionUserIds ?? [] },
          postDate: toDateString(new Date()),
          clockEventId: activeClockEvent.id,
          wrapUp: true,
          ticketIds: selectedTicketIds,
          attachments: postAttachments,
        });
      }
      draftGenRef.current += 1;
      cachedPlanPostIdRef.current = null;
      await clockOut();
      // Cleared only now, so the editor doesn't blank while clock-out runs.
      setText('');
    } catch (e) {
      setPostError(e instanceof Error ? e.message : clockText.postFailed);
    } finally {
      setPosting(false);
      setSubmittingMode(null);
    }
  }

  // ── Status line copy ──
  const eyebrow = clockText.status(
    !isClockedIn ? 'clockedOut' : isPaused ? 'onBreak' : 'clockedIn',
  );

  // A wrap-up always posts to the session's own team (gateTeamId), which can
  // differ from whatever team is currently selected if the user switched
  // teams mid-shift — name it so the destination isn't a surprise. Split
  // around the link's token so a translation can put the link anywhere.
  const [destinationBefore, destinationAfter] = composerMode
    ? clockText
        .destination(
          composerMode,
          composerMode === 'wrapup' && teamName && gateTeamId !== selectedTeamId
            ? teamName
            : undefined,
        )
        .split(HUDDLE_LINK_TOKEN)
    : ['', ''];

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label={clockText.loading} />
      </div>
    );
  }

  return (
    <AppPage fill hideTitle>
      <div className="clock-screen flex h-full min-h-0 flex-col gap-6 overflow-y-auto">
        {/* ── Status line — eyebrow + Today/Last 7 days, one compact row ── */}
        <div className="clock-status flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              isClockedIn
                ? isPaused
                  ? 'bg-amber-500'
                  : 'animate-pulse bg-green-500'
                : 'bg-neutral-400',
            )}
          />
          {/* Only the state is announced: the totals beside it change every
              minute while clocked in, and would be read out each time. */}
          <span role="status">{eyebrow}</span>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span>
            {clockText.today}{' '}
            <strong className="text-neutral-900 dark:text-neutral-50">
              {formatDuration(todaySeconds)}
            </strong>
          </span>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span>
            {clockText.last7Days}{' '}
            <strong className="text-neutral-900 dark:text-neutral-50">
              {formatDuration(last7DaysSeconds)}
            </strong>
          </span>
        </div>

        {/* ── Big session timer — kept prominent even though the status line
             above is otherwise flat/compact; this is still the number people
             come to this page to check. ── */}
        <div className="clock-timer shrink-0">
          <div className="font-mono text-4xl font-bold tabular-nums md:text-5xl">
            {formatTimer(sessionSeconds)}
          </div>
          {activeClockEvent && (
            <Text variant="muted" size="sm" className="mt-1">
              {clockText.since(formatTime(new Date(activeClockEvent.startTime), CLOCK_LOCALE))}
            </Text>
          )}
          {/* The team this clock action targets — the session's own team once
              clocked in, which a mid-shift team switch can make differ from
              the one selected in the sidebar. */}
          {teamName && (
            <Text size="sm" weight="medium" className="clock-team mt-1">
              {clockText.team(isClockedIn, teamName)}
            </Text>
          )}
          {/* Break/Resume lives with the timer so it stays visible in every
              state — plain actions, plan composer, wrap-up composer. */}
          {isClockedIn && (
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() => void (isPaused ? resumeClock() : pauseClock())}
                isLoading={clockPauseLoading}
                aria-label={isPaused ? clockText.resumeWork : clockText.takeBreakLabel}
                leftIcon={<FontAwesomeIcon icon={isPaused ? faPlay : faMugHot} />}
                className="gap-2 rounded-full px-6 font-semibold shadow-md transition-transform hover:scale-105 active:scale-95"
              >
                {isPaused ? clockText.resumeWork : clockText.takeBreak}
              </Button>
            </div>
          )}
          {/* Active ticket replaces the plan badge when a timer is running. */}
          {isClockedIn && runningTicket ? (
            <div className="active-ticket-badge mt-3 flex px-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate(
                    ticketDetailPath({ sourceId: runningTicket.source, id: runningTicket.id }),
                  )
                }
                aria-label={clockText.openTicket(runningTicket.title)}
                className="h-auto max-w-full rounded-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-600 dark:focus-visible:ring-green-400"
              >
                <Badge
                  variant="default"
                  size="sm"
                  className="inline-flex max-w-full cursor-pointer items-center gap-1.5 hover:opacity-90"
                >
                  <FontAwesomeIcon icon={faTicket} className="shrink-0" aria-hidden />
                  <span className="min-w-0 max-w-[min(100%,20rem)] truncate sm:max-w-md md:max-w-lg">
                    {runningTicket.title}
                  </span>
                </Badge>
              </Button>
            </div>
          ) : (
            requirePlan &&
            isClockedIn && (
              <Badge variant="default" size="sm" className="mt-3">
                {clockText.planRequired}
              </Badge>
            )
          )}
        </div>

        {/* ── A ticket timer waiting for this clock-in (see TicketStartProvider) ── */}
        {!isClockedIn && pendingStart && (
          <div
            className="clock-pending-start flex shrink-0 flex-wrap items-center gap-2"
            role="status"
          >
            <FontAwesomeIcon icon={faTicket} className="text-neutral-500" aria-hidden />
            <Text size="sm">{timerText.pendingStart(pendingStart.request.label)}</Text>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelPendingStart}
              aria-label={timerText.cancelPendingStartLabel(pendingStart.request.label)}
            >
              {timerText.cancelPendingStart}
            </Button>
          </div>
        )}

        {/* ── Composer-first: a big prompt, then one card holding the plan/
             wrap-up text (collapsed to a single line until focused) and the
             Pulse alternative inline beside it. ── */}
        {composerMode && (
          <div className="clock-plan flex shrink-0 flex-col gap-3">
            {/* Same size/weight as every other page's title (PageTitle in
                AppPage.tsx) — this heading stands in for it here since the
                page's own title is hidden in favor of the compact status
                line above. */}
            <Text as="h2" size="2xl" weight="semibold" className="tracking-tight">
              {clockText.prompt(composerMode)}
            </Text>

            {/* Flush on mobile/Capacitor — no border or padding boxing the
                editor in, so it gets the full screen width. The bordered
                card is a desktop treatment, from md: up. */}
            <div className="clock-plan-composer flex flex-col gap-3 md:rounded-2xl md:border md:border-neutral-200 md:p-4 md:dark:border-neutral-800">
              <Text variant="muted" size="sm">
                {destinationBefore}
                <button
                  type="button"
                  // The session's own team, which a mid-shift team switch can
                  // make differ from the selected one — where this post lands.
                  onClick={() =>
                    navigate(gateTeamId ? `/app/huddle?team=${gateTeamId}` : '/app/huddle')
                  }
                  className="underline underline-offset-2"
                >
                  {clockText.huddleLink}
                </button>
                {destinationAfter}
              </Text>

              {/* Mounted only once the seed lookup has settled — see `seedSettled`.
                  Mounting earlier gives RichEditor an empty `value` it will never
                  replace, which silently drops the plan text on wrap-up. Waiting
                  here, before choosing collapsed or expanded, also means a
                  seeded wrap-up opens straight onto its content. */}
              {!editorMounted ? (
                composerLoading
              ) : !showEditor ? (
                // Wraps so the pills drop to their own line where they don't
                // fit beside the input (e.g. tablet width with the sidebar open).
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="min-w-0 flex-1 sm:min-w-64">
                    <Input
                      readOnly
                      placeholder={clockText.placeholder(composerMode)}
                      aria-label={clockText.writeLabel(composerMode)}
                      onFocus={expandComposer}
                    />
                  </div>
                  <Button variant="primary" onClick={expandComposer} className={COMPACT_PILL}>
                    {clockText.submit(composerMode)}
                  </Button>
                  <PulseAlternative pulse={clockPulse} label={clockPulseLabel} />
                </div>
              ) : (
                <>
                  <Suspense fallback={composerLoading}>
                    <MarkdownEditor
                      ref={setEditorHandle}
                      key={`${composerMode}-${editorKey}`}
                      // `text`, not `seedText`: RichEditor reloads when `value` differs
                      // from its own last output, which is how a pasted image shows inline.
                      value={text}
                      onChange={handleEditorChange}
                      onSubmit={() =>
                        void (composerMode === 'plan'
                          ? postPlanAndClockIn()
                          : postWrapUpAndClockOut())
                      }
                      onFiles={uploadDroppedMedia}
                    />
                  </Suspense>

                  {/* ── Ticket / mention / attachment chips ── */}
                  <ComposerChips
                    selectedTickets={selectedTickets}
                    onTicketRemove={removeTicket}
                    mentions={mentions}
                    onMentionRemove={handleMentionRemove}
                    attachments={attachments}
                    onAttachmentRemove={handleAttachmentRemove}
                  />

                  {/* ── Attach bar — same Photo/Video/Doc/Ticket/@Mention controls as Huddle ── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <ComposerAttachButtons
                      teamId={gateTeamId}
                      onAttachmentAdd={handleAttachmentAdd}
                      selectedTicketIds={selectedTicketIds}
                      onTicketSelect={addTicket}
                      onMentionSelect={handleMentionSelect}
                      onUploadProgress={reporterFor('picker')}
                      onError={setComposerError}
                    />
                  </div>

                  <ComposerProgress uploadFraction={uploadFraction} posting={posting} />

                  <ComposerError message={composerError} onDismiss={() => setComposerError(null)} />

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <Button
                      variant="primary"
                      onClick={() =>
                        void (composerMode === 'plan'
                          ? postPlanAndClockIn()
                          : postWrapUpAndClockOut())
                      }
                      isLoading={posting || clockInLoading || clockOutLoading}
                      disabled={!text.trim() || uploadInFlight}
                      className={cn(COMPACT_PILL, 'w-full sm:w-auto')}
                    >
                      {clockText.submit(composerMode)}
                    </Button>
                    <PulseAlternative pulse={clockPulse} label={clockPulseLabel} />
                    <Text variant="muted" size="sm" className="font-mono">
                      {clockText.shortcutHint(composerMode, !text.trim())}
                    </Text>
                  </div>
                  {postError && (
                    <Text variant="destructive" size="sm">
                      {postError}
                    </Text>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Plain actions when the gate is satisfied (or off) ──
             Same compact pill as the composer's "Clock in with a plan", so
             it reads as an equal "X or Y" pair with Pulse beside it rather
             than a primary action next to an afterthought. No `items-start`
             — children stretch to the container's full width on mobile, so
             "or" actually centers and both buttons match width too. */}
        {!composerMode && (
          <div className="clock-actions flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
            {!isClockedIn ? (
              <Button
                variant="primary"
                onClick={() => void clockIn()}
                isLoading={clockInLoading}
                disabled={!selectedTeamId}
                aria-label={clockText.clockIn}
                leftIcon={<FontAwesomeIcon icon={faPlay} />}
                className={COMPACT_PILL}
              >
                {clockText.clockIn}
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => void clockOut()}
                isLoading={clockOutLoading}
                aria-label={clockText.clockOut}
                leftIcon={<FontAwesomeIcon icon={faStop} />}
                className={COMPACT_PILL}
              >
                {clockText.clockOut}
              </Button>
            )}
            <PulseAlternative pulse={clockPulse} label={clockPulseLabel} />
          </div>
        )}

        {/* Clocking out closes every ticket timer (clock.stop), so say so first. */}
        {isClockedIn && runningTicket && (
          <Text variant="muted" size="sm" className="clock-out-stops-timer shrink-0">
            {timerText.clockOutStopsTimer(
              timerLabel(runningTicket.source, runningTicket.id, runningTicket.title),
            )}
          </Text>
        )}

        {clockOutBlockedReason && (
          <Text variant="warning" size="sm" className="shrink-0" aria-live="polite">
            {clockOutBlockedReason}
          </Text>
        )}

        {/* ── Redmine push — renders itself away when there is nothing to send ── */}
        <RedminePushPanel isClockedIn={isClockedIn} />

        {/* ── Recent sessions ── */}
        <RecentSessionsPanel
          sessions={recentSessions}
          loading={recentSessionsLoading}
          // The personal timesheet lives on the Dashboard now (`/app/timesheet`
          // is retired). Explicit tab=me and team=: without them, an admin whose last-used
          // Dashboard tab was "Team" lands on the admin timesheet instead of
          // their own history, and the destination would otherwise scope by
          // whichever team happens to be globally selected rather than the
          // team these sessions actually belong to (gateTeamId can differ
          // from selectedTeamId — see the wrap-up team-suffix note above).
          onViewAll={() =>
            navigate(
              recentSessionsTeamId
                ? `/app/dashboard?view=timesheet&tab=me&team=${recentSessionsTeamId}`
                : '/app/dashboard?view=timesheet&tab=me',
            )
          }
        />
      </div>
      <PulseUploadModal
        open={planPulse.modalOpen}
        onClose={planPulse.closeModal}
        scanLink={planPulse.link?.scanLink ?? null}
        destination={planPulse.destination}
        status={planPulse.status}
      />
      <PulseUploadModal
        open={wrapUpPulse.modalOpen}
        onClose={wrapUpPulse.closeModal}
        scanLink={wrapUpPulse.link?.scanLink ?? null}
        destination={wrapUpPulse.destination}
        status={wrapUpPulse.status}
      />
    </AppPage>
  );
};
