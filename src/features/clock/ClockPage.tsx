/**
 * ClockPage — plan-first shift screen.
 *
 * Reads top-to-bottom as a gate rather than a dashboard:
 *   1. Status — eyebrow + a big bold session timer (elapsed time this
 *      shift, not the wall clock) + either the active ticket badge (when a
 *      ticket timer is running) or a "plan required" badge when the team
 *      gate is on and no ticket is running. Break/Resume lives here, beside
 *      the timer, so it stays on screen whichever composer is open below.
 *   2. Today's plan — while clocked in, the plan's live state (TodayPlan):
 *      items checked off, the ticket running, a button to start each ticket.
 *      The posted plan in Huddle stays as posted.
 *   3. Composer — plan-before-clock-in / wrap-up-before-clock-out, with the
 *      same Photo/Video/Doc/Ticket/@Mention bar as the Huddle composer
 *      (⌘/Ctrl+↵ submits).
 *   4. Recent sessions — the user's last completed sessions on this team.
 *
 * Gate state comes from useClockToggle.planGate (realtime via DDP), so this
 * page never needs a reload. With the team setting off, it's a plain
 * clock-in/out screen.
 */
import { faMugHot, faPlay, faStop, faTicket } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  cn,
  DropzoneOverlay,
  Input,
  Spinner,
  Text,
  hasBusyUpload,
  useDropzone,
  type AttachmentUpload,
} from '@mieweb/ui';
import type { RichEditorHandle } from '@mieweb/ui/kerebron';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import { huddleApi, ticketApi, type HuddlePost, type PulseUploadStatus } from '../../lib/api';
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
import { useComposerUploads } from '../huddle/useComposerUploads';
import { UPLOAD_TEXT } from '../huddle/uploadText';
import type { TicketRef } from '../huddle/useTicketSelection';
import {
  appendPlanItem,
  appendPlanTickets,
  planTicketItem,
  planTicketsAsChecklist,
  withChecks,
  planTicketName,
  ticketIdsInText,
} from '../huddle/planItems';
import { useTeamMentions } from '../huddle/useTeamMentions';
import { usePersonTrigger, useTicketTrigger } from '../huddle/referenceTriggers';
import { toPostAttachment } from '../huddle/api';
import {
  fetchTeamRefs,
  postRefsIn,
  refsCover,
  refsNeeded,
  type TeamRefs,
} from '../huddle/postRefs';
import { ComposerAttachButtons, ComposerChips } from '../huddle/ComposerAttachments';
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
import { TodayPlan } from './TodayPlan';
import { useRecentSessions } from './useRecentSessions';
import { useSessionPlan } from './useSessionPlan';
import { createOwnLineKit } from './ownLineKit';
import { usePlanTaskEditor } from './usePlanTaskEditor';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

// ─── ClockPage ────────────────────────────────────────────────────────────────

/** The compact "X or Y" pair beside the plan/wrap-up input — the submit
 *  button and the Pulse chip share this exact class list so the two read as
 *  equal alternatives rather than a primary action and an afterthought. `h-10`
 *  is explicit so both stay the same height whatever Button size either one
 *  defaults to. */
const COMPACT_PILL = 'h-10 gap-2 rounded-full px-4 text-sm font-semibold shrink-0';

/**
 * The submit button's words while it waits for attachments: how much of their
 * bytes are in (by size, so a big video counts for more than a photo), then
 * Processing once every byte is and the server is finishing.
 */
