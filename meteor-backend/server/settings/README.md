# settings

Hierarchical settings (#607): a value set on an enterprise, organization or team is inherited by everything below it unless a lower level overrides it or a higher level locks it.

- `registry.js` is the single source of truth for each setting's type, system default and allowed levels. Add a setting there, not in a consumer.
- `resolve.js` is the pure resolver: an inheritance chain in, effective `{ value, source, locked }` per setting out.
- An absent key means "inherit"; never store a resolved value.
