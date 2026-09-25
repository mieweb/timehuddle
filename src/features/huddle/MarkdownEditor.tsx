/**
 * MarkdownEditor — shared Kerebron RichEditor wrapper.
 *
 * Adds four things the raw RichEditor lacks:
 *  1. A capturing `mousedown` handler that preventDefaults clicks on the
 *     editor's toolbar/menu controls (but never on the editable content).
 *     ProseMirror otherwise blurs and collapses the selection before a toolbar
 *     command runs, so "Toggle bold" etc. would no-op. preventDefault keeps the
 *     selection alive; the click still fires and applies the mark. The editable
 *     area sits inside the same `.kb-custom-menu__wrapper`, so it's explicitly
 *     excluded — otherwise clicking the text would fail to place the caret and
 *     the editor would appear frozen (no typing).
 *  2. ⌘/Ctrl+↵ submit.
 *  3. File interception on paste *and* drop — see {@link MarkdownEditorProps.onFiles}.
 *  4. A placeholder. RichEditorProps has no `placeholder`, and swapping the old
 *     `<textarea placeholder="What's on your mind?…">` for RichEditor left the
 *     empty composer with no prompt at all. Drawn as a CSS `::before` (see
 *     styles.css) because ProseMirror owns the editable subtree, and mirrored
 *     into the editor's `aria-describedby` so it is announced rather than being
 *     visual-only — pseudo-element text is not in the accessibility tree.
 *  5. An accessible name. RichEditor only marks its surface up as
 *     `role="textbox"` when it is given one, so without `label` the composer is
 *     an anonymous `contenteditable` div to a screen reader.
 *
 * RichEditor is uncontrolled — `value` seeds the document on mount only, so
 * remount via `key` when switching documents. `value` still tracks the live
 * content on re-render (the host updates it from `onChange`), which is what
 * drives the placeholder's visibility.
 *
 * The RichEditor handle is forwarded through, so a host can call `getContent()`
 * on submit. That matters: `onChange` fires from an async serialization of the
 * whole document, so the mirrored `value` can lag the last keystroke. Read the
 * editor, not the mirror, when the text is about to be persisted.
 */
import { RichEditor } from '@mieweb/ui/kerebron';
import type { CollabConfig, RichEditorHandle } from '@mieweb/ui/kerebron';
import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';

interface MarkdownEditorProps {
  value?: string;
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+Enter handler. */
  onSubmit?: () => void;
  className?: string;
  /** When set, enables live collaborative editing (Yjs) for the given room. */
  collab?: CollabConfig;
  /** Prompt shown while the editor is empty, and announced as its description. */
  placeholder?: string;
  /**
   * Accessible name for the editing surface. Without it the surface is an
   * unlabelled `contenteditable` with no role — see the note above.
   */
  'aria-label'?: string;
  /** Focus the editor as soon as it is ready (e.g. a composer just expanded). */
  autoFocus?: boolean;
  /**
   * Called with files pasted **or dropped** into the editor (e.g. a screenshot).
   * When set, the event is intercepted before the editor sees it — see the
   * listener below for why.
   */
  onFiles?: (files: File[]) => void;
}

export const MarkdownEditor = forwardRef<RichEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value = '',
      onChange,
      onSubmit,
      className,
      collab,
      placeholder,
      onFiles,
      'aria-label': ariaLabel,
      autoFocus,
    },
    ref,
  ) {
    const isEmpty = value.trim().length === 0;
    const containerRef = useRef<HTMLDivElement>(null);
    // The handle is forwarded to the host, so focusing needs an instance of our
    // own rather than reaching through whatever the host passed (or didn't).
    const editorRef = useRef<RichEditorHandle>(null);
    // Ties the visible placeholder to the editor's `aria-describedby`. Unique
    // per instance so two composers on one page don't collide.
    const describedById = useId();

    // Kerebron's media plugin inlines whatever lands in the editor: an image
    // becomes a base64 `data:` URL, a video an object URL. Neither reaches the
    // media store, and the image case is the worse one — a 4 MB screenshot turns
    // into ~5.8 MB of markdown, which blows past the API's 1 MB body limit and
    // fails the whole post. So intercept and hand the files to the host, which
    // uploads them like any other attachment.
    //
    // *Every* file is taken, not just the ones Kerebron would have handled: a
    // dropped PDF matched neither our filter nor the plugin's, so it landed on a
    // contenteditable whose dragover we had already cancelled and vanished — no
    // attachment, no error, nothing. The host decides what it can accept and
    // reports what it cannot.
    //
    // Kerebron's plugin accepts an `uploadHandler` that would do all of this,
    // but @mieweb/ui's RichEditor neither forwards it nor exposes the editor view
    // to set it at runtime, so interception is the only seam available.
    //
    // Native capture-phase listeners on this wrapper (rather than React's
    // onPasteCapture/onDropCapture) are what guarantee ordering: they run while
    // the event is still descending, before ProseMirror's own handlers on the
    // contenteditable below can see it.
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !onFiles) return;

      const intercept = (event: ClipboardEvent | DragEvent) => {
        const transfer =
          'clipboardData' in event ? event.clipboardData : (event as DragEvent).dataTransfer;
        const files = Array.from(transfer?.files ?? []);
        if (files.length === 0) return; // plain text, links, …— let the editor handle it
        event.preventDefault();
        event.stopPropagation();
        onFiles(files);
      };

      // A drop only fires if the preceding dragover was cancelled. `files` is not
      // readable during a drag (the browser withholds it until drop), so the
      // decision has to be made from `items` — which does expose `kind`.
      const allowDrop = (event: DragEvent) => {
        const items = Array.from(event.dataTransfer?.items ?? []);
        if (items.some((item) => item.kind === 'file')) event.preventDefault();
      };

      // The toolbar's image button asks before falling back to its own dialog,
      // which would embed the file as a base64 data URL — the same bloat this
      // component intercepts paste and drop to avoid. Answering it puts that
      // button on the host's upload path instead, so it behaves like Photo.
      const pickImage = (event: Event) => {
        event.preventDefault();
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/*';
        picker.multiple = true;
        picker.addEventListener('change', () => {
          const files = Array.from(picker.files ?? []);
          if (files.length > 0) onFiles(files);
        });
        picker.click();
      };

      container.addEventListener('paste', intercept, true);
      container.addEventListener('dragover', allowDrop, true);
      container.addEventListener('drop', intercept, true);
      container.addEventListener('kb:insert-image', pickImage);
      return () => {
        container.removeEventListener('paste', intercept, true);
        container.removeEventListener('dragover', allowDrop, true);
        container.removeEventListener('drop', intercept, true);
        container.removeEventListener('kb:insert-image', pickImage);
      };
    }, [onFiles]);

    // The host gets the same handle we hold, so `getContent()`/`focus()` work
    // for callers while this component can still focus the editor itself.
    useImperativeHandle(ref, () => editorRef.current as RichEditorHandle, []);

    // A composer that just expanded should be ready to type in. `focus()` waits
    // for the editor's own setup, so this is safe on the first render.
    useEffect(() => {
      if (autoFocus) editorRef.current?.focus();
    }, [autoFocus]);

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
        <RichEditor
          ref={editorRef}
          value={value}
          onChange={onChange}
          collab={collab}
          aria-label={ariaLabel}
          aria-describedby={placeholder ? describedById : undefined}
        />
        {/* The visible prompt is a CSS ::before, which no screen reader sees.
            This carries the same words into the accessibility tree. */}
        {placeholder && (
          <span id={describedById} className="sr-only">
            {placeholder}
          </span>
        )}
      </div>
    );
  },
);
