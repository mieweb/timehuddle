# TimeHuddle

**ALWAYS follow these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

This is a React 19 + Vite + Tailwind CSS 4 + TypeScript frontend application. The backend is a separate Fastify + MongoDB service located in `backend/`.

## Working Effectively

### Node Version

This project pins Node via `.nvmrc`. **Run `nvm use` before Node-related terminal commands (`node`, `npm`, `npx`, `pnpm`, `yarn`)** to ensure the correct Node version is active. Using the wrong version causes `package-lock.json` drift and CI failures.

```bash
nvm use          # activate the pinned version
node --version   # verify
```

If `nvm` is not available, check `.nvmrc` for the required version and install it before proceeding.

### Initial Setup and Dependencies

```bash
nvm use
npm install
```

### Build and Development

```bash
npm run dev      # Vite dev server — instant startup, port 3000
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

- Development URL: `http://localhost:3000`
- Connects to the backend API at `http://localhost:4000`

### Code Quality and Validation

```bash
npm run lint       # ESLint
npm run lint:fix   # ESLint auto-fix
npm run typecheck  # tsc --noEmit
npm run format     # Prettier check
npm run format:fix # Prettier auto-fix
npm test           # Vitest (run once)
npm run test:watch # Vitest watch mode
```

Pre-commit hooks (husky + lint-staged) run lint + format automatically.

### Required Validation Steps

1. `npm run test:all` — must pass at the end of every coding session before handing off
2. `npm run lint && npm run typecheck` — both must pass
3. `npm run format` — must be clean
4. Smoke-test in browser at `http://localhost:3000`

### Testing with MCP Browser

- Use MCP browser in Playwright if available to test functionality
- **Never close the browser** after running MCP browser commands unless explicitly asked
- Let the user interact with the browser after navigation or testing
- Only use `browser_close` when the user specifically requests it

## Reporting Issues

### GitHub Issue Titles

- **Use Title Case**: Capitalize all major words in issue titles (e.g., "Add Docker Compose for Full Local Development Stack")
- **No conventional commit prefixes**: Do not use `feat:`, `fix:`, `chore:` etc. in issue titles — those belong in commit messages, not issues
- **Be descriptive**: Titles should clearly convey the what, not the how

### Issue Body Structure

- **Overview**: One paragraph explaining the problem or goal
- **Current State**: Bullet list of how things work today
- **Proposed Changes**: Numbered sections with sub-bullets for each change
- **Acceptance Criteria**: Checkboxes (`- [ ]`) for each verifiable outcome
- **Out of Scope (for Now)**: Explicit list of what is intentionally excluded from this issue

## Project Structure

```
index.html              # Vite entry — mounts <div id="root">
src/
  main.tsx              # ReactDOM.createRoot entry point
  styles.css            # Tailwind 4 entry + brand token bridge (required)
  features/             # Feature-sliced modules (clock, teams, tickets, …)
  lib/                  # Shared utilities (api, TeamContext, useSession, …)
  ui/                   # Shell components (AppLayout, Sidebar, AppHeader, …)
```

### Path Aliases

| Alias    | Resolves to |
| -------- | ----------- |
| `@ui/*`  | `src/ui/*`  |
| `@lib/*` | `src/lib/*` |

### Key Files

- **Global styles**: `src/styles.css` — Tailwind 4 `@import`, brand tokens, dark-mode variant. **Do not remove.**
- **App shell**: `src/ui/AppLayout.tsx` — layout, sidebar, routing context
- **Routing**: client-side only via `RouterContext` (no React Router)
- **API calls**: `src/lib/api.ts` — fetch wrappers to the backend
- **Auth**: `src/lib/useSession.ts`

## Technology Stack

### Vite 8

- `@vitejs/plugin-react` (SWC)
- HMR — changes reflect instantly, no restart needed
- Build output: `dist/`

### React 19

- Concurrent features, Suspense
- `motion` (Framer Motion 12) for animations

### Tailwind CSS 4

- Oxide/Lightning CSS engine — **no `tailwind.config.js` required**
- Theme tokens via CSS variables in `client/styles.css`
- `@mieweb/ui` brand tokens mapped to Tailwind colors
- Dark mode via `data-theme="dark"` on `<html>`

### TypeScript 5.x

- Strict mode, `moduleResolution: Bundler`, `module: ESNext`

### Vitest

- Unit/integration tests alongside source files

