# Brand source artwork

Inputs for `npx @capacitor/assets generate`, which writes the iOS asset catalog
(`ios/App/App/Assets.xcassets/`), the Android resources (`android/app/src/main/res/`),
and the PWA icons (`icons/`). Those outputs are generated — edit the sources here,
never the generated files.

| File            | Feeds                        | Why it looks the way it does                        |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `logo.png`      | app icons (generic fallback) | Trimmed so the mark fills ~91% of the square        |
| `icon-only.png` | iOS `AppIcon`                | Same trimmed art, pinned explicitly for iOS         |
| `splash.png`    | iOS + Android splash screens | Original art, padding intact — splashes need margin |

## Three traps when regenerating

**Don't feed the icons untrimmed art.** The original logo is a 2000x2000 canvas
whose mark occupies only the middle ~820px. Generating from it produced an iOS
icon that was 41% mark and 59% blank white, so the app rendered visibly smaller
than its neighbours on the home screen. Hence the trimmed `logo.png`.

**Don't trim the splash to match.** A splash screen is meant to have wide margins
around a centred logo, so `splash.png` deliberately keeps the original padding.
This is the only reason the icon and splash sources differ.

**Don't add `icon-foreground.png` / `icon-background.png`.** Supplying those
switches the generator onto a path that emits the Android adaptive foreground at
legacy-icon scale (48-192px) instead of the correct 108dp scale (108-432px),
which the launcher then upscales into a blurry icon. Letting `logo.png` serve as
the fallback keeps the correct sizes.

## Regenerating

```bash
npx @capacitor/assets generate
```

Then sanity-check the fill ratio — the iOS icon and the Android adaptive
foreground should both land near 91%:

```bash
magick ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png -fuzz 3% -trim -format '%w of %W\n' info:
```

The iOS icon must stay 1024x1024 with **no alpha channel** — App Store validation
rejects icons with transparency.

The web copy used by the React app lives at `public/logo.png` and is derived from
`logo.png` here, so the two cannot drift:

```bash
magick assets/logo.png -resize 512x512 -strip -quality 92 public/logo.png
```
