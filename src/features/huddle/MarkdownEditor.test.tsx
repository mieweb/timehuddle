/**
 * MarkdownEditor — collaborative-editor fallback.
 *
 * RichEditor renders nothing when its collaborative kit fails to load (the Yjs
 * chunk is a dynamic import), which left the huddle edit composer as an empty
 * box with no way to edit the post. The wrapper has to notice that and remount
 * the editor without collaboration.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Stands in for RichEditor: renders a ProseMirror surface only in plain mode. */
const collabLoads = { value: true };

vi.mock('@mieweb/ui/kerebron', () => ({
  RichEditor: ({ value, collab }: { value?: string; collab?: unknown }) =>
    collab && !collabLoads.value ? null : (
      <div className="ProseMirror" data-collab={collab ? 'on' : 'off'}>
        {value}
      </div>
    ),
}));

const { MarkdownEditor } = await import('./MarkdownEditor');

const collab = { room: 'post-1', wsUrl: 'ws://localhost/yjs' };

// Vitest isn't configured with `globals`, so testing-library's automatic
// cleanup never registers — unmount by hand or the next test finds this one's
// editor still in the DOM.
afterEach(() => {
  cleanup();
  collabLoads.value = true;
});

describe('MarkdownEditor', () => {
  it('keeps the collaborative editor when it mounts', async () => {
    render(<MarkdownEditor value="post text" onChange={() => {}} collab={collab} />);

    const editor = await screen.findByText('post text');
    expect(editor.dataset.collab).toBe('on');

    // Well past the fallback deadline, a working editor is left alone.
    await new Promise((resolve) => setTimeout(resolve, 4100));
    expect(screen.getByText('post text').dataset.collab).toBe('on');
  }, 10000);

  it('falls back to the single-user editor, seeded with the text, when collab never mounts', async () => {
    collabLoads.value = false;
    const { rerender } = render(
      <MarkdownEditor value="post text" onChange={() => {}} collab={{ ...collab }} />,
    );

    expect(screen.queryByText('post text')).toBeNull();

    // Hosts pass a freshly built config object on every render — the fallback
    // must not restart its deadline each time one arrives.
    const rerenders = setInterval(
      () =>
        rerender(<MarkdownEditor value="post text" onChange={() => {}} collab={{ ...collab }} />),
      200,
    );

    try {
      await waitFor(
        () => {
          const editor = screen.getByText('post text');
          expect(editor.dataset.collab).toBe('off');
        },
        { timeout: 6000 },
      );
    } finally {
      clearInterval(rerenders);
    }
  }, 10000);
});
