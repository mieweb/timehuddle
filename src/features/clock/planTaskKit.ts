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
 * item unchecked. A line the plan doesn't hold (one written in the wrap-up)
 * is an ordinary checklist line: its box toggles the document's own state.
 */
import type { EditorKit } from '@kerebron/editor';
import { NodeTaskItem } from '@kerebron/extension-basic-editor/NodeTaskItem';
import type { Node as PmNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/** What a checklist line is: the plan's tickets it holds, or a line of text. */
export type PlanTaskIdentity = { ticketIds: string[] } | { text: string };

export interface PlanTaskSlot {
  /** In front of the line's text: its tickets' ▶/⏸. */
  element: HTMLElement;
  /** Under the line's text: its tickets' time pills. */
  timeElement: HTMLElement;
  /** The tickets the line holds, in order; each gets its timer. */
  ticketIds: string[];
}

export interface PlanTaskRegistry {
  /** The slots of the items on screen, in no particular order. */
  slots: () => PlanTaskSlot[];
  /** Calls `listener` whenever a slot comes, goes or changes ticket. */
  subscribe: (listener: () => void) => () => void;
  /** Set by the host: save a tick of a line the plan holds. Rejecting puts the checkbox back. */
  onToggle: (identity: PlanTaskIdentity, checked: boolean) => Promise<void>;
  /** Set by the host: whether the plan has loaded; until then no box acts. */
  ready: () => boolean;
  /** Set by the host: whether a line is checked off; undefined when the plan doesn't hold it. */
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

/** The tickets a task item holds, in order, each once: ticket chips, or links to tickets. */
function ticketIdsIn(node: PmNode): string[] {
  const found: string[] = [];
  const add = (id: string | null) => {
    if (id && !found.includes(id)) found.push(id);
  };
  node.descendants((child) => {
    if (child.type.name === 'reference' && child.attrs.kind === 'ticket') {
      add(ticketIdOfHref(child.attrs.href) ?? (child.attrs.id as string));
      return false;
    }
    for (const mark of child.marks)
      if (mark.type.name === 'link') add(ticketIdOfHref(mark.attrs.href));
    return true;
  });
  return found;
}

/** A task item's identity, as `planChecklist` reads its markdown line. */
function identityOf(node: PmNode): PlanTaskIdentity {
  const ticketIds = ticketIdsIn(node);
  return ticketIds.length ? { ticketIds } : { text: node.textContent.trim() };
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

let nextContentId = 0;

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
    ready: () => false,
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
    private view: EditorView,
    private getPos: () => number | undefined,
    private registry: InternalRegistry,
  ) {
    this.dom = document.createElement('li');
    this.dom.className = 'plan-task-item';
    const label = document.createElement('label');
    label.contentEditable = 'false';
    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    label.append(this.checkbox);
    const slotElement = document.createElement('span');
    slotElement.className = 'plan-task-slot';
    slotElement.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    // The box is named by its line's text.
    this.contentDOM.id = `plan-task-${++nextContentId}`;
    this.checkbox.setAttribute('aria-labelledby', this.contentDOM.id);
    const timeElement = document.createElement('span');
    timeElement.className = 'plan-task-time';
    timeElement.contentEditable = 'false';
    this.dom.append(label, slotElement, this.contentDOM, timeElement);
    this.slot = { element: slotElement, timeElement, ticketIds: ticketIdsIn(node) };
    this.syncChecked();
    registry.add(this.slot, this);

    this.checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    this.checkbox.addEventListener('change', () => {
      const checked = this.checkbox.checked;
      // Until the plan is read, a box can't tell a plan line from any other.
      if (!this.registry.ready()) {
        this.checkbox.checked = !checked;
        return;
      }
      const identity = identityOf(this.node);
      if (this.registry.checkedOf(identity) === undefined) {
        this.setDocumentChecked(checked);
        return;
      }
      // Shown at once; the plan the server saves comes back as the editor's
      // value. One save at a time, so a quick second click isn't lost.
      this.dom.dataset.checked = String(checked);
      this.checkbox.disabled = true;
      this.registry
        .onToggle(identity, checked)
        .catch(() => this.syncChecked())
        .finally(() => {
          this.checkbox.disabled = false;
        });
    });
  }

  /** A line the plan doesn't hold: its check is the document's, as with the stock item. */
  private setDocumentChecked(checked: boolean): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked }),
    );
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
    const ticketIds = ticketIdsIn(node);
    if (!sameIds(ticketIds, this.slot.ticketIds)) {
      this.slot.ticketIds = ticketIds;
      this.registry.changed();
    }
    return true;
  }

  /** What React draws in the slot (and the checkbox) is not ProseMirror's. */
  ignoreMutation(mutation: { target: Node; type: string }): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node;
    return this.slot.element.contains(target) || this.slot.timeElement.contains(target);
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
    return ((node: PmNode, view: EditorView, getPos: () => number | undefined) =>
      new PlanTaskItemView(node, view, getPos, this.registry)) as unknown as ReturnType<
      NodeTaskItem['getNodeView']
    >;
  }
}

/** The kit for a plan editor; give it one registry for the editor's life. */
export function createPlanTaskKit(registry: PlanTaskRegistry): EditorKit {
  const item = new PlanTaskItem(registry as InternalRegistry);
  return { getExtensions: () => [item] };
}
