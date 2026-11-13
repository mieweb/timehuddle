# eSheet Findings

What eSheet offers TimeHuddle's clock-in flow (`proto/today-flow`), and what is
still open. Read from `@mieweb/ui` and `@esheet/*` 0.0.7.

## Editor

- **The prototype already uses eSheet's editor.** eSheet's rich text field
  (`RichTextEsheet`) is built on `TextAreaRich` (Kerebron), the same editor as:
  - the clock-in composer (`TextAreaRich` directly, for the ticket `+` menu and
    `insertLine`);
  - the ticket description (`Textarea`, which renders `TextAreaRich` underneath).
- **Decision: keep `TextAreaRich`.** Markdown in and out, tickets as links, no
  toolbar on the phone, the same field everywhere.
- **To do:** port our `TextAreaRich` additions (the `+` menu entries,
  `insertLine`, the stable handle) to upstream `@mieweb/ui`.

## Drag and drop

| Who                                                              | Uses                                       | Notes                                                              |
| ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| eSheet builder and rank field                                    | SortableJS, bundled inside, not exported   | Drag by handle; no keyboard                                        |
| `@mieweb/ui` `BoardView`, `CustomizableDashboard`, `EmailEditor` | dnd-kit                                    | For moves across columns; only the dashboard has keyboard          |
| `@mieweb/ui` clinical lists (`ProblemList` and others)           | `useDragReorder`                           | Flat lists; keyboard and announcements; HTML5 drag, weak on phones |
| TimeHuddle My Board                                              | `SortableList` (ours, on `useDragReorder`) | Press and hold on touch, keyboard, drop zones                      |

- **Decision: keep `SortableList`.** My Board is one flat list, which is what
  `useDragReorder` is for; it has keyboard support, and it adds no dependency.
- **Proposal:** make `SortableList` a `@mieweb/ui` component (branch
  `feat/sortable-list`), so every list gets touch drag. Revisit dnd-kit if the
  Personal bar needs real moves between lists.

## Why eSheet might have come up

eSheet's editor and drag and drop aren't new to us, so the point is probably its
**form structure**:

1. **Plan as a template.** Sections such as "Today" and "Blockers", tickets as
   tap-to-insert items, a required section before clock-in (like `RichTextEsheet`'s
   sections and findings).
2. **Questions each organization sets.** Admins design their own clock-in and
   clock-out questions with the eSheet builder, as an opt-in setting.
3. **Ranking today's work.** The rank question orders items by drag, as Pinned does.
4. **One MIE stack.** Reuse eSheet's forms and conditional logic instead of
   building our own.

## Questions

1. Did eSheet come up for its form structure (sections, templates) or for its
   builder (organizations design their own questions)?
2. Should `SortableList` go upstream into `@mieweb/ui`? (For Poonam.)
3. Should `@mieweb/ui` settle on one drag library, or keep `useDragReorder` for
   flat lists and dnd-kit for multi-container moves?
4. Would eSheet's builder and rank field use `SortableList` instead of SortableJS,
   to gain keyboard support?
