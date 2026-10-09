import { faCheck, faChevronDown, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  Button,
  ButtonGroup,
  Dropdown,
  DropdownItem,
  Input,
  Spinner,
  Text,
} from '@mieweb/ui';
import { SuperChatInbox, type ComposerAttachment } from '@mieweb/ui/components/SuperChat';
import {
  createCodePlugin,
  createImagePlugin,
  createMermaidPlugin,
} from '@mieweb/ui/components/SuperChat/plugins';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { composerAttachmentToFile, toPostAttachment, uploadMedia } from '../features/huddle/api';
import { ComposerChips, TicketVideoChips } from '../features/huddle/ComposerAttachments';
import { ComposerError } from '../features/huddle/ComposerError';
import { composerErrorMessage } from '../features/huddle/composerErrors';
import {
  defaultConversation,
  postsToConversations,
  searchConversations,
  starterConversation,
  stripInboxDecorations,
  SYSTEM_PARTICIPANT_ID,
  type ThreadBy,
  withTodayConversation,
} from '../features/huddle/superChatFeed';
import type { MediaItem } from '../features/huddle/types';
import { PulseButton } from '../features/pulse-upload/PulseButton';
import { TicketPicker } from '../features/huddle/TicketPicker';
import { findListHeader, useInboxSlot } from '../features/huddle/useInboxSlot';
import { LoadOlderSentinel } from '../features/huddle/LoadOlderSentinel';
import { useFeedWindow } from '../features/huddle/useFeedWindow';
import { useTeamMentions } from '../features/huddle/useTeamMentions';
import { useTicketVideos } from '../features/huddle/useTicketVideos';
import { AppPage } from '../ui/AppPage';
import { NoAccessState } from '../ui/NoAccessState';
import { useQueryParams, useRouter, useSearchParam } from '../ui/router';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { huddleApi, resolveMediaUrl, type HuddlePost } from '@lib/api';
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
// Below the backend's 100 MB: the composer hands files over as base64, which a mobile WebView can't hold at that size.
const COMPOSER_MAX_FILE_BYTES = 25 * 1024 * 1024;
const THREAD_BY_OPTIONS: ThreadBy[] = ['day', 'session', 'person', 'ticket'];
const THREAD_BY_LABELS: Record<ThreadBy, string> = {
  session: 'Session',
  day: 'Day',
  person: 'Person',
  ticket: 'Ticket',
};
// Must not contain another option's label: e2e picks menu items by name.
const THREAD_BY_DESCRIPTIONS: Record<ThreadBy, string> = {
  day: "Everyone's updates, one thread per date",
  session: 'Each clock-in to clock-out with its plan and wrap-up; off-the-clock posts kept apart',
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

function loadStoredThreadBy(): ThreadBy {
  try {
    const stored = localStorage.getItem(THREAD_BY_KEY);
    return (THREAD_BY_OPTIONS as string[]).includes(stored ?? '') ? (stored as ThreadBy) : 'day';
  } catch {
    return 'day';
  }
}

/** The grouping a conversation id belongs to — ids are `${threadBy}:${key}`. */
function threadByOf(conversationId: string | null): ThreadBy | null {
  const prefix = conversationId?.split(':')[0] ?? '';
  return (THREAD_BY_OPTIONS as string[]).includes(prefix) ? (prefix as ThreadBy) : null;
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
  const onScreen = pathname === '/app/huddle';

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
  const [storedThreadBy, _setThreadBy] = useState<ThreadBy>(loadStoredThreadBy);
  const threadBy =
    threadByOf(conversationParam) ?? (postParam ? 'session' : null) ?? storedThreadBy;
  const setThreadBy = useCallback(
    (next: ThreadBy) => {
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
  const { selectedTeamId, setSelectedTeamId, teams, allTeams, isAdmin, currentTime, teamsReady } =
    useTeam();

  // Personal is a view, not a team selection: entering it leaves the selected
  // team and org alone, so the team picker stays put. It shows the caller's own
  // posts across every team, fetched separately (no per-team DDP subscription
  // applies across teams). Having the Personal team itself selected (e.g. from
  // the header switcher) lands in the same view.
  //
  // It lives in the URL because a Personal conversation can belong to any team:
  // without `?view=me` a reloaded or shared link would fall back to the team
  // feed, where a cross-team conversation reads as not found.
  const showMe = params.get('view') === 'me';
  // A team change from anywhere (header switcher, org switch) leaves the
  // Personal view. Compared with the previous value so loading a `?view=me`
  // link, which also settles the team, doesn't immediately clear it.
  const personalScopeTeamRef = useRef(selectedTeamId);
  useEffect(() => {
    if (personalScopeTeamRef.current === selectedTeamId) return;
    personalScopeTeamRef.current = selectedTeamId;
    if (showMe) setParams({ view: null });
  }, [selectedTeamId, showMe, setParams]);
  const personalTeamId = allTeams.find((t) => t.isPersonal)?.id ?? null;
  const scope: 'team' | 'me' =
    showMe || (selectedTeamId !== null && selectedTeamId === personalTeamId) ? 'me' : 'team';
  // Where the inbox's chat input posts: the Personal team in the Personal
  // view, the selected team otherwise.
  const postingTeamId = scope === 'me' ? personalTeamId : selectedTeamId;

  // The ticket the chat input's Ticket button adds to the next post, reset
  // per team so one picked for one team can't land in another team's post.
  // (Pulse isn't staged here: the server posts a Pulse video itself — see PulseButton.)
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>(undefined);
  // The picked ticket's own videos come along with it.
  const ticketVideos = useTicketVideos(selectedTicketId);
  // @mentions reach the whole team, not just whoever is in the open thread.
  const mentions = useTeamMentions(postingTeamId);
  // A send is in flight. The ref is what guards re-entry; the state only
  // drives the composer's busy send button.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setSelectedTicketId(undefined);
  }, [postingTeamId]);

  const teamOptions = teams.filter((t) => !t.isPersonal);
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
  const refreshMyPosts = useCallback(async () => {
    try {
      const page = await huddleApi.getMyPosts(meSince);
      // Answered for a window that has since moved on; the newer fetch owns the state.
      if (meSinceRef.current !== meSince) return;
      setMyPosts(page.posts);
      setMyPostsError(null);
      meLoadedRef.current = true;
      settleMe(ME_FEED_KEY, { ok: true, hasMore: page.hasMore });
    } catch (err) {
      console.error('[Huddle] refreshMyPosts failed:', err);
      // Only the first load replaces the feed; a failed older window keeps what
      // is loaded and reports through the list footer's Retry.
      if (!meLoadedRef.current) setMyPostsError('Failed to load your posts.');
      settleMe(ME_FEED_KEY, { ok: false });
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
  // session for the team(s) in scope.
  const liveTeamIds = useMemo(
    () => (scope === 'me' ? allTeams.map((t) => t.id) : selectedTeamId ? [selectedTeamId] : []),
    [scope, allTeams, selectedTeamId],
  );
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
      const page = await huddleApi.getPosts(selectedTeamId, teamSince);
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
  // caller's own posts across every team.
  const activePosts = scope === 'me' ? myPosts : posts;

  // A post link (dashboard Recent Activity, clock-in/out and huddle-comment
  // notifications) opens the conversation containing it once loaded. Its team
  // comes in the link's ?team= (TeamContext switches to it); a search that
  // would hide it is cleared when it resolves. Against the active scope, since
  // Personal fetches its own posts and a Personal post link can name any team.
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

  // Only the Personal ("me") scope labels messages with their team — a
  // single-team feed already has that context from the page itself.
  const getTeamName = useMemo(() => {
    if (scope !== 'me') return undefined;
    const names = new Map(allTeams.map((t) => [t.id, t.name]));
    return (teamId: string) => names.get(teamId);
  }, [scope, allTeams]);

  // ── SuperChatInbox mapping (memoized — posts update via DDP) ──
  // Keyed on the post arrays themselves: syncPosts/refreshMyPosts replace them
  // on every change, including ones that don't bump `updatedAt` (clock-in
  // linking a plan to its session, clock-out closing it). `nowMinute` keeps a
  // live session's worked duration moving without regrouping every second.
  const nowMinute = Math.floor(currentTime / 60_000) * 60_000;
  const allConversations = useMemo(() => {
    const grouped = postsToConversations(activePosts, threadBy, viewer, nowMinute, getTeamName);
    return user
      ? withTodayConversation(
          grouped,
          threadBy,
          { userId: user.id, name: user.name },
          scope,
          nowMinute,
        )
      : grouped;
  }, [activePosts, threadBy, viewer, nowMinute, getTeamName, user, scope]);
  // Search runs over whole conversations (titles, people, clock lines, post
  // fields), after grouping, so a match keeps its thread intact.
  // With no posts at all, the inbox shows a starter conversation instead:
  // SuperChat's chat input only exists inside an open conversation, and it is
  // where the first update gets posted.
  const conversations = useMemo(() => {
    if (activePosts.length === 0 && user) {
      return [starterConversation({ userId: user.id, name: user.name }, scope)];
    }
    return searchConversations(allConversations, activePosts, searchQuery, getTeamName);
  }, [allConversations, activePosts, searchQuery, getTeamName, user, scope]);
  const renderPlugins = useMemo(() => [createCodePlugin(), imagePlugin, createMermaidPlugin()], []);

  // SuperChatInbox has no slot for its list header, so the page's filters are
  // portaled into it.
  const feedRef = useRef<HTMLDivElement>(null);
  const listHeaderEl = useInboxSlot(feedRef, findListHeader);

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
          <DropdownItem
            key={option}
            icon={<SelectedCheck selected={option === threadBy} />}
            onClick={() => {
              setThreadBy(option);
              // DropdownItem doesn't close its menu on its own.
              setThreadByMenuOpen(false);
            }}
          >
            <span className="flex flex-col">
              <span>{THREAD_BY_LABELS[option]}</span>
              <Text as="span" variant="muted" size="xs" className="max-w-56 whitespace-normal">
                {THREAD_BY_DESCRIPTIONS[option]}
              </Text>
            </span>
          </DropdownItem>
        ))}
      </Dropdown>
    </div>
  );

  // Search, then team picker (left) and Group by (right). "Personal" is a view
  // (see `showMe`); picking a team uses the same setSelectedTeamId as the
  // header team switcher.
  const inboxControls = (
    <div className="huddle-inbox-controls flex w-full min-w-0 flex-col gap-3">
      <div className="huddle-search relative">
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
    : defaultConversation(conversations, threadBy, nowMinute);
  const openConversation = (conversationId: string) =>
    setParams({ conversation: conversationId }, 'push');

  // Switching team or view leaves the open conversation behind. Compared with
  // the previous value so a linked conversation survives the first render.
  // Skipped until the teams are in: `scope` can only be trusted once
  // `personalTeamId` is known, and the flip it makes on arrival is the app
  // settling, not the reader moving.
  const scopeKey = `${selectedTeamId}|${scope}`;
  const scopeKeyRef = useRef(scopeKey);
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
    if (!match) return;
    setParams({ conversation: match.id, post: null, postId: null, q: null });
  }, [postParam, targetPostLoaded, threadBy, allConversations, setParams]);

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
  ) {
    // A Pulse video or ticket keeps the send button live with an empty box, so
    // a second click during the upload would post the same thing again. The
    // composer's own `isSending` covers this a render later; the ref covers
    // the click that lands before that render.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setInboxError(null);
    let id: string;
    // Snapshot what's staged now: the uploads below take time, and anything
    // picked meanwhile belongs to the *next* post, not this one.
    const ticketId = selectedTicketId;
    try {
      if (!postingTeamId) throw new Error('Select a team before posting.');
      if (ticketVideos.loading) {
        throw new Error("The ticket's videos are still loading. Send again in a moment.");
      }
      if (ticketVideos.error) throw new Error(ticketVideos.error);
      const staged = ticketVideos.videos;
      // One file at a time: each attachment arrives as a base64 `data:` URL, so
      // decoding and uploading them together would hold every string, blob and
      // File in memory at once — enough to kill a mobile WebView at the size
      // limit the picker accepts.
      const media: MediaItem[] = [];
      for (const attachment of composerAttachments) {
        media.push(await uploadMedia(await composerAttachmentToFile(attachment)));
      }
      ({ id } = await huddleApi.createPost({
        teamId: postingTeamId,
        content: {
          text,
          // SuperChat only resolves names of people already in the thread, so
          // the roster match is unioned in for everyone else on the team.
          mentions: [...new Set([...sentMentions, ...mentions.detect(text)])].filter(
            (participantId) => participantId !== SYSTEM_PARTICIPANT_ID,
          ),
        },
        ticketId,
        attachments: [...media, ...staged].map(toPostAttachment),
        postDate: toDateString(new Date()),
      }));
    } catch (err) {
      console.error('[Huddle] Failed to post:', err);
      setInboxError(composerErrorMessage(err, 'Failed to post. Please try again.'));
      throw err;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    // Clear only what this post actually took: a ticket picked while it was in
    // flight belongs to the next one.
    setSelectedTicketId((prev) => (prev === ticketId ? undefined : prev));

    // The Personal view reads its own cross-team list, not the team feed —
    // the post went to the Personal team, so it can never appear in `posts`.
    if (scope === 'me') {
      await refreshMyPosts();
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
  }

  // Inline edit from the feed (self-authored messages only) → huddle.updatePost
  async function handleMessageEdited(messageId: string, text: string) {
    const post = activePosts.find((p) => p.id === messageId);
    if (!post) return;
    const shown = conversations.flatMap((c) => c.thread).find((m) => m.id === messageId)?.text;
    const body = shown ? stripInboxDecorations(text, shown, post.content.text) : text;
    try {
      await huddleApi.updatePost(messageId, { text: body, mentions: post.content.mentions });
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
          className="huddle-feed min-h-0 min-w-0 flex-1 overflow-y-auto"
          onClickCapture={openAppLinkHere}
        >
          {scope === 'team' && !selectedTeamId && (
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
                    conversations={conversations}
                    activeConversationId={activeConversation?.id}
                    onConversationOpened={(conversation) => openConversation(conversation.id)}
                    currentParticipantId={user.id}
                    virtualized
                    // On a phone, open straight into the conversation (Today) rather than the list.
                    defaultMobileView="chat"
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
                    acceptedFileTypes={['image', 'video', 'pdf']}
                    onMessageSent={(text, { mentions: sentMentions, attachments }) =>
                      handleMessageSent(text, sentMentions, attachments)
                    }
                    onMessageEdited={(messageId, text) => void handleMessageEdited(messageId, text)}
                    composerProps={{
                      // Input on its own row, labelled buttons underneath.
                      layout: 'stacked',
                      // Pulse sits in this row; say it's another way to post.
                      placeholder: postingTeamId
                        ? 'Share an update, or post a Pulse…'
                        : 'Share an update…',
                      maxFileSize: COMPOSER_MAX_FILE_BYTES,
                      // A ticket is a post on its own.
                      canSendWhenEmpty: !!selectedTicketId,
                      // Also busy while staged content is still settling: a send
                      // rejected then would lose the picked files, which the
                      // composer clears before `onSend` (gap 4.14).
                      isSending: sending || ticketVideos.loading,
                      mentionOptions: mentions.options,
                      leadingSlot: (
                        // ChatComposer's leadingSlot wrapper has no gap of its own, and the
                        // CSS module lets its two children join the composer's row.
                        <>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {postingTeamId && (
                              <TicketPicker
                                teamId={postingTeamId}
                                onSelect={setSelectedTicketId}
                                selectedId={selectedTicketId}
                              />
                            )}
                            <TicketVideoChips videos={ticketVideos.videos} />
                            <ComposerChips
                              selectedTicketId={selectedTicketId}
                              onTicketRemove={() => setSelectedTicketId(undefined)}
                              mentions={[]}
                              onMentionRemove={() => {}}
                              attachments={[]}
                              onAttachmentRemove={() => {}}
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
                                className="huddle-composer-or px-1 text-sm text-muted-foreground"
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
                    className={`h-full rounded-none border-0 ${styles.inbox}`}
                  />
                )}
              {listHeaderEl && createPortal(inboxControls, listHeaderEl)}
            </>
          )}
        </div>
      </div>
    </AppPage>
  );
}
