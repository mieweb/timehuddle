import { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Ticket {
  id: number;
  title: string;
  status: 'Open' | 'In progress';
  time: string;
  assignee: string;
}

interface Comment {
  id: string;
  author: string;
  initials: string;
  text: string;
  time: string;
  avatarColor: AvatarColor;
}

interface Post {
  id: string;
  author: string;
  initials: string;
  avatarColor: AvatarColor;
  time: string;
  body: string;
  videoFile?: string;
  videoTicketId?: number;
  ticket?: Ticket;
  likes: number;
  comments: Comment[];
  views: number;
}

type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

// ── Avatar ───────────────────────────────────────────────────────────────────

const avatarClasses: Record<AvatarColor, string> = {
  indigo: 'bg-indigo-100 text-indigo-600',
  teal:   'bg-teal-100 text-teal-600',
  coral:  'bg-red-100 text-red-500',
  amber:  'bg-amber-100 text-amber-600',
  pink:   'bg-pink-100 text-pink-500',
  green:  'bg-green-100 text-green-600',
};

function Avatar({
  initials,
  color,
  size = 'md',
}: {
  initials: string;
  color: AvatarColor;
  size?: 'sm' | 'md';
}) {
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-[13px]';
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarClasses[color]}`}>
      {initials}
    </div>
  );
}

// ── Ticket embed ──────────────────────────────────────────────────────────────

function TicketEmbed({ ticket }: { ticket: Ticket }) {
  return (
    <div className="border border-amber-200 rounded-xl overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-100">
        <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
        </div>
        <span className="text-xs font-medium flex-1 text-gray-800">{ticket.title}</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-100 text-blue-600">
          {ticket.status}
        </span>
      </div>
      <div className="flex items-center gap-4 px-3 py-2 bg-white">
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {ticket.time}
        </span>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {ticket.assignee}
        </span>
        <button className="ml-auto text-xs text-indigo-500 flex items-center gap-1 hover:text-indigo-700 transition-colors">
          Open
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Video thumbnail ───────────────────────────────────────────────────────────

function VideoThumb({ filename, ticketId }: { filename: string; ticketId?: number }) {
  return (
    <div className="relative bg-gray-100 rounded-xl h-48 flex items-center justify-center mb-3 overflow-hidden cursor-pointer group border border-gray-200">
      <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center bg-black/5 group-hover:bg-black/10 transition-colors">
        <div className="w-12 h-12 rounded-full bg-white shadow-md flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-700 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      <div className="absolute bottom-2.5 left-3 text-[10px] text-gray-100 bg-gray-800/70 px-2 py-1 rounded">
        {filename}
      </div>
      {ticketId && (
        <div className="absolute top-2.5 right-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
          ticket #{ticketId}
        </div>
      )}
    </div>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────

function PostCard({ post }: { post: Post }) {
  const [liked, setLiked]         = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText]   = useState('');
  const [comments, setComments]         = useState<Comment[]>(post.comments);

  function handleLike() {
    setLiked(prev => !prev);
    setLikeCount(prev => liked ? prev - 1 : prev + 1);
  }

  function sendComment() {
    if (!commentText.trim()) return;
    setComments(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        author: 'You',
        initials: 'PD',
        text: commentText.trim(),
        time: 'Just now',
        avatarColor: 'indigo',
      },
    ]);
    setCommentText('');
  }

  return (
    <div className="border-b border-gray-100 px-5 pt-4 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar initials={post.initials} color={post.avatarColor} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-800">{post.author}</div>
          <div className="text-xs text-gray-400">{post.time}</div>
        </div>
        <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Video */}
      {post.videoFile && (
        <VideoThumb filename={post.videoFile} ticketId={post.videoTicketId} />
      )}

      {/* Body text */}
      <p className="text-sm text-gray-700 leading-relaxed mb-3">{post.body}</p>

      {/* Ticket */}
      {post.ticket && <TicketEmbed ticket={post.ticket} />}

      {/* Actions */}
      <div className="flex items-center gap-0.5 py-2 border-t border-gray-100 -mx-1">
        <button
          onClick={handleLike}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors ${
            liked ? 'text-pink-500' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="w-4 h-4" fill={liked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          {likeCount}
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        <button
          onClick={() => setShowComments(v => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2.5 py-2 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {comments.length}
        </button>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2.5 py-2 rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        </button>

        <div className="ml-auto flex items-center gap-1 text-xs text-gray-300">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {post.views}
        </div>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="pb-3 bg-gray-50 -mx-5 px-5 pt-3 border-t border-gray-100">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2 mb-2.5">
              <Avatar initials={c.initials} color={c.avatarColor} size="sm" />
              <div className="flex-1 bg-white border border-gray-200 rounded-t-none rounded-xl px-3 py-2">
                <div className="text-xs font-semibold text-gray-700 mb-0.5">{c.author}</div>
                <div className="text-xs text-gray-500 leading-relaxed">{c.text}</div>
                <div className="text-[10px] text-gray-300 mt-1">{c.time}</div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3">
            <Avatar initials="PD" color="indigo" size="sm" />
            <input
              className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2 text-xs text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-400 transition-colors"
              placeholder="Reply..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendComment()}
            />
            <button
              onClick={sendComment}
              className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center hover:bg-indigo-600 transition-colors shrink-0"
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compose bar ───────────────────────────────────────────────────────────────

function ComposeBar({ onPost }: { onPost: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText]         = useState('');

  function submit() {
    if (!text.trim()) return;
    onPost(text.trim());
    setText('');
    setExpanded(false);
  }

  if (!expanded) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 bg-white cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <Avatar initials="PD" color="indigo" />
        <div className="flex-1 bg-gray-100 border border-gray-200 rounded-full px-4 py-2.5 text-sm text-gray-400">
          Share an update...
        </div>
        <button className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 py-3 border-b border-gray-100 bg-white">
      <div className="flex gap-3">
        <Avatar initials="PD" color="indigo" />
        <div className="flex-1">
          <textarea
            autoFocus
            className="w-full bg-white border border-indigo-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 outline-none resize-none leading-relaxed min-h-20"
            placeholder="What's on your mind?"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Photo
            </button>
            <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Video
            </button>
            <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
              Ticket
            </button>
            <button
              onClick={() => { setText(''); setExpanded(false); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-1"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="ml-auto text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const INITIAL_POSTS: Post[] = [
  {
    id: '1',
    author: 'Sara Kim',
    initials: 'SK',
    avatarColor: 'teal',
    time: '2 hours ago',
    body: 'Finished the API rate limiting implementation. Sliding window per user, headers on every response, all edge cases covered.',
    videoFile: 'stress-test-demo.mp4',
    videoTicketId: 41,
    ticket: {
      id: 41,
      title: '#41 — API rate limiting',
      status: 'In progress',
      time: '4h 30m',
      assignee: 'Sara K.',
    },
    likes: 14,
    views: 42,
    comments: [
      { id: 'c1', author: 'Jake D.', initials: 'JD', avatarColor: 'indigo', text: 'Sliding window was the right call.', time: '1h ago' },
      { id: 'c2', author: 'Mia R.',  initials: 'MR', avatarColor: 'coral',  text: '@Sara share the load test results?',  time: '45m ago' },
    ],
  },
  {
    id: '2',
    author: 'Tom R.',
    initials: 'TR',
    avatarColor: 'pink',
    time: 'Yesterday · 4:30 PM',
    body: 'Walkthrough of the new timer widget — shows break detection logic in action. Covers all 3 timer states.',
    videoFile: 'timer-widget-walkthrough.mp4',
    likes: 8,
    views: 19,
    comments: [
      { id: 'c3', author: 'Sara K.', initials: 'SK', avatarColor: 'teal', text: 'Break detection is exactly what we needed.', time: '2h ago' },
    ],
  },
  {
    id: '3',
    author: 'Alex L.',
    initials: 'AL',
    avatarColor: 'amber',
    time: '2 days ago',
    body: 'Dashboard wireframes done — going with layout B. Starting component breakdown today.',
    likes: 5,
    views: 11,
    comments: [],
  },
];

// ── Main export ───────────────────────────────────────────────────────────────

export default function Huddle() {
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);

  function addPost(text: string) {
    setPosts(prev => [
      {
        id: Date.now().toString(),
        author: 'Pat Doe',
        initials: 'PD',
        avatarColor: 'indigo',
        time: 'Just now',
        body: text,
        likes: 0,
        views: 1,
        comments: [],
      },
      ...prev,
    ]);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100 shrink-0">
        <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Huddle</h1>
        <div className="flex gap-2">
          <button className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        <ComposeBar onPost={addPost} />
        <div className="h-2 bg-gray-100 border-y border-gray-200" />
        {posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