## Styling Conventions

- **Tailwind utility classes** for layout, spacing, color — inline in JSX
- **`client/styles.css`** for global tokens and third-party overrides only
- **SASS/SCSS** can be added per-component (`Component.module.scss`) for complex vendor overrides where utility classes don't reach
- No global CSS beyond `client/styles.css`

## Troubleshooting

- **Blank page / API errors**: ensure the backend is running on port 4000
- **Type errors**: `npm run typecheck`
- **Lint errors**: `npm run lint:fix`
- **Style broken**: check `client/styles.css` imports are intact

## Code Quality Principles

### DRY (Don't Repeat Yourself)

- **Never duplicate code**: If you find yourself copying code, extract it into a reusable function
- **Single source of truth**: Each piece of knowledge should have one authoritative representation
- **Refactor mercilessly**: When you see duplication, eliminate it immediately
- **Shared utilities**: Common patterns should be abstracted into utility functions

### KISS (Keep It Simple, Stupid)

- **Simple solutions**: Prefer the simplest solution that works
- **Avoid over-engineering**: Don't add complexity for hypothetical future needs
- **Clear naming**: Functions and variables should be self-documenting
- **Small functions**: Break down complex functions into smaller, focused ones
- **Readable code**: Code should be obvious to understand at first glance

### Core Model Data Discipline

- **Persist domain data only**: Core persistence models should store canonical business data, not UI convenience values.
- **No display-only fallbacks in model shape**: Do not add fields that exist only as presentation fallbacks (for example, duplicated title snapshots) to core database models.
- **Resolve presentation at read time**: Compute or join display-friendly values in service/response layers rather than persisting redundant fallback fields.

### Folder Philosophy

- **Clear purpose**: Every folder should have a main thing that anchors its contents.
- **No junk drawers**: Don’t leave loose files without context or explanation.
- **Explain relationships**: If it’s not elegantly obvious how files fit together, add a README or note.
- **Immediate clarity**: Opening a folder should make its organizing principle clear at a glance.

### Frontend / Backend Code Barrier

- **Never import frontend code from the backend** and never import backend code from the frontend.
- **Shared logic belongs in `packages/`**: If both sides need the same utility, it lives in a scoped package (e.g. `packages/youtube/` as `@timehuddle/youtube`) — not duplicated, not cross-imported.
- **The backend owns data**: Persistence, validation, and business rules live in the backend. The frontend only consumes the API.
- **Public APIs only**: The frontend communicates with the backend exclusively through versioned HTTP endpoints — never by reaching into backend modules directly.

### Backend Architecture: Route → Controller → Service

Every backend feature must follow a strict three-layer separation:

| Layer          | Location                   | Responsibility                                              |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| **Route**      | `backend/src/routes/`      | Schema declaration, auth hooks, wires request to controller |
| **Controller** | `backend/src/controllers/` | Extracts params, calls service(s), formats reply            |
| **Service**    | `backend/src/services/`    | Business logic and database access — no Fastify types       |

**Rules:**

- **Routes never contain business logic.** They declare the Fastify schema, attach `preHandler`/`onRequest` hooks, and call exactly one controller method.
- **Controllers never touch the database directly.** They read from `req` (params, query, body, `req.user`), call service methods, and call `reply.send()` or `return`.
- **Services never import Fastify types.** They are plain async functions or classes that can be unit-tested without an HTTP context.
- **New routes always get a controller.** Do not add inline handler logic to a route file — extract it to `backend/src/controllers/<feature>.controller.ts` immediately.
- **Existing inline route handlers should be migrated to controllers** whenever they are touched.

```
// ✅ Correct
// routes/work-summary.ts  → calls workSummaryController.getByUser(req, reply)
// controllers/work-summary.controller.ts → calls workSummaryService.forUser(userId)
// services/work-summary.service.ts → queries MongoDB, returns data

// ❌ Wrong
// routes/work-summary.ts  → contains MongoDB queries inline
```

### Refactoring Guidelines

- **Continuous improvement**: Refactor as you work, not as a separate task
- **Safe refactoring**: Always run tests before and after refactoring
- **Incremental changes**: Make small, safe changes rather than large rewrites
- **Preserve behavior**: Refactoring should not change external behavior
- **Code reviews**: All refactoring should be reviewed for correctness

### Dead Code Management

