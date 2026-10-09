import { Meteor } from 'meteor/meteor';
import { rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { isBeforeWindow, resolveSince } from './huddle-window-core';
import { discardMedia } from './uploads';
import { discardUnreferencedInlineImages, externalizeInlineImages } from './inline-images';
import { ObjectId } from 'mongodb';

/**
 * A session can hold several posts (the plan plus replies sent from the Huddle
 * inbox). Its plan/wrap-up post is the one carrying the wrap-up, else the
 * earliest — never simply the newest, which may be an inbox reply.
 */
export const SESSION_POST_SORT = { wrapUpAt: -1, createdAt: 1 };

const METEOR_BASE_URL = process.env.ROOT_URL?.replace(/\/$/, '') ?? 'http://localhost:3100';

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
}

// postDate is a plain calendar date string (client-local), e.g. "2026-07-22"
export const POST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Drafts (status: 'draft') can no longer be created, but rows saved before
// they were removed still exist — keep them out of every feed. Absent status =
// published (legacy posts included).
const PUBLISHED = { status: { $ne: 'draft' } };

// Every feed read is `teamId`/`userId` + a createdAt window, newest first.
Meteor.startup(async () => {
  try {
    const posts = rawDb().collection('huddlePosts');
    await posts.createIndex({ teamId: 1, createdAt: -1 });
    await posts.createIndex({ userId: 1, createdAt: -1 });
  } catch (error) {
    console.error('[huddle] failed to create feed indexes:', error);
  }
});

/** The window start for a feed read, or a bad-request when `since` isn't a date. */
function requireSince(since) {
  const sinceDate = resolveSince(since);
  if (!sinceDate) throw new Meteor.Error('bad-request', 'since must be an ISO date string');
  return sinceDate;
}

/** Whether `filter` matches any post created before the window — i.e. there is more to load. */
async function hasPostsBefore(filter, sinceDate) {
  const older = await rawDb()
    .collection('huddlePosts')
    .findOne({ ...filter, createdAt: { $lt: sinceDate } }, { projection: { _id: 1 } });
  return older !== null;
}

// Permission helpers
async function getTeam(teamId) {
  // Try plain string first (Meteor-created teams)
  let team = await rawDb().collection('teams').findOne({ _id: teamId });
  if (team) return team;
  // Fall back to ObjectId (legacy Fastify-created teams)
  if (/^[a-f0-9]{24}$/i.test(teamId)) {
    team = await rawDb().collection('teams').findOne({ _id: new ObjectId(teamId) });
  }
  return team ?? null;
}

async function getOrgRole(userId, team) {
  if (!team.orgId) return 'member';
  const membership = await rawDb().collection('orgMembers').findOne({ orgId: team.orgId, userId });
  return membership?.role ?? 'member';
}

async function canModifyPost(userId, post, team) {
  const isAuthor = post.userId === userId;
  const isTeamAdmin = (team.admins ?? []).includes(userId);
  const orgRole = await getOrgRole(userId, team);
  const isOrgOwner = orgRole === 'owner';
  return isAuthor || isTeamAdmin || isOrgOwner;
}

// Enrichment helpers
function toUserInfo(user) {
  const userName = user?.profile?.name ?? 'Unknown User';
  const words = userName.trim().split(/\s+/);
  const userInitials = words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : userName.substring(0, 2).toUpperCase();

  return { userName, userInitials };
}

async function getUserInfo(userId) {
  // Query Meteor users collection
  const user = await rawDb().collection('users').findOne({ _id: String(userId) });
  return toUserInfo(user);
}

