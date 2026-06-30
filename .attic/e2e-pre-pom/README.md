# Archived E2E Tests (Pre-POM)

**Archived on**: 2026-06-30

**Reason**: Replaced with Page Object Model (POM) based testing infrastructure.

## What Was Here

- 11 Playwright E2E tests without POM pattern
- Direct DOM manipulation and hardcoded credentials
- Tests: api-token, clock-breaks, dashboard-hours, notification-deeplink, profile, pulsevault, screenshots, shift-reminder, tickets, timesheet-notifications, work
- Original `playwright.config.ts` configuration
- Test reports from previous runs

## Migration Notes

The new test infrastructure lives in `tests/e2e/` with:
- Page Object Models in `tests/e2e/pages/`
- Test user factory with role-based fixtures in `tests/e2e/fixtures/`
- Feature-based test organization in `tests/e2e/{feature}/`

Tests were not migrated 1:1. Instead, we rebuilt from scratch using:
1. Manual exploration with Playwright MCP to understand real selectors
2. POM pattern for reusability
3. Role-based test users (owner, admin, member) from seed data
4. Started with auth tests (login/signup) as foundation

## Future Work

Other feature tests (clock, tickets, profile, etc.) can be reimplemented in the new structure as needed, referencing these archived tests for coverage ideas but not copying implementation patterns.
