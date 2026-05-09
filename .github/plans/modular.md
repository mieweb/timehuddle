# Modular Plugin System

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Idea

TimeHuddle features should be buildable as self-contained modules that can be enabled or disabled per team or org. This keeps the core small and lets the product grow without every feature being mandatory for everyone.

---

## Core Concept

A **module** is a feature that can be toggled on or off. When disabled, its UI, routes, and data are hidden — but the core system is unaffected.

Examples of what would be modules:
- Dashboard
- Standups
- Timers
- Tickets
- Redmine integration
- GitHub integration
- Pulse Video

---

## What a Module Provides

- Its own frontend feature folder (`src/features/<module>/`)
- Its own backend routes and models (scoped, not global)
- A registration entry so the system knows it exists
- An enabled/disabled flag that can be toggled at the team or org level

---

## Open Questions

- Where does the enabled/disabled flag live — team settings, org settings, or both?
- Who can toggle a module — org admin, team admin, or any user?
- How does the frontend conditionally render nav items and routes?
- Do modules declare their own dependencies on other modules?
- Is there a module registry, or is it just a config object?

---

## Out of Scope (for Now)

- Third-party / community plugin marketplace
- Module versioning or compatibility contracts
- Hot-loading modules at runtime without a deploy
- Per-user module preferences
