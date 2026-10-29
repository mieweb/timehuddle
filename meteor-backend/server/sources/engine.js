/**
 * The driver engine (#734 step 3): one outside issue in, one ticket record out,
 * and edits back, for any source a definition in `@timehuddle/ticket-sources`
 * describes.
 *
 * The engine reads each record field from the source's answer by the path its
 * definition gives, and calls the definition's named hooks for what a path
 * can't say. It never asks which source it is serving: a source's own rules
 * live in its definition and its hooks (`registry.js`).
 *
 * Only ever one issue at a time. A full record carries the description,
 * history and custom fields, which may hold patient information, so lists and
 * search keep their slim shapes and never come through here.
 *
 * No Meteor imports, so this is unit-testable (tests/sources-engine.test.ts).
 */
import { isHook } from '@timehuddle/ticket-sources';

/** An engine refusal, with a `code` the methods turn into a Meteor error. */
export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The value at a dotted `path` in `raw` (`priority.name`), or undefined. */
export function readPath(raw, path) {
  if (!path) return undefined;
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), raw);
}

/** `template` with `{key}` and `{container}` filled from `ref`, each URL-encoded. */
export function fillTemplate(template, ref) {
  return template.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(ref[name] ?? ''));
}

function callHook(hooks, value, args, ctx) {
  const fn = hooks[value.hook];
  if (typeof fn !== 'function') throw new Error(`No hook registered for "${value.hook}"`);
  return fn(...args, ctx);
}

const asText = (value) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n') : '');

/** A timestamp as an ISO string, or null. */
function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** What a value is called: its `key` when it is an object, else itself. */
function nameOf(value, key) {
  if (value == null) return null;
  if (typeof value === 'object') return key && value[key] != null ? String(value[key]) : null;
  return String(value);
}

/** `{ id, name }` from an object with an id, or null. */
function toNamed(value, key = 'name') {
  if (!value || typeof value !== 'object' || value.id == null) return null;
  return { id: String(value.id), name: nameOf(value, key) ?? '' };
}

async function toStatus(spec, value, hooks, ctx) {
  const native = nameOf(value, spec.name) ?? '';
  const when = spec.closedWhen;
  let isClosed = false;
  if (isHook(when)) isClosed = Boolean(await callHook(hooks, when, [value], ctx));
  else if (when?.equals !== undefined) isClosed = native === when.equals;
  else if (Array.isArray(when?.in)) isClosed = when.in.includes(native);
  return { ...(value?.id != null ? { id: String(value.id) } : {}), native, isClosed };
}

function toPriority(spec, value) {
  const native = nameOf(value, spec.name);
  if (!native) return null;
  return {
    ...(value?.id != null ? { id: String(value.id) } : {}),
    native,
    rank: spec.ranks?.[native.toLowerCase()] ?? 0,
  };
}

function toPeople(spec, value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const people = list.map((person) => toNamed(person, spec.name)).filter(Boolean);
  return spec.max ? people.slice(0, spec.max) : people;
}

function toLabels(spec, raw) {
  if (spec.groups) {
    return Object.entries(spec.groups)
      .map(([group, path]) => ({ name: nameOf(readPath(raw, path)), group }))
      .filter((label) => label.name);
  }
  const list = readPath(raw, spec.path);
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      name: nameOf(item, spec.name) ?? '',
      ...(spec.color && item?.[spec.color] ? { color: String(item[spec.color]) } : {}),
    }))
    .filter((label) => label.name);
}

function toExtra(spec, raw) {
  const list = readPath(raw, spec.path);
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const value = item?.[spec.value];
      return {
        label: nameOf(item, spec.name) ?? '',
        value: Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value),
      };
    })
    .filter((field) => field.label && field.value);
}

function toAttachments(spec, raw) {
  const list = readPath(raw, spec.path);
  return (Array.isArray(list) ? list : [])
    .filter((item) => item?.id != null)
    .map((item) => {
      const size = Number(readPath(item, spec.size));
      return {
        id: String(item.id),
        name: nameOf(item, spec.name) ?? '',
        url: nameOf(readPath(item, spec.url)) ?? null,
        ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
        author: toNamed(readPath(item, spec.author)),
        at: toIso(readPath(item, spec.at)),
      };
    });
}

function toDates(spec, raw) {
  const dates = {
    created: toIso(readPath(raw, spec.created)),
    updated: toIso(readPath(raw, spec.updated)),
  };
  const due = readPath(raw, spec.due);
  const closed = toIso(readPath(raw, spec.closed));
  return { ...dates, ...(due ? { due: String(due) } : {}), ...(closed ? { closed } : {}) };
}

/**
 * The ticket record for `raw`, one source's answer for one issue, read field
 * by field from `definition`. `hooks` are the source's named hooks; `ctx` is
 * passed to each (the member's account, for one).
 */
