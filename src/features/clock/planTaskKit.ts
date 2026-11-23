/**
 * Today's plan in the editor (M4, #886): a Kerebron kit whose task item —
 * replacing the stock one by name — leaves a slot between its checkbox and its
 * text, where the app draws a ticket's ▶/⏸ and running time (React portals,
 * see TodayPlan). The editor is read-only while clocked in, so a tick isn't an
 * edit of the text: it's handed to the app, which saves it at once.
 *
 * A slot is a `contentEditable=false` element the view ignores mutations and
 * events in, so what React draws there never reaches ProseMirror.
 *
 * A checkbox shows the session plan's state (`checkedOf`), not the text's:
 * Kerebron's markdown reader drops `[x]`, so the text alone would load every
 * item unchecked.
 */
import type { EditorKit } from '@kerebron/editor';
import { NodeTaskItem } from '@kerebron/extension-basic-editor/NodeTaskItem';
import type { Node as PmNode } from 'prosemirror-model';

/** What a checklist line is: a ticket of the plan, or a line of text. */
export type PlanTaskIdentity = { ticketId: string } | { text: string };

export interface PlanTaskSlot {
  element: HTMLElement;
  /** The ticket the item holds, if it holds one. */
  ticketId: string | null;
}

export interface PlanTaskRegistry {
  /** The slots of the items on screen, in no particular order. */
  slots: () => PlanTaskSlot[];
  /** Calls `listener` whenever a slot comes, goes or changes ticket. */
  subscribe: (listener: () => void) => () => void;
  /** Set by the host: save a tick. Rejecting puts the checkbox back. */
  onToggle: (identity: PlanTaskIdentity, checked: boolean) => Promise<void>;
  /** Set by the host: whether an item is checked off; undefined keeps the text's. */
  checkedOf: (identity: PlanTaskIdentity) => boolean | undefined;
  /** Call when `checkedOf`'s answers change, so every checkbox shows them. */
  refreshChecks: () => void;
}

const TICKET_PATH = /^\/app\/tickets\/(?!redmine\/)([^/?#\s]+)$/;

function ticketIdOfHref(href: unknown): string | null {
  const match = typeof href === 'string' ? TICKET_PATH.exec(href) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** The first ticket a task item holds: a ticket chip, or a link to a ticket. */
function ticketIdIn(node: PmNode): string | null {
  let found: string | null = null;
  node.descendants((child) => {
    if (found) return false;
    if (child.type.name === 'reference' && child.attrs.kind === 'ticket') {
      found = ticketIdOfHref(child.attrs.href) ?? (child.attrs.id as string);
      return false;
    }
    for (const mark of child.marks) {
      const id = mark.type.name === 'link' ? ticketIdOfHref(mark.attrs.href) : null;
      if (id) {
        found = id;
        return false;
      }
    }
    return true;
  });
  return found;
}

/** A task item's identity, as `planChecklist` reads its markdown line. */
function identityOf(node: PmNode): PlanTaskIdentity {
  const ticketId = ticketIdIn(node);
  return ticketId ? { ticketId } : { text: node.textContent.trim() };
}

export function createPlanTaskRegistry(): PlanTaskRegistry {
  const slots = new Set<PlanTaskSlot>();
  const views = new Set<{ syncChecked: () => void }>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const registry: InternalRegistry = {
    slots: () => [...slots],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onToggle: async () => {},
    checkedOf: () => undefined,
    refreshChecks: () => views.forEach((view) => view.syncChecked()),
    add: (slot, view) => {
      slots.add(slot);
      views.add(view);
      notify();
    },
    remove: (slot, view) => {
      slots.delete(slot);
      views.delete(view);
      notify();
    },
    changed: notify,
  };
  return registry;
}

interface InternalRegistry extends PlanTaskRegistry {
  add: (slot: PlanTaskSlot, view: { syncChecked: () => void }) => void;
  remove: (slot: PlanTaskSlot, view: { syncChecked: () => void }) => void;
  changed: () => void;
}

class PlanTaskItemView {
  dom: HTMLLIElement;
  contentDOM: HTMLElement;
  private checkbox: HTMLInputElement;
  private slot: PlanTaskSlot;

  constructor(
    private node: PmNode,
    private registry: InternalRegistry,
  ) {
    this.dom = document.createElement('li');
    const label = document.createElement('label');
    label.contentEditable = 'false';
    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    label.append(this.checkbox);
    const slotElement = document.createElement('span');
    slotElement.className = 'plan-task-slot';
    slotElement.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.dom.append(label, slotElement, this.contentDOM);
    this.slot = { element: slotElement, ticketId: ticketIdIn(node) };
    this.syncChecked();
    registry.add(this.slot, this);

    this.checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    this.checkbox.addEventListener('change', () => {
      const checked = this.checkbox.checked;
      // Shown at once; the plan the server saves comes back as the editor's value.
      this.dom.dataset.checked = String(checked);
      this.registry.onToggle(identityOf(this.node), checked).catch(() => this.syncChecked());
    });
  }

  /** Show the plan's state for this item (the text's, if the plan doesn't say). */
  syncChecked(): void {
    const checked = this.registry.checkedOf(identityOf(this.node)) ?? !!this.node.attrs.checked;
    this.checkbox.checked = checked;
    this.dom.dataset.checked = String(checked);
  }

  update(node: PmNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncChecked();
    const ticketId = ticketIdIn(node);
    if (ticketId !== this.slot.ticketId) {
      this.slot.ticketId = ticketId;
      this.registry.changed();
    }
    return true;
  }

  /** What React draws in the slot (and the checkbox) is not ProseMirror's. */
  ignoreMutation(mutation: { target: Node; type: string }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }

  stopEvent(event: Event): boolean {
    return this.slot.element.contains(event.target as Node);
  }

  destroy(): void {
    this.registry.remove(this.slot, this);
  }
}

class PlanTaskItem extends NodeTaskItem {
  constructor(private registry: InternalRegistry) {
    super({ nested: true });
  }

  override getNodeView() {
    return ((node: PmNode) => new PlanTaskItemView(node, this.registry)) as unknown as ReturnType<
      NodeTaskItem['getNodeView']
    >;
  }
}

/** The kit for a plan editor; give it one registry for the editor's life. */
export function createPlanTaskKit(registry: PlanTaskRegistry): EditorKit {
  const item = new PlanTaskItem(registry as InternalRegistry);
  return { getExtensions: () => [item] };
}
