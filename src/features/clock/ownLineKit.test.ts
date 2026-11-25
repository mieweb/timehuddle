import { Schema, type Node as PmNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { chipOnOwnLine } from './ownLineKit';

// The node names the plan editor's documents use: a paragraph, a reference
// chip, and a checklist item that says whether it's checked.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    reference: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { kind: {}, id: {}, label: {} },
    },
    task_list: { group: 'block', content: 'task_item+' },
    task_item: { content: 'paragraph block*', attrs: { checked: { default: false } } },
  },
});
const { paragraph, reference, task_list, task_item } = schema.nodes;
const p = (...parts: (string | PmNode)[]) =>
  paragraph.create(
    null,
    parts.map((part) => (typeof part === 'string' ? schema.text(part) : part)),
  );
const chip = (kind = 'ticket') => reference.create({ kind, id: 't-12', label: 'TH-12' });

/** The doc as lines: a paragraph's text with `[TH-12]` for a chip, `- [ ]` for an item. */
function lines(doc: PmNode): string[] {
  const out: string[] = [];
  doc.descendants((node, _pos, parent) => {
    if (node.type !== paragraph) return true;
    let text = '';
    node.forEach((child) => {
      text += child.isText ? child.text : `[${child.attrs.label}]`;
    });
    out.push(parent?.type === task_item ? `- [${parent.attrs.checked ? 'x' : ' '}] ${text}` : text);
    return false;
  });
  return out;
}

/** Picks a chip where `#lo` ends the doc, as RichEditor does: a chip and a space. */
function pick(doc: PmNode, kind = 'ticket') {
  const end = TextSelection.atEnd(doc).from;
  const state = EditorState.create({ doc });
  const tr = state.tr.replaceWith(end - 3, end, [chip(kind), schema.text(' ')]);
  const next = state.apply(tr);
  const moved = chipOnOwnLine([tr], next, new Set(['ticket']));
  return { next, moved: moved && next.apply(moved) };
}

describe('chipOnOwnLine', () => {
  it('puts a ticket picked mid-line on a line of its own, the caret on the next', () => {
    const { moved } = pick(schema.node('doc', null, [p('Fix #lo')]));
    const typed = moved!.apply(moved!.tr.insertText('Next'));
    expect(lines(typed.doc)).toEqual(['Fix', '[TH-12]', 'Next']);
  });

  it('in a checklist, the ticket and the line after it are new unchecked items', () => {
    const item = task_item.create({ checked: true }, p('Fix #lo'));
    const { moved } = pick(schema.node('doc', null, [task_list.create(null, item)]));
    expect(lines(moved!.doc)).toEqual(['- [x] Fix', '- [ ] [TH-12]', '- [ ] ']);
  });

  it('a pick at the start of a line stays there, with a new line after it', () => {
    const { moved } = pick(schema.node('doc', null, [p('#lo')]));
    expect(lines(moved!.doc)).toEqual(['[TH-12]', '']);
  });

  it('leaves other kinds of picks inline', () => {
    const { next, moved } = pick(schema.node('doc', null, [p('Ask #lo')]), 'person');
    expect(moved).toBeNull();
    expect(lines(next.doc)).toEqual(['Ask [TH-12] ']);
  });
});
