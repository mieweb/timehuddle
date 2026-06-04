import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const bodyTextClass = 'text-sm text-neutral-700 dark:text-neutral-300';

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className={`mb-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100`}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className={`mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100`}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className={`mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-100`}>
      {children}
    </h3>
  ),
  p: ({ children }) => <p className={`mb-2 last:mb-0 ${bodyTextClass}`}>{children}</p>,
  ul: ({ children }) => (
    <ul className={`mb-2 list-disc space-y-1 pl-5 last:mb-0 ${bodyTextClass}`}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className={`mb-2 list-decimal space-y-1 pl-5 last:mb-0 ${bodyTextClass}`}>{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-neutral-300 pl-3 italic text-neutral-600 last:mb-0 dark:border-neutral-600 dark:text-neutral-400">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <code
          className={`block overflow-x-auto rounded-md bg-neutral-100 p-3 font-mono text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 ${className ?? ''}`}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto last:mb-0">{children}</pre>,
  hr: () => <hr className="my-3 border-neutral-200 dark:border-neutral-700" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-neutral-200 bg-neutral-50 px-2 py-1 text-left font-semibold dark:border-neutral-700 dark:bg-neutral-800">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-neutral-200 px-2 py-1 dark:border-neutral-700">{children}</td>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-neutral-900 dark:text-neutral-100">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className }) => (
  <div className={className}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  </div>
);
