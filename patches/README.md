# patches/

Fixes to `@kerebron/*` that the RichEditor needs, applied after every install by
[`patch-package`](https://github.com/ds300/patch-package) through
[`scripts/apply-patches.cjs`](../scripts/apply-patches.cjs) (`postinstall`).

They are not written here. Each one is a copy of the patch of the same name in
[mieweb/ui's `patches/`](https://github.com/mieweb/ui/tree/main/patches), which
`@mieweb/ui` asks host apps to apply. Kerebron is a peer dependency, so the app's
copy is the one the editor runs, and a fix made only in the library never reaches it.

| Patch                 | Without it                                                                             |
| --------------------- | -------------------------------------------------------------------------------------- |
| `extension-menu`      | The toolbar's Heading and List dropdowns do nothing, and buttons never show as pressed |
| `extension-markdown`  | Highlight, superscript and subscript are dropped when a document is saved as Markdown  |
| `extension-codecrock` | The code-block language picker has no accessible name                                  |

## Keeping them in step

The patches target `@kerebron/*@0.8.12` exactly, which is why `package.json` pins
those packages to `0.8.12` with no `^`. `patch-package` fails the install if a
patch no longer matches its package.

After `npm run ui:sync`, compare `vendor/ui/patches/` with this folder. Upstream's
files are in pnpm format; ours differ only in the filename
(`@kerebron+<name>+<version>.patch`) and in each path being prefixed with
`node_modules/@kerebron/<name>/`. When upstream drops a patch because Kerebron
fixed the bug, delete it here and move the pin.

`scripts/apply-patches.cjs` lists the patches it expects and fails the install if
one is missing, so adding, removing or renaming a patch means updating that list too.
