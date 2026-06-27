import { Meteor } from 'meteor/meteor';
import { rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { ObjectId } from 'mongodb';

const METEOR_BASE_URL = process.env.ROOT_URL?.replace(/\/$/, '') ?? 'http://localhost:3100';

// Safe ObjectId conversion — only converts 24-char hex strings
function toId(id) {
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : id;
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
async function getUserInfo(userId) {
  // Try Meteor users collection first (string ID)
  let user = await rawDb().collection('users').findOne({ _id: String(userId) });
  
  // Fallback to Fastify user collection (ObjectId)
  if (!user) {
    user = await rawDb().collection('user').findOne({ _id: toId(userId) });
  }
  
  const userName = user?.profile?.name ?? user?.name ?? 'Unknown User';
  const words = userName.trim().split(/\s+/);
  const userInitials = words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : userName.substring(0, 2).toUpperCase();
  
  return { userName, userInitials };
}

async function enrichPost(post) {
  const { userName, userInitials } = await getUserInfo(post.userId);
  
  let ticketTitle = undefined;
  if (post.ticketId) {
    const ticket = await rawDb().collection('tickets').findOne({ _id: toId(post.ticketId) });
    ticketTitle = ticket?.title;
  }
  
  const id = post._id?.toHexString ? post._id.toHexString() : String(post._id);
  
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
    createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : String(post.createdAt),
    updatedAt: post.updatedAt instanceof Date ? post.updatedAt.toISOString() : String(post.updatedAt ?? post.createdAt),
  };
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
Meteor.publish('huddlePosts.byTeam', async function (teamId) {
  if (!teamId || typeof teamId !== 'string') {
    throw new Meteor.Error('bad-request', 'teamId is required');
  }
  if (!this.userId) {
    throw new Meteor.Error('not-authorized', 'Authentication required');
  }
  
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
  
  // Initial fetch and send
  let posts = await collection.find({ teamId }).sort({ createdAt: -1 }).toArray();
  // Also fetch posts where teamId was stored as ObjectId (legacy)
  if (/^[a-f0-9]{24}$/i.test(teamId)) {
    const legacyPosts = await collection
      .find({ teamId: new ObjectId(teamId) })
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
  
  for (const post of posts) {
    const enriched = await enrichPost(post);
    this.added('huddlePosts', enriched.id, enriched);
  }
  
  this.ready();
  
  // Set up change stream for real-time updates
  const changeStream = collection.watch([], { fullDocument: 'updateLookup' });
  
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
        const enriched = await enrichPost(change.fullDocument);
        if (change.operationType === 'insert') {
          self.added('huddlePosts', enriched.id, enriched);
        } else {
          self.changed('huddlePosts', enriched.id, enriched);
        }
      } else if (change.operationType === 'delete') {
        const deletedId = change.documentKey._id.toHexString();
        self.removed('huddlePosts', deletedId);
      }
    } catch (err) {
      console.error('[huddle] change stream error:', err);
    }
  }));
  
  changeStream.on('error', (err) => {
    console.error('[huddle] change stream error:', err);
  });
  
  this.onStop(() => {
    changeStream.close().catch(err => {
      console.error('[huddle] failed to close change stream:', err);
    });
  });
});

// Methods
Meteor.methods({
  async 'huddle.getPosts'({ teamId }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!teamId || typeof teamId !== 'string') {
      throw new Meteor.Error('bad-request', 'teamId is required');
    }
    
    const team = await getTeam(teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
    const posts = await rawDb().collection('huddlePosts')
      .find({ teamId })
      .sort({ createdAt: -1 })
      .toArray();
    
    const enriched = await Promise.all(posts.map(post => enrichPost(post)));
    return { posts: enriched };
  },
  
  async 'huddle.createPost'({ teamId, content, ticketId, attachments }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
    if (!teamId || typeof teamId !== 'string') {
      throw new Meteor.Error('bad-request', 'teamId is required');
    }
    if (!content || typeof content.text !== 'string') {
      throw new Meteor.Error('bad-request', 'content.text is required');
    }
    
    const team = await getTeam(teamId);
    if (!team) {
      throw new Meteor.Error('not-found', 'Team not found');
    }
    
    const isMember = (team.members ?? []).includes(this.userId) || (team.admins ?? []).includes(this.userId);
    if (!isMember) {
      throw new Meteor.Error('forbidden', 'Not a team member');
    }
    
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
        const meteorUser = await rawDb().collection('users').findOne({ _id: String(mentionedUserId) });
        const fastifyUser = meteorUser ? null : await rawDb().collection('user').findOne({ _id: toId(mentionedUserId) });
        if (!meteorUser && !fastifyUser) {
          throw new Meteor.Error('not-found', `User ${mentionedUserId} not found`);
        }
      }
    }
    
    const doc = {
      _id: new ObjectId(),
      teamId,
      userId: this.userId,
      content: {
        text: content.text,
        mentions: content.mentions ?? [],
      },
      ticketId: ticketId ?? undefined,
      attachments: attachments ?? [],
      likes: [],
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await rawDb().collection('huddlePosts').insertOne(doc);
    
    return { id: doc._id.toHexString() };
  },
  
  async 'huddle.updatePost'({ postId, content }) {
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'Authentication required');
    }
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
    
    const canModify = await canModifyPost(this.userId, post, team);
    if (!canModify) {
      throw new Meteor.Error('forbidden', 'Cannot modify this post');
    }
    
    // Validate mentions if provided
    if (content.mentions && Array.isArray(content.mentions)) {
      for (const mentionedUserId of content.mentions) {
        const meteorUser = await rawDb().collection('users').findOne({ _id: String(mentionedUserId) });
        const fastifyUser = meteorUser ? null : await rawDb().collection('user').findOne({ _id: toId(mentionedUserId) });
        if (!meteorUser && !fastifyUser) {
          throw new Meteor.Error('not-found', `User ${mentionedUserId} not found`);
        }
      }
    }
    
    await rawDb().collection('huddlePosts').updateOne(
      { _id: toId(postId) },
      {
        $set: {
          content: {
            text: content.text,
            mentions: content.mentions ?? [],
          },
          updatedAt: new Date(),
        },
      }
    );
    
    return { id: postId };
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
    
    // Delete the post
    await rawDb().collection('huddlePosts').deleteOne({ _id: toId(postId) });
    
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
          url: '/app/huddle',
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
              url: '/app/huddle',
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
      .find({ ticketId })
      .sort({ createdAt: -1 })
      .toArray();
    const enriched = await Promise.all(posts.map(enrichPost));
    return { posts: enriched };
  },
});
