# Archived Huddle Card View

**Archived on**: 2026-09-29

**Reason**: Replaced by `SuperChatInbox` (see
[`docs/huddle-superchat-inbox-plan.md`](../../docs/huddle-superchat-inbox-plan.md), issue #601).
`src/pages/Huddle.tsx` no longer has a cards/chat toggle — the inbox is the only feed view.

## What Was Here

- `PostCard/` — the card-per-post feed item: markdown body, attachments, ticket tag, like button,
  edit/delete menu, and the comments panel underneath.
- `HuddleComments/` — the flat comment list + add-comment box shown under an expanded `PostCard`.
- `DraftsPanel.tsx` — the Huddle page's Drafts tab (write, edit, publish and delete private drafts).
  Archived 2026-09-30 when drafts were removed from the app entirely: the Drafts tab, the Clock
  page's "Save draft", and the `huddle.getMyDrafts` / `getMyLatestDraft` / `publishPost` backend
  methods. Draft rows already in `huddlePosts` (`status: 'draft'`) are left in place and still
  filtered out of every feed.

- `HuddleComposer.tsx` — the Huddle page's "Share an update…" composer (Kerebron rich editor, attach
  bar, Pulse, ticket picker, @mentions). Archived 2026-10-01: posting moved into the inbox's own
  message box (SuperChat's `ChatComposer`, configured through `composerProps`), so a conversation
  is where you write. Its `ComposerContent` type went with it; the ticket-video pull-in it did now
  lives in `src/features/huddle/useTicketVideos.ts`.
- `collab.ts` — the Yjs room config (`huddlePostCollab`) that let two people edit one post live.
  Only `HuddleComposer`'s edit mode used it, and inline edit in the inbox is SuperChat's plain
  text box, so nothing opens a collaborative editor any more. The `/yjs/<postId>` relay on the
  backend is untouched.
- `yjs-collab-editing.spec.ts` — the e2e test for that live co-editing. It already drove the
  removed card view (`Switch to card view`, `Post actions`), so it could not pass on `main` either.

## Why They're Archived, Not Deleted

`SuperChatInbox` has no per-message reply/thread concept, so comments have no equivalent surface in
the new inbox (see the **Out of Scope** section of the execution plan). Comments are **not shown
anywhere in the app right now**, but:

- Comment data (`huddleComments` collection) is untouched.
- The backend methods (`huddle.getComments`, `huddle.addComment`, `huddle.deleteComment`, …) are
  untouched.
- Likes (`post.likes`) are similarly still stored; see Milestone 9 of the execution plan for what
  happened to the like button.

If replies land in `SuperChatInbox` upstream, comments can come back by building a new surface
against the existing data/methods — these files are kept as a reference for the previous UI and
interaction patterns (optimistic add/delete, permission checks), not to be revived as-is.

## Migration Notes

`Huddle.tsx`'s inbox now renders every published post as a top-level message via
`postsToConversations` (`src/features/huddle/superChatFeed.ts`), grouped by session/day/person/
ticket instead of one card per post.
