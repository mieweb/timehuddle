# PulseVault + Wormhole — Simple Explanation

## The problem, in plain terms

Video upload and video playback for Pulse Vault run on their own separate door into the server (`/pulsevault/upload` and `/pulsevault/artifacts/:id`), instead of going through the same front door (`Wormhole`) that every other feature uses. That made it a "side-channel" — invisible in the API docs (Swagger) and disconnected from the rest of the system.

## Why we couldn't just fix it the obvious way

We looked at making the upload a normal Wormhole method call (the same way `reserve`, `getVideo`, etc. work). It doesn't work, because:

- Wormhole's normal door only accepts small JSON messages (max 1 MB).
- A video can be up to 500 MB — it wouldn't fit.
- Video files need to stream in pieces and be "seekable" (so you can skip ahead while watching) — Wormhole's normal door doesn't support that, only all-at-once JSON in/out.

So this wasn't something we forgot to do — the tool genuinely didn't have a way to do it.

## What changed

We went and checked the tool itself (`meteor-wormhole`, the library that builds this front door) to see if anyone had ever solved this before.

**We found someone already had.** A developer on our own team's related project had built a second, smaller door specifically for this situation — a way to register a custom endpoint *through* Wormhole instead of bypassing it, while still letting raw video bytes flow through it directly (not squeezed through the small JSON door).

**And even better: we already have it.** This project already includes that exact fix, sitting quietly in a folder called `vendor/meteor-wormhole` (a copy of the improved library, already downloaded into this project). Our server is already configured to use that copy instead of the plain public version — but nobody had connected Pulse Vault's upload/playback code to it yet.

So the situation changed from:

> ❌ "This is impossible with the tools we have — Wormhole cannot support this at all."

to:

> ✅ "The tool we need already exists, and it's already sitting in our own codebase, unused."

## What still needs to happen (not done yet)

1. Change `pulsevault.js` so its upload/playback door registers itself *through* Wormhole using this new feature, instead of opening its own separate door.
2. Manually add a description of these two endpoints to the API docs (Swagger), since this new feature doesn't do that part automatically — that still has to be written by hand.

Nothing has been changed in the code yet — this is a plan, waiting on the go-ahead.

## One-line summary

We can't send the video itself through Wormhole's normal method — but we *can* register the video door as belonging to Wormhole instead of standing apart from it, using a feature that's already sitting in this project unused.
