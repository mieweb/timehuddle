# TimeHuddle UI/UX Redesign — Implementation Prompt

> Use this document as the instruction set for the actual implementation pass on
> `src/`. It is based on the approved layout/UX from
> [design/redesign-prototype/index.html](../design/redesign-prototype/index.html)
> and an audit of the real, existing app structure. **No feature, component, route,
> API call, or business logic may be removed.** This is a re-layout/re-skin pass:
> existing components get moved, restyled, and re-composed into the new
> structure — not rewritten from scratch, and not deleted.

## How To Execute This Prompt

Paste this whole file (or just the "Execution Plan" section below) to an
implementation agent, one step at a time, in order. Each step is small,
independently testable, and ends with a validation command. Do not start step
`N+1` until step `N`'s validation passes. Steps 1–8 are Phase 1 (mobile).
Steps 9–15 are Phase 2 (desktop). Steps 16–17 are final verification.

## Execution Plan (Step-by-Step)

**Phase 1 — Mobile**

1. [x] Confirm/adjust [BottomNav.tsx](../src/ui/BottomNav.tsx) tab set: Dashboard,
   Huddle, Clock (center FAB), Tickets, Teams. Move Settings behind the
   profile/overflow menu. Validate: `npm run typecheck` + manual tap-through
   at a 390×844 viewport.