async function enrichPost(post) {
  // `authorInfo` / `ticketTitle` are pre-filled by attachEnrichment for list
  // call sites; single-post call sites fall back to their own lookups.
  const { userName, userInitials } = post.authorInfo ?? (await getUserInfo(post.userId));

  let ticketTitle = post.ticketTitle ?? undefined;
  if (post.ticketId && post.ticketTitle === undefined) {
    const ticket = await rawDb().collection('tickets').findOne({ _id: toId(post.ticketId) });
    ticketTitle = ticket?.title;
  }

  const id = post._id?.toHexString ? post._id.toHexString() : String(post._id);

  // Clock-in/out times are read off the linked ClockEvent rather than copied
  // onto the post, so the session stays the single source of truth. Scoped to
  // the post's own author/team — clockEventId is client-supplied on write, so
  // an unscoped `_id`-only lookup would let a spoofed id expose another
  // user's or team's session times through this team's feed. `attachSessions`
  // pre-populates `post.session` for batch call sites; this falls back to a
  // single scoped lookup when it hasn't (single-post call sites).
  const session =
    post.session !== undefined
      ? post.session
      : post.clockEventId
        ? await fetchOwnedSession(post)
        : undefined;
  
  return {
    id,
    teamId: post.teamId,
    userId: post.userId,
    userName,
    userInitials,
    content: post.content ?? { text: '', mentions: [] },
    ticketId: post.ticketId ?? undefined,
    ticketTitle,
    attachments: (post.attachments ?? []).map((att) => ({
      ...att,
      url: att.url && /^https?:\/\//i.test(att.url)
        ? att.url
        : `${METEOR_BASE_URL}${att.url?.startsWith('/') ? '' : '/'}${att.url ?? ''}`,
      thumbnailUrl: att.thumbnailUrl
        ? (/^https?:\/\//i.test(att.thumbnailUrl)
            ? att.thumbnailUrl
            : `${METEOR_BASE_URL}${att.thumbnailUrl.startsWith('/') ? '' : '/'}${att.thumbnailUrl}`)
        : undefined,
    })),
    likes: post.likes ?? [],
    commentCount: post.commentCount ?? 0,
    status: post.status ?? undefined,
    postDate: post.postDate ?? undefined,
    clockEventId: post.clockEventId ?? undefined,
    session,
    wrapUpAt: post.wrapUpAt instanceof Date
      ? post.wrapUpAt.toISOString()
      : (post.wrapUpAt ? String(post.wrapUpAt) : null),
    createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : String(post.createdAt),
    updatedAt: post.updatedAt instanceof Date ? post.updatedAt.toISOString() : String(post.updatedAt ?? post.createdAt),
  };
}

function toSessionShape(event) {
  const rawEnd = event.endTime;
  return {
    startTime: typeof event.startTime === 'number' ? event.startTime : 0,
    endTime: rawEnd instanceof Date ? rawEnd.getTime() : typeof rawEnd === 'number' ? rawEnd : null,
  };
}

/** Single-post session lookup, scoped to the post's own author/team. */
async function fetchOwnedSession(post) {
  const event = await rawDb()
    .collection('clockevents')
    .findOne(
      { _id: toId(post.clockEventId), userId: post.userId, teamId: post.teamId },
      { projection: { startTime: 1, endTime: 1 } },
    );
  return event ? toSessionShape(event) : undefined;
}

/**
 * Batch session lookup for a list of posts — one `$in` query instead of one
 * per post, since `huddlePosts.byTeam` and `huddle.getPosts` enrich an
 * unbounded team feed. Mutates each post with a `session` property that
 * `enrichPost` then just passes through.
 */
async function attachSessions(posts) {
  const withSession = posts.filter((p) => p.clockEventId);
  if (!withSession.length) return posts;
  const ids = withSession.map((p) => toId(p.clockEventId));
  const events = await rawDb()
    .collection('clockevents')
    .find({ _id: { $in: ids } }, { projection: { userId: 1, teamId: 1, startTime: 1, endTime: 1 } })
    .toArray();
  const eventsById = new Map(events.map((e) => [String(e._id), e]));
  for (const post of withSession) {
    const event = eventsById.get(String(toId(post.clockEventId)));
    // Same ownership scoping as the single-post path — a match on _id alone
    // isn't enough to trust a client-supplied clockEventId.
    if (event && event.userId === post.userId && String(event.teamId) === String(post.teamId)) {
      post.session = toSessionShape(event);
    }
  }
  return posts;
}

/**
 * Batch lookups for a list of posts — one `$in` query each for sessions,
 * authors and ticket titles instead of one per post, since
 * `huddlePosts.byTeam`, `huddle.getPosts` and `huddle.getMyPosts` enrich an
 * unbounded feed. Mutates each post with `session`, `authorInfo` and
 * `ticketTitle`, which `enrichPost` then just passes through.
 */