- **Immediate removal**: Delete unused code immediately when identified
- **Historical preservation**: Move significant dead code to `.attic/` directory with context
- **Documentation**: Include comments explaining why code was moved to attic
- **Regular cleanup**: Review and clean attic directory periodically
- **No accumulation**: Don't let dead code accumulate in active codebase

### Performance Considerations

- **Lazy load features**: Use `React.lazy` and `Suspense` for route-level code splitting
- **Avoid unnecessary re-renders**: Prefer `useMemo` and `useCallback` only where measurable impact exists — don't pre-optimize
- **Bundle size**: Avoid importing entire libraries; prefer named imports
- **Backend queries**: Return only the fields the client needs; avoid over-fetching from the API

### Avoid Repetitive Code: DRY

Do this when it makes sense.

- **For Example**: Never call connection setup per-query.\*\* Guards like `ensureMongooseConnected()` repeated inside model helpers cause redundant readyState checks and risk duplicate connect attempts.
- Initialize all connections once in `bootstrap()` in `backend/src/server.ts`, before any request can arrive:
  ```typescript
  await connectDB(); // native MongoDB driver
  await ensureMongooseConnected(); // Mongoose (whenever any Mongoose model is in use)
  ```
- Model helpers then need no connection guards — queries run unconditionally.

### Mongoose vs Native MongoDB — When to Use Each

- **Mongoose**: Stateful or permissioned models with lifecycle hooks, instance methods, or enum enforcement (e.g. `Ticket`). Use `InferSchemaType` — no separate interface needed.
- **Native MongoDB driver**: Simple append/query models with no business rules (e.g. `ClockEvent`). Use a typed `interface` + collection accessor from `backend/src/models/index.ts`.

### Mongoose ESM Import Rule (Node 24)

Named imports from `mongoose` crash in ESM under Node 24 / Docker. Always use the default import then destructure:

```typescript
// ❌ Fails in Node 24 ESM
import { Schema, model, models } from 'mongoose';

// ✅ Correct
import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;
```

### Mongoose Schema — `_id` Type Pinning

`InferSchemaType` infers `_id` as `mongoose.Types.ObjectId`, which is incompatible with native driver filter types. Pin it explicitly when the model coexists with native driver queries:

```typescript
import { ObjectId } from 'mongodb';
export type Ticket = mongoose.InferSchemaType<typeof ticketSchema> & { _id: ObjectId };
```

### Mongoose Pre-Hook Signature (v8+)

Use `async function` with no `next` parameter — passing `next` causes a type error in Mongoose 8:

```typescript
// ❌ Type error in Mongoose 8
ticketSchema.pre('save', function (next) {
  next();
});

// ✅ Correct
ticketSchema.pre('save', async function () {
  this.updatedAt = new Date();
});
```

## HTML & CSS Guidelines

- **Semantic Naming**: Every `<div>` and other structural element must use a meaningful, semantic class name that clearly indicates its purpose or role within the layout.
- **CSS Simplicity**: Styles should avoid global resets or overrides that affect unrelated components or default browser behavior. Keep changes scoped and minimal.
- **Tailwind-first**: Use Tailwind utility classes for all layout, spacing, and color. Add per-component `.module.scss` files only for complex vendor overrides where utility classes don't reach.

## Accessibility (ARIA Labeling)

### Interactive Elements

- **All interactive elements** (buttons, links, forms, dialogs) must include appropriate ARIA roles and labels
- **Use ARIA attributes**: Implement aria-label, aria-labelledby, and aria-describedby to provide clear, descriptive information for screen readers
- **Semantic HTML**: Use semantic HTML wherever possible to enhance accessibility

### Dynamic Content

- **Announce updates**: Ensure all dynamic content updates (modals, alerts, notifications) are announced to assistive technologies using aria-live regions
- **Maintain tab order**: Maintain logical tab order and keyboard navigation for all features
- **Visible focus**: Provide visible focus indicators for all interactive elements

## Internationalization (I18N)

### Text and Language Support

- **Externalize text**: All user-facing text must be externalized for translation
- **Multiple languages**: Support multiple languages, including right-to-left (RTL) languages such as Arabic and Hebrew
- **Language selector**: Provide a language selector for users to choose their preferred language

### Localization

- **Format localization**: Ensure date, time, number, and currency formats are localized based on user settings
- **UI compatibility**: Test UI layouts for text expansion and RTL compatibility
- **Unicode support**: Use Unicode throughout to support international character sets

