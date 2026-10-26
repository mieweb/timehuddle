// ─── The ticket record ────────────────────────────────────────────────────────
// The one shape every source is translated into (#734 step 2). Field names
// follow today's `UnifiedTicket` where it already has them.

/** A person, by an id that is unique within its own source only. */
export interface RecordPerson {
  id: string;
  name: string;
}

/** Something with an id and a name: a project, a team, a tracker. */
export interface RecordNamed {
  id: string;
  name: string;
}

/**
 * `native` is what the source calls it. `isClosed` is the one fact every
 * source can answer, and decides Open / Closed.
 */
export interface RecordStatus {
  native: string;
  isClosed: boolean;
}

/** `rank` makes priorities comparable across sources: higher is more urgent, 0 is none. */
export interface RecordPriority {
  native: string;
  rank: number;
}

/** A label. `color` is the source's own (a GitHub label's); `group` names a kind of label, e.g. `tracker`. */
export interface RecordLabel {
  name: string;
  color?: string;
  group?: string;
}

export type BodyFormat = 'markdown' | 'textile' | 'plain';

export interface RecordText {
  text: string;
  format: BodyFormat;
}

/** Where an outside issue is: the server's host, a container (a GitHub repo) and the key. */
export interface IssueRef {
  server: string;
  container?: string;
  key: string;
}

/** One entry in a ticket's conversation: a comment, a field change, or time logged. */
export type ConversationEntry =
  | { kind: 'comment'; id: string; author: RecordPerson | null; at: string; text: RecordText }
  | {
      kind: 'change';
      id: string;
      author: RecordPerson | null;
      at: string;
      field: string;
      from?: string;
      to?: string;
    }
  | { kind: 'time'; id: string; author: RecordPerson | null; at: string; seconds: number };

export interface RecordRelation {
  kind: string;
  target: IssueRef | { url: string };
}

export interface TicketRecord {
  ref: IssueRef | null;
  url: string | null;
  title: string;
  body: RecordText | null;
  status: RecordStatus;
  priority: RecordPriority | null;
  assignees: RecordPerson[];
  reporter: RecordPerson | null;
  labels: RecordLabel[];
  type: RecordNamed | null;
  container: RecordNamed | null;
  milestone: (RecordNamed & { due?: string }) | null;
  dates: { created: string | null; updated: string | null; due?: string; closed?: string };
  conversation: ConversationEntry[];
  relations: RecordRelation[];
  /** A source's custom fields, shown as they are. */
  extra: { label: string; value: string }[];
}

export type RecordField = Exclude<keyof TicketRecord, 'ref' | 'url'>;

export declare const RECORD_FIELDS: readonly RecordField[];

// ─── Source definitions ───────────────────────────────────────────────────────

/** A named step the backend supplies, for what plain data can't express. */
export interface Hook {
  readonly hook: string;
}

export interface FieldSpec {
  /** Where the field is in the source's answer, as a dotted path (`priority.name`). */
  path?: string;
  /** For a list, or an object: the key holding its name. */
  name?: string;
  /** For a list of labels: the key holding a label's colour. */
  color?: string;
  /** For custom fields: the key holding a value. */
  value?: string;
  /** Labels gathered from several places, by group: `{ tracker: 'tracker.name' }`. */
  groups?: Record<string, string>;
  /** Read by a hook instead of a path. */
  from?: Hook;
  format?: BodyFormat;
  /** For `status`: how it reads as closed, by an equal value or a hook. */
  closedWhen?: { equals: string } | Hook;
  /** The most values a source takes (Redmine has one assignee). */
  max?: number;
  /** Whether TimeHuddle may write it back; `'allowed'` is only the moves the source allows. */
  edit?: boolean | 'allowed';
  /** For `dates`: where each date is. */
  created?: string;
  updated?: string;
  due?: string;
  closed?: string;
  /** For `conversation` read from a path: where an entry's author and text are. */
  author?: string;
  text?: string;
}

export interface SourceDefinition {
  /** Lowercase letters, digits or dashes: `redmine`, `github`. */
  kind: string;
  label: string;
  connect: {
    auth: 'none' | 'header' | 'bearer';
    header?: string;
    fields?: { id: string; label: string; secret?: boolean }[];
  };
  /**
   * How an issue's address and ID look. Only these keys: an ID is plain text,
   * the same colour and font for every source.
   */
  id: {
    hosts?: string[];
    /** Runs on the address's path; names its parts `(?<container>…)` and `(?<key>…)`. */
    match?: RegExp;
    /** `{prefix}`, `{key}`, `{container}`, `{repo}`: e.g. `{prefix}-{key}`. */
    show: string;
  };
  api: {
    base?: string;
    issue?: string;
    paging?: 'offset' | 'link-header';
  };
  fields: Partial<Record<RecordField, FieldSpec>>;
  /** What the source can do beyond reading one issue. */
  can: Record<string, boolean | Hook>;
}

export declare function hook(name: string): Hook;
export declare function isHook(value: unknown): value is Hook;
/** Check a definition and freeze it; throws an Error saying what is wrong. */
export declare function defineSource<
  T extends Partial<SourceDefinition> & Pick<SourceDefinition, 'kind' | 'label'>,
>(definition: T): Readonly<SourceDefinition>;

export declare function matchIssueUrl(
  definition: SourceDefinition,
  url: string,
): { container?: string; key: string } | null;
export declare function showId(
  definition: SourceDefinition,
  ref: { container?: string; key: string },
  prefix?: string,
): string;

export declare const timehuddle: Readonly<SourceDefinition>;
export declare const redmine: Readonly<SourceDefinition>;
export declare const github: Readonly<SourceDefinition>;
export declare const SOURCES: Readonly<{
  timehuddle: Readonly<SourceDefinition>;
  redmine: Readonly<SourceDefinition>;
  github: Readonly<SourceDefinition>;
}>;

/** The outside ID for `url` (#689), e.g. `timehuddle-223` or `PM-233`, or null. */
export declare function outsideIdOf(
  url: string | null | undefined,
  prefixes: readonly { host: string; prefix: string }[],
): string | null;
