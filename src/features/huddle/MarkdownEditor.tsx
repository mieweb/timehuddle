/**
 * MarkdownEditor — shared Kerebron RichEditor wrapper.
 *
 * Adds two things the raw RichEditor lacks:
 *  1. A capturing `mousedown` handler that preventDefaults clicks on the
 *     editor's toolbar/menu controls (but never on the editable content).
 *     ProseMirror otherwise blurs and collapses the selection before a toolbar
 *     command runs, so "Toggle bold" etc. would no-op. preventDefault keeps the
 *     selection alive; the click still fires and applies the mark. The editable
 *     area sits inside the same `.kb-custom-menu__wrapper`, so it's explicitly
 *     excluded — otherwise clicking the text would fail to place the caret and
 *     the editor would appear frozen (no typing).
 *  2. ⌘/Ctrl+↵ submit.
 *  3. A placeholder. RichEditorProps has no `placeholder`, and swapping the old
 *     `<textarea placeholder="What's on your mind?…">` for RichEditor left the
 *     empty composer with no prompt at all. Rendered as a real (non-interactive)
 *     overlay rather than a CSS `::before`, so it stays readable by assistive
 *     tech and doesn't depend on ProseMirror's internal empty-node markup.
 *
 * RichEditor is uncontrolled — `value` seeds the document on mount only, so
 * remount via `key` when switching documents. `value` still tracks the live
 * content on re-render (the host updates it from `onChange`), which is what
 * drives the placeholder's visibility.
 */
import { RichEditor } from '@mieweb/ui/kerebron';
import type { CollabConfig } from '@mieweb/ui/kerebron';
import React, { useEffect, useRef } from 'react';

interface MarkdownEditorProps {
  value?: string;
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+Enter handler. */
  onSubmit?: () => void;
  className?: string;
  /** When set, enables live collaborative editing (Yjs) for the given room. */
  collab?: CollabConfig;
  /** Prompt shown while the editor is empty. */
  placeholder?: string;
  /**
   * Called with image files pasted into the editor (e.g. a screenshot).
   * When set, the paste is intercepted before the editor sees it — see the
   * listener below for why.
   */
  onImagePaste?: (files: File[]) => void;
}

export function MarkdownEditor({
  value = '',
  onChange,
  onSubmit,
  className,
  collab,
  placeholder,
  onImagePaste,
}: MarkdownEditorProps) {
  const isEmpty = value.trim().length === 0;
  const containerRef = useRef<HTMLDivElement>(null);

  // Kerebron's paste handler embeds a pasted screenshot inline as a base64
  // `data:` URL, so a single screenshot adds hundreds of KB to the post
  // document and never reaches the media store. Intercept it first and hand
  // the file to the host, which uploads it like any other attachment.
  //
  // A native capture-phase listener on this wrapper (rather than React's
  // onPasteCapture) is what guarantees ordering: it runs while the event is
  // still descending, before ProseMirror's own listener on the contenteditable
  // below can see it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onImagePaste) return;

    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return; // plain text, links, …— let the editor handle it
      event.preventDefault();
      event.stopPropagation();
      onImagePaste(files);
    };

    container.addEventListener('paste', handlePaste, true);
    return () => container.removeEventListener('paste', handlePaste, true);
  }, [onImagePaste]);

  return (
    <div
      ref={containerRef}
      className={[
        'markdown-editor rounded-lg border border-gray-200 dark:border-neutral-700',
        className ?? '',
      ].join(' ')}
      // Drives the `.ProseMirror::before` placeholder in styles.css. Floated
      // into the first line rather than absolutely positioned, so it needs no
      // hard-coded offset for the toolbar above it.
      data-empty={placeholder && isEmpty ? 'true' : undefined}
      style={
        placeholder
          ? ({
              '--markdown-editor-placeholder': JSON.stringify(placeholder),
            } as React.CSSProperties)
          : undefined
      }
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        // The editable content area lives inside `.kb-custom-menu__wrapper`
        // alongside the toolbar. Clicking the text must place the caret, so
        // never preventDefault there — otherwise the editor never focuses and
        // you can't type.
        if (target.closest('.kb-custom-menu__editor')) return;
        // For the toolbar/menu controls, preventDefault keeps the editor's
        // selection alive so the command (bold, italic, …) applies.
        if (target.closest('.kb-custom-menu__wrapper, [role="menu"]')) {
          e.preventDefault();
        }
      }}
      onKeyDown={(e) => {
        if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
    >
      <RichEditor value={value} onChange={onChange} collab={collab} />
    </div>
  );
}
