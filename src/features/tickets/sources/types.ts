/**
 * The contract every ticket source implements.
 *
 * A "source" is anywhere tickets come from — TimeHuddle's own `Ticket`
 * collection, a connected Redmine instance, and (later) whatever else. The
 * unified list, filter bar, and row component only ever see `UnifiedTicket`,
 * so adding a source is one new adapter file plus one entry in `index.ts`.
 *
 * Normalization happens here, at the read layer, and is never persisted: no
 * source information is written to the core `Ticket` model.
 */
import type { RedmineScope, TicketSourceId } from '../../../lib/api';

/**
 * Registered source identifiers. Defined in `lib/api` because the timer
 * endpoints take one, and re-exported here so source code reads from one place.
 */
export type { TicketSourceId };

/**
 * What a source lets the user do from the unified list.
 *
 * Every mutating control in the UI is gated on one of these, so a read-only
 * source cannot render an action it is unable to perform.
 */
export interface SourceCapabilities {
  edit: boolean;
  delete: boolean;
  assign: boolean;
  changeStatus: boolean;
  /**
   * The ticket also has a page in its own system (`externalUrl`), offered as
   * "Open in …" beside the in-app detail page.
   */
  openExternal: boolean;
}

/** The in-app detail page for a ticket: Huddle tickets and Redmine issues each have one. */
export function ticketDetailPath(ticket: { sourceId: TicketSourceId; id: string }): string {
  return ticket.sourceId === 'redmine'
    ? `/app/tickets/redmine/${ticket.id}`
    : `/app/tickets/${ticket.id}`;
}

/** A person a ticket is assigned to. Ids are namespaced per source. */
export interface UnifiedAssignee {
  /** Unique within the owning source only — never compare across sources. */
  id: string;
  name: string;
}

/**
 * A ticket's status.
 *
 * `native` is what the source calls it and is what the row renders. `isClosed`
 * is the only cross-source fact we derive, and it drives the Open/Closed tabs.
 */
export interface UnifiedStatus {
  native: string;
  isClosed: boolean;
}

/**
 * A ticket's priority.
 *
 * `rank` normalizes otherwise-incomparable scales so one sort works across
 * sources — higher means more urgent, 0 means "no priority set".
 */
export interface UnifiedPriority {
  native: string;
  rank: number;
}

/** The grouping a ticket belongs to: a Huddle team, or a Redmine project. */
export interface UnifiedContainer {
  id: string;
  name: string;
}

/** The single shape the unified list renders, whatever the source. */
export interface UnifiedTicket {
  /** `${sourceId}:${id}` — row identity. Client-side only, never persisted. */
  key: string;
  sourceId: TicketSourceId;
  /** Native id as a string. Only unique within its own source. */
  id: string;
  /** Short human-facing reference shown on the row, e.g. `#12345`. */
  ref: string;
  title: string;
  container: UnifiedContainer | null;
  status: UnifiedStatus;
  priority: UnifiedPriority | null;
  assignees: UnifiedAssignee[];
  createdBy: UnifiedAssignee | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Set when the ticket lives elsewhere and the row should link out. */
  externalUrl: string | null;
  /** A related link the ticket points at, e.g. a Huddle ticket's GitHub issue. */
  externalRef: { url: string; label: string } | null;
  /** Huddle-only; always false for other sources. Toggled from the row menu. */
  sharedWithTimeharbor: boolean;
  capabilities: SourceCapabilities;
}

/** Everything an adapter needs from the app to fetch and normalize. */
export interface TicketSourceContext {
  userId: string | null;
  /** Teams the signed-in user belongs to, for team-scoped sources. */
  teams: { id: string; name: string }[];
  /** Resolves a Huddle user id to a display name. */
  resolveMemberName: (userId: string) => string | null;
  /**
   * Which Redmine issues to fetch. Source-specific and deliberately so: the
   * alternative is an untyped options bag, and one named field per source is
   * easier to follow than that. Revisit if a third source needs its own knob.
   */
  redmineScope: RedmineScope;
}

/**
 * A ticket source.
 *
 * Mutation methods are deliberately optional: no source implements them today
 * (Redmine issues are read-only, Huddle mutations still run through the page's
 * own handlers), but declaring them here means adding write support later is an
 * additive change rather than a redesign of this interface.
 */
export interface TicketSource<Raw = unknown> {
  id: TicketSourceId;
  /** Shown in the source filter and on row badges. */
  label: string;
  capabilities: SourceCapabilities;
  /**
   * Whether this source can be fetched at all right now — e.g. Redmine is
   * unavailable until the user links an account. An unavailable source is
   * omitted from the list silently; it is not an error state.
   */
  isAvailable: (ctx: TicketSourceContext) => boolean;
  fetch: (ctx: TicketSourceContext) => Promise<Raw[]>;
  toUnified: (raw: Raw, ctx: TicketSourceContext) => UnifiedTicket;

  create?: (input: unknown, ctx: TicketSourceContext) => Promise<void>;
  update?: (id: string, input: unknown, ctx: TicketSourceContext) => Promise<void>;
  delete?: (id: string, ctx: TicketSourceContext) => Promise<void>;
}

/**
 * A source with its raw shape erased, so sources with different payloads can
 * live in one registry array. `load` folds fetch + normalize into one step,
 * which is the only combination callers ever need.
 */
export interface AnyTicketSource {
  id: TicketSourceId;
  label: string;
  capabilities: SourceCapabilities;
  isAvailable: (ctx: TicketSourceContext) => boolean;
  load: (ctx: TicketSourceContext) => Promise<UnifiedTicket[]>;
}

/** Erase a source's raw type so it can be registered. */
export function defineSource<Raw>(source: TicketSource<Raw>): AnyTicketSource {
  return {
    id: source.id,
    label: source.label,
    capabilities: source.capabilities,
    isAvailable: source.isAvailable,
    load: async (ctx) => {
      const raw = await source.fetch(ctx);
      return raw.map((item) => source.toUnified(item, ctx));
    },
  };
}

/** Build the composite row key for a ticket. */
export const ticketKey = (sourceId: TicketSourceId, id: string | number): string =>
  `${sourceId}:${id}`;
