---
title: Redmine
summary: Connect your own Redmine account, time its issues in TimeHuddle, and send the hours back as Spent time when you say so.
section: Redmine
order: 50
---

Connect your Redmine account once, and the issues assigned to you appear in TimeHuddle beside your team's tickets — to find, to time, to create and to update. This guide is the user's view. The full reference, with the reasoning behind each rule, is in the repository: [redmine-integration.md](https://github.com/mieweb/timehuddle/blob/main/docs/redmine-integration.md) and [redmine-design.md](https://github.com/mieweb/timehuddle/blob/main/docs/redmine-design.md).

> TimeHuddle is the record of _how_ time was spent. Redmine's Spent time is a one-way summary of it — never an input.

## Connect your account

1. In Redmine, open **My account** and copy your **API access key**.
2. In TimeHuddle, open **Settings → Redmine** and paste it.

TimeHuddle confirms who you are in Redmine and remembers the link. The key is stored encrypted and is never sent back to the browser. Everything you do afterwards happens **as you**: Redmine applies your own permissions and records you as the author. There is no shared admin account.

## One table for everything

The Tickets page shows one table: your team's Huddle tickets and **your** Redmine issues — the ones assigned to you, plus any issue you have started a timer on. Source is a column and a filter, not a mode you switch into. Search, sorting, column filters and the Open/Closed switch work across both.

### Find any other issue

Click into the Tickets search bar and suggestions open beneath it: your assigned issues, plus ones you logged time on, worked on recently or watch, each marked with why it is there. The search bar understands:

- words from a title
- `#1234` — an issue number
- a pasted Redmine link
- `@name` — what someone is working on

From a suggestion you can open the issue, start a timer on it (**Shift+Enter**), or hide it for 15 days.

### My Board

Select the tickets and issues you plan to work on and move them to **My Board**, your personal shortlist. Anything on the board stays in your table even after the issue is closed or reassigned.

## Time an issue

Start a timer from a board row, a search suggestion, the Work page or the issue's own page. Starts, stops, breaks and several sittings in one day are all recorded.

- **A ticket timer needs an open shift.** If you are clocked out, TimeHuddle asks once, clocks you in, and then starts the timer you asked for.
- **Breaks are excluded automatically**: a break closes the running session, and resuming opens a new one.
- **Clocking out stops any running timer**, and so does the 8-hour auto clock-out — nothing runs overnight by accident.

### Two clocks, two numbers

|                   | What it measures                               | Sent to Redmine? |
| ----------------- | ---------------------------------------------- | ---------------- |
| **Shift clock**   | Your working day for a team, minus meal breaks | No               |
| **Ticket timers** | Time on one ticket or issue, per day           | Yes              |

You can be clocked in without a timer running, so the shift total is usually the larger one. Only ticket timers on Redmine issues reach Redmine.

## Send your hours

On the Clock page, once you are clocked out with no timer running, press **Send work entries to Redmine**. You get a summary first — one row per issue per day, the hours, and the Redmine activity each will be logged under, which you can change per row. Nothing is sent until you confirm.

- Entries are **created, never edited or deleted**. Correcting logged time is an administrative act in Redmine.
- **Unsent time from earlier days is included**, so forgetting to send on Monday doesn't lose Monday.
- Time you track on a day after sending it is offered again on its own, and goes to Redmine as a further entry.
- After each entry is created, TimeHuddle reads it back to confirm Redmine stored what was sent.
- If Redmine refuses an entry, you see why in Redmine's own words. **Never send** drops a row you don't want in Redmine; the time stays in TimeHuddle.
- Time logged in Redmine by hand is never changed or double-counted.

## Create and update issues

- **New Ticket** asks whether you want a TimeHuddle ticket or a Redmine issue. The Redmine form covers project, tracker, subject, description, assignee and priority.
- Each Redmine issue has **its own page inside TimeHuddle**. From it you can change status, priority, assignee and description, and start or stop its timer. The status list only offers the changes your Redmine role and the project's workflow allow.
- If someone changed the issue in Redmine after you opened it, your save is refused and you are offered a reload, so you can't quietly overwrite their edit.
- **Delete** removes an issue from your table and My Board. It never deletes anything in Redmine.

## What you need

- A Redmine account with a personal API key, and permission to **log time** on the projects you track against.
- To create or edit issues, the matching Redmine permissions (**Add issues** / **Edit issues**).
- Your administrator has connected TimeHuddle to your Redmine — see [Run it yourself](/docs/self-hosting#connect-redmine).

## Not in this version

- Tags and custom fields; Redmine comments, attachments and issue relations.
- Editing or deleting logged time, or deleting issues in Redmine, from TimeHuddle.
- Anything flowing back from Redmine into TimeHuddle's own data — issues are read live, not stored.
- Team-wide views of Redmine work: an issue is only ever read through one person's key.
- Logging Redmine time from a personal workspace, since a ticket timer requires a team shift.
- More than one Redmine instance per deployment.
