import {
  faCheck,
  faChevronDown,
  faClock,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  ButtonGroup,
  type ChatComposerError,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  Input,
  Spinner,
  Text,
} from '@mieweb/ui';
import {
  SuperChatInbox,
  type ComposerAttachment,
  type SuperChatMediaFeedProps,
  type SuperChatRenderMessageMedia,
} from '@mieweb/ui/components/SuperChat';
import {
  createCodePlugin,
  createImagePlugin,
  createMermaidPlugin,
} from '@mieweb/ui/components/SuperChat/plugins';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  discardMedia,
  fetchTeamMembers,
  uploadedMedia,
  toPostAttachment,
} from '../features/huddle/api';
import { ComposerChips, TicketVideoChips } from '../features/huddle/ComposerAttachments';
import { ComposerChipButton } from '../features/huddle/ComposerChipButton';
import { ComposerError } from '../features/huddle/ComposerError';
import {
  composerErrorMessage,
  composerRefusalMessage,
  CONVERSATION_CLOSED_CODE,
} from '../features/huddle/composerErrors';
import {
  attachmentLimitLabel,
  attachmentSizeLimit,
  uploadAttachment,
} from '../features/huddle/useComposerUploads';
import { UPLOAD_TEXT } from '../features/huddle/uploadText';
import {
  conversationThreadId,
  conversationThreadIdForPost,
  defaultConversation,
  keptAttachments,
  isAwaitingDelivery,
  postsToConversations,
  postVideoNames,
  pulseVideoOfMedia,
  searchConversations,
  searchPosts,
  sessionConversationId,
  starterConversation,
  SYSTEM_PARTICIPANT_ID,
  type ThreadBy,
  DESTINATION_TEXT,
  postDestination,
  reasonsPostWontShow,
  topicIdOfThread,
  topicTitle,
  withTopicConversations,
} from '../features/huddle/superChatFeed';
import { useConversationTopics } from '../features/huddle/useConversationTopics';
import {
  ConversationMenu,
  NewConversationButton,
  StartHuddleButton,
} from '../features/huddle/ConversationControls';
import type { MediaItem } from '../features/huddle/types';
import { ScheduleDialog, ScheduledPostsButton } from '../features/huddle/ScheduleSend';
import { SCHEDULE_TEXT, type PostSchedule } from '../features/huddle/postSchedule';
import { PulseButton } from '../features/pulse-upload/PulseButton';
import { pulseArtifactId, videoLabel } from '../features/pulse-upload/artifact';
import { PulseVideoPlayer, VIDEO_CARD_SIZE } from '../features/pulse-upload/PulseVideoPlayer';
import { VideoMenu } from '../features/pulse-upload/VideoMenu';
import { noteVideoNames, useVideoNamesVersion } from '../features/pulse-upload/videoNames';
import { TicketPicker } from '../features/huddle/TicketPicker';
import { HuddleNotifyMenu } from '../features/huddle/HuddleNotifyMenu';
import { useHuddleViewing } from '../features/huddle/useHuddleViewing';
import {
  findConversationHeader,
  findListHeader,
  useInboxSlot,
} from '../features/huddle/useInboxSlot';
import { LoadOlderSentinel } from '../features/huddle/LoadOlderSentinel';
import { useFeedWindow } from '../features/huddle/useFeedWindow';
import { useStoredSidebarWidth } from '../features/huddle/useStoredSidebarWidth';
import {
  GROUP_MENTION_OPTIONS,
  detectGroupMentions,
  detectMentions,
  isGroupMentionId,
  useTeamMentions,
} from '../features/huddle/useTeamMentions';
import { useTicketVideos } from '../features/huddle/useTicketVideos';
import { useTicketSelection } from '../features/huddle/useTicketSelection';
import { AppPage } from '../ui/AppPage';
import { NoAccessState } from '../ui/NoAccessState';
import { liveLocation, useQueryParams, useRouter, useSearchParam } from '../ui/router';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { isTeamMember } from '@lib/organizationAccess';
import { TEAMS_STRINGS } from '../features/teams/teamsStrings';
import { ApiError, huddleApi, resolveMediaUrl, type HuddlePost } from '@lib/api';
import { getDdpClient, useLiveClockEvents } from '@lib/ddp';
import { useRefresh } from '@lib/RefreshContext';
import { toDateString } from '@lib/timeUtils';
import styles from './Huddle.module.css';

const THREAD_BY_KEY = 'app:huddleThreadBy';
// How long to wait for a first snapshot (DDP ready or REST) before reporting a load failure.
const LOAD_TIMEOUT_MS = 10_000;
// Team-picker value for the Personal view; team ids are never this string.
const PERSONAL_VIEW = 'personal';
// URL params that say which view Huddle is showing; any of them in the URL means the link chose the view.
const VIEW_PARAMS = ['conversation', 'post', 'postId', 'view', 'q'];
// Key of the Personal view's feed window; team feeds are keyed by team id.
const ME_FEED_KEY = 'me';
// How far back a link that can't be dated (a post, a session) is chased before it reads as not found.
const LINK_SEARCH_MAX_DAYS = 360;
/** The composer's attachment cap (ChatComposer's default). */
const COMPOSER_MAX_FILES = 10;
/** The send button's "Send later…" option id. */
const SEND_LATER = 'schedule';
const HUDDLE_PATH = '/app/huddle';
/**
 * The groupings the inbox offers. Day is gone (#866): a workday conversation
 * replaces the calendar-day thread, and an old `day:` link opens the workday
 * for that date.
 */
type InboxGrouping = Exclude<ThreadBy, 'day'>;
// All comes first and sits apart: it is the one option that doesn't group.
const THREAD_BY_OPTIONS: InboxGrouping[] = ['all', 'conversation', 'session', 'person', 'ticket'];
/** The "won't show here" warning before sending (#866). */
const SEND_ELSEWHERE_TEXT = {
  title: "This post won't show in the thread you're reading",
  description: (destination: string) => `It goes to ${destination}.`,
  send: 'Send and open it',
} as const;

/** The grouping for someone who hasn't picked one (or had picked the retired Day). */
const DEFAULT_THREAD_BY: InboxGrouping = 'conversation';
/** Kept stable so the inbox's rows don't re-render for it. */
const EDIT_MEDIA_LABELS = { removeAttachment: UPLOAD_TEXT.remove };

const THREAD_BY_LABELS: Record<InboxGrouping, string> = {
  all: 'All',
  conversation: 'Conversation',
  session: 'Session',
  person: 'Person',
  ticket: 'Ticket',
};
// Must not contain another option's label: e2e picks menu items by name.
const THREAD_BY_DESCRIPTIONS: Record<InboxGrouping, string> = {
  all: 'Every update in one thread, oldest first',
  conversation: 'Stand-up to stand-up threads, team conversations and direct messages',
  session: 'Each clock-in to clock-out with its plan, updates and wrap-up',
  person: 'One thread per teammate',
  ticket: 'Updates grouped by the work item they link to',
};

const baseImagePlugin = createImagePlugin();
const ZoomableImage = baseImagePlugin.components!.img;
/** Post markdown stores backend media by path (`/uploads/…`), which the native
 *  app would resolve against capacitor://localhost — bind it to the backend. */
function BackendImage(props: Record<string, unknown>) {
  const { src } = props;
  const isRelative = typeof src === 'string' && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src);
  return <ZoomableImage {...props} src={isRelative ? resolveMediaUrl(src) : src} />;
}
const imagePlugin = {
  ...baseImagePlugin,
  components: { ...baseImagePlugin.components, img: BackendImage },
};

/** Reserves the check's slot on unselected items so every label lines up. */
function SelectedCheck({ selected }: { selected: boolean }) {
  return <FontAwesomeIcon icon={faCheck} className={selected ? undefined : 'invisible'} />;
}

function loadStoredThreadBy(): InboxGrouping {
  try {
    const stored = localStorage.getItem(THREAD_BY_KEY);
    return (THREAD_BY_OPTIONS as string[]).includes(stored ?? '')
      ? (stored as InboxGrouping)
      : DEFAULT_THREAD_BY;
  } catch {
    return DEFAULT_THREAD_BY;
  }
}

/** The grouping a conversation id belongs to — ids are `${threadBy}:${key}`. */
function threadByOf(conversationId: string | null): InboxGrouping | null {
  const prefix = conversationId?.split(':')[0] ?? '';
  return (THREAD_BY_OPTIONS as string[]).includes(prefix) ? (prefix as InboxGrouping) : null;
}

