# Organizations

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

> **NAMESPACE NOTE (PENDING):** Profile and org URL namespacing is intentionally not finalized yet. This plan should stay at a product/data-shape level until that decision is made.

## Namespace Decisions (Pending)

We are intentionally keeping this lightweight for now and deferring implementation detail.

- User public handles are expected to be globally unique.
- Org path strategy is still open (`/{orgSlug}` vs `/org/{orgSlug}`).
- Subdomains remain a future option, not a current commitment.
- Certain URL roots should be reserved or blocked for both user handles and org slugs
  (product/system routes, trust-sensitive names, and profanity/abuse terms).

## Signup And Identity Principles

To avoid awkward account states, signup should not require an email-first flow.
Users should be able to create an account directly with Google/GitHub and land
in a valid profile/org context immediately.

- **Social-first signup is valid**: Google/GitHub can be the first and only
  identity step at account creation.
- **Username is a product identity, not a provider identity**: provider emails
  and provider usernames can inform a default suggestion, but the TimeHuddle
  handle is the canonical URL identity.
- **URL identity is stable**: user profile URLs should resolve by canonical
  handle, and org URLs should resolve by canonical org slug once namespace
  decisions are finalized.
- **No silent account merges**: linking an external provider to an existing
  account should require explicit user intent when there is ambiguity.
- **One external account maps to one internal account**: this prevents account
  takeover and duplicate ownership oddities.
- **Personal org still applies**: first-time signup (email or social) should
  create or attach to the same personal-org model described in this plan.

This keeps onboarding simple now while preserving clean identity foundations for
future org routing and profile visibility features.

### Social Signup Flow (Google/GitHub)

For social-first signup, the expected flow is:

1. User selects **Continue with Google** or **Continue with GitHub**.
2. User completes provider auth/consent and returns to TimeHuddle.
3. User chooses/confirms canonical TimeHuddle username (and resolves any
  collisions or blocked names).
4. Account creation completes and user lands in personal-org context.

## The Problem

Today the data hierarchy is flat:

```
User ──belongs to──▶ Team
```

This works for small, single-company use. But the moment a company has multiple
departments, a consulting firm has multiple clients, or a platform wants to
resell TimeHuddle to many companies — the model breaks down. There is no
concept of "all teams at Acme Corp" or "billing for Acme as a whole" or
"Acme's admin manages all of Acme's teams."

An **Organization** layer solves this cleanly and unlocks a range of features
that simply cannot exist without it.

---

## Proposed Hierarchy

```
Organization
  ├── Settings (name, logo, billing, SSO config)
  ├── Org Admins (can manage all teams and members)
  └── Teams
        └── Members (users)
```

Users belong to an organization and are then members of one or more teams
within that organization. An org admin can see and manage all teams. A team
admin only manages their own team.

This mirrors how **GitHub Organizations**, **Slack Workspaces**, **Linear
Workspaces**, and **Google Workspace** are structured.

---

## What Organizations Unlock

| Feature | Why it needs Orgs |
|---------|------------------|
| Org-wide billing | One invoice per company, not per team |
| SSO / Google Workspace login | Auth is org-scoped, not team-scoped |
| Cross-team reporting | "Total hours across all teams at Acme this month" |
| Org-level capacity view | See all teams' utilization on one timeline |
| Shared member directory | People page across the whole org |
| Shared holiday calendars | One holiday config for all teams in the org |
| Org branding | Logo, theme, custom domain |
| ADP / payroll export | One export covers all teams in the org |

---

## Impact on Existing Data Model

Currently teams are top-level. Adding orgs means every team gets an `orgId`.
Every user gets an `orgId` (or a set of org memberships for consulting/agency
use cases where one person works for multiple orgs).

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string;          // URL-friendly, e.g. "acme-corp"
  logoUrl?: string;
  billingEmail: string;
  plan: 'free' | 'pro' | 'enterprise';
  ssoConfig?: SsoConfig; // future
  createdAt: Date;
}

