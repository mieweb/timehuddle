# TimeHuddle Frontend

**ALWAYS follow these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

This is a React 19 + Vite + Tailwind CSS 4 + TypeScript frontend application. The backend is a separate Fastify + MongoDB service located in `backend/`.

## Working Effectively

### Initial Setup and Dependencies

```bash
npm install
```

### Build and Development

```bash
npm run dev      # Vite dev server — instant startup, port 3000
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

- Development URL: `http://localhost:3000`
- Connects to `timecore` API at `http://localhost:4000`

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

1. `npm run lint && npm run typecheck` — both must pass
2. `npm run format` — must be clean
3. Smoke-test in browser at `http://localhost:3000`

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

| Alias | Resolves to |
|---|---|
| `@ui/*` | `src/ui/*` |
| `@lib/*` | `src/lib/*` |

### Key Files

- **Global styles**: `src/styles.css` — Tailwind 4 `@import`, brand tokens, dark-mode variant. **Do not remove.**
- **App shell**: `src/ui/AppLayout.tsx` — layout, sidebar, routing context
- **Routing**: client-side only via `RouterContext` (no React Router)
- **API calls**: `src/lib/api.ts` — fetch wrappers to `timecore`
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

## @mieweb/ui Usage

**HARD RULE: Every UI element MUST use `@mieweb/ui` imports. No raw `<button>`, `<input>`, `<select>`, `<table>`, or custom modal/card/badge markup.**

| Element | Import |
|---|---|
| `<button>` | `Button` |
| `<input>` | `Input` |
| modal | `Modal, ModalHeader, ModalBody, ModalFooter` |
| card | `Card, CardHeader, CardContent` |
| `<table>` | `Table, TableHeader, TableBody, TableRow, TableCell` |
| badge | `Badge` |
| avatar | `Avatar` |
| `<select>` | `Select` |
| loading | `Spinner` |

## Troubleshooting

- **Blank page / API errors**: ensure `timecore` is running on port 4000
- **Type errors**: `npm run typecheck`
- **Lint errors**: `npm run lint:fix`
- **Style broken**: check `client/styles.css` imports are intact

## Code Quality Principles

<!-- https://github.com/mieweb/template-mieweb-opensource/blob/main/.github/copilot-instructions.md -->

### 🎯 DRY (Don't Repeat Yourself)

- **Never duplicate code**: If you find yourself copying code, extract it into a reusable function
- **Single source of truth**: Each piece of knowledge should have one authoritative representation
- **Refactor mercilessly**: When you see duplication, eliminate it immediately
- **Shared utilities**: Common patterns should be abstracted into utility functions

### 💋 KISS (Keep It Simple, Stupid)

- **Simple solutions**: Prefer the simplest solution that works
- **Avoid over-engineering**: Don't add complexity for hypothetical future needs
- **Clear naming**: Functions and variables should be self-documenting
- **Small functions**: Break down complex functions into smaller, focused ones
- **Readable code**: Code should be obvious to understand at first glance

### 🧹 Folder Philosophy

- **Clear purpose**: Every folder should have a main thing that anchors its contents.
- **No junk drawers**: Don’t leave loose files without context or explanation.
- **Explain relationships**: If it’s not elegantly obvious how files fit together, add a README or note.
- **Immediate clarity**: Opening a folder should make its organizing principle clear at a glance.

### 🔄 Refactoring Guidelines

- **Continuous improvement**: Refactor as you work, not as a separate task
- **Safe refactoring**: Always run tests before and after refactoring
- **Incremental changes**: Make small, safe changes rather than large rewrites
- **Preserve behavior**: Refactoring should not change external behavior
- **Code reviews**: All refactoring should be reviewed for correctness

### ⚰️ Dead Code Management

- **Immediate removal**: Delete unused code immediately when identified
- **Historical preservation**: Move significant dead code to `.attic/` directory with context
- **Documentation**: Include comments explaining why code was moved to attic
- **Regular cleanup**: Review and clean attic directory periodically
- **No accumulation**: Don't let dead code accumulate in active codebase

### 🌐 Testing with MCP Browser

- Use MCP browser in Playwright if available to test functionality
- **Never close the browser** after running MCP browser commands unless explicitly asked
- Let the user interact with the browser after navigation or testing
- Only use `browser_close` when the user specifically requests it

## HTML & CSS Guidelines

- **Semantic Naming**: Every `<div>` and other structural element must use a meaningful, semantic class name that clearly indicates its purpose or role within the layout.
- **CSS Simplicity**: Styles should avoid global resets or overrides that affect unrelated components or default browser behavior. Keep changes scoped and minimal.
- **Tailwind-first**: Use Tailwind utility classes for all layout, spacing, and color. Add per-component `.module.scss` files only for complex vendor overrides where utility classes don't reach.

## Accessibility (ARIA Labeling)

### 🎯 Interactive Elements

- **All interactive elements** (buttons, links, forms, dialogs) must include appropriate ARIA roles and labels
- **Use ARIA attributes**: Implement aria-label, aria-labelledby, and aria-describedby to provide clear, descriptive information for screen readers
- **Semantic HTML**: Use semantic HTML wherever possible to enhance accessibility

### 📢 Dynamic Content

- **Announce updates**: Ensure all dynamic content updates (modals, alerts, notifications) are announced to assistive technologies using aria-live regions
- **Maintain tab order**: Maintain logical tab order and keyboard navigation for all features
- **Visible focus**: Provide visible focus indicators for all interactive elements

## Internationalization (I18N)

### 🌍 Text and Language Support

- **Externalize text**: All user-facing text must be externalized for translation
- **Multiple languages**: Support multiple languages, including right-to-left (RTL) languages such as Arabic and Hebrew
- **Language selector**: Provide a language selector for users to choose their preferred language

### 🕐 Localization

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

## Quick Reference

### 🪶 All Changes should be considered for Pull Request Philosophy

- **Smallest viable change**: Always make the smallest change that fully solves the problem.
- **Fewest files first**: Start with the minimal number of files required.
- **No sweeping edits**: Broad refactors or multi-module changes must be split or proposed as new components.
- **Isolated improvements**: If a change grows complex, extract it into a new function, module, or component instead of modifying multiple areas.
- **Direct requests only**: Large refactors or architectural shifts should only occur when explicitly requested.

## @mieweb/ui Usage

**HARD RULE: Every UI element MUST use `@mieweb/ui` imports. No raw `<button>`, `<input>`, `<select>`, `<table>`, or custom modal/card/badge markup.**
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
