# Meteor React Tailwind TypeScript Starter

**ALWAYS follow these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

This is a Meteor 3.4 + React 19 + Tailwind CSS 4 + TypeScript starter application with passwordless authentication and a real-time Todo example.

## Working Effectively

### Initial Setup and Dependencies

- **CRITICAL**: Install Meteor first: `curl https://install.meteor.com/ | sh`
  - If network restrictions prevent direct installation, use package managers or manual installation
  - Alternative: Use `npx meteor` for commands (may require Meteor package installation)
- Install Node.js dependencies: `npm ci --no-audit --no-fund` -- takes 30 seconds
- **NEVER CANCEL**: Wait for complete dependency installation

### Build and Development

- **NEVER CANCEL**: Development server startup: `meteor run` or `npm start` -- NEVER CANCEL, can take 2-5 minutes for initial build. Set timeout to 10+ minutes.
- **NEVER CANCEL**: Production build: `meteor build ../build --directory` -- NEVER CANCEL, takes 5-15 minutes. Set timeout to 30+ minutes.
- Development URL: `http://localhost:3000` (default Meteor port)

### Code Quality and Validation

- Lint check: `npm run lint` -- takes 4 seconds
- Lint fix: `npm run lint:fix` -- takes 3 seconds
- Type checking: `npm run typecheck` -- takes 5 seconds
- Format check: `npm run format` -- takes 2 seconds
- Format fix: `npm run format:fix` -- takes 1 second
- **ALWAYS run these before committing**: Pre-commit hooks will automatically run lint-staged

### Required Validation Steps

- **ALWAYS validate changes by**:
  1. Run `npm run lint` and `npm run typecheck` -- both must pass
  2. Run `npm run format` to ensure code style compliance
  3. Start the application with `meteor run` and test functionality
  4. **MANUAL VALIDATION REQUIRED**: Test the complete auth flow and Todo functionality

## Validation Scenarios

### Authentication Flow Testing

**ALWAYS test the passwordless auth flow after making auth-related changes:**

1. Start application: `meteor run`
2. Navigate to `http://localhost:3000`
3. Enter an email address and submit
4. Check server logs for magic link (if no SMTP configured)
5. Either click the link or copy the token from the URL and paste it manually
6. Verify successful login and Todo app access

### Todo Application Testing

**ALWAYS test Todo functionality after making UI or API changes:**

1. Create a new todo item
2. Toggle todo completion status
3. Delete a todo item
4. Test filtering (all/active/completed)
5. Test clearing completed todos
6. Verify real-time updates (open multiple browser tabs)

### Theme and UI Testing

**ALWAYS test theme switching and responsive design:**

1. Toggle between light and dark themes
2. Test responsive behavior on different screen sizes
3. Verify all UI components render correctly
4. Check accessibility with screen readers if available

## Configuration and Environment

### Environment Variables

- `MAIL_URL`: SMTP configuration for magic link emails (optional for development)
- `ROOT_URL`: Base URL for production deployment
- `PORT`: Server port (default: 3000)
- `MONGO_URL`: MongoDB connection string for production

### Development vs Production

- Development: Magic links logged to console (no SMTP required)
- Production: Requires SMTP configuration via `MAIL_URL`
- Build artifacts: Created in `../build` directory (outside project root)

## Project Structure and Navigation

### Core Directories

- `client/`: React application entry point and global styles
  - `main.tsx`: React root component and Meteor startup
  - `main.html`: HTML shell with root element
  - `styles.css`: Tailwind CSS imports and global styles
- `imports/`: Shared application code
  - `api/todos.ts`: Meteor methods, publications, and data model
  - `startup/`: Client and server startup configuration
  - `ui/`: React components and UI logic
- `server/main.ts`: Meteor server entry point
- Configuration files: `tsconfig.json`, `tailwind.config.cjs`, `eslint.config.mjs`

### Key Files to Modify

- **API Changes**: `imports/api/todos.ts` (methods and publications)
- **UI Components**: `imports/ui/` directory
- **Authentication**: `imports/startup/server.ts` (accounts configuration)
- **Styling**: `client/styles.css` and component files
- **Type Definitions**: Add to `imports/` subdirectories

### Common File Relationships

- When modifying `imports/api/todos.ts`, check `imports/ui/TodosApp.tsx` and `imports/ui/TodoItem.tsx`
- When changing theme variables, check `client/styles.css` and `tailwind.config.cjs`
- When adding UI components, update `imports/ui/index.ts` if creating a shared component library

