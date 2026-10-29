# @timehuddle/ticket-sources

The ticket record and the config format ticket sources are described in, for
[#734](https://github.com/mieweb/timehuddle/issues/734): handling tickets from
Redmine, GitHub and later Jira without new screens or code paths for each one.

| File           | Role                                                               |
| -------------- | ------------------------------------------------------------------ |
| `core.js`      | `RECORD_FIELDS`, `defineSource`, `hook`, `matchIssueUrl`, `showId` |
| `definitions/` | One definition per source: `timehuddle`, `redmine`, `github`       |
| `index.js`     | Public surface, plus `SOURCES` and `outsideIdOf` (#689)            |
| `index.d.ts`   | Types: the `TicketRecord` and `SourceDefinition`                   |

Plain JS with `index.d.ts`, like `@timehuddle/ota-version`: the front end gets
types, and the Meteor backend imports it without a build step.

## The rules

- **A definition is plain data.** It says how to sign in, where an issue lives,
  where each record field is in the source's answer (a dotted `path`), and
  which fields can be edited. `defineSource` refuses anything it can't check,
  and freezes the result.
- **Config until it needs logic, then a hook.** What plain data can't say is a
  named hook, `hook('redmineJournals')`. The backend registers what each name
  does; a definition never holds a function.
- **An ID is plain text.** `showId` builds it from the definition's `id.show`
  template (`{prefix}-{key}`, `{repo}-{key}`). A definition can't style its
  IDs: every source's look the same.

## Adding a source

1. Write `definitions/<kind>.js` with `defineSource`.
2. Add it to `SOURCES` and the exports in `index.js`, and its declaration in
   `index.d.ts`.
3. Any hooks it names get their implementation on the backend (#734 step 3).

## Tests

`index.test.ts` runs with the app's unit tests (`npm run test:unit`, see the
root `vitest.config.ts`), so it runs in CI too.