## Documentation Preferences

### Diagrams and Visual Documentation

- **Always use Mermaid diagrams** instead of ASCII art for workflow diagrams, architecture diagrams, and flowcharts
- **Use memorable names** instead of single letters in diagrams (e.g., `Engine`, `Auth`, `Server` instead of `A`, `B`, `C`)
- Use appropriate Mermaid diagram types:
  - `graph TB` or `graph LR` for workflow architectures
  - `flowchart TD` for process flows
  - `sequenceDiagram` for API interactions
  - `gitgraph` for branch/release strategies
- Include styling with `classDef` for better visual hierarchy
- Add descriptive comments and emojis sparingly for clarity

### Documentation Standards

- Keep documentation DRY (Don't Repeat Yourself) - reference other docs instead of duplicating
- Use clear cross-references between related documentation files
- Update the main architecture document when workflow structure changes

## Working with GitHub Actions Workflows

### Development Philosophy

- **Script-first approach**: All workflows should call scripts that can be run locally
- **Local development parity**: Developers should be able to run the exact same commands locally as CI runs
- **Simple workflows**: GitHub Actions should be thin wrappers around scripts, not contain complex logic
- **Easy debugging**: When CI fails, developers can reproduce the issue locally by running the same script

## Quick Reference

### Pull Request Philosophy

- **Smallest viable change**: Always make the smallest change that fully solves the problem.
- **Fewest files first**: Start with the minimal number of files required.
- **No sweeping edits**: Broad refactors or multi-module changes must be split or proposed as new components.
- **Isolated improvements**: If a change grows complex, extract it into a new function, module, or component instead of modifying multiple areas.
- **Direct requests only**: Large refactors or architectural shifts should only occur when explicitly requested.
- **Permission changes by need**: Add new permission arrangements only when they are required for the current task or explicitly requested.

## @mieweb/ui Usage

**HARD RULE: Every UI element MUST use `@mieweb/ui` imports. No raw `<button>`, `<input>`, `<select>`, `<table>`, or custom modal/card/badge markup.**
**Scope: This is an app-wide rule for all existing and new frontend screens, not a page-by-page preference.**

When touching UI code anywhere in the app:

- Prefer `@mieweb/ui` primitives for structure and interaction (`Card`, `CardHeader`, `CardContent`, `Button`, `Input`, `Select`, `Table`, `Modal`, `Badge`, `Spinner`, `Text`).
- Treat raw HTML wrappers (`<div>`, `<span>`) as layout glue only; avoid building custom UI controls or custom card/modal/table systems with plain markup.
- During refactors, migrate nearby legacy markup to `@mieweb/ui` components as part of the same change when safe.

Use this component mapping for ALL pages:

- `<button>` → `import { Button } from '@mieweb/ui'`
- `<input>` → `import { Input } from '@mieweb/ui'`
- modal divs → `import { Modal, ModalHeader, ModalBody, ModalFooter } from '@mieweb/ui'`
- card containers → `import { Card, CardHeader, CardContent } from '@mieweb/ui'`
- `<table>` → `import { Table, TableHeader, TableBody, TableRow, TableCell } from '@mieweb/ui'`
- badges/pills → `import { Badge } from '@mieweb/ui'`
- avatar circles → `import { Avatar } from '@mieweb/ui'`
- `<select>` → `import { Select } from '@mieweb/ui'`
- date pickers → `import { DateRangePicker } from '@mieweb/ui'`
- chat UI → `import { MessageBubble, MessageList, MessageComposer } from '@mieweb/ui'`
- loading → `import { Spinner } from '@mieweb/ui'`

**Before marking any page complete, verify: does it import from `@mieweb/ui`? If not, it's not done.**

### Code Quality Checklist

- [ ] **DRY**: No code duplication - extracted reusable functions?
- [ ] **KISS**: Simplest solution that works?
- [ ] **Minimal Changes**: Smallest viable change made for PR?
- [ ] **Naming**: Self-documenting function/variable names?
- [ ] **Size**: Functions small and focused?
- [ ] **Dead Code**: Removed or archived appropriately?
- [ ] **Accessibility**: ARIA labels and semantic HTML implemented?
- [ ] **I18N**: User-facing text externalized for translation?
- [ ] **Components**: All UI elements use `@mieweb/ui` components?
- [ ] **Lint**: Run linter if appropriate
- [ ] **Test**: Run tests
