# Profiles

> **STATUS: READY** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Idea

Profiles should not just be personal account settings pages. In TimeHuddle,
someone else's profile should also act as a lightweight team-facing view of who
that person is, what they are working on, and how they have been showing up in
the flow of work.

That does **not** mean turning profiles into a full reporting surface. It means
giving teammates, managers, scrum masters, and leadership a clear, high-signal
view of the person without forcing them to jump across tickets, timesheets,
messages, and activity logs.

---

## Team-Facing Profile Surface

For another user's profile, the useful information likely falls into three
layers.

### Identity and Working Context

- Add a Profile/User timezone setting.
- This setting should inform how dates and times are displayed in the UI while canonical storage remains UTC.
- Show basic team-facing identity and context such as role, team membership,
	and timezone.
- Add a lightweight **Reports To** field or relationship so teammates can see
	who a person's manager or direct lead is.

This does not need to become a full org-chart feature in the first version. The
main value is quick clarity: "Who does this person report to?" should be easy
to answer from the profile when that relationship matters.

### Current Work Snapshot

- Show current assigned tickets or recent work items.
- Show recent work/time context at a high level rather than raw ledger detail.
- Potentially show lightweight capacity or availability context when that
	feature exists.

### Team Visibility Layer

- Show a richer team-facing activity feed powered by the existing activity log.
- Present activity as a higher-level narrative, grouped and styled for humans,
	not just as raw event rows.
- Surface recent meeting / standup participation when that feature exists.
- Highlight blockers or recurring themes only when there is enough signal to do
	so cleanly.

---

## Videos and Reels

A profile may surface video content uploaded by or featuring that user — a
lightweight reel of work-related clips, demo recordings, or standup videos.

- Profile can display a scrollable list of video attachments the user has
  posted across tickets, standups, and comments.
- No dedicated video hosting required — this reuses the attachment model from
  [pulse-video.md](pulse-video.md).
- The reel is optional and only appears if the user has uploaded videos.

---

## Why This Matters

The value of a team-facing profile is that it becomes the natural place to
answer questions like:

- who is this person in the team?
- what are they focused on right now?
- what have they been doing recently?
- who do they report to?
- are they blocked, overloaded, or inactive?

This is especially useful for:

- **Scrum masters** who want quick context before or during standups
- **Managers** who want a concise operational view of recent work and visibility
- **Leadership** who want a high-level sense of momentum and contribution

---

## Relationship to Other Plans

- **Activity feed** provides the underlying event stream for the richer profile
	activity view.
- **Meetings / standups** can contribute recent responses, blockers, and
	participation context.
- **Team capacity** can later contribute availability and workload signals.
- **Pulse Video** ([pulse-video.md](pulse-video.md)) provides the video upload
  and playback foundation that the profile reel depends on.
- **Reporting** remains separate; profiles should summarize a person, not become
	a generic analytics dashboard.

---

## Scope Guidance

Keep this lightweight for now; detailed product and technical design is
intentionally deferred.

The first useful version should likely focus on:

- timezone and working-context basics
- clickable team-facing identity
- current work snapshot
- richer profile activity feed based on the existing activity log

That is enough to make profiles meaningfully more useful without overbuilding a
full people-analytics product.