/** Local midnight (epoch ms) of a `day:YYYY-MM-DD` conversation id; null for any other id. */
function dayConversationStart(conversationId: string | null): number | null {
  const match = /^day:(\d{4})-(\d{2})-(\d{2})$/.exec(conversationId ?? '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const start = new Date(year, month - 1, day);
  // A date that rolled over (month 13, Feb 30) is not a day.
  return start.getMonth() === month - 1 && start.getDate() === day ? start.getTime() : null;
}

export default function Huddle() {
  // View state in the URL (see src/ui/ROUTING.md):
  //   ?conversation=  the open conversation (opening one pushes, so Back closes it)
  //   ?post=          a post to open (alias ?postId=, from notifications); it
  //                   resolves to the ?conversation= that contains it
  //   ?q=             search
  const { params, setParams } = useQueryParams();
  const conversationParam = params.get('conversation');
  const postParam = params.get('post') || params.get('postId');
  const [searchQuery, setSearchQuery] = useSearchParam('q');

  // AppLayout keeps Huddle mounted behind other pages, but the sidebar link
  // back to it carries none of the view. Remember the view while Huddle is on
  // screen and put it back when it returns to a bare URL; a link that names a
  // view (a notification, a shared conversation) wins. The layout effect runs
  // before paint, so the return never flashes the default conversation, and it
  // re-runs each time <Activity> shows the page again.
  const { pathname, navigate } = useRouter();
  const onScreen = pathname === HUDDLE_PATH;

  // A post can link into the app: a timer update links its ticket. The chat
  // opens a link in a new tab; one that stays in the app opens here instead.
  // A modified click (new tab, new window) is left to the browser.
  const openAppLinkHere = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.origin);
      const inApp = url.pathname === '/app' || url.pathname.startsWith('/app/');
      if (url.origin !== window.location.origin || !inApp) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}`);
    },
    [navigate],
  );
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const lastViewRef = useRef<Record<string, string | null>>({});
  useLayoutEffect(() => {
    if (VIEW_PARAMS.some((key) => paramsRef.current.has(key))) return;
    setParams(lastViewRef.current);
  }, [setParams]);
  // A hidden <Activity> keeps its DOM, so playing media would carry on, audible,
  // behind the next page. Layout-effect cleanups run when it hides.
  const huddleRootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = huddleRootRef.current;
    return () =>
      root?.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => media.pause());
  }, []);
  useEffect(() => {
    if (!onScreen) return;
    // The search draft, not the URL's `q`: the URL follows it after a pause, and
    // leaving inside that pause would otherwise lose what was typed.
    lastViewRef.current = {
      conversation: params.get('conversation'),
      view: params.get('view'),
      q: searchQuery,
    };
  }, [onScreen, params, searchQuery]);
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A failed inbox send or inline edit. Separate from `error` above, which is
  // a feed-load failure and takes the feed's place on screen.
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [threadByMenuOpen, setThreadByMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  // How the inbox groups posts into conversations. Persisted so a reload
  // keeps the reader's choice; switching it only re-runs the grouping
  // function below, it never refetches. A linked conversation or post brings
  // its own grouping without overwriting the saved one (posts are found by
  // session).
  const [storedThreadBy, _setThreadBy] = useState<InboxGrouping>(loadStoredThreadBy);
  // A post link opens the post's session, even when All is the saved grouping:
  // SuperChatInbox can't scroll to a message yet, and a session's short thread
  // keeps the post in view (see docs/superchat-inbox-gaps.md).
  const threadBy =
    threadByOf(conversationParam) ?? (postParam ? 'session' : null) ?? storedThreadBy;
  const setThreadBy = useCallback(
    (next: InboxGrouping) => {
      _setThreadBy(next);
      // The open conversation belongs to the old grouping.
      setParams({ conversation: null });
      try {
        localStorage.setItem(THREAD_BY_KEY, next);
      } catch {
        // Storage may be unavailable (private mode, embedded webview) — the
        // in-memory choice for this session still works.
      }
    },
    [setParams],
  );
  const { user } = useSession();
  const [sidebarWidth, setSidebarWidth] = useStoredSidebarWidth(user?.id);
  const {
    selectedTeamId: contextTeamId,
    selectedTeam,
    isSelectedTeamMember,
    setSelectedTeamId,
    teams,
    allTeams,
    isAdmin,
    currentTime,
    teamsReady,
  } = useTeam();
  // An organization owner can open a team they haven't joined, but its feed is
  // members-only: the team has no Huddle here until they join it.
  const unjoinedTeam = selectedTeam && !isSelectedTeamMember ? selectedTeam : null;
  const selectedTeamId = unjoinedTeam ? null : contextTeamId;

  // Personal is a view, not a team selection: entering it leaves the selected
  // team and org alone, so the team picker stays put. It shows the posts in the
  // caller's personal team, fetched separately over REST. Having the Personal
  // team itself selected (e.g. from the header switcher) lands in the same view.
  //
  // It lives in the URL because the selected team is not the Personal team:
  // without `?view=me` a reloaded or shared link would fall back to the team
  // feed, where a Personal conversation reads as not found.
  const showMe = params.get('view') === 'me';
  // A team change from anywhere (header switcher, org switch) leaves the
  // Personal view. Compared with the previous value so loading a `?view=me`
  // link, which also settles the team, doesn't immediately clear it.
  // The context's team, not the feed's: a team opened without being joined has no
  // feed, but selecting it is not the reader moving, so it must not leave the view.
  const personalScopeTeamRef = useRef(contextTeamId);
  useEffect(() => {
    if (personalScopeTeamRef.current === contextTeamId) return;
    personalScopeTeamRef.current = contextTeamId;
    if (showMe) setParams({ view: null });
  }, [contextTeamId, showMe, setParams]);
  const personalTeamId = allTeams.find((t) => t.isPersonal)?.id ?? null;
  const scope: 'team' | 'me' =
    showMe || (selectedTeamId !== null && selectedTeamId === personalTeamId) ? 'me' : 'team';
  // Where the inbox's chat input posts: the Personal team in the Personal
  // view, the selected team otherwise.
  const postingTeamId = scope === 'me' ? personalTeamId : selectedTeamId;

  // The tickets the chat input's Ticket button adds to the next post, reset
  // per team so one picked for one team can't land in another team's post.
  // (Pulse isn't staged here: the server posts a Pulse video itself — see PulseButton.)
  const {
    tickets: selectedTickets,
    ticketIds: selectedTicketIds,
    setTickets: setSelectedTickets,
    addTicket,
    removeTicket,
  } = useTicketSelection();
  // The picked tickets' own videos come along with them.
  const ticketVideos = useTicketVideos(selectedTicketIds);
  // @mentions reach the whole team, not just whoever is in the open thread.
  const mentions = useTeamMentions(postingTeamId);
  // A send is in flight. The ref is what guards re-entry; the state only
  // drives the composer's busy send button.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  // The open "Send later…" dialog: settles the send that is waiting on it.
  const [schedulePrompt, setSchedulePrompt] = useState<{
    resolve: (schedule: PostSchedule) => void;
    reject: () => void;
  } | null>(null);
  const askForSchedule = () =>
    new Promise<PostSchedule>((resolve, reject) =>
      setSchedulePrompt({ resolve, reject: () => reject(new Error('Scheduling cancelled')) }),
    );
  // The open "won't show here" warning (#866): settles the send waiting on it.
  // Cancel rejects, which puts the draft back in the composer.
  const [elsewherePrompt, setElsewherePrompt] = useState<{
    reasons: string[];
    destination: string;
    resolve: () => void;
    reject: () => void;
  } | null>(null);
  const confirmSendElsewhere = (reasons: string[], destination: string) =>
    new Promise<void>((resolve, reject) =>
      setElsewherePrompt({
        reasons,
        destination,
        resolve,
        reject: () => reject(new Error('Sending cancelled')),
      }),
    );
  useEffect(() => {
    setSelectedTickets([]);
  }, [postingTeamId, setSelectedTickets]);

  const teamOptions = teams.filter((t) => !t.isPersonal && isTeamMember(t, user?.id ?? null));
  const teamPickerValue = scope === 'me' ? PERSONAL_VIEW : (selectedTeamId ?? '');
  const teamPickerLabel =
    scope === 'me'
      ? 'Personal'
      : (teamOptions.find((t) => t.id === selectedTeamId)?.name ?? 'Select team');
  const selectTeamView = (value: string) => {
    // DropdownItem doesn't close its menu on its own.
    setTeamMenuOpen(false);
    if (value === PERSONAL_VIEW) {
      setParams({ view: 'me' }, 'push');
      return;
    }
    setParams({ view: null }, 'push');
    setSelectedTeamId(value);
  };
  // How far back each feed reaches. The team feed and the Personal view keep
  // their own windows; the team's resets when the selected team changes.
  const teamFeedKey = `team:${selectedTeamId}`;
  const teamWindow = useFeedWindow(teamFeedKey);
  const meWindow = useFeedWindow(ME_FEED_KEY);
  const feedWindow = scope === 'me' ? meWindow : teamWindow;

  const [myPosts, setMyPosts] = useState<HuddlePost[]>([]);
  // Starts true so the Personal view's first render shows the spinner, not an
  // empty feed, before its fetch effect runs.
  const [myPostsLoading, setMyPostsLoading] = useState(true);
  const [myPostsError, setMyPostsError] = useState<string | null>(null);
  const { since: meSince, settle: settleMe } = meWindow;
  const meSinceRef = useRef(meSince);
  meSinceRef.current = meSince;
  const meLoadedRef = useRef(false);
  // Resolves to the posts it loaded, or null when the fetch failed or was superseded.
  const refreshMyPosts = useCallback(async (): Promise<HuddlePost[] | null> => {
    try {
      const asOf = Date.now();
      const page = await huddleApi.getMyPosts(meSince);
      // The server's names as of the fetch, newer than any rename made before it.
      noteVideoNames(postVideoNames(page.posts), asOf);
      // Answered for a window that has since moved on; the newer fetch owns the state.
      if (meSinceRef.current !== meSince) return null;
      setMyPosts(page.posts);
      setMyPostsError(null);
      meLoadedRef.current = true;
      settleMe(ME_FEED_KEY, { ok: true, hasMore: page.hasMore });
      return page.posts;
    } catch (err) {
      console.error('[Huddle] refreshMyPosts failed:', err);
      // Only the first load replaces the feed; a failed older window keeps what
      // is loaded and reports through the list footer's Retry.
      if (!meLoadedRef.current) setMyPostsError('Failed to load your posts.');
      settleMe(ME_FEED_KEY, { ok: false });
      return null;
    }
  }, [meSince, settleMe]);
  useEffect(() => {
    if (scope !== 'me') return;
    // No spinner here: a widened window or a return to Personal keeps the posts
    // already on screen while the fetch runs.
    refreshMyPosts().finally(() => setMyPostsLoading(false));
  }, [scope, refreshMyPosts]);

  // Live session state for the inbox titles and the classic card header. The
  // posts publication only fires on post writes, so a clock-out would never
  // reach the feed on its own — `clock.liveForTeams` carries every still-open
  // session for the team in scope.
  const liveTeamIds = useMemo(() => (postingTeamId ? [postingTeamId] : []), [postingTeamId]);
  const { docs: liveClockEvents } = useLiveClockEvents(liveTeamIds);

  // Last REST snapshot for the team, replaced wholesale on every refetch (not
  // merged) so an edit or delete that happened while DDP was disconnected is
  // reflected, and a post absent from a later snapshot doesn't linger forever.
  const restPostsRef = useRef<Map<string, HuddlePost>>(new Map());

  // Build the feed from the DDP cache plus any pending overlay posts. Lifted to
  // component scope so posting and pull-to-refresh can trigger an immediate
  // re-sync.
  const syncPosts = useCallback(() => {
    if (!selectedTeamId) return;
    const ddp = getDdpClient();
    const byId = new Map<string, HuddlePost>();
    for (const p of ddp.docs('huddlePosts')) {
      if (p.teamId !== selectedTeamId) continue;
      const post = { ...p, id: (p.id ?? p._id) as string } as unknown as HuddlePost;
      byId.set(post.id, post);
    }
    // REST snapshot wins over the DDP cache when it's newer — DDP may be
    // holding a stale copy while the socket is disconnected (e.g. backgrounded
    // for a Pulse recording), so a plain "DDP always wins" merge would hide
    // REST-only edits indefinitely.
    for (const [id, restPost] of restPostsRef.current) {
      const ddpPost = byId.get(id);
      if (
        !ddpPost ||
        new Date(restPost.updatedAt).getTime() > new Date(ddpPost.updatedAt).getTime()
      ) {
        byId.set(id, restPost);
      } else if (restPost.session?.endTime != null && ddpPost.session?.endTime == null) {
        // Clock-out doesn't touch the post, so the DDP copy keeps its open
        // session snapshot; take the closed one from the post-clock-out refetch.
        byId.set(id, { ...ddpPost, session: restPost.session });
      } else if ((restPost.scheduleVersion ?? 0) > (ddpPost.scheduleVersion ?? 0)) {
        // Delivery and reschedule don't bump updatedAt either (so a scheduled
        // post isn't shown as edited), so compare scheduleVersion instead —
        // it's bumped on every write to deliverAt/deliveredAt/postDate.
        // Whichever copy has the higher version is the newer one: this
        // covers Send now / Reschedule made from another tab, or made here
        // while DDP was disconnected, without letting an older cached REST
        // snapshot (e.g. from right after the post was created, before
        // either happened) undo a delivery or reschedule that's since
        // happened live.
        byId.set(id, {
          ...ddpPost,
          deliverAt: restPost.deliverAt,
          deliveredAt: restPost.deliveredAt,
          postDate: restPost.postDate,
          scheduleVersion: restPost.scheduleVersion,
        });
      }
    }
    const teamPosts = [...byId.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setPosts(teamPosts);
  }, [selectedTeamId]);

  // Fetch the feed over REST and overlay it. Used by pull-to-refresh and as a
  // fallback when the live DDP socket is down (dropped while backgrounded for a
  // Pulse recording), so the feed still updates without a reconnect.
  const selectedTeamIdRef = useRef(selectedTeamId);
  selectedTeamIdRef.current = selectedTeamId;
  const { since: teamSince, settle: settleTeam } = teamWindow;
  const teamSinceRef = useRef(teamSince);
  teamSinceRef.current = teamSince;
  /** Resolves false when the fetch failed. */
  const refreshFeed = useCallback(async (): Promise<boolean> => {
    if (!selectedTeamId) return true;
    try {
      const asOf = Date.now();
      const page = await huddleApi.getPosts(selectedTeamId, teamSince);
      // The server's names as of the fetch, whichever copy of a post wins below.
      noteVideoNames(postVideoNames(page.posts), asOf);
      // A refetch that outlived a team switch (e.g. the post-send retry loop)
      // must not write the old team's snapshot over the new team's feed; the
      // same goes for one answered for a window that has since widened.
      if (selectedTeamIdRef.current !== selectedTeamId || teamSinceRef.current !== teamSince)
        return true;
      restPostsRef.current = new Map(page.posts.map((post) => [post.id, post]));
      syncPosts();
      // A fetched snapshot is real data, even when it is empty.
      setLoading(false);
      setError(null);
      settleTeam(teamFeedKey, { ok: true, hasMore: page.hasMore });
      return true;
    } catch (err) {
      console.error('[Huddle] refreshFeed failed:', err);
      settleTeam(teamFeedKey, { ok: false });
      return false;
    }
  }, [selectedTeamId, teamSince, teamFeedKey, syncPosts, settleTeam]);

  // Wire pull-to-refresh (swipe down) to the REST refetch for whichever scope
  // is active.
  const refreshActiveScope = useCallback(async () => {
    if (scope === 'me') await refreshMyPosts();
    else await refreshFeed();
  }, [scope, refreshMyPosts, refreshFeed]);
  useRefresh(refreshActiveScope);

  // A post's `session.endTime` is a snapshot from when it was last fetched —
  // clocking out doesn't touch the huddlePosts document, so the change stream
  // behind the posts subscription never fires for it. The live clock event
  // list above drops a session the instant it closes, so refetch only when a
  // session that was open in scope has closed — not on first load, a team
  // switch or a clock-in. In Personal only the caller's own sessions count.
  const liveClockEventIdsKey = liveClockEvents
    .map((d) => `${d._id}:${d.endTime ?? 'open'}`)
    .join(',');
  const openSessionsRef = useRef<Map<string, string>>(new Map());
  const refreshActiveScopeRef = useRef(refreshActiveScope);
  refreshActiveScopeRef.current = refreshActiveScope;
  useEffect(() => {
    const inScope = new Set(liveTeamIds);
    const open = new Map<string, string>();
    for (const d of liveClockEvents) {
      const teamId = String(d.teamId ?? '');
      if (d.endTime != null || !inScope.has(teamId)) continue;
      if (scope === 'me' && d.userId !== user?.id) continue;
      open.set(String(d._id), teamId);
    }
    const previous = openSessionsRef.current;
    openSessionsRef.current = open;
    const closed = [...previous].some(([id, teamId]) => inScope.has(teamId) && !open.has(id));
    if (closed) void refreshActiveScopeRef.current();
  }, [liveClockEventIdsKey, liveTeamIds, scope, user?.id]);

  // A team's feed starts over when the selected team changes — and only then.
  // Huddle is paused (see AppLayout) when another page is showing, which runs
  // every effect's cleanup; the posts already on screen must survive that.
  const loadedTeamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTeamId) {
      loadedTeamRef.current = null;
      setPosts([]);
      setLoading(false);
      return;
    }
    if (loadedTeamRef.current === selectedTeamId) return;
    loadedTeamRef.current = selectedTeamId;
    setPosts([]);
    restPostsRef.current.clear();
    setLoading(true);
    setError(null);
  }, [selectedTeamId]);

  // The live subscription hasn't delivered in time: fetch over REST, and only
  // when that fails too say so — an empty feed would read as "no posts" (and
  // offer the starter conversation).
  const refreshFeedRef = useRef(refreshFeed);
  refreshFeedRef.current = refreshFeed;
  useEffect(() => {
    if (!loading || !selectedTeamId) return;
    const loadingFallback = setTimeout(() => {
      void refreshFeedRef.current().then((ok) => {
        if (ok) return;
        setLoading(false);
        setError('Failed to load posts. Pull down to retry.');
      });
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(loadingFallback);
  }, [loading, selectedTeamId]);

  // Subscribe to the live DDP publication for the team's posts in the window.
  // The subscription is the one source of the posts: REST only answers whether
  // older posts exist (fetching them there too downloaded every post twice),
  // unless the socket is down — then REST carries the feed instead.
  useEffect(() => {
    if (!selectedTeamId) return;

    const ddp = getDdpClient();
    let cancelled = false;
    let offChange = () => {};
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    // The feed is rebuilt from the DDP cache only once the window's posts are
    // all in, then on every change. Not before: returning to a paused Huddle
    // re-subscribes, and the cache is empty until the posts arrive again —
    // syncing then would blank the feed and lose the open conversation and the
    // list's scroll position.
    const unsub = ddp.subscribe('huddlePosts.byTeam', [selectedTeamId, teamSince], () => {
      if (cancelled) return;
      setLoading(false);
      setError(null);
      syncPosts();
      offChange();
      offChange = ddp.onCollectionChange('huddlePosts', syncPosts);
      markReady();
    });

    if (ddp.status === 'failed') {
      // Dropped while the app was backgrounded for a Pulse recording.
      void refreshFeed();
    } else {
      // Settle the window once its posts are in, so the list's end doesn't ask
      // for an older window before this one has rendered.
      void Promise.all([huddleApi.hasPostsBefore(selectedTeamId, teamSince), ready])
        .then(([hasMore]) => {
          if (!cancelled) settleTeam(teamFeedKey, { ok: true, hasMore });
        })
        .catch((err) => {
          console.error('[Huddle] hasPostsBefore failed:', err);
          if (!cancelled) settleTeam(teamFeedKey, { ok: false });
        });
    }

    return () => {
      cancelled = true;
      unsub();
      offChange();
    };
  }, [selectedTeamId, teamSince, teamFeedKey, syncPosts, refreshFeed, settleTeam]);

  // The posts driving the inbox: one team's feed, or (in the "Me" scope) the
  // caller's personal team.
  const activePosts = scope === 'me' ? myPosts : posts;
  // The conversation topics (#866) the posts belong to, with the names I see.
  const { topics, refresh: refreshTopics } = useConversationTopics(postingTeamId, activePosts);
  const openWorkday = topics.openWorkdayId ? (topics.byId.get(topics.openWorkdayId) ?? null) : null;
  const myScheduledPosts = useMemo(
    () => activePosts.filter((p) => p.userId === user?.id && isAwaitingDelivery(p)),
    [activePosts, user?.id],
  );

  // Personal scope has no live subscription at all (huddle.getMyPosts is a
  // one-time REST call), and a team's own DDP feed can just as easily be
  // disconnected (mobile backgrounded for a Pulse recording) — either way, a
  // post's own Agenda-driven delivery while this tab is open would otherwise
  // never update it here. Poll the active scope's own REST refresh while any
  // of mine are still waiting, matching Agenda's own processEvery, so the
  // dashed bubble and "Scheduled (n)" catch up without a manual refresh.
  useEffect(() => {
    if (!myScheduledPosts.length) return;
    const id = setInterval(() => void refreshActiveScopeRef.current(), 30_000);
    return () => clearInterval(id);
  }, [myScheduledPosts.length]);

  // A post link (dashboard Recent Activity, clock-in/out and huddle-comment
  // notifications) opens the conversation containing it once loaded. Its team
  // comes in the link's ?team= (TeamContext switches to it); a search that
  // would hide it is cleared when it resolves. Against the active scope, since
  // Personal fetches its own posts.
  // A boolean, not the array itself: that gets a fresh identity on every DDP
  // change event.
  const targetPostLoaded = postParam !== null && activePosts.some((p) => p.id === postParam);

  // Team admins (and org owners) get the extra session-title detail (hours,
  // no-wrap-up warning). Not in Personal: `isAdmin` there reflects the
  // Personal team, where everyone is admin, not the posts' source teams.
  const viewerIsAdmin = scope === 'team' && isAdmin;
  const viewer = useMemo(
    () => ({ userId: user?.id ?? '', isAdmin: viewerIsAdmin }),
    [user?.id, viewerIsAdmin],
  );

  // ── SuperChatInbox mapping (memoized — posts update via DDP) ──
  // Keyed on the post arrays themselves: syncPosts/refreshMyPosts replace them
  // on every change, including ones that don't bump `updatedAt` (clock-in
  // linking a plan to its session, clock-out closing it). `nowMinute` keeps a
  // live session's worked duration moving without regrouping every second.
  const nowMinute = Math.floor(currentTime / 60_000) * 60_000;
  // A rename doesn't change the post, so the feed rebuilds on a name itself.
  const videoNamesVersion = useVideoNamesVersion();
  const allConversations = useMemo(() => {
    const grouped = postsToConversations(
      activePosts,
      threadBy,
      viewer,
      nowMinute,
      activePosts,
      topics,
    );
    if (!user) return grouped;
    const me = { userId: user.id, name: user.name };
    return withTopicConversations(grouped, threadBy, topics, me, nowMinute);
  }, [activePosts, threadBy, viewer, nowMinute, user, scope, videoNamesVersion, topics]);
  // Search runs over whole conversations (titles, people, clock lines, post
  // fields), after grouping, so a match keeps its thread intact. All has just
  // the one thread, so there it narrows the posts in it instead.
  // With nothing to group (no posts at all, or in Session none made on the
  // clock), the inbox shows a starter conversation instead: SuperChat's chat
  // input only exists inside an open conversation, and it is where the first
  // update gets posted.
  const conversations = useMemo(() => {
    const nothingGrouped = allConversations.length === 0 && !searchQuery.trim();
    // Conversation grouping already lists its open topics, posts or not.
    const topicsListed = threadBy === 'conversation' && allConversations.length > 0;
    if ((activePosts.length === 0 || nothingGrouped) && user && !topicsListed) {
      return [
        starterConversation({ userId: user.id, name: user.name }, scope, nowMinute, threadBy),
      ];
    }
    if (threadBy === 'all' && searchQuery.trim()) {
      const matches = searchPosts(activePosts, searchQuery, viewer);
      return postsToConversations(matches, 'all', viewer, nowMinute, activePosts);
    }
    return searchConversations(allConversations, activePosts, searchQuery);
  }, [allConversations, activePosts, searchQuery, user, scope, threadBy, viewer, nowMinute]);
  const renderPlugins = useMemo(() => [createCodePlugin(), imagePlugin, createMermaidPlugin()], []);
  // A post's Pulse video (its message's media, see superChatFeed.ts) is the
  // same card as everywhere else; here ▶ opens the conversation's media view.
  // Who owns each video in view, for Rename: its owner, not whoever posted it
  // (a post can carry a ticket's videos). Read through a ref, so the media
  // callbacks below keep their identity as posts change.
  const videoOwners = useRef(new Map<string, string | null>());
  videoOwners.current = useMemo(() => {
    const owners = new Map<string, string | null>();
    for (const post of activePosts) {
      for (const att of post.attachments) {
        const video = att.type === 'video' ? pulseArtifactId(att.url) : null;
        if (video) owners.set(video, att.ownerId ?? null);
      }
    }
    return owners;
  }, [activePosts]);
  const ownsVideo = useCallback(
    (videoId: string) => !!user?.id && videoOwners.current.get(videoId) === user.id,
    [user?.id],
  );
  // A Pulse video is our card (▶ opens it in the media view), never folded
  // into a gallery; an image is SuperChat's own tile, and two or more its
  // gallery.
  const renderMessageMedia = useCallback<SuperChatRenderMessageMedia>(
    ({ attachment, open, launchId, maxSize }) =>
      pulseVideoOfMedia(attachment) ? (
        <PulseVideoPlayer
          maxSize={maxSize}
          video={attachment.id}
          title={videoLabel(attachment.title, attachment.id)}
          caption={attachment.title}
          renamable={ownsVideo(attachment.id)}
          onOpen={open && (() => open(true))}
          launchId={launchId}
        />
      ) : null,
    [ownsVideo],
  );
  // The conversation's media view (SuperChat's feed of its photos and
  // videos). Opening one is a tap to watch it, so a clip starts with its sound,
  // as on every card (the player's own mute is in its bar); a Pulse video's ⋯
  // menu is there too, to copy its link or rename one of your own.
  const mediaFeedProps = useMemo<SuperChatMediaFeedProps>(
    () => ({
      // Mobile first: each clip edge to edge, and on a phone the media view
      // takes the whole screen above the message box.
      layout: 'overlay',
      muted: false,
      // A Pulse video's menu; an image or an uploaded file has none.
      renderActions: ({ attachment }) =>
        pulseVideoOfMedia(attachment) ? (
          <VideoMenu
            video={attachment.id}
            name={attachment.title ?? null}
            label={videoLabel(attachment.title, attachment.id)}
            renamable={ownsVideo(attachment.id)}
            inFeed
          />
        ) : null,
    }),
    [ownsVideo],
  );

  // SuperChatInbox has no slot for its list header, so the page's filters are
  // portaled into it.
  const feedRef = useRef<HTMLDivElement>(null);
  const listHeaderEl = useInboxSlot(feedRef, findListHeader);
  const conversationHeaderEl = useInboxSlot(feedRef, findConversationHeader);
  // Pushes about this team are skipped while it's on screen (#784).
  useHuddleViewing(scope === 'team' ? selectedTeamId : null);

  // Both filter dropdowns share one look: equal-width bordered fields with a
  // small legend notched into the top border.
  const filterFieldClass = 'relative flex min-w-0 flex-1 [&>*]:min-w-0 [&>*]:flex-1';
  const filterLegendClass =
    'pointer-events-none absolute -top-1.5 start-2 z-10 bg-background px-1 text-[10px] leading-none text-muted-foreground';
  const filterTriggerClass =
    'w-full justify-between gap-1 border border-input bg-background px-2.5';

  const groupByDropdown = (
    <div className={filterFieldClass}>
      <span aria-hidden className={filterLegendClass}>
        Group by
      </span>
      <Dropdown
        open={threadByMenuOpen}
        onOpenChange={setThreadByMenuOpen}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Group by: ${THREAD_BY_LABELS[threadBy]}`}
            className={filterTriggerClass}
          >
            <span className="min-w-0 truncate">{THREAD_BY_LABELS[threadBy]}</span>
            <FontAwesomeIcon icon={faChevronDown} className="shrink-0 text-xs" />
          </Button>
        }
      >
        {THREAD_BY_OPTIONS.map((option) => (
          <Fragment key={option}>
            <DropdownItem
              icon={<SelectedCheck selected={option === threadBy} />}
              onClick={() => {
                setThreadBy(option);
                // DropdownItem doesn't close its menu on its own.
                setThreadByMenuOpen(false);
              }}
            >
              <span className="flex flex-col">
                <span className="flex items-center gap-2">
                  {THREAD_BY_LABELS[option]}
                  {(option === 'all' || option === 'conversation') && (
                    <Badge variant="secondary" size="sm">
                      New
                    </Badge>
                  )}
                </span>
                <Text as="span" variant="muted" size="xs" className="max-w-56 whitespace-normal">
                  {THREAD_BY_DESCRIPTIONS[option]}
                </Text>
              </span>
            </DropdownItem>
            {option === 'all' && <DropdownSeparator />}
          </Fragment>
        ))}
      </Dropdown>
    </div>
  );

  // Search, then team picker (left) and Group by (right). "Personal" is a view
  // (see `showMe`); picking a team uses the same setSelectedTeamId as the
  // header team switcher.
  const inboxControls = (
    <div className="huddle-inbox-controls flex w-full min-w-0 flex-col gap-3">
      <div className="huddle-search-row flex items-center gap-2">
        <div className="huddle-search relative min-w-0 flex-1">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2 text-xs text-neutral-400"
          />
          <Input
            label="Search posts"
            hideLabel
            size="sm"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts, people, tickets, dates…"
            className="ps-8"
          />
        </div>
        {scope === 'team' && postingTeamId && user && (
          <NewConversationButton
            teamId={postingTeamId}
            roster={mentions.options}
            viewerId={user.id}
            onCreated={(created) => void openTopic(created.id)}
          />
        )}
      </div>
      <ButtonGroup orientation="horizontal">
        <div className={filterFieldClass}>
          <span aria-hidden className={filterLegendClass}>
            Team
          </span>
          <Dropdown
            open={teamMenuOpen}
            onOpenChange={setTeamMenuOpen}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Team: ${teamPickerLabel}`}
                className={filterTriggerClass}
              >
                <span className="min-w-0 truncate">{teamPickerLabel}</span>
                <FontAwesomeIcon icon={faChevronDown} className="shrink-0 text-xs" />
              </Button>
            }
          >
            {[{ id: PERSONAL_VIEW, name: 'Personal' }, ...teamOptions].map((option) => (
              <DropdownItem
                key={option.id}
                icon={<SelectedCheck selected={option.id === teamPickerValue} />}
                onClick={() => selectTeamView(option.id)}
              >
                {option.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
        {groupByDropdown}
      </ButtonGroup>
      {searchQuery.trim() && conversations.length === 0 && (
        <Text as="p" variant="muted" size="xs" role="status">
          No matching posts
        </Text>
      )}
    </div>
  );

  // The conversation the inbox has open (controlled — see onConversationOpened
  // below).
  //
  // A linked id is resolved against every conversation, not the search-filtered
  // list, so the search box can't hide what the link points at. The starter
  // conversation is the one id that exists only in the rendered list. An id
  // that resolves to nothing is a dead link rather than a reason to open
  // someone else's conversation, so it gets the not-found state instead of
  // silently falling back to the first one.
  const linkedConversation = conversationParam
    ? (allConversations.find((c) => c.id === conversationParam) ??
      conversations.find((c) => c.id === conversationParam) ??
      null)
    : null;
  const activeConversation = conversationParam
    ? linkedConversation
    : defaultConversation(conversations, threadBy, nowMinute, topics.openWorkdayId);
  const openConversation = (conversationId: string) =>
    setParams({ conversation: conversationId }, 'push');
  // A topic just made or started: reload the list first, so its thread is
  // there to open rather than a not-found.
  const openTopic = async (topicId: string) => {
    await refreshTopics();
    openConversation(conversationThreadId(topicId));
  };
  // The topic behind the open thread, when it is one (Conversation grouping).
  const activeTopicId = topicIdOfThread(activeConversation?.id);
  const activeTopic = activeTopicId ? (topics.byId.get(activeTopicId) ?? null) : null;
  // An old `day:YYYY-MM-DD` link (the Day grouping, retired in #866) opens the
  // workday for that date once the topics are in.
  useEffect(() => {
    const day = /^day:(\d{4}-\d{2}-\d{2})$/.exec(conversationParam ?? '')?.[1];
    if (!day) return;
    const workday = [...topics.byId.values()].find(
      (t) => t.kind === 'workday' && t.dateKey === day,
    );
    if (workday) setParams({ conversation: conversationThreadId(workday.id) });
  }, [conversationParam, topics, setParams]);
  // Where the composer's next post goes, always shown beside it (#866).
  // The team names it too (a direct message names the person, its audience).
  const composerDestination = postDestination(activeConversation?.id, topics);
  const destinationTeamName =
    scope === 'me' ? 'Personal' : (teamOptions.find((t) => t.id === selectedTeamId)?.name ?? '');
  const composerDestinationName = composerDestination
    ? composerDestination.kind === 'direct'
      ? topicTitle(composerDestination)
      : DESTINATION_TEXT.inTeam(destinationTeamName, topicTitle(composerDestination))
    : DESTINATION_TEXT.inTeam(destinationTeamName, DESTINATION_TEXT.newWorkday);

  // Switching team or view leaves the open conversation behind. Compared with
  // the previous value so a linked conversation survives the first render.
  // Skipped until the teams are in: `scope` can only be trusted once
  // `personalTeamId` is known, and the flip it makes on arrival is the app
  // settling, not the reader moving.
  const scopeKey = `${contextTeamId}|${scope}`;
  const scopeKeyRef = useRef(scopeKey);
  // The grouping on screen now, for a send that finishes after it changed.
  const threadByRef = useRef(threadBy);
  useEffect(() => {
    threadByRef.current = threadBy;
  }, [threadBy]);
  useEffect(() => {
    if (!teamsReady) {
      scopeKeyRef.current = scopeKey;
      return;
    }
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    setParams({ conversation: null });
  }, [scopeKey, teamsReady, setParams]);

  const feedLoading = scope === 'me' ? myPostsLoading : loading;
  const feedError = scope === 'me' ? myPostsError : error;

  // A link to something older than the loaded window isn't missing yet: widen
  // until it turns up. Only `hasMore === false` (or, for a day link, a window
  // that now covers its date) says it isn't there — `null` just means no fetch
  // has reported yet. Widening stops on its own at LINK_SEARCH_MAX_DAYS, and
  // after a failed load, leaving the list footer to carry on by hand.
  const { hasMore, loadingOlder, loadFailed, loadOlder } = feedWindow;
  const conversationMissing = !!conversationParam && !linkedConversation;
  const postMissing = !!postParam && !targetPostLoaded;
  const dayStart = dayConversationStart(conversationParam);
  const conversationSearched =
    hasMore === false || (dayStart !== null && Date.parse(feedWindow.since) <= dayStart);
  const postSearched = hasMore === false;
  const searchingForLink =
    (conversationMissing && !conversationSearched) || (postMissing && !postSearched);
  const linkSearchStopped = loadFailed || feedWindow.days >= LINK_SEARCH_MAX_DAYS;
  const linkStateSettled = scopeKeyRef.current === scopeKey && !feedLoading && !feedError;
  const resolvingLink = searchingForLink && !linkSearchStopped && linkStateSettled;
  // Still missing, but history hasn't been ruled out: the reader loads the rest.
  const linkSearchPaused = searchingForLink && linkSearchStopped && linkStateSettled;
  useEffect(() => {
    if (resolvingLink) loadOlder();
  }, [resolvingLink, loadingOlder, loadOlder]);

  // The link points at a conversation we have, but the search box is hiding
  // it — the link wins, so the search goes. Once per link: after that the
  // reader is searching for something else, and clearing every keystroke that
  // filtered the open conversation out would make the box impossible to type in.
  const searchClearedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedConversation) {
      searchClearedForRef.current = null;
      return;
    }
    if (searchClearedForRef.current === linkedConversation.id) return;
    if (!searchQuery.trim()) return;
    if (conversations.some((c) => c.id === linkedConversation.id)) return;
    searchClearedForRef.current = linkedConversation.id;
    setSearchQuery('');
  }, [linkedConversation, conversations, searchQuery, setSearchQuery]);

  // A conversation that was open and then went — its last post deleted, or the
  // starter replaced by the first real one — is not a dead link. Drop back to
  // the list instead of covering the inbox with not-found, which would leave
  // nothing to pick from. A link that never resolved still gets not-found.
  const everResolvedRef = useRef<string | null>(null);
  useEffect(() => {
    if (linkedConversation && conversationParam) {
      everResolvedRef.current = conversationParam;
      return;
    }
    if (!conversationParam || everResolvedRef.current !== conversationParam) return;
    everResolvedRef.current = null;
    setParams({ conversation: null });
  }, [conversationParam, linkedConversation, setParams]);

  // Only once the posts are in, and not across a scope change, where the
  // effect above clears the param a render later. Not while an older window
  // could still hold it (`conversationSearched`).
  const conversationUnavailable = conversationMissing && conversationSearched && linkStateSettled;

  // Post link → the conversation that holds it (see `targetPostLoaded`).
  // Searched in every conversation, not just the ones the search box shows.
  useEffect(() => {
    if (!postParam || !targetPostLoaded || threadBy !== 'session') return;
    const match = allConversations.find((c) => c.thread.some((m) => m.id === postParam));
    // A post made off the clock has no Session thread: its conversation holds it.
    const offClock = match ? null : activePosts.find((p) => p.id === postParam && !p.clockEventId);
    const conversation = match?.id ?? (offClock && conversationThreadIdForPost(offClock, topics));
    if (!conversation) return;
    setParams({ conversation, post: null, postId: null, q: null });
  }, [postParam, targetPostLoaded, threadBy, allConversations, activePosts, setParams, topics]);

  // A deleted post, or one from a team this link didn't carry, never resolves
  // above — without this the inbox would quietly show its default conversation
  // while the URL still named the post. Same timing guard as the conversation
  // case, so a post still arriving over DDP isn't called missing.
  const postUnavailable = postMissing && postSearched && linkStateSettled;

  // Posting from the inbox's chat input → huddle.createPost. Rejecting tells
  // SuperChat to put the typed text back, so only a failed upload or create
  // rejects; a slow refresh afterwards doesn't.
  async function handleMessageSent(
    text: string,
    sentMentions: string[],
    composerAttachments: ComposerAttachment[],
    conversationId: string,
    sendOption?: string,
  ) {
    // A Pulse video or ticket keeps the send button live with an empty box, so
    // a second click during the upload would post the same thing again. The
    // composer's own `isSending` covers this a render later; the ref covers
    // the click that lands before that render. Refused out loud (a rejection),
    // so SuperChat puts this draft and its files back rather than dropping them.
    const alreadySending = () => new Error('A post is already on its way. Send again in a moment.');
    if (sendingRef.current) throw alreadySending();
    // Cancelling the dialog rejects, so SuperChat puts the typed text back.
    const sendSchedule = sendOption === SEND_LATER ? await askForSchedule() : null;
    // Stamped once: the post's Day thread, even if midnight passes while it sends.
    const postDate = toDateString(sendSchedule?.deliverAt ?? new Date());
    // Posting from a conversation thread posts into that conversation (#866).
    // Where it goes is named explicitly, never left to the server, so a
    // workday that closed while this was typed is refused and explained
    // rather than the post moving silently (#866 R5). A scheduled post bound
    // for a workday names none: its workday is the one open when it is
    // delivered.
    const destination = postDestination(conversationId, topics);
    const postTopicId =
      destination && !(sendSchedule && destination.kind === 'workday') ? destination.id : null;
    // Warn before sending a post that won't show in the thread being read.
    // Cancelling rejects, so SuperChat puts the draft back.
    const reasons = reasonsPostWontShow(destination, topics, {
      threadBy,
      openThreadId: conversationId,
      openThreadTitle: conversations.find((c) => c.id === conversationId)?.title ?? '',
      searchQuery,
      text,
      viewer: { userId: user?.id ?? '', name: user?.name ?? '' },
      ticketIds: selectedTicketIds,
    });
    if (reasons.length) {
      await confirmSendElsewhere(
        reasons,
        destination ? topicTitle(destination) : DESTINATION_TEXT.newWorkday,
      );
    }
    if (sendingRef.current) throw alreadySending();
    sendingRef.current = true;
    setSending(true);
    setInboxError(null);
    let id: string;
    let clockEventId: string | undefined;
    // The conversation the server put it in (#866).
    let landedTopicId: string | undefined;
    // Snapshot what's staged now: anything picked while this posts belongs to
    // the *next* post, not this one.
    const ticketIds = selectedTicketIds;
    // The conversation open in the live URL, read again when the post lands
    // to tell whether the reader opened another one meanwhile.
    const openConversationParam = () =>
      new URLSearchParams(liveLocation().search).get('conversation');
    const sentFromParam = openConversationParam();
    try {
      if (!postingTeamId) throw new Error('Select a team before posting.');
      if (ticketVideos.loading) {
        throw new Error("The tickets' videos are still loading. Send again in a moment.");
      }
      if (ticketVideos.error) throw new Error(ticketVideos.error);
      const staged = ticketVideos.videos;
      // Every file was uploaded as it was attached (composerProps.uploadAttachment),
      // and the composer waited for the rest before calling this.
      const media = composerAttachments.map(uploadedMedia);
      ({
        id,
        clockEventId,
        conversationId: landedTopicId,
      } = await huddleApi.createPost({
        teamId: postingTeamId,
        content: {
          text,
          // SuperChat only resolves names of people already in the thread, so
          // the roster match is unioned in for everyone else on the team.
          mentions: [...new Set([...sentMentions, ...mentions.detect(text)])].filter(
            (participantId) =>
              participantId !== SYSTEM_PARTICIPANT_ID && !isGroupMentionId(participantId),
          ),
          // @team / @here only mean something in a team's Huddle, not Personal.
          groupMentions: scope === 'team' ? detectGroupMentions(text) : [],
        },
        ticketIds,
        attachments: [...media, ...staged].map(toPostAttachment),
        postDate,
        ...(sendSchedule && { deliverAt: sendSchedule.deliverAt.toISOString() }),
        ...(postTopicId && { conversationId: postTopicId }),
      }));
    } catch (err) {
      console.error('[Huddle] Failed to post:', err);
      setInboxError(composerErrorMessage(err, 'Failed to post. Please try again.'));
      // The workday closed while this was written: reload the topics, so the
      // composer shows the new workday as where the kept draft goes (#866 R5).
      if (err instanceof ApiError && err.code === CONVERSATION_CLOSED_CODE) void refreshTopics();
      throw err;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    // Where the post landed. In Conversation grouping, its conversation: the
    // open workday when it was sent from a closed one (the reader was warned
    // and agreed). Opened only now it's posted, so a failed send restores its
    // draft where it was written.
    const landedThread = landedTopicId ? conversationThreadId(landedTopicId) : null;
    if (threadBy === 'conversation' && landedThread && landedThread !== conversationId) {
      openConversation(landedThread);
    }
    // In Session grouping, the server put it in the live shift, or in no shift
    // when clocked out — then its conversation opens. Opened after the refresh
    // below, once the post (maybe a shift's first) is in.
    const sessionLanding =
      threadBy !== 'session'
        ? null
        : clockEventId
          ? sessionConversationId(clockEventId)
          : landedThread;
    // Clear only what this post actually took: a ticket picked while it was in
    // flight belongs to the next one.
    setSelectedTickets((prev) => prev.filter((t) => !ticketIds.includes(t.id)));

    // Only once the post is in the loaded feed (else it opens on not-found),
    // and not if the reader left Huddle or moved to another team, view,
    // grouping or conversation meanwhile: opening it would undo their choice.
    const openSessionLanding = (postLoaded: boolean) => {
      if (!sessionLanding || sessionLanding === conversationId || !postLoaded) return;
      // The live URL: hidden behind another page, Huddle's own render (and
      // `onScreen`) is paused at the moment it was left.
      const stillHere = liveLocation().pathname === HUDDLE_PATH;
      if (
        !stillHere ||
        threadByRef.current !== threadBy ||
        scopeKeyRef.current !== scopeKey ||
        openConversationParam() !== sentFromParam
      )
        return;
      openConversation(sessionLanding);
    };

    // The Personal view reads its own cross-team list, not the team feed —
    // the post went to the Personal team, so it can never appear in `posts`.
    if (scope === 'me') {
      const mine = await refreshMyPosts();
      openSessionLanding(!!mine?.some((p) => p.id === id));
      return;
    }

    // Show the new post without waiting on the live DDP socket, which may be
    // down (dropped while the app was backgrounded for a Pulse recording):
    // refreshFeed refetches over REST and overlays the result, and syncPosts
    // drops the overlay once the subscription catches up. Retry until the post
    // is in the feed by *either* route.
    const ddp = getDdpClient();
    const inFeed = () =>
      restPostsRef.current.has(id) || ddp.docs('huddlePosts').some((p) => (p.id ?? p._id) === id);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1500));
      await refreshFeed();
      if (inFeed()) break;
    }
    openSessionLanding(inFeed());
  }

  // Taking back a file removed from the message box after it uploaded.
  const discardAttachment = useCallback((result: unknown) => discardMedia(result as MediaItem), []);

  // The composer refused a file: say which and why (composerErrors.ts).
  const handleComposerError = useCallback((message: string, context?: ChatComposerError) => {
    // A failed post: handleMessageSent has already said why ("too large",
    // "no connection"); the box's generic "Failed to send" would cover it.
    if (context?.reason === 'send-failed') return;
    setInboxError(
      composerRefusalMessage(context, {
        limitOf: attachmentLimitLabel,
        maxFiles: COMPOSER_MAX_FILES,
      }) ?? message,
    );
  }, []);

  // Inline edit from the feed (self-authored messages only) → huddle.updatePost
  async function handleMessageEdited(
    messageId: string,
    text: string,
    edits: { removedMedia: string[]; removedFiles: string[] },
  ) {
    const post = activePosts.find((p) => p.id === messageId);
    if (!post) return;
    // The edit starts from the post's text as shown (shownBody: images
    // inlined in it show under it, and stay the post's attachments), without
    // its label, which is the message's `label`, not its text.
    const body = text;
    const attachments = keptAttachments(post, edits);
    // Recompute from the edited text rather than keeping the original
    // mentions: a scheduled post can sit unsent for a while, and swapping who
    // it mentions before delivery must notify the new name, not the old one.
    // Always load the post's own team roster rather than reuse the composer's:
    // that one only covers `postingTeamId`, and it is empty while loading or
    // after a failed fetch, which
    // would save `mentions: []` and deliver a scheduled post silently. A failed
    // fetch here fails the save instead.
    try {
      const editedMentions = detectMentions(body, await fetchTeamMembers(post.teamId)).filter(
        (participantId) => participantId !== SYSTEM_PARTICIPANT_ID,
      );
      await huddleApi.updatePost(
        messageId,
        { text: body, mentions: editedMentions, groupMentions: detectGroupMentions(body) },
        attachments ? { attachments } : undefined,
      );
      // REST refresh too: with the DDP socket down (mobile, backgrounded) the
      // saved edit would otherwise stay invisible until a manual refresh.
      await refreshActiveScope();
    } catch (err) {
      console.error('[Huddle] Failed to save edit:', err);
      setInboxError(composerErrorMessage(err, 'Failed to save the edit. Please try again.'));
    }
  }

  return (
    // Flush: the inbox fills the whole area beside the sidebar, no margins.
    <AppPage fill flush hideTitle>
      {/* Phones only: clip (not hide) sideways overflow so the page can't be
          dragged horizontally; clip creates no scroll container, so vertical
          scrolling is unchanged. */}
      <div ref={huddleRootRef} className="huddle flex h-full min-h-0 gap-0 max-md:overflow-x-clip">
        {/* The filters live in the inbox's list header; until the inbox is on
            screen (loading, error, no team) they sit in a column the size of
            that list, so they don't jump when it appears. Phones open on the
            chat, where the list is hidden, so they show nothing here. */}
        {!listHeaderEl && (
          <aside className="huddle-toolbar hidden w-64 shrink-0 border-e border-border p-3 sm:block">
            {inboxControls}
          </aside>
        )}

        {/* Feed */}
        <div
          ref={feedRef}
          className="huddle-feed flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          onClickCapture={openAppLinkHere}
        >
          {scope === 'team' && unjoinedTeam && (
            <div className="huddle-not-joined flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
              <p className="max-w-md text-sm text-gray-500 dark:text-neutral-400">
                {TEAMS_STRINGS.huddleNotJoined}
              </p>
              <ButtonGroup>
                <Button size="sm" onClick={() => navigate(`/app/teams/${unjoinedTeam.id}`)}>
                  {TEAMS_STRINGS.openTeamToJoin}
                </Button>
              </ButtonGroup>
            </div>
          )}

          {scope === 'team' && !unjoinedTeam && !selectedTeamId && (
            <div className="flex items-center justify-center py-16 px-4">
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Please select a team to view the huddle feed
              </p>
            </div>
          )}

          {(scope === 'me' || selectedTeamId) && (
            <>
              {(feedLoading || resolvingLink) && (
                <div className="huddle-loading flex items-center justify-center py-16">
                  <Spinner size="lg" label="Loading posts" />
                </div>
              )}

              {feedError && (
                <div className="huddle-load-error flex items-center justify-center py-16 px-4">
                  <p role="alert" className="text-sm text-red-500 dark:text-red-400">
                    {feedError}
                  </p>
                </div>
              )}

              {conversationUnavailable && (
                <NoAccessState kind="not-found" resource="conversation" />
              )}

              {!conversationUnavailable && postUnavailable && (
                <NoAccessState kind="not-found" resource="post" />
              )}

              {linkSearchPaused && (
                <Alert variant="info" className="m-3">
                  That link isn’t in the posts loaded so far. Load older posts at the end of the
                  list to keep looking.
                </Alert>
              )}

              <ComposerError message={inboxError} onDismiss={() => setInboxError(null)} />

              {schedulePrompt && (
                <ScheduleDialog
                  title={SCHEDULE_TEXT.dialogTitle}
                  confirmLabel={SCHEDULE_TEXT.confirm}
                  onConfirm={(picked) => {
                    schedulePrompt.resolve(picked);
                    setSchedulePrompt(null);
                  }}
                  onClose={() => {
                    schedulePrompt.reject();
                    setSchedulePrompt(null);
                  }}
                />
              )}

              {/* Warned before sending a post that won't show here (#866). */}
              <AlertDialog
                open={elsewherePrompt !== null}
                onOpenChange={(next) => {
                  if (next || !elsewherePrompt) return;
                  elsewherePrompt.reject();
                  setElsewherePrompt(null);
                }}
                title={SEND_ELSEWHERE_TEXT.title}
                description={SEND_ELSEWHERE_TEXT.description(elsewherePrompt?.destination ?? '')}
                actionLabel={SEND_ELSEWHERE_TEXT.send}
                onAction={() => {
                  elsewherePrompt?.resolve();
                  setElsewherePrompt(null);
                }}
                onCancel={() => {
                  elsewherePrompt?.reject();
                  setElsewherePrompt(null);
                }}
              >
                <ul className="huddle-send-elsewhere-reasons list-disc space-y-1 ps-5 text-sm">
                  {elsewherePrompt?.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </AlertDialog>

              {/* SuperChatInbox, grouped by the selected Thread by option.
                  Its chat input posts to the team; own messages edit inline.
                  Stays mounted through an empty search so the filters in its
                  list header don't vanish mid-typing, and with no posts at all
                  it opens the starter conversation (see `conversations`). */}
              {!feedLoading &&
                !resolvingLink &&
                !feedError &&
                !conversationUnavailable &&
                !postUnavailable &&
                user && (
                  <SuperChatInbox
                    // One box for the thread's cards, ours and SuperChat's.
                    mediaMaxSize={VIDEO_CARD_SIZE}
                    // An edited message's × says what the message box's does.
                    mediaLabels={EDIT_MEDIA_LABELS}
                    // Posting uploads each picked File; a base64 copy of a large
                    // video is more than a browser string, or a phone, can hold.
                    attachmentDataUrls={false}
                    conversations={conversations}
                    activeConversationId={activeConversation?.id}
                    onConversationOpened={(conversation) => openConversation(conversation.id)}
                    currentParticipantId={user.id}
                    virtualized
                    // On a phone, open straight into the conversation (Today) rather than the list.
                    defaultMobileView="chat"
                    // Drag the divider to widen the list; the width survives a reload.
                    resizableSidebar
                    sidebarWidth={sidebarWidth}
                    onSidebarWidthChange={setSidebarWidth}
                    listFooter={
                      // The starter stands in for an empty feed, but an empty window can still have history behind it — or a failed fetch that never said.
                      activePosts.length > 0 ||
                      feedWindow.hasMore === true ||
                      feedWindow.loadFailed ? (
                        <LoadOlderSentinel
                          hasMore={feedWindow.hasMore}
                          loading={feedWindow.loadingOlder}
                          failed={feedWindow.loadFailed}
                          onVisible={feedWindow.loadOlder}
                          onRetry={() => {
                            feedWindow.retry();
                            void refreshActiveScope();
                          }}
                        />
                      ) : undefined
                    }
                    renderPlugins={renderPlugins}
                    renderMessageMedia={renderMessageMedia}
                    mediaFeedProps={mediaFeedProps}
                    acceptedFileTypes={['image', 'video', 'pdf', 'document']}
                    onComposerError={handleComposerError}
                    onMessageSent={(
                      text,
                      { conversation, mentions: sentMentions, attachments, sendOption },
                    ) =>
                      handleMessageSent(
                        text,
                        sentMentions,
                        attachments,
                        conversation.id,
                        sendOption,
                      )
                    }
                    onMessageEdited={(messageId, text, { removedMedia, removedFiles }) =>
                      void handleMessageEdited(messageId, text, { removedMedia, removedFiles })
                    }
                    composerProps={{
                      // Input on its own row, labelled buttons underneath.
                      layout: 'stacked',
                      // Pulse sits in this row; say it's another way to post.
                      placeholder: postingTeamId
                        ? 'Share an update, or post a Pulse…'
                        : 'Share an update…',
                      // 500 MB for a video (PulseVault), 100 MB for anything else.
                      maxFileSize: attachmentSizeLimit,
                      // Each file uploads as it's attached, in place; removing
                      // it before sending takes it back.
                      uploadAttachment: uploadAttachment,
                      discardAttachment: discardAttachment,
                      uploadLabels: UPLOAD_TEXT,
                      // A ticket is a post on its own.
                      canSendWhenEmpty: selectedTicketIds.length > 0,
                      // Also busy while staged content is still settling: a send
                      // rejected then would lose the picked files, which the
                      // composer clears before `onSend` (gap 4.14).
                      isSending: sending || ticketVideos.loading,
                      mentionOptions:
                        scope === 'team'
                          ? [...GROUP_MENTION_OPTIONS, ...mentions.options]
                          : mentions.options,
                      sendOptions: postingTeamId
                        ? [
                            {
                              id: SEND_LATER,
                              label: SCHEDULE_TEXT.sendLater,
                              icon: <FontAwesomeIcon icon={faClock} aria-hidden="true" />,
                            },
                          ]
                        : undefined,
                      leadingSlot: (
                        // ChatComposer's leadingSlot wrapper has no gap of its own, and the
                        // CSS module lets its two children join the composer's row.
                        <>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {/* Where this post goes (#866); opens it. */}
                            <ComposerChipButton
                              onClick={
                                composerDestination
                                  ? () =>
                                      openConversation(conversationThreadId(composerDestination.id))
                                  : undefined
                              }
                              disabled={!composerDestination}
                              aria-label={`${DESTINATION_TEXT.to(composerDestinationName)}. Open it`}
                            >
                              {DESTINATION_TEXT.to(composerDestinationName)}
                            </ComposerChipButton>
                            {postingTeamId && (
                              <TicketPicker
                                teamId={postingTeamId}
                                onSelect={addTicket}
                                selectedIds={selectedTicketIds}
                              />
                            )}
                            <TicketVideoChips videos={ticketVideos.videos} />
                            <ComposerChips
                              selectedTickets={selectedTickets}
                              onTicketRemove={removeTicket}
                              mentions={[]}
                              onMentionRemove={() => {}}
                              attachments={[]}
                              onAttachmentRemove={() => {}}
                            />
                            <ScheduledPostsButton
                              posts={myScheduledPosts}
                              onSendNow={async (post) => {
                                await huddleApi.sendScheduledNow(post.id);
                                await refreshActiveScope();
                              }}
                              onReschedule={async (post, next) => {
                                await huddleApi.reschedulePost(post.id, {
                                  deliverAt: next.deliverAt.toISOString(),
                                  postDate: toDateString(next.deliverAt),
                                });
                                await refreshActiveScope();
                              }}
                              onDelete={async (post) => {
                                await huddleApi.deletePost(post.id);
                                await refreshActiveScope();
                              }}
                            />
                          </div>
                          {/* After the composer's +, behind a "/" (or): a Pulse video posts
                              itself when it lands, so nothing typed here goes with it. Refetch
                              in case the live feed missed it (DDP dropped while in the Pulse
                              app). Keyed by team so one team's link doesn't announce under
                              another. */}
                          {postingTeamId && (
                            <div
                              className={`huddle-composer-pulse flex items-center gap-1.5 ${styles.pulseGroup}`}
                            >
                              <span
                                className={`huddle-composer-or px-1 text-sm text-muted-foreground ${styles.pulseOr}`}
                                aria-hidden="true"
                              >
                                /
                              </span>
                              <PulseButton
                                key={postingTeamId}
                                destination={{ kind: 'huddle', teamId: postingTeamId }}
                                ariaLabel="Post a video with Pulse"
                                onSettled={() => void refreshActiveScope()}
                              />
                            </div>
                          )}
                        </>
                      ),
                    }}
                    // No outer border or rounding: the inbox sits on the page as the page.
                    className={`min-h-0 flex-1 rounded-none border-0 ${styles.inbox}`}
                  />
                )}
              {listHeaderEl && createPortal(inboxControls, listHeaderEl)}
              {/* A team's bell; the Personal view mixes teams, so it has none. */}
              {conversationHeaderEl &&
                scope === 'team' &&
                selectedTeamId &&
                createPortal(
                  <div className="huddle-conversation-actions flex items-center gap-1">
                    {threadBy === 'conversation' && (
                      <StartHuddleButton
                        teamId={selectedTeamId}
                        openWorkday={openWorkday}
                        onStarted={(workday) => void openTopic(workday.id)}
                      />
                    )}
                    {activeTopic && (
                      <ConversationMenu
                        conversation={activeTopic}
                        canRenameForEveryone={
                          activeTopic.kind === 'group' &&
                          (activeTopic.createdBy === user?.id || viewerIsAdmin)
                        }
                        onChanged={() => void refreshTopics()}
                      />
                    )}
                    <HuddleNotifyMenu
                      teamId={selectedTeamId}
                      teamName={teamOptions.find((t) => t.id === selectedTeamId)?.name ?? ''}
                    />
                  </div>,
                  conversationHeaderEl,
                )}
            </>
          )}
        </div>
      </div>
    </AppPage>
  );
}
