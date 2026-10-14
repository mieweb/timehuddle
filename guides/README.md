# guides/

**The documentation people read on the website.** Every `*.md` file here except
this README is bundled into the frontend build and rendered at `/docs/<filename>`
by [`src/features/site/docs/`](../src/features/site/docs/), with no account needed.

These are written for **people using or running TimeHuddle**, not for the people
changing its code. Design notes, plans and audits belong in [`docs/`](../docs/);
what shipped in a release belongs in [`release-notes/`](../release-notes/README.md).

## A guide

```markdown
---
title: Clock in and out
summary: One sentence, shown in the docs index and as the guide's lead.
section: Using TimeHuddle
order: 20
---

Body in markdown. Start sections at `##` — the page renders the title as `h1`,
and every `##` becomes an entry in the guide's "On this page" list.
```

- **The filename is the URL.** `clock-in.md` is served at `/docs/clock-in`, so
  use lowercase words joined by dashes, and don't rename a guide people link to.
- **`section`** groups guides in the sidebar; sections appear in the order of
  their first guide.
- **`order`** sorts every guide across sections. Leave gaps (10, 20, 30) so a
  new guide fits in without renumbering.
- **Link between guides** with site paths: `[Redmine](/docs/redmine)`.
- **Every field is required.** A malformed guide fails the build's tests
  (`guides.test.ts` loads this folder), rather than silently disappearing.

## Keep them true

A guide describes what the product does today. If a change you make alters
something a guide says, update the guide in the same pull request.