async function attachEnrichment(posts) {
  if (!posts.length) return posts;
  const userIds = [...new Set(posts.map((p) => String(p.userId)))];
  const ticketIds = [...new Set(posts.filter((p) => p.ticketId).map((p) => String(p.ticketId)))];
  const [users, tickets] = await Promise.all([
    rawDb()
      .collection('users')
      .find({ _id: { $in: userIds } }, { projection: { 'profile.name': 1 } })
      .toArray(),
    ticketIds.length
      ? rawDb()
          .collection('tickets')
          .find({ _id: { $in: ticketIds.map(toId) } }, { projection: { title: 1 } })
          .toArray()
      : [],
    attachSessions(posts),
  ]);
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  const titlesById = new Map(tickets.map((t) => [String(t._id), t.title]));
  for (const post of posts) {
    post.authorInfo = toUserInfo(usersById.get(String(post.userId)));
    if (post.ticketId) post.ticketTitle = titlesById.get(String(post.ticketId)) ?? null;
  }
  return posts;
}

async function enrichComment(comment) {
  const { userName, userInitials } = await getUserInfo(comment.userId);
  
  const id = comment._id?.toHexString ? comment._id.toHexString() : String(comment._id);
  
  return {
    id,
    postId: comment.postId,
    userId: comment.userId,
    userName,
    userInitials,
    content: comment.content ?? '',
    mentions: comment.mentions ?? [],
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : String(comment.createdAt),
    updatedAt: comment.updatedAt instanceof Date ? comment.updatedAt.toISOString() : (comment.updatedAt ? String(comment.updatedAt) : null),
  };
}

