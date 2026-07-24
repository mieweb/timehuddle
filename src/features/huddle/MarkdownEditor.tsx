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
 *
 * RichEditor is uncontrolled — `value` seeds the document on mount only, so
 * remount via `key` when switching documents.
 */
import { RichEditor } from '@mieweb/ui/kerebron';
import type { CollabConfig } from '@mieweb/ui/kerebron';
import React from 'react';

interface MarkdownEditorProps {
  value?: string;
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+Enter handler. */
  onSubmit?: () => void;
  className?: string;
  /** When set, enables live collaborative editing (Yjs) for the given room. */
  collab?: CollabConfig;
}

export function MarkdownEditor({ value = '', onChange, onSubmit, className, collab }: MarkdownEditorProps) {
  return (
    <div
      className={[
        'markdown-editor rounded-lg border border-gray-200 dark:border-neutral-700',
        '[&_.ProseMirror]:min-h-52 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2.5',
        '[&_.ProseMirror]:text-base [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:outline-none',
        className ?? '',
      ].join(' ')}
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
