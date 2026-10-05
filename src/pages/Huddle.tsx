import { faCheck, faChevronDown, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  ButtonGroup,
  Card,
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
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { composerAttachmentToFile, toPostAttachment, uploadMedia } from '../features/huddle/api';
import { ComposerChips, TicketVideoChips } from '../features/huddle/ComposerAttachments';
import { ComposerError } from '../features/huddle/ComposerError';
import { composerErrorMessage } from '../features/huddle/composerErrors';
import { PulseAttachButton } from '../features/huddle/PulseAttachButton';
import { clearComposerPulseUpload } from '../features/huddle/pulseComposerUpload';
import {
  postsToConversations,
  searchConversations,
  starterConversation,
  stripInboxDecorations,
  SYSTEM_PARTICIPANT_ID,
  type ThreadBy,
} from '../features/huddle/superChatFeed';
import type { MediaItem } from '../features/huddle/types';
import { TicketPicker } from '../features/huddle/TicketPicker';
import { findListHeader, useInboxSlot } from '../features/huddle/useInboxSlot';
import { useTeamMentions } from '../features/huddle/useTeamMentions';
import { useTicketVideos } from '../features/huddle/useTicketVideos';
import { AppPage } from '../ui/AppPage';
import { NoAccessState } from '../ui/NoAccessState';
import { useQueryParams, useSearchParam } from '../ui/router';
import { useSession } from '@lib/useSession';
import { useTeam } from '@lib/TeamContext';
import { huddleApi, resolveMediaUrl, type HuddlePost } from '@lib/api';
import { getDdpClient, useLiveClockEvents } from '@lib/ddp';
import { useRefresh } from '@lib/RefreshContext';
import { toDateString } from '@lib/timeUtils';
import styles from './Huddle.module.css';

const THREAD_BY_KEY = 'app:huddleThreadBy';
// Team-picker value for the Personal view; team ids are never this string.
const PERSONAL_VIEW = 'personal';
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

export default function Huddle() {
  // View state in the URL (see src/ui/ROUTING.md):
  //   ?conversation=  the open conversation (opening one pushes, so Back closes it)
  //   ?post=          a post to open (alias ?postId=, from notifications); it
  //                   resolves to the ?conversation= that contains it
  //   ?q=             search
  const { params, setParams } = useQueryParams();
  const conversationParam = params.get('conversation');
  const postParam = params.get('post') || params.get('postId');
  const [posts, setPosts] = useState<HuddlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A failed inbox send or inline edit. Separate from `error` above, which is
  // a feed-load failure and takes the feed's place on screen.
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [threadByMenuOpen, setThreadByMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useSearchParam('q');
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

  // What the chat input's own buttons (Pulse video, Ticket) add to the next
  // post. A Pulse video is already on the backend (a video id, not a File), so
  // it rides alongside SuperChat's own attachments and joins the post on send.
  // Scoped by team so a recording or ticket picked for one team can't land in
  // another team's post.
  const pulseScope = `huddle-inbox-${postingTeamId ?? 'none'}`;
  const [pulseVideos, setPulseVideos] = useState<MediaItem[]>([]);
  const [pulsePending, setPulsePending] = useState(false);
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
    setPulseVideos([]);
    setSelectedTicketId(undefined);
  }, [pulseScope]);
  function removePulseVideo(mediaId: string) {
    setPulseVideos((prev) => prev.filter((m) => m.id !== mediaId));
    clearComposerPulseUpload(pulseScope);
  }

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
  const [myPosts, setMyPosts] = useState<HuddlePost[]>([]);
  const [myPostsLoading, setMyPostsLoading] = useState(false);
  const [myPostsError, setMyPostsError] = useState<string | null>(null);
  const refreshMyPosts = useCallback(async () => {
    try {
      setMyPosts(await huddleApi.getMyPosts());
      setMyPostsError(null);
    } catch (err) {
      console.error('[Huddle] refreshMyPosts failed:', err);
      setMyPostsError('Failed to load your posts.');
    }
  }, []);
  useEffect(() => {
    if (scope !== 'me') return;
    setMyPostsLoading(true);
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
  const refreshFeed = useCallback(async () => {
    if (!selectedTeamId) return;
    try {
      const fresh = await huddleApi.getPosts(selectedTeamId);
      // A refetch that outlived a team switch (e.g. the post-send retry loop)
      // must not write the old team's snapshot over the new team's feed.
      if (selectedTeamIdRef.current !== selectedTeamId) return;
      restPostsRef.current = new Map(fresh.map((post) => [post.id, post]));
      syncPosts();
    } catch (err) {
      console.error('[Huddle] refreshFeed failed:', err);
    }
  }, [selectedTeamId, syncPosts]);

  // Wire pull-to-refresh (swipe down) to the REST refetch for whichever scope
  // is active.
  const refreshActiveScope = useCallback(
    () => (scope === 'me' ? refreshMyPosts() : refreshFeed()),
    [scope, refreshMyPosts, refreshFeed],
  );
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

  // Subscribe to live DDP publication for huddle posts
  useEffect(() => {
    if (!selectedTeamId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const ddp = getDdpClient();
    const unsub = ddp.subscribe('huddlePosts.byTeam', [selectedTeamId], () => setLoading(false));

    // Sync immediately in case data is already cached
    syncPosts();

    // REST fallback: populate the feed even if the DDP socket is down (it's
    // dropped while the app is backgrounded for a Pulse recording).
    refreshFeed().finally(() => setLoading(false));

    // Then keep syncing on every change
    const offChange = ddp.onCollectionChange('huddlePosts', syncPosts);

    const loadingFallback = setTimeout(() => setLoading(false), 3000);

    return () => {
      clearTimeout(loadingFallback);
      unsub();
      offChange();
      setPosts([]);
      restPostsRef.current.clear();
    };
  }, [selectedTeamId, syncPosts, refreshFeed]);

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
  const allConversations = useMemo(
    () => postsToConversations(activePosts, threadBy, viewer, nowMinute, getTeamName),
    [activePosts, threadBy, viewer, nowMinute, getTeamName],
  );
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
  const activeConversation = conversationParam ? linkedConversation : conversations[0];
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
  // effect above clears the param a render later.
  const conversationUnavailable =
    !!conversationParam &&
    !linkedConversation &&
    scopeKeyRef.current === scopeKey &&
    !feedLoading &&
    !feedError;

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
  const postUnavailable =
    !!postParam &&
    !targetPostLoaded &&
    scopeKeyRef.current === scopeKey &&
    !feedLoading &&
    !feedError;

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
    const postedPulseIds = new Set(pulseVideos.map((m) => m.id));
    try {
      if (!postingTeamId) throw new Error('Select a team before posting.');
      if (pulsePending) {
        throw new Error('Your Pulse video is still uploading. Send again once it is attached.');
      }
      if (ticketVideos.loading) {
        throw new Error("The ticket's videos are still loading. Send again in a moment.");
      }
      if (ticketVideos.error) throw new Error(ticketVideos.error);
      const staged = [...pulseVideos, ...ticketVideos.videos];
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
    // Clear only what this post actually took: anything staged while it was in
    // flight belongs to the next one.
    setPulseVideos((prev) => prev.filter((m) => !postedPulseIds.has(m.id)));
    setSelectedTicketId((prev) => (prev === ticketId ? undefined : prev));
    clearComposerPulseUpload(pulseScope);

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
      <div className="huddle flex h-full min-h-0 flex-col gap-4 max-md:overflow-x-clip">
        {/* The filters live in the inbox's list header; until the inbox is on
            screen (loading, no posts) they sit here instead. Ghost card: no
            border or fill of its own, it sits on the page. */}
        {!listHeaderEl && (
          <Card variant="ghost" padding="none" className="huddle-header shrink-0">
            <div className="huddle-toolbar p-3">{inboxControls}</div>
          </Card>
        )}

        {/* Feed */}
        <div ref={feedRef} className="huddle-feed min-h-0 flex-1 overflow-y-auto">
          {scope === 'team' && !selectedTeamId && (
            <div className="flex items-center justify-center py-16 px-4">
              <p className="text-sm text-gray-500 dark:text-neutral-400">
                Please select a team to view the huddle feed
              </p>
            </div>
          )}

          {(scope === 'me' || selectedTeamId) && (
            <>
              {feedLoading && (
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

              <ComposerError message={inboxError} onDismiss={() => setInboxError(null)} />

              {/* SuperChatInbox, grouped by the selected Thread by option.
                  Its chat input posts to the team; own messages edit inline.
                  Stays mounted through an empty search so the filters in its
                  list header don't vanish mid-typing, and with no posts at all
                  it opens the starter conversation (see `conversations`). */}
              {!feedLoading &&
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
                    renderPlugins={renderPlugins}
                    acceptedFileTypes={['image', 'video', 'pdf']}
                    onMessageSent={(text, { mentions: sentMentions, attachments }) =>
                      handleMessageSent(text, sentMentions, attachments)
                    }
                    onMessageEdited={(messageId, text) => void handleMessageEdited(messageId, text)}
                    composerProps={{
                      // Input on its own row, labelled buttons underneath.
                      layout: 'stacked',
                      placeholder: 'Share an update…',
                      maxFileSize: COMPOSER_MAX_FILE_BYTES,
                      // A Pulse video or ticket is a post on its own.
                      canSendWhenEmpty: pulseVideos.length > 0 || !!selectedTicketId,
                      // Also busy while staged content is still settling: a send
                      // rejected then would lose the picked files, which the
                      // composer clears before `onSend` (gap 4.14).
                      isSending: sending || pulsePending || ticketVideos.loading,
                      mentionOptions: mentions.options,
                      leadingSlot: (
                        // ChatComposer's leadingSlot wrapper has no gap of its own.
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {/* Keyed by scope: it reads its pending reservation only on mount. */}
                          <PulseAttachButton
                            key={pulseScope}
                            scope={pulseScope}
                            onAttach={(media) =>
                              setPulseVideos((prev) =>
                                prev.some((m) => m.id === media.id) ? prev : [...prev, media],
                              )
                            }
                            onPendingChange={setPulsePending}
                          />
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
                            attachments={pulseVideos}
                            onAttachmentRemove={removePulseVideo}
                          />
                        </div>
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