interface OrgMembership {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

// Team gains orgId:
interface Team {
  // ... existing fields ...
  orgId: string;
}
```

---

## Migration Path

The migration from the current model is straightforward in concept:

1. Create a default org for every existing top-level team cluster
2. Associate all existing teams with their org
3. All existing users become org members with `role: 'member'`
4. Existing team admins remain team admins (not automatically org admins)

The trickiest part is "what is a cluster?" — today there is no org boundary, so
the migration would likely create one org per existing top-level admin or ask
users to self-organize during an onboarding flow.

---

## Google Workspace Integration (Future)

Google Workspace (formerly G Suite) is the most common SSO target for small-to-
mid-size teams. The integration would work at the org level:

- Org admin connects their Google Workspace domain to their TimeHuddle org
- Members sign in with their Google account — no separate password
- Member list can be pre-populated from the Google Workspace directory
- Google Calendar can sync time-off and blocked time entries (see
  [team-capacity.md](team-capacity.md))

**How it would work technically:**

```
Google Workspace Admin Console
  └── OAuth App Authorization (domain-wide)
        └── Better Auth Google Provider (already in stack)
              └── TimeHuddle Org SSO config
```

`better-auth` (already used for auth) supports Google OAuth out of the box.
The org-level piece is mapping a Google Workspace domain to a TimeHuddle org
so that `@acme.com` logins automatically join the Acme org.

**Future extensions:**
- Microsoft Entra ID (Azure AD) — same pattern, different provider
- SAML 2.0 / OIDC for enterprise SSO (Okta, OneLogin, etc.)
- SCIM provisioning — automatically create/deactivate users when they are
  added/removed in the IdP

---

## Org Roles

| Role | Can do |
|------|--------|
| `owner` | Everything — billing, SSO config, delete org, promote admins |
| `admin` | Create/delete teams, manage all members, run org-wide reports |
| `member` | Belongs to teams as assigned by team admins |

An org can have multiple `admin`s but should have at least one `owner`.

---

## Personal Orgs

For individual users or very small teams who don't need the org concept, a
**personal org** is auto-created on signup (similar to GitHub's personal
namespace). It behaves exactly like a regular org but is owned by the user and
cannot have additional org-level admins.

This means the org layer is always present in the data model — features built
on top of it work consistently without special-casing solo users.

### Personal Org First (Near-Term Direction)

To unblock GitHub login and clean profile/org URL identity quickly, personal
org support should ship before full multi-org capabilities.

- First successful signup (email, GitHub, or Google) creates one personal org.
- User handle and personal-org slug become the first namespace anchors.
- Team and org admin complexity can come later; namespace and identity should
  not wait for full org management.

This keeps onboarding fast while reducing future migration pressure.

---

## Open Questions

- **Multi-org users**: can one person belong to multiple orgs? (Consultants,
  contractors working for multiple companies.) If yes, how does the UI handle
  switching context?
- **Org slug / URL shape**: should org pages use `/{orgSlug}` or
  `/org/{orgSlug}`?
- **Subdomain strategy**: should subdomains (`acme.timehuddle.app`) be
  supported later as canonical or redirect-only?
- **Invitation flow**: does joining an org require an invite, or can anyone with
  a matching email domain join?
- **Data isolation**: are org data boundaries enforced at the DB level (separate
  collections) or application level (orgId filter on every query)?
- **Reserved and blocked names**: what baseline deny-list should apply to both
  user handles and org slugs (for example system routes, trademark-sensitive
  terms, and profanity/abuse patterns), and what moderation process updates it?
- **When to add it?**: adding orgs early is less painful than retrofitting.
  Even a minimal org layer (org exists, teams belong to org, no extra UI) would
  future-proof the data model without requiring a full org management UI upfront.

---

## Relationship to Other Plans

| Plan | How orgs affect it |
|------|--------------------|
| [team-capacity.md](team-capacity.md) | Org-level capacity timeline across all teams |
| [reporting.md](reporting.md) | Org-scoped reports (all teams, all members) |
| [exporters.md](exporters.md) | ADP export covers whole org's payroll |
| [standups.md](standups.md) | Org admin can see all team standups |
| [custom-fields.md](custom-fields.md) | Field schemas shared at org level, overridden per team |

---

## Possible Rollout Sequence

1. **Personal org + social signup foundation** — on first signup (including
  GitHub/Google), create personal org and establish canonical handle/slug
  identity; keep scope minimal and onboarding-focused
2. **Baseline org model** — add `Organization` + `OrgMembership`, add `orgId`
  to `Team`, and backfill existing users/teams into personal org defaults
3. **Org context in API** — all queries implicitly scope to the user's current
  org; enforced at middleware level
4. **Org settings page** — name, logo, member list, invite by email
5. **Org admin role** — promote members to org admin, org-wide team management
6. **Google Workspace SSO** — domain-level login, directory sync
7. **Org-wide reporting** — reports that span all teams in the org
8. **Billing** — plan tiers, seat counting, upgrade/downgrade flows
9. **Enterprise SSO** — SAML/OIDC, SCIM provisioning
