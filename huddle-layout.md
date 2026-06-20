# Huddle Page — Layout & Design Documentation

This document extracts the layout structure, styling patterns, and interactive behaviors from the current `src/pages/Huddle.tsx` implementation. Use this as the design reference for implementing Phase 1 (Kerebron composer).

---

## Page Structure

```
┌────────────────────────────────────────┐
│ Header (fixed)                         │
│ - Title + Search + Notification        │
├────────────────────────────────────────┤
│ ComposeBar (collapsed/expanded)        │
├────────────────────────────────────────┤
│ Divider (2px gray-100)                 │
├────────────────────────────────────────┤
│ Feed (scrollable)                      │
│ - PostCard 1                           │
│ - PostCard 2                           │
│ - PostCard 3                           │
│ - ...                                  │
└────────────────────────────────────────┘
```

### Container Classes

- **Main wrapper**: `flex flex-col h-full bg-gray-50 min-h-screen`
- **Header**: `flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100 shrink-0`
- **Feed**: `flex-1 overflow-y-auto`

---

## Header Bar

**Layout**: Horizontal flex with space-between alignment

```tsx
<div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100 shrink-0">
  <h1 className="text-lg font-semibold text-gray-900 tracking-tight">Huddle</h1>
  <div className="flex gap-2">
    {/* Search button */}
    <button className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
      {/* Search icon */}
    </button>
    {/* Notification button */}
    <button className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
      {/* Bell icon */}
    </button>
  </div>
</div>
```

**Key patterns**:

- Buttons: `w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors`
- Title: `text-lg font-semibold text-gray-900 tracking-tight`
- Padding: `px-5 py-3`

---

## ComposeBar Component

### States

1. **Collapsed** (default):
   - Clickable container that expands on click
   - Shows placeholder text: "Share an update..."
   - Displays avatar + fake input + camera button

2. **Expanded** (editing):
   - Textarea for content input
   - Button bar with Photo/Video/Ticket + Cancel/Post actions

### Collapsed Layout

```tsx
<div
  className="flex items-center gap-3 px-5 py-3 bg-white cursor-pointer"
  onClick={() => setExpanded(true)}
>
  <Avatar initials="PD" color="indigo" />
  <div className="flex-1 bg-gray-100 border border-gray-200 rounded-full px-4 py-2.5 text-sm text-gray-400">
    Share an update...
  </div>
  <button className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
    {/* Camera icon */}
  </button>
</div>
```

### Expanded Layout

```tsx
<div className="px-5 py-3 border-b border-gray-100 bg-white">
  <div className="flex gap-3">
    <Avatar initials="PD" color="indigo" />
    <div className="flex-1">
      {/* Textarea */}
      <textarea
        autoFocus
        className="w-full bg-white border border-indigo-300 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 outline-none resize-none leading-relaxed min-h-20"
        placeholder="What's on your mind?"
      />

      {/* Button bar */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
          {/* Icon */} Photo
        </button>
        <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
          {/* Icon */} Video
        </button>
        <button className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors">
          {/* Icon */} Ticket
        </button>
        <button
          onClick={cancel}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-1"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="ml-auto text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Post
        </button>
      </div>
    </div>
  </div>
</div>
```

**Key patterns**:

- Textarea: `border-indigo-300` for focus, `rounded-xl`, `min-h-20`
- Action buttons: `rounded-full`, small text (`text-xs`), `gap-1.5` for icon spacing
- Primary button (Post): `bg-indigo-500 hover:bg-indigo-600`, `ml-auto` for right alignment
- Secondary button (Cancel): Plain text link style

---

## Avatar Component

**Sizes**:

- `md` (default): `w-9 h-9 text-[13px]`
- `sm`: `w-7 h-7 text-[10px]`

**Colors** (background + text combos):

```tsx
const avatarClasses = {
  indigo: 'bg-indigo-100 text-indigo-600',
  teal: 'bg-teal-100 text-teal-600',
  coral: 'bg-red-100 text-red-500',
  amber: 'bg-amber-100 text-amber-600',
  pink: 'bg-pink-100 text-pink-500',
  green: 'bg-green-100 text-green-600',
};
```

**Structure**:

```tsx
<div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 bg-indigo-100 text-indigo-600">
  PD
</div>
```

---

## PostCard Component

### Structure

```
┌─────────────────────────────────────┐
│ Header (avatar + name + time + •••) │
├─────────────────────────────────────┤
│ Video Thumbnail (optional)          │
├─────────────────────────────────────┤
│ Body Text                           │
├─────────────────────────────────────┤
│ Ticket Embed (optional)             │
├─────────────────────────────────────┤
│ Action Bar (like, comment, share)   │
├─────────────────────────────────────┤
│ Comments Section (expandable)       │
└─────────────────────────────────────┘
```

### Classes

**Container**: `border-b border-gray-100 px-5 pt-4 bg-white`

**Header**:

```tsx
<div className="flex items-center gap-2.5 mb-3">
  <Avatar initials={initials} color={color} />
  <div className="flex-1">
    <div className="text-sm font-semibold text-gray-800">{author}</div>
    <div className="text-xs text-gray-400">{time}</div>
  </div>
  <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
    {/* Three dots menu */}
  </button>
</div>
```

**Body text**:

```tsx
<p className="text-sm text-gray-700 leading-relaxed mb-3">{body}</p>
```

---

## Video Thumbnail

```tsx
<div className="relative bg-gray-100 rounded-xl h-48 flex items-center justify-center mb-3 overflow-hidden cursor-pointer group border border-gray-200">
  {/* Video icon */}
  <div className="absolute inset-0 flex items-center justify-center bg-black/5 group-hover:bg-black/10 transition-colors">
    <div className="w-12 h-12 rounded-full bg-white shadow-md flex items-center justify-center">
      {/* Play icon */}
    </div>
  </div>
  <div className="absolute bottom-2.5 left-3 text-[10px] text-gray-100 bg-gray-800/70 px-2 py-1 rounded">
    {filename}
  </div>
  {ticketId && (
    <div className="absolute top-2.5 right-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
      ticket #{ticketId}
    </div>
  )}
</div>
```

**Key patterns**:

- Height: `h-48`
- Play button: `w-12 h-12 rounded-full bg-white shadow-md`
- Filename badge: `text-[10px] bg-gray-800/70` (bottom-left)
- Ticket badge: `text-[10px] bg-amber-50 border-amber-200` (top-right)

---

## Ticket Embed

```tsx
<div className="border border-amber-200 rounded-xl overflow-hidden mb-3">
  {/* Header row */}
  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-100">
    <div className="w-5 h-5 rounded-md bg-amber-100 flex items-center justify-center shrink-0">
      {/* Ticket icon */}
    </div>
    <span className="text-xs font-medium flex-1 text-gray-800">{title}</span>
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-100 text-blue-600">
      {status}
    </span>
  </div>

  {/* Details row */}
  <div className="flex items-center gap-4 px-3 py-2 bg-white">
    <span className="text-xs text-gray-400 flex items-center gap-1">
      {/* Clock icon */} {time}
    </span>
    <span className="text-xs text-gray-400 flex items-center gap-1">
      {/* User icon */} {assignee}
    </span>
    <button className="ml-auto text-xs text-indigo-500 flex items-center gap-1 hover:text-indigo-700 transition-colors">
      Open {/* External link icon */}
    </button>
  </div>
</div>
```

**Colors**:

- Container: `border-amber-200`
- Header background: `bg-amber-50`
- Icon background: `bg-amber-100` (for ticket icon)
- Status badge: `bg-blue-100 text-blue-600`
- Details background: `bg-white`

---

## Action Bar

```tsx
<div className="flex items-center gap-0.5 py-2 border-t border-gray-100 -mx-1">
  {/* Like button */}
  <button className="flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
    {/* Heart icon */} {likeCount}
  </button>

  <div className="w-px h-4 bg-gray-200 mx-1" />

  {/* Comment button */}
  <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2.5 py-2 rounded-lg transition-colors">
    {/* Comment icon */} {commentCount}
  </button>

  <div className="w-px h-4 bg-gray-200 mx-1" />

  {/* Share button */}
  <button className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 px-2.5 py-2 rounded-lg transition-colors">
    {/* Share icon */}
  </button>

  {/* View count (right-aligned) */}
  <div className="ml-auto flex items-center gap-1 text-xs text-gray-300">
    {/* Eye icon */} {views}
  </div>
</div>
```

**Key patterns**:

- Dividers: `w-px h-4 bg-gray-200 mx-1`
- Buttons: `px-2.5 py-2 rounded-lg`, `gap-1.5` for icon spacing
- Liked state: `text-pink-500` (filled heart icon)
- Default state: `text-gray-400 hover:text-gray-600`

---

## Comments Section

**Container** (shown when `showComments` is true):

```tsx
<div className="pb-3 bg-gray-50 -mx-5 px-5 pt-3 border-t border-gray-100">
  {/* Existing comments */}
  {comments.map((c) => (
    <div key={c.id} className="flex gap-2 mb-2.5">
      <Avatar initials={c.initials} color={c.avatarColor} size="sm" />
      <div className="flex-1 bg-white border border-gray-200 rounded-t-none rounded-xl px-3 py-2">
        <div className="text-xs font-semibold text-gray-700 mb-0.5">{c.author}</div>
        <div className="text-xs text-gray-500 leading-relaxed">{c.text}</div>
        <div className="text-[10px] text-gray-300 mt-1">{c.time}</div>
      </div>
    </div>
  ))}

  {/* Comment input */}
  <div className="flex items-center gap-2 mt-3">
    <Avatar initials="PD" color="indigo" size="sm" />
    <input
      className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2 text-xs text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-400 transition-colors"
      placeholder="Reply..."
    />
    <button className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center hover:bg-indigo-600 transition-colors shrink-0">
      {/* Send icon (white) */}
    </button>
  </div>
</div>
```