## Build Pipeline and CI

### GitHub Actions Workflow

The `.github/workflows/ci.yml` validates:

1. Code linting with ESLint
2. Type checking with TypeScript
3. **NEVER CANCEL**: Full Meteor build -- takes 10-20 minutes. Set timeout to 45+ minutes.

### Local Development Workflow

1. Make code changes
2. Run validation: `npm run lint && npm run typecheck && npm run format`
3. Test manually: `meteor run` and validate user scenarios
4. Commit changes (pre-commit hooks will re-run validation)

## Technology Stack Details

### Meteor 3.4 (Node 22)

- Modern ESM module system
- Rspack build toolchain (faster than Webpack)
- Built-in MongoDB integration
- Real-time data synchronization via DDP

### React 19

- Concurrent features enabled
- Suspense for data fetching ready
- Modern hooks and error boundaries

### Tailwind CSS 4

- Oxide (Lightning CSS) engine
- Custom CSS variables for theming
- Utility-first styling approach

### TypeScript 5.x

- Strict mode enabled
- Path aliases configured (`@api/*`, `@ui/*`, etc.)
- Meteor type definitions included

## Troubleshooting

### Common Issues

- **Build fails**: Ensure Meteor is properly installed and Node.js version is 22+
- **Type errors**: Run `npm run typecheck` and fix TypeScript issues
- **Lint errors**: Run `npm run lint:fix` to auto-fix most issues
- **Style issues**: Run `npm run format:fix` to auto-format code
- **Database issues**: Meteor uses embedded MongoDB in development

### Network Restrictions

- If Meteor installation fails due to network restrictions, try alternative installation methods
- Document any installation workarounds in the instructions
- Use `npx meteor` as fallback if global installation unavailable

### Performance Notes

- **NEVER CANCEL**: Initial Meteor startup can take 2-5 minutes
- **NEVER CANCEL**: Meteor builds take 5-15 minutes (normal behavior)
- Hot module reloading works for most React changes
- Database changes may require server restart

## Testing (Currently No Test Framework)

This starter does not include a testing framework. To add testing:

- Consider `meteortesting:mocha` for Meteor-specific testing
- Jest can be added for pure JavaScript/React logic testing
- Playwright or Cypress for end-to-end testing

## Common Commands Reference

```bash
# Setup (one-time)
curl https://install.meteor.com/ | sh
npm ci --no-audit --no-fund

# Development
meteor run                    # Start dev server (2-5 min startup)
npm run lint                  # Check code style (4 sec)
npm run typecheck             # Check TypeScript (5 sec)
npm run format                # Check formatting (2 sec)

# Fixes
npm run lint:fix              # Auto-fix lint issues (3 sec)
npm run format:fix            # Auto-format code (1 sec)

# Production
meteor build ../build --directory  # Build for production (5-15 min)
```

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

## Production vs Development Mode

### 🚀 Environment Detection

- **Check `.env` for `MYNAME`**: Before testing, check if `MYNAME` is defined in the server `.env` file
- **If `MYNAME` is defined**: This indicates a production/proxy environment
  - Don't restart for UI changes; just build with `npm run build` in the client folder. If you need to restart the server, just ask the user to do it.
  - Use the `MYNAME` URL (e.g., `https://pulseclip.os.mieweb.org/`) for all browser testing
  - Do NOT use `localhost` URLs for testing - the app is behind an nginx proxy
- **If `MYNAME` is not defined**: Use development mode with `localhost:3000`

### 🔧 Testing Workflow

1. Read `server/.env` to check for `MYNAME` variable
2. If `MYNAME` exists, build and start the server: `npm run build && npm run start`
3. Navigate to the `MYNAME` URL for browser testing (not localhost)
4. The nginx proxy handles routing to the local server

## HTML & CSS Guidelines

- **Semantic Naming**: Every `<div>` and other structural element must use a meaningful, semantic class name that clearly indicates its purpose or role within the layout.
- **CSS Simplicity**: Styles should avoid global resets or overrides that affect unrelated components or default browser behavior. Keep changes scoped and minimal.
- **SASS-First Approach**: All styles should be written in SASS (SCSS) whenever possible. Each component should have its own dedicated SASS file to promote modularity and maintainability.

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
