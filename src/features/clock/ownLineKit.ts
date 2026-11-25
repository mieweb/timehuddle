/**
 * In the Clock page's plan, a ticket picked with `#` takes a line of its own,
 * as the Ticket button puts it: text before it stays on its line, and typing
 * goes on below it. Inside a checklist its line is a new unchecked item.
 *
 * TimeHuddle's own: `@mieweb/ui`'s RichEditor inserts a pick inline, in the
 * sentence, with a space after it. This kit, passed through `editorKits`,
 * moves a just-picked ticket chip onto its own line in the same undo step.
 */
import { Extension, type EditorKit } from '@kerebron/editor';
import type { Node as PmNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

/** The editor node `@mieweb/ui` holds a picked reference in. */
const REFERENCE_NODE = 'reference';

interface ReplaceLike {
  from: number;
  slice: { content: { childCount: number; child: (index: number) => PmNode } };
}

/** The chip a pick inserted (a chip and a space, in one step), or null. */
function pickedChip(tr: Transaction, kinds: ReadonlySet<string>): number | null {
  if (!tr.docChanged || tr.steps.length !== 1) return null;
  const step = tr.steps[0] as unknown as Partial<ReplaceLike>;
  const content = step.slice?.content;
  if (typeof step.from !== 'number' || !content || content.childCount !== 2) return null;
  const chip = content.child(0);
  const space = content.child(1);
  const isPick =
    chip.type.name === REFERENCE_NODE &&
    kinds.has(String(chip.attrs.kind)) &&
    space.isText &&
    space.text === ' ';
  return isPick ? step.from : null;
}

/**
 * How deep a split at `$pos` goes to start a new line: the paragraph, or the
 * list item holding it, so a line in a list is a new item. A new checklist
 * item starts unchecked.
 */
function lineSplit($pos: ResolvedPos) {
  const holder = $pos.depth >= 2 ? $pos.node($pos.depth - 1) : null;
  if (!holder || !/item/i.test(holder.type.name)) return { depth: 1 };
  const attrs = 'checked' in holder.attrs ? { ...holder.attrs, checked: false } : holder.attrs;
  return { depth: 2, typesAfter: [{ type: holder.type, attrs }, null] };
}

/**
 * The transaction that puts a just-picked chip of these `kinds` on its own
 * line, caret on the line after it; null when `trs` picked none.
 */
export function chipOnOwnLine(
  trs: readonly Transaction[],
  state: EditorState,
  kinds: ReadonlySet<string>,
): Transaction | null {
  const index = trs.findIndex((tr) => pickedChip(tr, kinds) !== null);
  if (index < 0) return null;
  let start = pickedChip(trs[index], kinds)!;
  for (const later of trs.slice(index + 1)) start = later.mapping.map(start);
  const chip = state.doc.nodeAt(start);
  if (chip?.type.name !== REFERENCE_NODE) return null;

  const tr = state.tr;
  let end = start + chip.nodeSize;
  // The space the pick put after the chip: the chip ends its line instead.
  if (state.doc.textBetween(end, end + 1) === ' ') tr.delete(end, end + 1);
  // And the spaces that led up to it end the line before.
  const $start = state.doc.resolve(start);
  const before = $start.parent.textBetween(0, $start.parentOffset, undefined, '\ufffc');
  const spaces = before.length - before.trimEnd().length;
  if (spaces) {
    tr.delete(start - spaces, start);
    start -= spaces;
    end -= spaces;
  }
  if (tr.doc.resolve(start).parentOffset > 0) {
    const { depth, typesAfter } = lineSplit(tr.doc.resolve(start));
    tr.split(start, depth, typesAfter);
    start += 2 * depth;
    end += 2 * depth;
  }
  const { depth, typesAfter } = lineSplit(tr.doc.resolve(end));
  tr.split(end, depth, typesAfter);
  return tr.setSelection(TextSelection.create(tr.doc, end + 2 * depth)).scrollIntoView();
}

class OwnLineExtension extends Extension {
  override name = 'th-own-line-picks';
  constructor(private readonly kinds: ReadonlySet<string>) {
    super({});
  }
  override getProseMirrorPlugins(): Plugin[] {
    const kinds = this.kinds;
    return [
      new Plugin({ appendTransaction: (trs, _old, state) => chipOnOwnLine(trs, state, kinds) }),
    ];
  }
}

/** Picks of these reference kinds (e.g. `'ticket'`) go on a line of their own. */
export function createOwnLineKit(kinds: readonly string[]): EditorKit {
  const extension = new OwnLineExtension(new Set(kinds));
  return { getExtensions: () => [extension] };
}
