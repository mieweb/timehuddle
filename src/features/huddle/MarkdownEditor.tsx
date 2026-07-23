/**
 * MarkdownEditor — shared Kerebron RichEditor wrapper.
 *
 * Adds two things the raw RichEditor lacks:
 *  1. A capturing `mousedown` handler that preventDefaults clicks on the
 *     editor's own toolbar/menu (`.kb-custom-menu__wrapper`). ProseMirror
 *     otherwise blurs and collapses the selection before a toolbar command
 *     runs, so "Toggle bold" etc. would no-op. preventDefault keeps the
 *     selection alive; the click still fires and applies the mark.
 *  2. ⌘/Ctrl+↵ submit.
 *
 * RichEditor is uncontrolled — `value` seeds the document on mount only, so
 * remount via `key` when switching documents.
 */
import { RichEditor } from '@mieweb/ui/kerebron';
import React from 'react';

interface MarkdownEditorProps {
  value?: string;
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+Enter handler. */
  onSubmit?: () => void;
  className?: string;
}

export function MarkdownEditor({ value = '', onChange, onSubmit, className }: MarkdownEditorProps) {
  return (
    <div
      className={[
        'markdown-editor rounded-lg border border-gray-200 dark:border-neutral-700',
        '[&_.ProseMirror]:min-h-52 [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2.5',
        '[&_.ProseMirror]:text-base [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:outline-none',
        className ?? '',
      ].join(' ')}
      onMouseDownCapture={(e) => {
        // Preserve the editor selection when clicking the toolbar/menu.
        if ((e.target as HTMLElement).closest('.kb-custom-menu__wrapper')) {
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
      <RichEditor value={value} onChange={onChange} />
    </div>
  );
}