**Key patterns**:

- Section background: `bg-gray-50` (extends beyond card with `-mx-5 px-5`)
- Comment bubbles: `rounded-t-none` for speech bubble effect
- Input: `rounded-full`, `focus:border-indigo-400`
- Send button: `w-8 h-8 bg-indigo-500`

---

## Typography Scale

| Element       | Class                   | Size |
| ------------- | ----------------------- | ---- |
| Page title    | `text-lg font-semibold` | 18px |
| Post author   | `text-sm font-semibold` | 14px |
| Post body     | `text-sm`               | 14px |
| Timestamp     | `text-xs`               | 12px |
| Button labels | `text-xs`               | 12px |
| Badges        | `text-[10px]`           | 10px |

---

## Color Palette

### Primary Actions

- **Indigo** (primary): `bg-indigo-500 hover:bg-indigo-600`, `text-indigo-500`, `border-indigo-300/400`
- **Pink** (like/favorite): `text-pink-500`

### Neutrals

- Background (page): `bg-gray-50`
- Background (cards): `bg-white`
- Background (input collapsed): `bg-gray-100`
- Border (light): `border-gray-100`
- Border (input): `border-gray-200`
- Text (primary): `text-gray-800`
- Text (secondary): `text-gray-700`
- Text (muted): `text-gray-400`
- Text (placeholder): `text-gray-300`

### Ticket Accent (Amber)

- Border: `border-amber-200`
- Background (header): `bg-amber-50`
- Icon background: `bg-amber-100`
- Text: `text-amber-600/700`

---

## Spacing Patterns

| Context                    | Class     | Value |
| -------------------------- | --------- | ----- |
| Page padding (horizontal)  | `px-5`    | 20px  |
| Section padding (vertical) | `py-3`    | 12px  |
| Card padding (top)         | `pt-4`    | 16px  |
| Element gap (small)        | `gap-1.5` | 6px   |
| Element gap (medium)       | `gap-2.5` | 10px  |
| Element gap (large)        | `gap-3`   | 12px  |
| Bottom margin (elements)   | `mb-3`    | 12px  |

---

## Interactive Behaviors

### Composer

1. **Collapsed → Expanded**: Entire container is clickable, onClick sets `expanded` state
2. **Post submission**: Validates non-empty text, creates new post, resets state
3. **Cancel**: Clears text, collapses composer

### PostCard

1. **Like toggle**: Button changes color to pink, increments/decrements count
2. **Comment toggle**: Expands/collapses comment section below action bar
3. **Comment submission**: Enter key or send button, adds comment to local state

### Video Thumbnail

- Hover: Darkens overlay (`bg-black/10`)
- Click: Would open video player (not implemented)

---

## Data Types

```typescript
interface Ticket {
  id: number;
  title: string;
  status: 'Open' | 'In progress';
  time: string;
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

interface Post {
  id: string;
  author: string;
  initials: string;
  avatarColor: AvatarColor;
  time: string;
  body: string;
  videoFile?: string;
  videoTicketId?: number;
  ticket?: Ticket;
  likes: number;
  comments: Comment[];
  views: number;
}

type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';
```

---

## Icon Sizes

All icons use consistent sizing within their context:

- Header buttons: `w-4 h-4`
- Action bar: `w-4 h-4` (or `w-3.5 h-3.5` for inline icons)
- Button labels: `w-3.5 h-3.5`
- Badge/embed icons: `w-3 h-3`

---

## Border Radius Scale

| Element                       | Class                     | Value  |
| ----------------------------- | ------------------------- | ------ |
| Page elements (cards, videos) | `rounded-xl`              | 12px   |
| Buttons (small)               | `rounded-lg`              | 8px    |
| Pills (inputs, chips)         | `rounded-full`            | 9999px |
| Avatars                       | `rounded-full`            | 9999px |
| Badges                        | `rounded` or `rounded-md` | 4-6px  |

---

## Implementation Notes for Phase 1

When building the Kerebron composer, preserve these patterns:

1. **Expand/collapse animation**: Consider using `motion` (Framer Motion) for smooth height transitions
2. **Textarea replacement**: Kerebron editor should match the textarea styling (`border-indigo-300`, `rounded-xl`, `min-h-20`)
3. **Button bar layout**: Use `flex-wrap` to handle long button lists gracefully
4. **Avatar consistency**: Reuse the existing `Avatar` component
5. **Ticket embed reuse**: Extract `TicketEmbed` into a shared component for use in picker preview
6. **Upload buttons**: Match the existing button style (`rounded-full`, icon + label)
7. **Focus states**: All interactive elements have `:hover` and `:focus` states
8. **Disabled states**: Post button uses `disabled:opacity-40 disabled:cursor-not-allowed`

---

**Last updated**: 2026-06-16 (extracted from Huddle.tsx)
