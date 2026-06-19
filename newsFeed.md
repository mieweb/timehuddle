# Huddle Feed Component

A team news feed for the [timehuddle](https://github.com/mieweb/timehuddle) project. Built with React 19, TypeScript, and Tailwind CSS 4.

---

## What it does

- **Post feed** — shows team updates in reverse chronological order
- **Compose bar** — click to expand and write a new post
- **Video thumbnails** — displays video attachment previews with play button
- **Ticket embeds** — links posts to tracker tickets with status and time info
- **Likes** — toggle like on any post, count updates instantly
- **Comments** — expand/collapse per post, send replies with Enter or the send button
- **View counts** — shows how many people have seen each post

---

## File location

```
src/pages/Huddle.tsx
```

---

## How to add it to the app

### 1. Add the route

In `src/App.tsx`, import the component and add a route:

```tsx
import Huddle from './pages/Huddle';

// inside your <Routes>:
<Route path="/huddle" element={<Huddle />} />;
```

### 2. Add a nav link

Find your sidebar or bottom nav and add a link to `/huddle`:

```tsx
<NavLink to="/huddle">Huddle</NavLink>
```

---

## Component structure

```
Huddle                  ← main page, holds post state
├── ComposeBar          ← collapsed input that expands into a full composer
├── PostCard            ← individual post (one per feed item)
│   ├── Avatar          ← colored initials circle
│   ├── VideoThumb      ← video placeholder with play button
│   └── TicketEmbed     ← linked ticket with status badge
```

---

## Types

```ts
type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

interface Post {
  id: string;
  author: string;
  initials: string; // e.g. "SK" for Sara Kim
  avatarColor: AvatarColor;
  time: string; // display string e.g. "2 hours ago"
  body: string; // post text
  videoFile?: string; // filename shown on video thumbnail
  videoTicketId?: number; // ticket number shown on video badge
  ticket?: Ticket; // optional embedded ticket card
  likes: number;
  comments: Comment[];
  views: number;
}

interface Ticket {
  id: number;
  title: string; // e.g. "#41 — API rate limiting"
  status: 'Open' | 'In progress';
  time: string; // logged time e.g. "4h 30m"
  assignee: string;
}

interface Comment {
  id: string;
  author: string;
  initials: string;
  text: string;
  time: string;
  avatarColor: AvatarColor;
}
```

---

## Adding a new post programmatically

The `Huddle` component manages its own state. To add a post from outside (e.g. after an API call), lift the state up or pass in posts as props:

```tsx
// Example: replace internal state with props
export default function Huddle({ posts, onPost }: {
  posts: Post[];
  onPost: (text: string) => void;
}) { ... }
```

---

## Extending it

| What you want       | Where to change                                                        |
| ------------------- | ---------------------------------------------------------------------- |
| Real video playback | Replace `VideoThumb` with an `<video>` element                         |
| Real ticket data    | Fetch from backend and pass into `Post.ticket`                         |
| @mention support    | Add mention parsing inside `ComposeBar` textarea                       |
| Infinite scroll     | Wrap the post list in an intersection observer                         |
| Dark mode           | The component is light mode only — wrap with a theme context to toggle |

---

## Dependencies

No extra packages needed. Uses only:

- `react` (already in timehuddle)
- Tailwind CSS (already in timehuddle)
- Inline SVG icons (no icon library required)