export async function toRecord(definition, raw, { hooks = {}, ctx = {}, ref = null, url = null } = {}) {
  const f = definition.fields;
  const read = (spec) => (spec ? readPath(raw, spec.path) : undefined);
  const named = (spec) => (spec ? toNamed(read(spec), spec.name) : null);
  const body = asText(read(f.body));

  // A conversation read from its own address (a separate comments list) is
  // #734 step 4.
  const conversation = isHook(f.conversation?.from)
    ? await callHook(hooks, f.conversation.from, [raw], ctx)
    : [];

  return {
    ref,
    url,
    title: asText(read(f.title)),
    body: body ? { text: body, format: f.body.format ?? 'plain' } : null,
    status: f.status
      ? await toStatus(f.status, read(f.status), hooks, ctx)
      : { native: '', isClosed: false },
    priority: f.priority ? toPriority(f.priority, read(f.priority)) : null,
    assignees: f.assignees ? toPeople(f.assignees, read(f.assignees)) : [],
    reporter: named(f.reporter),
    labels: f.labels ? toLabels(f.labels, raw) : [],
    type: named(f.type),
    container: named(f.container),
    milestone: named(f.milestone),
    dates: f.dates ? toDates(f.dates, raw) : { created: null, updated: null },
    conversation: Array.isArray(conversation) ? conversation : [],
    attachments: f.attachments ? toAttachments(f.attachments, raw) : [],
    relations: [],
    extra: f.extra ? toExtra(f.extra, raw) : [],
  };
}

/**
 * The statuses the member may move the issue to, current one first: the
 * source lists them where `status.allowed` says. Empty when the definition
 * lets status be set freely, or not at all.
 */
export async function statusChoices(definition, raw, { hooks = {}, ctx = {} } = {}) {
  const spec = definition.fields.status;
  if (spec?.edit !== 'allowed' || !spec.allowed) return [];
  const current = await toStatus(spec, readPath(raw, spec.path), hooks, ctx);
  const listed = readPath(raw, spec.allowed);
  const moves = await Promise.all(
    (Array.isArray(listed) ? listed : []).map((value) => toStatus(spec, value, hooks, ctx)),
  );
  return [current, ...moves.filter((status) => status.id !== current.id)];
}

/** The source's answer for issue `ref`, or null when it is missing or hidden. */
async function readRaw(definition, ref, request) {
  if (!definition.api.issue) throw new Error(`Source "${definition.kind}" names no issue address`);
  const answer = await request(fillTemplate(definition.api.issue, ref));
  return (definition.api.item ? readPath(answer, definition.api.item) : answer) ?? null;
}

/**
 * Read issue `ref` through `definition`. `request(path)` asks the source with
 * the member's own key and resolves to its answer, or null when the issue is
 * missing or hidden from them. Returns `{ raw, record, choices }`, or null.
 *
 * @param {{ definition: object, ref: object, request: (path: string) => Promise<any>,
 *   hooks?: object, ctx?: object, url?: string | null }} args
 */
export async function fetchRecord({ definition, ref, request, hooks = {}, ctx = {}, url = null }) {
  const raw = await readRaw(definition, ref, request);
  if (!raw) return null;
  const options = { hooks, ctx, ref, url };
  return {
    raw,
    record: await toRecord(definition, raw, options),
    choices: { status: await statusChoices(definition, raw, options) },
  };
}

/**
 * Write `edits` (record field → new value) to issue `ref`, as the member.
 *
 * Refused before anything is sent when a field isn't marked editable, or when
 * the issue changed since `expectedUpdatedAt`: most sources have no locking of
 * their own, and writing over a newer edit would undo it. The source's `write`
 * hook gets the current answer and the edits, and resolves to
 * `{ raw, mismatches }`: the issue as stored, and the fields it didn't store as
 * sent. `ctx.reload()` reads the issue again, for the hook's read-back.
 */
export async function writeRecord({
  definition,
  ref,
  request,
  hooks = {},
  ctx = {},
  url = null,
  expectedUpdatedAt,
  edits,
}) {
  const keys = Object.keys(edits ?? {});
  if (keys.length === 0) throw new EngineError('bad-request', 'Nothing to change.');
  for (const key of keys) {
    if (!definition.fields[key]?.edit) {
      throw new EngineError('bad-request', `${key} can't be changed from TimeHuddle.`);
    }
  }
  const write = definition.can.write;
  if (!isHook(write)) throw new EngineError('bad-request', `${definition.label} is read-only.`);

  // Only the answer: the record, conversation and all, is built once, at the end.
  const load = () => readRaw(definition, ref, request);
  const current = await load();
  if (!current) throw new EngineError('gone', 'This issue no longer exists, or you can no longer see it.');
  const updated = toIso(readPath(current, definition.fields.dates?.updated));
  if (updated !== expectedUpdatedAt) {
    throw new EngineError(
      'stale',
      `This issue changed in ${definition.label} since you opened it. Reload to see the latest version.`,
    );
  }

  const { raw, mismatches = [] } = await callHook(hooks, write, [{ raw: current, edits }], {
    ...ctx,
    reload: load,
  });
  const options = { hooks, ctx, ref, url };
  return {
    record: await toRecord(definition, raw, options),
    choices: { status: await statusChoices(definition, raw, options) },
    mismatches,
  };
}
