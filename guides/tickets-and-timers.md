---
title: Tickets and timers
summary: One table for your team's tickets and your Redmine issues, a shortlist called My Board, and a timer for each piece of work.
section: Using TimeHuddle
order: 30
---

The **Tickets** page is one table: your team's Huddle tickets, plus your Redmine issues if you have [connected Redmine](/docs/redmine). Source is a column and a filter, not a separate mode.

## Create a ticket

Press **New Ticket**. Give it a title; optionally a priority (low, medium, high or critical) and assignees. You are assigned by default, and anyone you add is notified. New tickets go straight onto your **My Board**.

Pasting a **GitHub issue or pull request URL** into the new-ticket dialog, or into the command palette (**⌘K** / **Ctrl+K**), creates a ticket from it.

A ticket moves through **open → in progress → blocked → reviewed → closed**. The Open/Closed switch above the table counts _reviewed_ as closed.

## Find a ticket

The search bar understands:

| Type     | Finds                           |
| -------- | ------------------------------- |
| words    | titles, references and links    |
| `#3fa2c` | a ticket by its reference       |
| `@dana`  | tickets assigned to Dana        |
| `@`      | any ticket that has an assignee |

Every column can also be sorted and filtered, and you can select several rows to act on them at once.

## My Board

Select the tickets you plan to work on and move them to **My Board** — your personal shortlist. Items stay on it until you take them off, even when they are closed or reassigned.

## Run a timer

Start a timer from a ticket's row, from My Board, or from the ticket's own page.

- **A timer needs an open shift.** If you are clocked out, TimeHuddle offers to clock you in first.
- **One at a time.** Starting a timer on another ticket stops the one that was running.
- **The team sees it.** Starting, switching and stopping a timer posts a one-line update to the Huddle — "Started #3fa2c: …" — so nobody needs to ask what you are on.
- **Breaks and clock-out stop it.** A break closes the session; resuming opens a new one. Clocking out stops the timer.

Time is kept per ticket, per day, and can hold several sittings. The **Work** page shows your week at a glance and each day's ticket time. Starting a timer on a previous day isn't possible, but you can copy the previous day's list of tickets forward.

## Shift time and ticket time differ

You can be clocked in without a timer running — answering a colleague, in a meeting — so your shift total is usually larger than your ticket total. That is expected. Only ticket time on Redmine issues is ever sent to Redmine.
