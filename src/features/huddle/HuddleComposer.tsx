import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import mermaid from 'mermaid';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import { useTeam } from '@lib/TeamContext';
import { TicketPicker } from './TicketPicker';
import { AttachmentBar } from './AttachmentBar';
import { MentionMenu } from './MentionMenu';
import type { ComposerContent, MediaItem } from './types';

// ─── Mermaid renderer ─────────────────────────────────────────────────────────
function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    const id = 'mermaid-' + Math.random().toString(36).slice(2);
    mermaid
      .render(id, code)
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg; })
      .catch(() => { if (ref.current) ref.current.innerHTML = `<pre class="text-red-400 text-xs p-2">${code}</pre>`; });
  }, [code]);
  return <div ref={ref} className="my-3 p-3 bg-neutral-900 border border-neutral-700 rounded-xl overflow-x-auto" />;
}

// ─── Shared markdown renderer ─────────────────────────────────────────────────
// Exported so HuddlePost in the feed can reuse:
//   import { MarkdownContent } from './HuddleComposer'
//   <MarkdownContent content={post.content.text} />
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="
      prose prose-sm dark:prose-invert max-w-none
      prose-p:text-gray-800 dark:prose-p:text-neutral-200
      prose-headings:text-gray-900 dark:prose-headings:text-neutral-100
      prose-strong:text-gray-900 dark:prose-strong:text-neutral-100
      prose-code:text-indigo-600 dark:prose-code:text-indigo-400
      prose-code:bg-indigo-50 dark:prose-code:bg-indigo-950/40
      prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
      prose-code:font-mono prose-code:text-xs
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-neutral-900 dark:prose-pre:bg-neutral-950
      prose-pre:border prose-pre:border-neutral-700 dark:prose-pre:border-neutral-800
      prose-pre:rounded-xl prose-pre:text-xs prose-pre:p-0
      prose-blockquote:border-indigo-300 dark:prose-blockquote:border-indigo-700
      prose-blockquote:text-gray-500 dark:prose-blockquote:text-neutral-400
      prose-a:text-indigo-500 prose-a:no-underline hover:prose-a:underline
      prose-ul:text-gray-700 dark:prose-ul:text-neutral-300
      prose-ol:text-gray-700 dark:prose-ol:text-neutral-300
      prose-hr:border-gray-200 dark:prose-hr:border-neutral-700
      prose-table:text-xs
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={{
          code({ className, children }) {
            const code = String(children).trim();
            if (className === 'language-mermaid') return <MermaidBlock code={code} />;
            return <code className={className}>{children}</code>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full text-xs border border-neutral-700 rounded-lg overflow-hidden">{children}</table>
              </div>
            );
          },
          thead({ children }) { return <thead className="bg-neutral-800">{children}</thead>; },
          th({ children }) {
            return <th className="px-3 py-2 text-neutral-300 font-medium text-left border-b border-neutral-700">{children}</th>;
          },
          td({ children }) {
            return <td className="px-3 py-2 text-neutral-300 border-b border-neutral-800">{children}</td>;
          },
          tr({ children }) {
            return <tr className="hover:bg-neutral-800/50 transition-colors">{children}</tr>;
          },
          p({ children }) {
            const renderWithMentions = (child: React.ReactNode): React.ReactNode => {
              if (typeof child === 'string') {
                const parts = child.split(/(@\w+)/g);
                if (parts.length === 1) return child;
                return parts.map((part, i) =>
                  part.startsWith('@') ? (
                    <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 text-xs font-medium">
                      {part}
                    </span>
                  ) : part
                );
              }
              return child;
            };
            const processed = Array.isArray(children) ? children.map(renderWithMentions) : renderWithMentions(children);
            return <p>{processed}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ─── Table picker popover ─────────────────────────────────────────────────────
const TABLE_ROWS = 6;
const TABLE_COLS = 6;

function TablePicker({ onSelect, onClose }: { onSelect: (rows: number, cols: number) => void; onClose: () => void }) {
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 top-full left-0 mt-1 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg p-3"
    >
      <p className="text-xs text-gray-400 dark:text-neutral-500 mb-2 select-none">
        {hovered ? `${hovered.row} × ${hovered.col} table` : 'Hover to select size'}
      </p>
      <div className="flex flex-col gap-1">
        {Array.from({ length: TABLE_ROWS }, (_, r) => (
          <div key={r} className="flex gap-1">
            {Array.from({ length: TABLE_COLS }, (_, c) => {
              const active = hovered && r < hovered.row && c < hovered.col;
              return (
                <div
                  key={c}
                  className={`w-5 h-5 rounded-sm border cursor-pointer transition-colors ${
                    active
                      ? 'bg-indigo-500 border-indigo-500'
                      : 'bg-gray-100 dark:bg-neutral-700 border-gray-200 dark:border-neutral-600 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
                  }`}
                  onMouseEnter={() => setHovered({ row: r + 1, col: c + 1 })}
                  onClick={() => {
                    onSelect(r + 1, c + 1);
                    onClose();
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Generate markdown table ──────────────────────────────────────────────────
function generateTable(rows: number, cols: number): string {
  const header = '| ' + Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(' | ') + ' |';
  const divider = '| ' + Array.from({ length: cols }, () => '-------').join(' | ') + ' |';
  const row = '| ' + Array.from({ length: cols }, () => 'Cell').join(' | ') + ' |';
  const dataRows = Array.from({ length: rows - 1 }, () => row).join('\n');
  return [header, divider, dataRows].filter(Boolean).join('\n');
}

// ─── Toolbar snippets (non-table) ─────────────────────────────────────────────
const SNIPPETS = {
  bold:      { wrap: ['**', '**'],   placeholder: 'bold text' },
  italic:    { wrap: ['*', '*'],     placeholder: 'italic text' },
  code:      { wrap: ['`', '`'],     placeholder: 'code' },
  quote:     { wrap: ['> ', ''],     placeholder: 'quote' },
  codeblock: { block: '```typescript\n\n```',                              cursor: 14 },
  math:      { block: '$$\n\n$$',                                          cursor: 3  },
  mermaid:   { block: '```mermaid\nflowchart LR\n  A --> B\n```',          cursor: 10 },
  link:      { block: '[link text](url)',                                   cursor: 1  },
} as const;

type SnippetKey = keyof typeof SNIPPETS;

// ─── Types ────────────────────────────────────────────────────────────────────
interface HuddleComposerProps {
  onPost: (content: ComposerContent) => void;
  userInitials?: string;
  userColor?: 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';
}

// ─── HuddleComposer ───────────────────────────────────────────────────────────
export function HuddleComposer({
  onPost,
  userInitials = 'PD',
  userColor = 'indigo',
}: HuddleComposerProps) {
  const [expanded, setExpanded]                 = useState(false);
  const [tab, setTab]                           = useState<'write' | 'preview'>('write');
  const [text, setText]                         = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>();
  const [attachments, setAttachments]           = useState<MediaItem[]>([]);
  const [mentions, setMentions]                 = useState<Array<{ userId: string; name: string }>>([]);
  const [showTablePicker, setShowTablePicker]   = useState(false);
  const textareaRef                             = useRef<HTMLTextAreaElement>(null);
  const { selectedTeamId }                      = useTeam();

  // ── Insert snippet at cursor ──────────────────────────────────────────────
  const insertSnippet = (key: SnippetKey) => {
    const snippet = SNIPPETS[key];
    const el = textareaRef.current;
    if (!el) return;

    const start    = el.selectionStart;
    const end      = el.selectionEnd;
    const selected = text.slice(start, end);
    let newText    = text;
    let newCursor  = start;

    if ('wrap' in snippet) {
      const inner = selected || snippet.placeholder;
      newText   = text.slice(0, start) + snippet.wrap[0] + inner + snippet.wrap[1] + text.slice(end);
      newCursor = start + snippet.wrap[0].length + inner.length + snippet.wrap[1].length;
    } else {
      const prefix = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
      newText   = text.slice(0, start) + prefix + snippet.block + '\n' + text.slice(end);
      newCursor = start + prefix.length + snippet.cursor;
    }

    setText(newText);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  };

  // ── Insert table at cursor ────────────────────────────────────────────────
  const insertTable = (rows: number, cols: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const start  = el.selectionStart;
    const prefix = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
    const table  = generateTable(rows, cols);
    const newText = text.slice(0, start) + prefix + table + '\n' + text.slice(start);
    setText(newText);
    const newCursor = start + prefix.length + table.indexOf('\n') + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    try {
      if (!text.trim() && attachments.length === 0) return;
      onPost({
        text: text.trim() || '(Image post)',
        json: { text: text.trim() || '(Image post)' },
        ticketId: selectedTicketId,
        attachments,
        mentions,
      });
      setText(''); setExpanded(false); setTab('write');
      setSelectedTicketId(undefined); setAttachments([]); setMentions([]);
    } catch (error) {
      console.error('[HuddleComposer] Error in handleSubmit:', error);
      alert('Failed to post. Please try again.');
    }
  };

  const handleCancel = () => {
    setText(''); setExpanded(false); setTab('write');
    setSelectedTicketId(undefined); setAttachments([]); setMentions([]);
  };

  const handleAttachmentAdd    = (media: MediaItem) => setAttachments(prev => [...prev, media]);
  const handleAttachmentRemove = (mediaId: string)  => setAttachments(prev => prev.filter(m => m.id !== mediaId));

  const handleMentionSelect = (userId: string, name: string) => {
    setMentions(prev => [...prev, { userId, name }]);
    const el = textareaRef.current;
    if (el) {
      const pos     = el.selectionStart;
      const newText = text.slice(0, pos) + `@${name} ` + text.slice(pos);
      setText(newText);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + name.length + 2, pos + name.length + 2); });
    } else {
      setText(prev => prev + `@${name} `);
    }
  };

  const avatarColorClasses = {
    indigo: 'bg-indigo-100 text-indigo-600',
    teal:   'bg-teal-100 text-teal-600',
    coral:  'bg-red-100 text-red-500',
    amber:  'bg-amber-100 text-amber-600',
    pink:   'bg-pink-100 text-pink-500',
    green:  'bg-green-100 text-green-600',
  };

  const btnBase = 'h-7 px-1.5 flex items-center justify-center rounded text-xs text-gray-600 dark:text-neutral-400 hover:bg-gray-200 dark:hover:bg-neutral-700 hover:text-gray-900 dark:hover:text-neutral-100 transition-colors';
  const divider = <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />;

  // ─── Collapsed ──────────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-neutral-800 cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}>
          {userInitials}
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-full px-4 py-2.5 text-sm text-gray-400 dark:text-neutral-500">
          Share an update...
        </div>
        <button className="w-9 h-9 rounded-full bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-400 dark:text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    );
  }

  // ─── Expanded ───────────────────────────────────────────────────────────────
  return (
    <div className="px-5 py-3 border-b border-gray-100 dark:border-neutral-700 bg-white dark:bg-neutral-800">
      <div className="flex gap-3">

        {/* Avatar */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}>
          {userInitials}
        </div>

        <div className="flex-1 min-w-0">

          {/* ── Tabs ── */}
          <div className="flex gap-1 border-b border-gray-100 dark:border-neutral-700">
            {(['write', 'preview'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs px-3 pb-2 pt-1 font-medium transition-colors border-b-2 -mb-px capitalize ${
                  tab === t
                    ? 'text-indigo-500 border-indigo-500'
                    : 'text-gray-400 dark:text-neutral-500 border-transparent hover:text-gray-600 dark:hover:text-neutral-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ── Toolbar (write only) ── */}
          {tab === 'write' && (
            <div className="flex items-center gap-0.5 px-1 py-1.5 bg-gray-50 dark:bg-neutral-900 border border-b-0 border-gray-200 dark:border-neutral-700 rounded-t-lg mt-2 flex-wrap">

              {/* Text */}
              <button onClick={() => insertSnippet('bold')}   title="Bold"   className={`${btnBase} font-bold w-7`}>B</button>
              <button onClick={() => insertSnippet('italic')} title="Italic" className={`${btnBase} italic font-serif w-7`}>I</button>
              <button onClick={() => insertSnippet('quote')}  title="Blockquote" className={`${btnBase} w-7`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>

              {divider}

              {/* Code */}
              <button onClick={() => insertSnippet('code')}      title="Inline code" className={`${btnBase} font-mono w-7`}>`</button>
              <button onClick={() => insertSnippet('codeblock')} title="Code block"  className={btnBase}>&lt;/&gt;</button>

              {divider}

              {/* Math */}
              <button onClick={() => insertSnippet('math')}    title="Math (KaTeX)" className={btnBase}>∑</button>

              {/* Mermaid */}
              <button onClick={() => insertSnippet('mermaid')} title="Mermaid diagram" className={btnBase}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>

              {/* Table — with grid picker popover */}
              <div className="relative">
                <button
                  onClick={() => setShowTablePicker(v => !v)}
                  title="Table"
                  className={`${btnBase} ${showTablePicker ? 'bg-gray-200 dark:bg-neutral-700 text-gray-900 dark:text-neutral-100' : ''}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M6 3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" />
                  </svg>
                </button>
                {showTablePicker && (
                  <TablePicker
                    onSelect={(rows, cols) => insertTable(rows, cols)}
                    onClose={() => setShowTablePicker(false)}
                  />
                )}
              </div>

              {/* Link */}
              <button onClick={() => insertSnippet('link')} title="Link" className={btnBase}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>

            </div>
          )}

          {/* ── Textarea ── */}
          {tab === 'write' && (
            <textarea
              ref={textareaRef}
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={"What's on your mind?\n\nTip: use the toolbar above or type markdown directly."}
              className="w-full bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 border-t-0 rounded-b-lg px-3 py-2.5 text-sm text-gray-800 dark:text-neutral-200 placeholder:text-gray-300 dark:placeholder:text-neutral-600 outline-none resize-none leading-relaxed min-h-28 font-mono"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
              }}
            />
          )}

          {/* ── Preview ── */}
          {tab === 'preview' && (
            <div className="min-h-28 mt-2 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2.5">
              {text.trim()
                ? <MarkdownContent content={text} />
                : <span className="text-gray-300 dark:text-neutral-600 text-sm">Nothing to preview yet...</span>
              }
            </div>
          )}

          {/* ── Ticket chip ── */}
          {selectedTicketId && (
            <div className="mt-2 inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-full px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
              Ticket #{selectedTicketId}
              <button onClick={() => setSelectedTicketId(undefined)} className="hover:text-amber-900 dark:hover:text-amber-200 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* ── Attachments ── */}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map(media => (
                <div key={media.id} className="relative bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-lg p-2 text-xs text-gray-600 dark:text-neutral-300 flex items-center gap-2">
                  {media.filename}
                  <button onClick={() => handleAttachmentRemove(media.id)} className="text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Button bar ── */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <AttachmentBar onAttachmentAdd={handleAttachmentAdd} />
            {selectedTeamId && <TicketPicker teamId={selectedTeamId} onSelect={setSelectedTicketId} selectedId={selectedTicketId} />}
            {selectedTeamId && <MentionMenu teamId={selectedTeamId} onSelect={handleMentionSelect} />}
            <button onClick={handleCancel} className="text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors ml-1">
              Cancel
            </button>
            <span className="text-xs text-gray-300 dark:text-neutral-600 ml-auto mr-2 hidden sm:block">⌘↵ to post</span>
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); handleSubmit(); }}
              disabled={!text.trim() && attachments.length === 0}
              className="text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Post
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}