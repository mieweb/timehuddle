import { useEffect, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import mermaid from 'mermaid';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

// ─── Mermaid global init ──────────────────────────────────────────────────────
let mermaidInitialized = false;
function ensureMermaidInit() {
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    mermaidInitialized = true;
  }
}

// ─── MermaidBlock ─────────────────────────────────────────────────────────────
// memo() means this component only re-renders if `code` actually changes —
// parent re-renders won't touch it, eliminating the flicker completely.
const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const ref      = useRef<HTMLDivElement>(null);
  const stableId = useRef('mermaid-' + Math.random().toString(36).slice(2));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ensureMermaidInit();

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!ref.current) return;
      try {
        const { svg } = await mermaid.render(stableId.current, code);
        if (ref.current) ref.current.innerHTML = svg;
      } catch {
        if (ref.current)
          ref.current.innerHTML = `<pre class="text-red-400 text-xs p-2 whitespace-pre-wrap">${code}\n\n⚠ Invalid diagram syntax</pre>`;
      }
    }, 300);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [code]);

  return (
    <div
      ref={ref}
      className="my-3 p-3 bg-neutral-900 border border-neutral-700 rounded-xl overflow-auto max-h-[70vh] min-h-12 [&_svg]:max-w-none [&_svg]:h-auto"
      style={{ WebkitOverflowScrolling: 'touch' }}
    />
  );
});

// ─── MarkdownContent ──────────────────────────────────────────────────────────
// memo() — only re-renders if the markdown string actually changes.
// This is the key fix: parent components (feed, composer) re-render all the
// time but the rendered markdown stays stable.
export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="
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
      "
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { ignoreMissing: true, detect: false, languages: {} }],
          rehypeKatex,
        ]}
        components={{
          code({ className, children, node, ...rest }) {
            const code        = String(children).trim();
            const nodeClasses = (node?.properties?.className as string[]) ?? [];
            const isMermaid   =
              className === 'language-mermaid' ||
              nodeClasses.includes('language-mermaid');
            if (isMermaid) return <MermaidBlock code={code} />;
            return <code className={className} {...rest}>{children}</code>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full text-xs border border-neutral-700 rounded-lg overflow-hidden">
                  {children}
                </table>
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
            const processed = Array.isArray(children)
              ? children.map(renderWithMentions)
              : renderWithMentions(children);
            return <p>{processed}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});