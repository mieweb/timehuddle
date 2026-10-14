# site/

**The public website** — the pages someone sees before they have an account.
`main.tsx` mounts them directly (outside `AppLayout`) and lazy-loads each, so the
app and the site never ship each other's code.

| Path                               | URL                     | What it is                                                            |
| ---------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `landing/`                         | `/`                     | The home page, built around the example day in `exampleDay.ts`        |
| `docs/`                            | `/docs`, `/docs/<slug>` | Renders the markdown guides in [`/guides`](../../../guides/README.md) |
| `copy.ts`                          | —                       | Every user-facing string on the site, for translation                 |
| `site.module.css`                  | —                       | The site's palette, fonts and motion. Light-only on purpose           |
| `SiteHeader.tsx`, `SiteFooter.tsx` | —                       | Shared by the landing page and the docs                               |

The public release notes (`/release-notes`) live with the rest of the release
notes in [`../release-notes/`](../release-notes/).

**Keep it true.** The landing page and guides describe what the product does
today. A change that alters a claim in `copy.ts` or a guide updates it in the
same pull request.