function uploadsLabel(items: AttachmentUpload<MediaItem>[]): string {
  const busy = items.filter((item) => item.state === 'uploading' || item.state === 'processing');
  if (busy.length > 0 && busy.every((item) => item.state === 'processing')) {
    return UPLOAD_TEXT.processing;
  }
  const total = busy.reduce((sum, item) => sum + item.file.size, 0);
  const sent = busy.reduce((sum, item) => sum + item.progress * item.file.size, 0);
  return UPLOAD_TEXT.waiting(Math.floor(total > 0 ? (sent / total) * 100 : 0));
}

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
  const {
    selectedTeamId,
    allTeams,
    isSelectedTeamMember,
    activeClockEvent,
    currentTime,
    teamsReady,
    refetchClock,
  } = useTeam();
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
  // Today's plan as it stands — items checked off, the ticket running (M4).
  const sessionPlan = useSessionPlan();
  // Once clocked in, the editor the plan was written in shows it as a
  // checklist: each ticket a line with its ▶/⏸ and running time (M4).
  const planEditor = usePlanTaskEditor(sessionPlan, runningTicket);
  // The running ticket's time this session counts its earlier stints too, as its
  // checklist line does.
  const runningTicketPriorMs = useMemo(() => {
    if (!runningTicket) return 0;
    const item = sessionPlan.plan?.items.find(
      (i) => 'ticketId' in i && i.runningSince === runningTicket.startTime,
    );
    return item && 'seconds' in item ? item.seconds * 1000 : 0;
  }, [runningTicket, sessionPlan.plan]);

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

  // ── Attach/ticket/mention controls — same action bar as the Huddle composer.
  // Tickets and mentions are written into the plan's text, which is the one
  // source of both: the ids posted are read back out of it (planItems). ──
  const planTicketIds = useMemo(() => ticketIdsInText(text), [text]);
  const teamMentions = useTeamMentions(gateTeamId);
  const gateTeam = allTeams.find((t) => t.id === gateTeamId);
  // `@` offers teammates and `#` the team's tickets, inserted as chips and
  // saved as links. A teammate's link is to their profile, so the mention
  // names exactly the person picked even when two share a first name
  // (postRefsIn).
  const personTrigger = usePersonTrigger(teamMentions);
  const ticketTrigger = useTicketTrigger(gateTeamId, gateTeam);
  const triggers = useMemo(() => [personTrigger, ticketTrigger], [personTrigger, ticketTrigger]);
  // A `#` ticket goes on its own line, as the Ticket button puts it.
  const [ownLineKit] = useState(() => createOwnLineKit(['ticket']));
  const planKits = useMemo(() => [ownLineKit], [ownLineKit]);
  // The wrap-up opens on today's plan: its checklist lines carry each ticket's
  // timer, and ticks save at once.
  const wrapUpKits = useMemo(
    () => [...planEditor.editorKits, ownLineKit],
    [planEditor.editorKits, ownLineKit],
  );
  // One failure notice for the composer, whichever step produced it — see
  // {@link ComposerError}. Reported here rather than via `alert()`.
  const [composerError, setComposerError] = useState<string | null>(null);
  // Every attached file — picked, pasted or dropped — is a tile that uploads
  // in place at once; posting waits for any still uploading.
  const uploads = useComposerUploads({ onError: setComposerError });
  const { attach, clear: clearUploads } = uploads;
  // Files dropped anywhere on the composer attach, as the pickers do; it opens
  // the editor so their tiles show.
  const composerDropzone = useDropzone({
    onDrop: (files) => {
      setComposerExpanded(true);
      attach(files);
    },
    multiple: true,
  });
  // A submit waiting for attachments still uploading: its button says how far.
  const [awaitingUploads, setAwaitingUploads] = useState(false);
  // A submit that waits for its files posts what's there when they're done —
  // the text typed meanwhile, the mentions and tickets as they are then —
  // read here, and only while the page is still open.
  // (`textRef`, the text as of now, is declared below with the Pulse drafts.)
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const editorHandleRef = useRef<RichEditorHandle | null>(null);
  /** The editor's current markdown; the `text` mirror when it isn't mounted or can't say. */
  const readEditor = async (): Promise<string> => {
    const handle = editorHandleRef.current;
    return handle ? handle.getContent().catch(() => textRef.current) : textRef.current;
  };
  /**
   * Waits for the attachments (a submit pressed early), then takes them out of
   * the composer for the post — so a page left or a mode switched meanwhile
   * can't take them back — with the text, mentions and tickets as they are
   * now. Throws naming a file that didn't upload (it stays, for
   * Retry or removal); null when the page went away meanwhile, or everything
   * was cleared while it waited (the button says why: it's disabled). The
   * team's people and tickets are read fresh first (see below).
   */
  const takeForPost = async () => {
    // Uploads settle, then the team's people and tickets are read fresh — only
    // what the text names, so a plain plan waits on nothing. A file attached
    // or a reference added while that lookup runs goes round again, so nothing
    // is taken unsettled or checked against a lookup that didn't cover it. A
    // failed lookup leaves the draft and its files in place for a retry.
    const noLookups = { members: false, tickets: false };
    let refs: TeamRefs = { members: [], ticketIds: new Set<string>() };
    let looked = noLookups;
    // The editor's own content, not the `text` mirror: onChange lags a
    // reference picked just before the press.
    let draft: string;
    for (;;) {
      if (hasBusyUpload(uploads.current())) setAwaitingUploads(true);
      try {
        const { failed } = await uploads.settle();
        if (!aliveRef.current) return null;
        if (failed.length > 0) throw new Error(UPLOAD_TEXT.blocked(failed[0].file.name));
      } finally {
        if (aliveRef.current) setAwaitingUploads(false);
      }
      const settled = uploads.current();
      draft = await readEditor();
      if (!aliveRef.current) return null;
      const needs = gateTeamId ? refsNeeded(draft) : noLookups;
      if (!refsCover(looked, needs)) {
        refs = await fetchTeamRefs(gateTeamId as string, needs);
        looked = needs;
        if (!aliveRef.current) return null;
        continue;
      }
      const now = uploads.current();
      if (now.length === settled.length && now.every((item, i) => item.id === settled[i].id)) {
        break;
      }
    }
    if (!draft.trim() && uploads.current().length === 0) return null;
    const taken = uploads.take();
    const media = taken.map((item) => item.result as MediaItem);
    const postText = draft.trim();
    return {
      media,
      text: postText,
      /** The draft as the editor held it, untrimmed. */
      draft,
      mentionUserIds: postRefsIn(postText, refs).mentions,
      ticketIds: postRefsIn(postText, refs).ticketIds,
      /** For a wrap-up whose saved text differs from the draft (the plan put back). */
      refs,
      looked,
      /** Puts them back, as uploaded, when the post fails. */
      giveBack: () =>
        uploads.restore(
          taken.map((item) => ({ file: item.file, result: item.result as MediaItem })),
        ),
    };
  };

  // A picked ticket is a new last item; the editor reloads `value`, so it shows at once.
  // Adds `item` as the plan's last item, built from the editor's own text:
  // the `text` mirror can lag the last keystroke (onChange is asynchronous),
  // and reloading the editor from it would drop that edit. Read again if the
  // mirror moves while reading, so an edit made meanwhile isn't lost either.
  const editPlan = async (update: (current: string) => string) => {
    let current = textRef.current;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = textRef.current;
      current = await readEditor();
      if (!aliveRef.current) return;
      if (textRef.current === before) break;
    }
    setText(update(current));
    setComposerExpanded(true);
  };
  const appendToPlan = (item: string) => editPlan((current) => appendPlanItem(current, item));

  const handleTicketSelect = (ticket: TicketRef) => {
    void appendToPlan(planTicketItem({ id: ticket.id, name: planTicketName(ticket, gateTeam) }));
  };

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
  // Start session (#884) clocks in with the pins as the plan, so it opens the
  // plan composer even where the team doesn't require one.
  const sessionFromPins = !!pendingStart?.alsoPlanned;
  const composerMode: ComposerMode | null =
    submittingMode ??
    (!isClockedIn
      ? (planMissing || sessionFromPins) && isSelectedTeamMember
        ? 'plan'
        : null
      : wrapUpMissing
        ? 'wrapup'
        : null);

  // The wrap-up seed normally comes from `sessionPost` (DDP-backed, realtime).
  // Its initial subscription sync is slow over a mobile/LAN connection, so the
  // wrap-up editor visibly loads its plan text late in Capacitor. Fetch the same
  // post directly (one-shot wormhole call) so it seeds immediately; the DDP copy
  // still takes over for realtime once it arrives.
  const [sessionPostFetch, setSessionPostFetch] = useState<Pick<
    HuddlePost,
    'id' | 'content' | 'tickets' | 'attachments'
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
    'id' | 'content' | 'tickets' | 'attachments'
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
  // Clocked in on the plan this page just posted, the plan becomes today's
  // checklist in this same editor: each ticket a line with its timer (M4).
  // The wrap-up opens on it. Only once the page reads clocked in: until then
  // the draft must stay as posted, so the effect above can clear it.
  useEffect(() => {
    const handedOver = handedOverRef.current;
    if (!isClockedIn || !postedPlan || !handedOver) return;
    const checklist = planTicketsAsChecklist(handedOver.draft);
    if (checklist === handedOver.draft) return;
    handedOverRef.current = { draft: checklist, plan: handedOver.plan };
    setText((current) => (current === handedOver.draft ? checklist : current));
  }, [isClockedIn, postedPlan]);
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
  editorHandleRef.current = editorHandle;
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
  // clock-in instead of a blank box — with its tickets as checklist lines, as
  // clocking in left it (M4). The plan composer starts empty.
  const seedText =
    composerMode === 'wrapup'
      ? planTicketsAsChecklist(
          sessionPost?.content.text ??
            sessionPostFetch?.content.text ??
            postedPlan?.content.text ??
            '',
        )
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
    // A draft already showing (the plan handed over at clock-in, or text typed
    // first) stays as it is: remounting the editor for it would drop an edit
    // made just as the seed lands.
    if (textRef.current.trim()) return;
    setText(seedText);
    setEditorKey((k) => k + 1);
  }, [composerMode, seedText, submittingMode]);

  // A ticket that joins today's plan mid-session (pinned on My Board) gets a
  // checklist line in the wrap-up, once per session: a line deleted here
  // stays deleted. Waits for the seed, which already holds the posted plan.
  const planLinesRef = useRef<{ session: string; ticketIds: Set<string> } | null>(null);
  useEffect(() => {
    const plan = sessionPlan.plan;
    if (composerMode !== 'wrapup' || !seedSettled || submittingMode || !plan) return;
    if (!textRef.current.trim()) return;
    if (planLinesRef.current?.session !== plan.clockEventId) {
      planLinesRef.current = { session: plan.clockEventId, ticketIds: new Set() };
    }
    const handled = planLinesRef.current.ticketIds;
    const shown = new Set(ticketIdsInText(textRef.current));
    const missing = plan.items.flatMap((item) =>
      'ticketId' in item && !handled.has(item.ticketId)
        ? [{ id: item.ticketId, name: item.title }]
        : [],
    );
    for (const ticket of missing) handled.add(ticket.id);
    const added = missing.filter((ticket) => !shown.has(ticket.id));
    if (added.length) void editPlan((current) => appendPlanTickets(current, added));
  }, [sessionPlan.plan, composerMode, seedSettled, submittingMode, editorKey]);

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
  // A plan link reserved before a shift that has since started is refused
  // (clockInWithPlan), so one prepared ahead on a phone is replaced whenever
  // you clock in or out.
  const planPulse = usePulseUpload(
    { kind: 'clock-plan', teamId: planTeamId, postDate },
    { onSettled: refreshClockFor(planDraftRef), prepareKey: activeClockEvent?.id ?? '' },
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
  const clockPulse = isClockedIn
    ? wrapUpPulse
    : gateTeamId && isSelectedTeamMember
      ? planPulse
      : null;
  const clockPulseLabel = clockText.pulse(isClockedIn);

  // Clear attach/ticket/mention selections whenever the composer opens fresh
  // (mode switches between plan/wrap-up/hidden, e.g. after a successful post).
  useEffect(() => {
    // A mode switch after a successful post finds nothing here: that post took
    // its files first (uploads.take). Anything left was never sent.
    clearUploads();
    setComposerExpanded(false);
    focusEditorOnMountRef.current = false;
  }, [composerMode, clearUploads]);

  // A ticket started while clocked out (#586) is written into the plan it's
  // waiting for, so clocking in doesn't ask for more than that ticket. Start
  // session (#884) brings the rest of My Board's pins along, written after it.
  const pendingTicketIds =
    composerMode === 'plan' && pendingStart?.request.kind === 'ticket'
      ? [pendingStart.request.ticket, ...(pendingStart.alsoPlanned ?? [])]
          .filter((ticket) => ticket.sourceId === 'huddle')
          .map((ticket) => ticket.id)
          .join(',')
      : '';
  // Written once per waiting start: deleting a line keeps it deleted, even
  // when the effect re-runs (the team list reloading changes `gateTeam`).
  const writtenPendingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingTicketIds) {
      writtenPendingRef.current = null;
      return;
    }
    if (writtenPendingRef.current === pendingTicketIds) return;
    let cancelled = false;
    // One retry, so a blip doesn't leave a pin out of the plan; one still
    // unread is reported rather than dropped without a word.
    const read = (id: string) =>
      ticketApi
        .getTicket(id)
        .catch(() => ticketApi.getTicket(id))
        .catch(() => null);
    void Promise.all(pendingTicketIds.split(',').map(read)).then((tickets) => {
      if (cancelled) return;
      const unread = tickets.filter((ticket) => !ticket).length;
      if (unread) {
        setComposerError(clockText.ticketsNotAdded(unread));
        // The notice shows in the open composer only.
        setComposerExpanded(true);
      }
      // Only into a plan for the ticket's own team: the server refuses
      // another team's ticket on this team's post.
      const items = tickets
        .filter((ticket) => ticket?.teamId === gateTeamId)
        .map((ticket) => ({ id: ticket!.id, name: planTicketName(ticket!, gateTeam) }));
      if (!items.length) return;
      writtenPendingRef.current = pendingTicketIds;
      focusEditorOnMountRef.current = true;
      void editPlan((current) => appendPlanTickets(current, items));
    });
    return () => {
      cancelled = true;
    };
  }, [pendingTicketIds, gateTeam, gateTeamId]);

  const showEditor = composerExpanded || !!text.trim() || uploads.items.length > 0;
  // Something to post: words, or a file on its own (a screenshot, say).
  const hasContent = !!text.trim() || uploads.items.length > 0;
  // Editing pins it open: a seeded wrap-up shows only because it has content,
  // so clearing that content to start over would otherwise collapse the
  // editor mid-typing. It stays open until the composer resets.
  const handleEditorChange = (value: string) => {
    setText(value);
    setComposerExpanded(true);
  };

  async function postPlanAndClockIn() {
    if (!gateTeamId || !hasContent || posting) return;
    // Clocked in at the press, however long its files take to finish.
    const at = Date.now();
    setPosting(true);
    setSubmittingMode('plan');
    setPostError(null);
    let planPosted = false;
    let giveBack: (() => void) | null = null;
    try {
      const ready = await takeForPost();
      if (!ready) return;
      giveBack = ready.giveBack;
      const { media, mentionUserIds } = ready;
      const trimmed = ready.text;
      const { draft } = ready;
      const attachments = media.map(toPostAttachment);
      const created = await huddleApi.createPost({
        teamId: gateTeamId,
        content: { text: trimmed, mentions: mentionUserIds },
        ticketIds: ready.ticketIds,
        attachments,
        postDate: toDateString(new Date(at)),
      });
      giveBack = null;
      const planPostId = created.id;
      planPosted = true;
      // Cache the plan post ID so postWrapUpAndClockOut can find it even if
      // the DDP subscription hasn't synced the new post back to this client yet.
      cachedPlanPostIdRef.current = planPostId;
      handedOverRef.current = { draft, plan: trimmed };
      setPostedPlan({
        id: planPostId,
        content: { text: trimmed, mentions: mentionUserIds },
        attachments,
      });
      draftGenRef.current += 1;
      // Link this plan to the new session so the per-session gate finds it.
      // Once the page reads clocked in, the plan becomes today's checklist
      // (the effect after `handedOverRef`).
      await clockIn({ planJustPosted: true, planPostId, at });
      // The editor keeps showing the plan while it posts, and the wrap-up
      // that replaces it opens on that same draft. Marked as seeded so it
      // doesn't remount to load the posted copy of the same text.
      seededTokenRef.current = `wrapup:${planTicketsAsChecklist(trimmed)}`;
    } catch (e) {
      // The post didn't go: its files come back, as they were.
      giveBack?.();
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
    if (!activeClockEvent || !hasContent || posting) return;
    // Clocked out at the press, however long its files take to finish.
    const at = Date.now();
    setPosting(true);
    setSubmittingMode('wrapup');
    setPostError(null);
    let giveBack: (() => void) | null = null;
    try {
      // Use sessionPost from DDP if available, otherwise fall back to the
      // cached post ID (handles the race where the plan post was just created
      // but hasn't arrived via DDP subscription yet).
      const ready = await takeForPost();
      if (!ready) return;
      giveBack = ready.giveBack;
      const { mentionUserIds } = ready;
      const trimmed = ready.text;
      const selectedTicketIds = ready.ticketIds;
      const effectivePostId = sessionPost?.id ?? cachedPlanPostIdRef.current;
      const postAttachments = ready.media.map(toPostAttachment);
      const planAttachments =
        sessionPost?.attachments ?? sessionPostFetch?.attachments ?? postedPlan?.attachments ?? [];
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
        // It may show the plan as today's checklist, its tickets as lines.
        const shownPlan = planTicketsAsChecklist(planText);
        const editorNeverSawPlan =
          planText !== '' &&
          handedOverRef.current?.plan !== planText &&
          !shownSeedRef.current.includes(planText) &&
          !shownSeedRef.current.includes(shownPlan);
        // The checklist is saved with the plan's checks: a box in the editor
        // shows the session's state, which its text doesn't hold.
        const textToSave = withChecks(
          editorNeverSawPlan && !trimmed.includes(planText) && !trimmed.includes(shownPlan)
            ? `${planText}\n\n${trimmed}`
            : trimmed,
          planEditor.checkedOf,
        );
        // Mentions a plan only attached (posted before plans linked them, so
        // no `@Name` in its text) were never shown, so stay — like tickets below.
        const planMentions =
          sessionPost?.content.mentions ?? sessionPostFetch?.content.mentions ?? [];
        // The text saved may have the plan put back, naming more than the draft.
        const textNeeds = refsNeeded(textToSave);
        const saveNeeds = {
          ...textNeeds,
          members: textNeeds.members || planMentions.length > 0,
        };
        const saveRefs =
          gateTeamId && !refsCover(ready.looked, saveNeeds)
            ? await fetchTeamRefs(gateTeamId, saveNeeds)
            : ready.refs;
        const saved = postRefsIn(textToSave, saveRefs);
        const mentionedInPlan = postRefsIn(planText, saveRefs).mentions;
        const memberIds = new Set(saveRefs.members.map((member) => member.id));
        const attachedOnlyMentions = planMentions.filter(
          (id) => memberIds.has(id) && !mentionedInPlan.includes(id),
        );
        const linkedInPlan = ticketIdsInText(planText);
        const attachedOnly = (sessionPost?.tickets ?? sessionPostFetch?.tickets ?? [])
          .map((t) => t.id)
          .filter((id) => !linkedInPlan.includes(id));

        await huddleApi.updatePost(
          effectivePostId,
          {
            text: textToSave,
            // Read from the text saved: a mention deleted in the wrap-up goes.
            mentions: [...new Set([...attachedOnlyMentions, ...saved.mentions])],
          },
          {
            wrapUp: true,
            // Added to the plan's own files, never in place of them: the
            // wrap-up doesn't show those, so it can't mean to drop them (and
            // the update deletes what it drops).
            attachments: postAttachments.length
              ? [...planAttachments, ...postAttachments]
              : undefined,
            // The list replaces the plan's. Tickets the plan's text links are
            // the wrap-up's to keep or delete; ones a plan only attached
            // (posted before plans linked them) were never shown, so stay.
            // Read from the text saved, which may have the plan put back in.
            ticketIds: [...new Set([...attachedOnly, ...saved.ticketIds])],
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
          content: { text: `**Wrap-up:** ${trimmed}`, mentions: mentionUserIds },
          postDate: toDateString(new Date()),
          clockEventId: activeClockEvent.id,
          wrapUp: true,
          ticketIds: selectedTicketIds,
          attachments: postAttachments,
        });
      }
      giveBack = null;
      draftGenRef.current += 1;
      cachedPlanPostIdRef.current = null;
      await clockOut({ at });
      // Cleared only now, so the editor doesn't blank while clock-out runs.
      setText('');
    } catch (e) {
      // The post didn't go: its files come back, as they were.
      giveBack?.();
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
                  {/* Its time ticks every second, so nothing here is a live region. */}
                  <span className="min-w-0 max-w-[min(100%,20rem)] truncate tabular-nums sm:max-w-md md:max-w-lg">
                    {clockText.runningTicketTime(
                      runningTicket.title,
                      formatTimer(
                        (currentTime - runningTicket.startTime + runningTicketPriorMs) / 1000,
                      ),
                    )}
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

        {/* ── Today's plan: its live state, apart from the posted plan (M4) ── */}
        {/* With a wrap-up composer, that editor shows the plan itself. */}
        {isClockedIn && composerMode !== 'wrapup' && (
          <TodayPlan sessionPlan={sessionPlan} triggers={triggers} runningTicket={runningTicket} />
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
            <div
              className="clock-plan-composer relative flex flex-col gap-3 md:rounded-2xl md:border md:border-neutral-200 md:p-4 md:dark:border-neutral-800"
              {...composerDropzone.getRootProps()}
            >
              <DropzoneOverlay
                isVisible={composerDropzone.isDragging}
                message={UPLOAD_TEXT.dropFiles}
                size="compact"
                variant="primary"
                className="rounded-2xl"
              />
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
                      // from its own last output, so a reset or a seed shows at once.
                      value={text}
                      onChange={handleEditorChange}
                      onSubmit={() =>
                        void (composerMode === 'plan'
                          ? postPlanAndClockIn()
                          : postWrapUpAndClockOut())
                      }
                      // Pasted or dropped files are tiles, as picked ones are.
                      onFiles={attach}
                      triggers={triggers}
                      editorKits={composerMode === 'wrapup' ? wrapUpKits : planKits}
                    />
                  </Suspense>
                  {composerMode === 'wrapup' && (
                    <>
                      {planEditor.timers}
                      <div role="alert" className="today-plan-error">
                        {planEditor.failure && (
                          <Text variant="destructive" size="sm">
                            {planEditor.failure}
                          </Text>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Attachment tiles (tickets and mentions are in the text) ── */}
                  <ComposerChips
                    attachments={uploads.items}
                    onAttachmentRemove={uploads.remove}
                    onAttachmentRetry={uploads.retry}
                  />

                  {/* ── Attach bar — same Photo/Video/Doc/Ticket/@Mention controls as Huddle ── */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <ComposerAttachButtons
                      teamId={gateTeamId}
                      onFiles={attach}
                      selectedTicketIds={planTicketIds}
                      onTicketSelect={handleTicketSelect}
                    />
                  </div>

                  <ComposerProgress posting={posting && !awaitingUploads} />

                  <ComposerError message={composerError} onDismiss={() => setComposerError(null)} />

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <Button
                      variant="primary"
                      onClick={() =>
                        void (composerMode === 'plan'
                          ? postPlanAndClockIn()
                          : postWrapUpAndClockOut())
                      }
                      // While it waits for attachments, its label says how far
                      // they've got instead of a spinner; never disabled by them.
                      isLoading={!awaitingUploads && (posting || clockInLoading || clockOutLoading)}
                      // Set only while waiting: Button spreads props after its
                      // own aria-busy, so an undefined here would clear it.
                      {...(awaitingUploads ? { 'aria-busy': true } : {})}
                      disabled={!hasContent}
                      className={cn(COMPACT_PILL, 'w-full sm:w-auto')}
                    >
                      {awaitingUploads
                        ? uploadsLabel(uploads.items)
                        : clockText.submit(composerMode)}
                    </Button>
                    <PulseAlternative pulse={clockPulse} label={clockPulseLabel} />
                    <Text variant="muted" size="sm" className="font-mono">
                      {clockText.shortcutHint(composerMode, !hasContent)}
                    </Text>
                  </div>
                  {/* Announced: a submit that stopped (a file didn't upload) says why. */}
                  <div role="alert" className="clock-post-error">
                    {postError && (
                      <Text variant="destructive" size="sm">
                        {postError}
                      </Text>
                    )}
                  </div>
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
                disabled={!selectedTeamId || !isSelectedTeamMember}
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

        {/* An organization owner can open a team they haven't joined; clocking in needs membership. */}
        {!isClockedIn && !!selectedTeamId && !isSelectedTeamMember && (
          <Text variant="muted" size="sm" className="clock-join-hint shrink-0">
            {clockText.joinToClockIn}
          </Text>
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
        link={planPulse.link?.url ?? null}
        destination={planPulse.destination}
        status={planPulse.status}
      />
      <PulseUploadModal
        open={wrapUpPulse.modalOpen}
        onClose={wrapUpPulse.closeModal}
        link={wrapUpPulse.link?.url ?? null}
        destination={wrapUpPulse.destination}
        status={wrapUpPulse.status}
      />
    </AppPage>
  );
};