// Publication with real-time updates
Meteor.publish('huddlePosts.byTeam', async function (teamId, since) {
  // Don't hold the connection's other subscriptions (teams, notifications,
  // tickets) behind this one's initial send — it is the largest on the page.
  this.unblock();
  if (!teamId || typeof teamId !== 'string') {
    throw new Meteor.Error('bad-request', 'teamId is required');
  }
  if (!this.userId) {
    throw new Meteor.Error('not-authorized', 'Authentication required');
  }
  const sinceDate = requireSince(since);
  
  const team = await getTeam(teamId);
  if (!team) {
    throw new Meteor.Error('not-found', 'Team not found');
  }
  
  const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
  if (!isMember) {
    throw new Meteor.Error('forbidden', 'Not a team member');
  }
  
  const db = rawDb();
  const collection = db.collection('huddlePosts');

  // Watch from before the snapshot is read, so a post written while the
  // snapshot is being enriched and sent isn't in neither. The listener attaches
  // after the send; the stream replays everything since this operation time.
  const { operationTime } = await db.command({ ping: 1 });
  const changeStream = collection.watch([], {
    fullDocument: 'updateLookup',
    ...(operationTime ? { startAtOperationTime: operationTime } : {}),
  });
  changeStream.on('error', (err) => {
    console.error('[huddle] change stream error:', err);
  });
  this.onStop(() => {
    changeStream.close().catch(err => {
      console.error('[huddle] failed to close change stream:', err);
    });
  });

  // Initial fetch and send — published posts only (drafts are author-only
  // and never appear in the team feed), from the window onward.
  const inWindow = { createdAt: { $gte: sinceDate } };
  let posts = await collection
    .find({ teamId, ...PUBLISHED, ...inWindow })
    .sort({ createdAt: -1 })
    .toArray();
  // Also fetch posts where teamId was stored as ObjectId (legacy)
  if (/^[a-f0-9]{24}$/i.test(teamId)) {
    const legacyPosts = await collection
      .find({ teamId: new ObjectId(teamId), ...PUBLISHED, ...inWindow })
      .sort({ createdAt: -1 })
      .toArray();
    // Merge, deduplicate by _id hex string
    const seen = new Set(posts.map(p => p._id.toHexString ? p._id.toHexString() : String(p._id)));
    for (const p of legacyPosts) {
      const id = p._id.toHexString ? p._id.toHexString() : String(p._id);
      if (!seen.has(id)) posts.push(p);
    }
    posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  // Track which ids this subscription has sent, so a draft being published
  // (an update) is delivered as `added` rather than a no-op `changed`.
  const sentIds = new Set();
  await attachEnrichment(posts);
  for (const post of posts) {
    const enriched = await enrichPost(post);
    this.added('huddlePosts', enriched.id, enriched);
    sentIds.add(enriched.id);
  }
  
  this.ready();

  const self = this;
  changeStream.on('change', Meteor.bindEnvironment(async (change) => {
    try {
      if (change.operationType === 'insert' || change.operationType === 'update' || change.operationType === 'replace') {
        if (change.fullDocument?.teamId !== teamId) {
          // also check if teamId is stored as ObjectId
          const tdStr = change.fullDocument?.teamId?.toHexString
            ? change.fullDocument.teamId.toHexString()
            : String(change.fullDocument?.teamId ?? '');
          if (tdStr !== teamId) return;
        }
        const docId = change.fullDocument._id.toHexString
          ? change.fullDocument._id.toHexString()
          : String(change.fullDocument._id);
        // Older than the window: not this subscription's to send.
        if (isBeforeWindow(change.fullDocument.createdAt, sinceDate)) return;
        // Drafts never reach the feed.
        if (change.fullDocument.status === 'draft') {
          if (sentIds.has(docId)) {
            sentIds.delete(docId);
            self.removed('huddlePosts', docId);
          }
          return;
        }
        const enriched = await enrichPost(change.fullDocument);
        if (sentIds.has(docId)) {
          self.changed('huddlePosts', enriched.id, enriched);
        } else {
          // Covers both fresh inserts and drafts being published.
          sentIds.add(docId);
          self.added('huddlePosts', enriched.id, enriched);
        }
      } else if (change.operationType === 'delete') {
        const deletedId = change.documentKey._id.toHexString();
        if (sentIds.has(deletedId)) {
          sentIds.delete(deletedId);
          self.removed('huddlePosts', deletedId);
        }
      }
    } catch (err) {
      console.error('[huddle] change stream error:', err);
    }
  }));
});

// Methods
/** The team, if `userId` is on it as a member or an admin; throws otherwise. */
export async function requireTeamMember(userId, teamId) {
  if (!teamId || typeof teamId !== 'string') {
    throw new Meteor.Error('bad-request', 'teamId is required');
  }
  const team = await getTeam(teamId);
  if (!team) {
    throw new Meteor.Error('not-found', 'Team not found');
  }
  const isMember = (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
  if (!isMember) {
    throw new Meteor.Error('forbidden', 'Not a team member');
  }
  return team;
}

/**
 * Create a published Huddle post as `userId`, after the same checks the
 * `huddle.createPost` method makes (team membership, ticket, mentions, clock
 * session ownership). Shared with server-side callers — a Pulse upload that
 * posts itself. Returns `{ id }`.
 */
export async function createHuddlePost(
  userId,
  { teamId, content, ticketId, attachments, postDate, clockEventId, wrapUp },
) {
  if (!content || typeof content.text !== 'string') {
    throw new Meteor.Error('bad-request', 'content.text is required');
  }
  if (postDate !== undefined && (typeof postDate !== 'string' || !POST_DATE_RE.test(postDate))) {
    throw new Meteor.Error('bad-request', 'postDate must be a YYYY-MM-DD string');
  }
  await requireTeamMember(userId, teamId);

  // Validate ticketId if provided
  if (ticketId) {
    const ticket = await rawDb().collection('tickets').findOne({ _id: toId(ticketId) });
    if (!ticket) {
      throw new Meteor.Error('not-found', 'Ticket not found');
    }
    if (ticket.teamId !== teamId) {
      throw new Meteor.Error('bad-request', 'Ticket does not belong to this team');
    }
  }
  
  // Validate mentions if provided
  if (content.mentions && Array.isArray(content.mentions)) {
    for (const mentionedUserId of content.mentions) {
      const user = await rawDb().collection('users').findOne({ _id: String(mentionedUserId) });
      if (!user) {
        throw new Meteor.Error('not-found', `User ${mentionedUserId} not found`);
      }
    }
  }

  // Validate clockEventId if provided — must be the caller's own session in
  // this team, so a spoofed id can't later surface someone else's clock-in/
  // out times through the feed (enrichPost scopes its lookup the same way).
  if (clockEventId) {
    if (typeof clockEventId !== 'string' || !isValidId(clockEventId)) {
      throw new Meteor.Error('bad-request', 'Invalid clockEventId');
    }
    const event = await rawDb()
      .collection('clockevents')
      .findOne(
        { _id: toId(clockEventId), userId, teamId },
        { projection: { _id: 1 } },
      );
    if (!event) {
      throw new Meteor.Error('forbidden', 'Clock event does not belong to you in this team');
    }
  }
  
  const { text, media } = await externalizeInlineImages(content.text, userId);
  const doc = {
    _id: new ObjectId(),
    teamId,
    userId,
    content: {
      text,
      mentions: content.mentions ?? [],
    },
    ticketId: ticketId ?? undefined,
    attachments: attachments ?? [],
    likes: [],
    commentCount: 0,
    ...(postDate ? { postDate } : {}),
    // Optionally link to a clock session (per-session gate) and/or stamp a
    // wrap-up at creation — used by the clock-out recovery path when a
    // session somehow has no plan post.
    ...(clockEventId ? { clockEventId } : {}),
    ...(wrapUp === true ? { wrapUpAt: new Date() } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  try {
    await rawDb().collection('huddlePosts').insertOne(doc);
  } catch (err) {
    await discardMedia(media);
    throw err;
  }
  
  return { id: doc._id.toHexString() };
}

/**
 * Add a wrap-up to `userId`'s post for a clock session: `line` goes under the
 * plan text and `attachment` joins its attachments. A session with no post
 * yet gets one, stamped as the wrap-up. Shared with server-side callers — a
 * Pulse wrap-up video that lands on its own.
 */
export async function appendWrapUp(userId, { teamId, clockEventId, postDate, line, attachment }) {
  await requireTeamMember(userId, teamId);
  const posts = rawDb().collection('huddlePosts');
  // Legacy posts carry the team id as an ObjectId; the feed matches both forms, so this does too.
  const sessionPost = await posts.findOne(
    { teamId: { $in: [teamId, toId(teamId)] }, userId, clockEventId, ...PUBLISHED },
    { sort: SESSION_POST_SORT },
  );
  if (!sessionPost) {
    await createHuddlePost(userId, {
      teamId,
      content: { text: line, mentions: [] },
      attachments: [attachment],
      postDate,
      clockEventId,
      wrapUp: true,
    });
    return;
  }
  // Appended to the post as stored at write time (an update pipeline), so an
  // edit to the plan made meanwhile isn't overwritten. `$literal`: text
  // starting with `$` would otherwise read as a field path.
  const text = { $ifNull: ['$content.text', ''] };
  await posts.updateOne({ _id: sessionPost._id }, [
    {
      $set: {
        'content.text': {
          $cond: [{ $eq: [text, ''] }, { $literal: line }, { $concat: [text, '\n\n', { $literal: line }] }],
        },
        attachments: { $concatArrays: [{ $ifNull: ['$attachments', []] }, [{ $literal: attachment }]] },
        wrapUpAt: '$$NOW',
        updatedAt: '$$NOW',
      },
    },
  ]);
}

Meteor.methods({
  async 'huddle.getPosts'({ teamId, since, withPosts = true }) {
    // requireIdentity, not this.userId: this is the REST feed refresh the
    // composer runs right after creating a post (huddle.createPost is REST for
    // the same reason — the WebView drops DDP while backgrounded). Over the
    // wormhole bridge the caller is a bearer token and `this.userId` is always
    // null, so a this.userId check rejected *every* REST refresh with
    // "Authentication required".
    const identity = await requireIdentity(this);
    if (!teamId || typeof teamId !== 'string') {
      throw new Meteor.Error('bad-request', 'teamId is required');
    }

    const team = await getTeam(teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }

    const isMember = (team.members ?? []).includes(identity.userId) || (team.admins ?? []).includes(identity.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
    const sinceDate = requireSince(since);
    // Legacy posts store teamId as an ObjectId — match both forms.
    const filter = { teamId: { $in: [teamId, toId(teamId)] }, ...PUBLISHED };
    // `withPosts: false` answers only `hasMore` — for a client already receiving
    // the window's posts from the huddlePosts.byTeam subscription.
    if (withPosts === false) {
      return { posts: [], hasMore: await hasPostsBefore(filter, sinceDate) };
    }
    const posts = await rawDb().collection('huddlePosts')
      .find({ ...filter, createdAt: { $gte: sinceDate } })
      .sort({ createdAt: -1 })
      .toArray();
    const hasMore = await hasPostsBefore(filter, sinceDate);
    
    await attachEnrichment(posts);
    const enriched = await Promise.all(
      posts.map(post => enrichPost({ ...post, teamId: String(post.teamId) })),
    );
    return { posts: enriched, hasMore };
  },

  /**
   * The caller's own published posts across every team they belong to — the
   * Huddle inbox's "Me · all teams" scope. Defaults to the last 30 days so an
   * account with years of history doesn't return an unbounded feed.
   */
  async 'huddle.getMyPosts'({ since } = {}) {
    const identity = await requireIdentity(this);
    const sinceDate = requireSince(since);

    const myTeams = await rawDb()
      .collection('teams')
      .find(
        { $or: [{ members: identity.userId }, { admins: identity.userId }] },
        { projection: { _id: 1 } },
      )
      .toArray();
    // Legacy posts store teamId as an ObjectId — match both forms.
    const teamIds = myTeams.flatMap((t) => [String(t._id), toId(String(t._id))]);

    const mine = { userId: identity.userId, teamId: { $in: teamIds }, ...PUBLISHED };
    const posts = await rawDb()
      .collection('huddlePosts')
      .find({ ...mine, createdAt: { $gte: sinceDate } })
      .sort({ createdAt: -1 })
      .toArray();
    const hasMore = await hasPostsBefore(mine, sinceDate);

    await attachEnrichment(posts);
    const enriched = await Promise.all(
      posts.map((post) => enrichPost({ ...post, teamId: String(post.teamId) })),
    );
    return { posts: enriched, hasMore };
  },

  async 'huddle.createPost'({ teamId, content, ticketId, attachments, postDate, clockEventId, wrapUp, draft }) {
    // requireIdentity: reachable via wormhole REST (bearer) and DDP alike.
    // REST matters on mobile — WKWebView tears down the DDP socket whenever the
    // app is backgrounded (e.g. to record a Pulse video), so a DDP-only write
    // silently strands the post until the socket reconnects.
    const identity = await requireIdentity(this);
    // Drafts were removed, but an older client (e.g. an installed mobile build)
    // may still send `draft: true`. Reject it rather than publishing text the
    // author meant to keep private.
    if (draft === true) {
      throw new Meteor.Error('bad-request', 'Drafts are no longer supported; update the app to post');
    }
    return createHuddlePost(identity.userId, { teamId, content, ticketId, attachments, postDate, clockEventId, wrapUp });
  },
  
  async 'huddle.updatePost'({ postId, content, wrapUp, attachments, ticketId }) {
    // requireIdentity: reachable via wormhole REST (bearer) and DDP alike.
    const identity = await requireIdentity(this);
    if (!postId || !isValidId(postId)) {
      throw new Meteor.Error('bad-request', 'Invalid postId');
    }
    if (!content || typeof content.text !== 'string') {
      throw new Meteor.Error('bad-request', 'content.text is required');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const canModify = await canModifyPost(identity.userId, post, team);
    if (!canModify) {
      throw new Meteor.Error('forbidden', 'Cannot modify this post');
    }
    
    // Validate mentions if provided
    if (content.mentions && Array.isArray(content.mentions)) {
      for (const mentionedUserId of content.mentions) {
        const user = await rawDb().collection('users').findOne({ _id: String(mentionedUserId) });
        if (!user) {
          throw new Meteor.Error('not-found', `User ${mentionedUserId} not found`);
        }
      }
    }

    // Validate ticketId when the caller is (re)assigning one. `null` clears it.
    if (ticketId !== undefined && ticketId !== null) {
      const ticket = await rawDb().collection('tickets').findOne({ _id: toId(ticketId) });
      if (!ticket) {
        throw new Meteor.Error('not-found', 'Ticket not found');
      }
      if (ticket.teamId !== post.teamId) {
        throw new Meteor.Error('bad-request', 'Ticket does not belong to this team');
      }
    }

    const { text, media } = await externalizeInlineImages(content.text, identity.userId);
    let replacedPost;
    try {
      replacedPost = await rawDb().collection('huddlePosts').findOneAndUpdate(
        { _id: toId(postId) },
        {
          $set: {
            content: {
              text,
              mentions: content.mentions ?? [],
            },
            // Only touch attachments/ticketId when the editor sends them, so the
            // plan-first clock flow (which omits them) leaves them untouched.
            ...(attachments !== undefined ? { attachments: attachments ?? [] } : {}),
            ...(ticketId !== undefined ? { ticketId: ticketId ?? undefined } : {}),
            ...(wrapUp === true ? { wrapUpAt: new Date() } : {}),
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'before' },
      );
    } catch (err) {
      await discardMedia(media);
      throw err;
    }
    // Deleted since it was read: nothing references the new files.
    if (!replacedPost) {
      await discardMedia(media);
      throw new Meteor.Error('not-found', 'Post not found');
    }
    await discardUnreferencedInlineImages(replacedPost.content?.text);
    
    return { id: postId };
  },

  /** The caller's own post for a given calendar date in a team, or null. */
  async 'huddle.getMyPostForDate'({ teamId, postDate }) {
    // requireIdentity: reachable via wormhole REST (bearer) and DDP alike.
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!teamId || typeof teamId !== 'string') {
      throw new Meteor.Error('bad-request', 'teamId is required');
    }
    if (typeof postDate !== 'string' || !POST_DATE_RE.test(postDate)) {
      throw new Meteor.Error('bad-request', 'postDate must be a YYYY-MM-DD string');
    }

    const team = await getTeam(teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    const isMember = (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }

    const post = await rawDb().collection('huddlePosts').findOne(
      { teamId, userId, postDate, ...PUBLISHED },
      { sort: { createdAt: -1 } }
    );
    return { post: post ? await enrichPost(post) : null };
  },

  /** The caller's post linked to a clock session (by clockEventId), or null. */
  async 'huddle.getMyPostForSession'({ teamId, clockEventId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!teamId || typeof teamId !== 'string') {
      throw new Meteor.Error('bad-request', 'teamId is required');
    }
    if (!clockEventId || typeof clockEventId !== 'string') {
      throw new Meteor.Error('bad-request', 'clockEventId is required');
    }

    const post = await rawDb().collection('huddlePosts').findOne(
      { teamId, userId, clockEventId, status: { $ne: 'draft' } },
      { sort: SESSION_POST_SORT }
    );
    return { post: post ? await enrichPost(post) : null };
  },

  async 'huddle.deletePost'({ postId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!postId || !isValidId(postId)) {
      throw new Meteor.Error('bad-request', 'Invalid postId');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const canModify = await canModifyPost(this.userId, post, team);
    if (!canModify) {
      throw new Meteor.Error('forbidden', 'Cannot delete this post');
    }
    
    // Delete all comments for this post
    await rawDb().collection('huddleComments').deleteMany({ postId });
    
    // Delete and capture the latest version atomically, including any edits
    // that landed after the authorization read above.
    const deletedPost = await rawDb()
      .collection('huddlePosts')
      .findOneAndDelete({ _id: toId(postId) });
    if (deletedPost) {
      await rawDb().collection('inlineImageBackups').deleteOne({ _id: deletedPost._id });
      await discardUnreferencedInlineImages(deletedPost.content?.text);
    }
    
    return 'ok';
  },
  
  async 'huddle.toggleLike'({ postId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!postId || !isValidId(postId)) {
      throw new Meteor.Error('bad-request', 'Invalid postId');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
    const likes = post.likes ?? [];
    const hasLiked = likes.includes(this.userId);
    
    let result;
    if (hasLiked) {
      result = await rawDb().collection('huddlePosts').updateOne(
        { _id: toId(postId) },
        { $pull: { likes: this.userId }, $set: { updatedAt: new Date() } }
      );
    } else {
      result = await rawDb().collection('huddlePosts').updateOne(
        { _id: toId(postId) },
        { $addToSet: { likes: this.userId }, $set: { updatedAt: new Date() } }
      );
    }
    
    // Fetch updated post to get correct like count
    const updated = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    
    return { count: updated.likes?.length ?? 0 };
  },
  
  async 'huddle.addComment'({ postId, content, mentions }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!postId || !isValidId(postId)) {
      throw new Meteor.Error('bad-request', 'Invalid postId');
    }
    
    // Normalize content — accept plain string or { text } object
    const text = typeof content === 'string' ? content : content?.text;
    if (!text || !text.trim()) {
      throw new Meteor.Error('bad-request', 'content is required');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
    const commentDoc = {
      _id: new ObjectId(),
      postId,
      userId: this.userId,
      content: text,
      mentions: mentions ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await rawDb().collection('huddleComments').insertOne(commentDoc);
    
    // Increment comment count on post
    await rawDb().collection('huddlePosts').updateOne(
      { _id: toId(postId) },
      { $inc: { commentCount: 1 }, $set: { updatedAt: new Date() } }
    );
    
    // Send notifications
    const commenterInfo = await getUserInfo(this.userId);
    const commenterName = commenterInfo.userName;
    
    // Notify post author (if not the commenter)
    if (post.userId !== this.userId) {
      await rawDb().collection('notifications').insertOne({
        _id: new ObjectId(),
        userId: post.userId,
        title: `${commenterName} commented on your post`,
        body: text.substring(0, 100),
        read: false,
        data: {
          type: 'huddle-comment',
          postId,
          teamId: post.teamId,
          url: `/app/huddle?postId=${postId}&teamId=${post.teamId}`,
        },
        createdAt: new Date(),
      });
    }
    
    // Notify mentioned users (skip commenter and post author)
    if (mentions && Array.isArray(mentions)) {
      const uniqueMentions = [...new Set(mentions)];
      for (const mentionedUserId of uniqueMentions) {
        if (mentionedUserId !== this.userId && mentionedUserId !== post.userId) {
          await rawDb().collection('notifications').insertOne({
            _id: new ObjectId(),
            userId: mentionedUserId,
            title: `${commenterName} mentioned you in a comment`,
            body: text.substring(0, 100),
            read: false,
            data: {
              type: 'huddle-comment',
              postId,
              teamId: post.teamId,
              url: `/app/huddle?postId=${postId}&teamId=${post.teamId}`,
            },
            createdAt: new Date(),
          });
        }
      }
    }
    
    return { id: commentDoc._id.toHexString() };
  },
  
  async 'huddle.getComments'({ postId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!postId || !isValidId(postId)) {
      throw new Meteor.Error('bad-request', 'Invalid postId');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
    const comments = await rawDb().collection('huddleComments')
      .find({ postId })
      .sort({ createdAt: 1 })
      .toArray();
    
    const enriched = await Promise.all(comments.map(comment => enrichComment(comment)));
    
    return { comments: enriched };
  },
  
  async 'huddle.deleteComment'({ commentId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!commentId || !isValidId(commentId)) {
      throw new Meteor.Error('bad-request', 'Invalid commentId');
    }
    
    const comment = await rawDb().collection('huddleComments').findOne({ _id: toId(commentId) });
    if (!comment) {
      throw new Meteor.Error('not-found', 'Comment not found');
    }
    
    const post = await rawDb().collection('huddlePosts').findOne({ _id: toId(comment.postId) });
    if (!post) {
      throw new Meteor.Error('not-found', 'Post not found');
    }
    
    const team = await getTeam(post.teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    // Check if user can modify (using comment's userId for authorship check)
    const isAuthor = comment.userId === this.userId;
    const isTeamAdmin = (team.admins ?? []).includes(this.userId);
    const orgRole = await getOrgRole(this.userId, team);
    const isOrgOwner = orgRole === 'owner';
    const canModify = isAuthor || isTeamAdmin || isOrgOwner;
    
    if (!canModify) {
      throw new Meteor.Error('forbidden', 'Cannot delete this comment');
    }
    
    // Delete the comment
    await rawDb().collection('huddleComments').deleteOne({ _id: toId(commentId) });
    
    // Decrement comment count on post
    await rawDb().collection('huddlePosts').updateOne(
      { _id: toId(comment.postId) },
      { $inc: { commentCount: -1 }, $set: { updatedAt: new Date() } }
    );
    
    return 'ok';
  },

  async 'huddle.getPostsByTicket'({ ticketId } = {}) {
    const identity = await requireIdentity(this);
    if (!ticketId) throw new Meteor.Error('bad-request', 'ticketId is required');
    const posts = await rawDb()
      .collection('huddlePosts')
      .find({ ticketId, ...PUBLISHED })
      .sort({ createdAt: -1 })
      .toArray();
    const enriched = await Promise.all(posts.map(enrichPost));
    return { posts: enriched };
  },
});
