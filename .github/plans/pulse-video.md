# Pulse Video

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Idea

Allow users to upload short video clips as attachments — to tickets, comments,
standups, or any other content where file attachments already exist.

## Scope

- Upload a video file as an attachment (same surface as image or file attachments)
- Store the uploaded video and serve it back for playback
- Basic inline video player where the attachment is rendered
- No transcoding, captioning, or streaming infrastructure required in the first version

## Out of Scope (for Now)

- Video recording in-browser
- Transcoding or format normalization
- Video hosting CDN or advanced streaming
- Captions, transcripts, or accessibility pass
- Analytics or view counts
- Dedicated video feed or reel surface (see [profiles.md](profiles.md))