2. [x] Locate the shared `Modal` primitive used across the app (`@mieweb/ui`
   `Modal`, or the app's own wrapper if one exists) and add/confirm a mobile
   bottom-sheet variant (slide up, full width, rounded top corners only,
   `max-h-[88vh]` with internal scroll). Apply it to: ticket create/detail
   modals, team edit modal, org edit modal, invite modal, confirm-delete
   modal. Validate: open each modal at mobile width, confirm slide-up behavior
   and that all existing buttons in them still work.
3. [x] Restyle [Huddle.tsx](../src/pages/Huddle.tsx) +
   [PostCard/](../src/features/huddle/PostCard/) for mobile: edge-to-edge
   cards, no side margins/radius, thin divider borders, composer pinned above
   the feed. Validate: create a post, confirm it still saves/renders via
   existing `HuddleComposer.tsx` + `api.ts` logic (no logic changes).
4. [x] In [DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx), make
   the stat card grid 2-column on mobile below the existing Me/Team toggle
   (toggle itself unchanged). Validate: numbers still populate correctly for
   both Me and Team modes.
5. [x] In [ClockPage.tsx](../src/features/clock/ClockPage.tsx), reorder to a
   single mobile column: status/timer → plan editor → clock button (full
   width). Validate: plan-first gate still blocks clock in/out without a
   plan/wrap-up (`useClockToggle.test.ts` must still pass).
6. [x] Restyle [TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx) filters
   as a horizontally scrollable chip row on mobile. Validate: filtering still
   returns correct results; GitHub/Redmine source badges still visible.
7. [x] Restyle [TeamsPage.tsx](../src/features/teams/TeamsPage.tsx),
   [OrganizationPage.tsx](../src/features/org/OrganizationPage.tsx), and
   [ProfilePage.tsx](../src/features/profile/ProfilePage.tsx) to single-column
   stacked layouts on mobile. Validate: edit/delete/invite actions on each
   still function.
8. [x] Confirm the app's toast/notification primitive renders full-width near the
   top on mobile. Validate: trigger a clock-in, ticket edit, and post-create
   toast; all appear correctly.
   → **Phase 1 done. Run `npm run lint && npm run typecheck && npm run test:all`,
   fix anything red, then stop and get sign-off before Phase 2.**

**Phase 2 — Desktop/Browser**

9. Confirm [Sidebar.tsx](../src/ui/Sidebar.tsx) `NAV` grouping matches:
   Workspace (Dashboard, Huddle, Clock, Tickets, Timesheet, Work), Manage
   (Teams, Organization, Media, Messages, Notifications, Activity). Reorder
   only — no items removed. Validate: every sidebar link still routes
   correctly.
10. Add the desktop centered-dialog variant to the same `Modal` primitive
    touched in step 2 (rounded on all corners, `max-w-md`/`max-w-lg`,
    click-outside-to-dismiss). Validate: same modals as step 2, now at full
    desktop width.
11. In `DashboardPage.tsx`, expand stat cards to a 4-column row inside a
    centered `max-w-4xl` column at desktop widths. Validate: layout doesn't
    break at 1280px/1440px/1920px.
12. Restyle the Huddle feed to a centered `max-w-2xl` column with visible
    card borders/radius and spacing at desktop widths. Validate: feed and
    composer still fully functional.
13. In `ClockPage.tsx`, cap the layout to a centered `max-w-2xl` column at
    desktop widths. Validate: plan-first gate still enforced.
14. Restyle Tickets/Teams/Organization/Profile pages to centered
    `max-w-3xl`/`max-w-4xl` columns with filters in a single horizontal row
    at desktop widths. Validate: all CRUD actions still function.
15. Confirm toasts shrink-to-content and center at desktop widths.
    → **Phase 2 done. Run `npm run lint && npm run typecheck && npm run test:all`.**

**Final Verification**

16. Manual pass: open every item in both nav bars (mobile bottom nav +
    desktop sidebar) at both a mobile viewport and full desktop width;
    confirm no dead links, no missing pages, no broken buttons.
17. Confirm every acceptance criterion in the "Acceptance Criteria" section
    below is checked off before calling this complete.

## Hard Constraints

- Do not delete any file in `src/features/**` or `src/ui/**` unless it becomes a
  literal duplicate after merging (confirm with the user first either way).
- Do not remove any route in [src/ui/router.ts](../src/ui/router.ts) or any page
  currently reachable from [src/ui/Sidebar.tsx](../src/ui/Sidebar.tsx) /
  [src/ui/BottomNav.tsx](../src/ui/BottomNav.tsx). If a page's *content* moves
  inside another page (e.g. tabs), the route can redirect/alias — it must not 404.
  keep all existing lower level components
- Every existing `@mieweb/ui` usage stays `@mieweb/ui`. Do not introduce raw
  `<button>`/`<input>`/`<table>` while doing this pass.
- Preserve all existing plan-first clock gate logic in
  [src/lib/useClockToggle.ts](../src/lib/useClockToggle.ts) and
  [src/features/clock/ClockPage.tsx](../src/features/clock/ClockPage.tsx) exactly
  as-is — only its visual placement/composition changes.
- Work in two clearly separated phases and land them as separate PRs:
  **Phase 1 = mobile view**, **Phase 2 = browser/desktop view**. Shared
  components touched in Phase 1 must not regress desktop until Phase 2 lands
  (verify with responsive breakpoints, not separate code paths).
- Run `npm run lint && npm run typecheck && npm run test:all` after each phase.

## Existing Component Inventory (do not lose these)

| Area | Existing files (keep & reposition) |
|---|---|
| Shell/Nav | [AppLayout.tsx](../src/ui/AppLayout.tsx), [Sidebar.tsx](../src/ui/Sidebar.tsx), [BottomNav.tsx](../src/ui/BottomNav.tsx), [AppHeader.tsx](../src/ui/AppHeader.tsx), [OrgTeamSwitcher.tsx](../src/ui/OrgTeamSwitcher.tsx), [UserDropdown.tsx](../src/ui/UserDropdown.tsx), [CommandPalette.tsx](../src/ui/CommandPalette.tsx), [ThemeToggle.tsx](../src/ui/ThemeToggle.tsx) |
| Dashboard | [DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx) |
| Clock/Time | [ClockPage.tsx](../src/features/clock/ClockPage.tsx), [TimesheetPage.tsx](../src/features/clock/TimesheetPage.tsx), [TimesheetRow.tsx](../src/features/clock/TimesheetRow.tsx), [AttachmentsPanel.tsx](../src/features/clock/AttachmentsPanel.tsx), [ClockInHeaderTimer.tsx](../src/ui/ClockInHeaderTimer.tsx), [Timer.tsx](../src/ui/Timer.tsx), [TimerToggleButton.tsx](../src/ui/TimerToggleButton.tsx), [TodayStatusCard.tsx](../src/features/timers/TodayStatusCard.tsx), [WorkPage.tsx](../src/features/timers/WorkPage.tsx) |
| Huddle (feed) | [Huddle.tsx](../src/pages/Huddle.tsx), [HuddleComposer.tsx](../src/features/huddle/HuddleComposer.tsx), [MarkdownEditor.tsx](../src/features/huddle/MarkdownEditor.tsx), [MarkdownContent.tsx](../src/features/huddle/MarkdownContent.tsx) & [ui/MarkdownContent.tsx](../src/ui/MarkdownContent.tsx), [MentionMenu.tsx](../src/features/huddle/MentionMenu.tsx), [PostCard/](../src/features/huddle/PostCard/), [DraftsPanel.tsx](../src/features/huddle/DraftsPanel.tsx), [AttachmentBar.tsx](../src/features/huddle/AttachmentBar.tsx), [PulseAttachButton.tsx](../src/features/huddle/PulseAttachButton.tsx), [TicketPicker.tsx](../src/features/huddle/TicketPicker.tsx), [HuddleComments/](../src/features/huddle/HuddleComments/) |
| Tickets | [TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx), [TicketDetailPage.tsx](../src/features/tickets/TicketDetailPage.tsx), [githubIssue.ts](../src/features/tickets/githubIssue.ts) (GitHub sync), [CompactTicketList.tsx](../src/features/profile/CompactTicketList.tsx) |
| Teams | [TeamsPage.tsx](../src/features/teams/TeamsPage.tsx), [TeamChart.tsx](../src/features/teams/TeamChart.tsx), [AdminTimesheetPanel.tsx](../src/features/teams/AdminTimesheetPanel.tsx), [AdminDayGroup.tsx](../src/features/teams/AdminDayGroup.tsx), [PendingJoinRequests.tsx](../src/features/teams/PendingJoinRequests.tsx) |
| Organization | [OrganizationPage.tsx](../src/features/org/OrganizationPage.tsx), [OrganizationOverviewPage.tsx](../src/features/org/OrganizationOverviewPage.tsx), [OrganizationMembersPage.tsx](../src/features/org/OrganizationMembersPage.tsx), [OrganizationChart.tsx](../src/features/org/OrganizationChart.tsx), [TeamMembersView.tsx](../src/features/org/TeamMembersView.tsx), [EnterprisePage.tsx](../src/features/enterprise/EnterprisePage.tsx) |
| Profile | [ProfilePage.tsx](../src/features/profile/ProfilePage.tsx), [ProfileWorkSnapshot.tsx](../src/features/profile/ProfileWorkSnapshot.tsx), [ProfileFeed.tsx](../src/features/profile/ProfileFeed.tsx), [ProfileActivityFeed.tsx](../src/features/profile/ProfileActivityFeed.tsx), [ProfileNotices.tsx](../src/features/profile/ProfileNotices.tsx), [ProfileAvatarCropModal.tsx](../src/features/profile/ProfileAvatarCropModal.tsx), [WorkSummaryTags.tsx](../src/features/profile/WorkSummaryTags.tsx), [UsernameBadge.tsx](../src/features/profile/UsernameBadge.tsx) |
| Inbox/Messages/Notifications | [InboxPage.tsx](../src/features/inbox/InboxPage.tsx), [MessagesPage.tsx](../src/features/messages/MessagesPage.tsx), [NotificationsPage.tsx](../src/features/notifications/NotificationsPage.tsx), [ShiftReminderContext.tsx](../src/features/notifications/ShiftReminderContext.tsx) |
| Media | [MediaPage.tsx](../src/features/media/MediaPage.tsx), [PulseUploadButton.tsx](../src/features/media/PulseUploadButton.tsx), [PulseUploadModal.tsx](../src/features/media/PulseUploadModal.tsx) |
| Activity/Settings/Auth | [ActivityLogPage.tsx](../src/features/activity/ActivityLogPage.tsx), [SettingsPage.tsx](../src/ui/SettingsPage.tsx), [LoginForm.tsx](../src/ui/LoginForm.tsx), [LandingPage.tsx](../src/ui/LandingPage.tsx) |
| Feedback/Seeder (internal tools, keep as-is, low priority for redesign) | [FeedbackModal.tsx](../src/features/feedback/FeedbackModal.tsx), [ReportIssueModal.tsx](../src/features/feedback/ReportIssueModal.tsx), [SeederPage.tsx](../src/features/seeder/SeederPage.tsx) |

## Mapping: Prototype Concept → Real Component To Reuse

| Prototype screen | Real component(s) to slot in (do not recreate) |
|---|---|
| `MyDashboard` / `TeamDashboard` toggle | [DashboardPage.tsx](../src/features/dashboard/DashboardPage.tsx) — add a personal/team tab inside this existing page instead of building a new one |
| `ClockPage` plan-gated clock in/out | [ClockPage.tsx](../src/features/clock/ClockPage.tsx) + [useClockToggle.ts](../src/lib/useClockToggle.ts) (logic untouched) + [TodayStatusCard.tsx](../src/features/timers/TodayStatusCard.tsx) for the at-a-glance status |
| `Huddle` Instagram-style feed | [Huddle.tsx](../src/pages/Huddle.tsx) page shell + [PostCard/](../src/features/huddle/PostCard/) + [HuddleComposer.tsx](../src/features/huddle/HuddleComposer.tsx) + [MarkdownEditor.tsx](../src/features/huddle/MarkdownEditor.tsx) (this *is* your Kerberon-style editor already) |
| `Tickets` list + filters + GitHub/Redmine badges | [TicketsPage.tsx](../src/features/tickets/TicketsPage.tsx), [TicketDetailPage.tsx](../src/features/tickets/TicketDetailPage.tsx), [githubIssue.ts](../src/features/tickets/githubIssue.ts) |
| `Teams` list + detail + roles | [TeamsPage.tsx](../src/features/teams/TeamsPage.tsx), [PendingJoinRequests.tsx](../src/features/teams/PendingJoinRequests.tsx), [TeamChart.tsx](../src/features/teams/TeamChart.tsx) |
| `OrgSettings` | [OrganizationPage.tsx](../src/features/org/OrganizationPage.tsx), [OrganizationMembersPage.tsx](../src/features/org/OrganizationMembersPage.tsx), [OrganizationOverviewPage.tsx](../src/features/org/OrganizationOverviewPage.tsx) |
| `ProfilePage` | [ProfilePage.tsx](../src/features/profile/ProfilePage.tsx) + its sub-widgets |
| Nav shell (bottom tabs / sidebar) | [BottomNav.tsx](../src/ui/BottomNav.tsx) (mobile) + [Sidebar.tsx](../src/ui/Sidebar.tsx) (desktop) — **already split this way**; redesign only changes tab set, ordering, and visual density, not the mobile/desktop split mechanism |
| Toasts | check for existing toast/notification primitive in `@mieweb/ui` first; reuse it instead of introducing a new one |

Pages that exist in the real app but had no prototype equivalent (Timesheet,
Work, Inbox, Messages, Notifications, Activity Log, Media Library, Enterprise,
Command Palette, Seeder) **must still be reachable** — fold them into the new
nav as secondary items (e.g. under an overflow/"More" menu on mobile, under a
"Manage" section on desktop sidebar, matching the existing `Sidebar.tsx`
`NAV` grouping) rather than dropping them.

---

## Phase 1 — Mobile View Changes

1. **Nav shell**: Confirm [BottomNav.tsx](../src/ui/BottomNav.tsx) tab set matches
   the prototype's 5-tab priority (Dashboard, Clock, Huddle, Tickets, Teams).
   Currently it's Home/Tickets/Clock(FAB)/Teams/Settings — decide with the user
   whether Huddle replaces Settings on the bar (move Settings into the
   profile/overflow menu) since Huddle is a core daily-use feature per the
   prototype. Keep the center FAB clock pattern — it already matches the
   prototype's "big single-tap clock" idea.
2. **Modals → bottom sheets**: Any modal opened from a mobile viewport
   (ticket create/detail, team edit, org edit, invite, confirm-delete) should
   slide up from the bottom, full-width, rounded top corners, capped at ~88vh
   with internal scroll — mirror the prototype's `Modal` component behavior.
   Locate the shared modal primitive in `@mieweb/ui` (`Modal`) and adjust its
   mobile variant/props rather than forking a new component.
3. **Huddle feed**: On mobile, [Huddle.tsx](../src/pages/Huddle.tsx) +
   [PostCard/](../src/features/huddle/PostCard/) should render edge-to-edge
   (no side margins/radius), thin divider borders between posts, composer
   pinned above the feed — matching the prototype's full-bleed feed styling.
4. **Dashboard**: Stat widgets in `DashboardPage.tsx` collapse to a 2-column
   grid on mobile; single toggle (segmented control) to switch "Me" / "Team".
5. **Clock page**: Single-column stack — timer/status, plan editor, then the
   large clock in/out button, full width, in that order top-to-bottom.
6. **Tickets/Teams/Org/Profile pages**: Single-column stacked forms/lists;
   filters wrap into a horizontally scrollable chip row instead of a multi-row
   wrap, so filtering stays a one-thumb interaction.
7. **Toasts**: full-width, pinned near top, using the existing toast primitive.

## Phase 2 — Browser/Desktop View Changes

1. **Nav shell**: Keep [Sidebar.tsx](../src/ui/Sidebar.tsx) persistent, full
   labels. Reorder/group per the prototype priority (Workspace: Dashboard,
   Huddle, Clock, Tickets, Timesheet, Work; Manage: Teams, Organization, Media,
   Messages, Notifications, Activity) — this already matches the current
   `NAV` structure closely, so Phase 2 is mostly visual density + ordering
   confirmation, not a rebuild.
2. **Modals → centered dialogs**: Same modal primitive, desktop variant centers
   the dialog, rounded on all corners, `max-w-md`/`max-w-lg` depending on
   content (ticket detail wider, confirm-delete narrower).
3. **Dashboard**: Stat widgets expand to a 4-column row inside a centered
   `max-w-4xl` column; Me/Team toggle can be a top tab bar instead of a
   segmented control.
4. **Huddle feed**: Centered `max-w-2xl` column, visible card borders/radius,
   spacing between posts — not edge-to-edge like mobile.
5. **Clock page**: Centered `max-w-2xl` reading column so the editor doesn't
   stretch full width on wide monitors.
6. **Tickets/Teams/Org/Profile pages**: Centered `max-w-3xl`/`max-w-4xl`
   columns; filters sit in a single horizontal row since width allows it.
7. **Toasts**: shrink-to-content width, centered, not full-bleed.

---

## Acceptance Criteria

- [ ] No existing route, page, or feature is unreachable after either phase.
- [ ] All plan-first clock in/out gating behavior is unchanged (verify with
      [useClockToggle.test.ts](../src/lib/useClockToggle.test.ts)).
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:all` pass after each
      phase.
- [ ] Manual smoke test at `http://localhost:3000` in both a mobile viewport
      (DevTools device toolbar) and full desktop width for every nav item.
- [ ] Every interactive element (buttons, edit, delete, create) still works —
      no dead UI.
- [ ] All UI still uses `@mieweb/ui` primitives; no new raw HTML controls
      introduced.
