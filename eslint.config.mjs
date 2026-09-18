import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import pluginImport from 'eslint-plugin-import';
import path from 'node:path';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettier from 'eslint-plugin-prettier';

export default [
  {
    // Consolidated ignores (migrated from legacy .eslintignore file)
    ignores: [
      'dist',
      '**/dist/**',
      'backend/data/videos',
      'backend/data/videos/**',
      'node_modules',
      // pnpm's local content-addressable store — third-party package sources
      '.pnpm-store',
      '**/scheduler.worker.js',
      '_build',
      'build',
      'coverage',
      // Capacitor native project directories — generated, not linted
      'ios',
      'android',
      // Vendored git submodules — upstream code, not linted here
      'vendor',
      // Meteor PoC backend — built/linted by Meteor tooling
      'meteor-backend',
      // Playwright test reports — generated files
      'playwright-report',
      'test-results',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react,
      'react-hooks': hooks,
      '@typescript-eslint': ts,
      'jsx-a11y': jsxA11y,
      import: pluginImport,
      'simple-import-sort': simpleImportSort,
      prettier,
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: {
          project: [path.resolve('./tsconfig.json')],
        },
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prettier/prettier': 'off',
      'simple-import-sort/imports': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  {
    // @mieweb/ui is the source of these controls — see
    // .github/instructions/mieweb-ui.instructions.md. This stops NEW raw
    // controls entering src/; the grandfathered files below are listed
    // explicitly so the exemption list shrinks rather than drifts.
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="button"]',
          message: "Use <Button> from '@mieweb/ui' instead of a raw <button>.",
        },
        {
          // `type="file"` is exempt: it is the hidden picker behind a real
          // Button, never rendered, and Input does not expose `capture`.
          selector:
            'JSXOpeningElement[name.name="input"]:not(:has(JSXAttribute[name.name="type"][value.value="file"]))',
          message: "Use <Input> from '@mieweb/ui' instead of a raw <input>.",
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message: "Use <Select> from '@mieweb/ui' instead of a raw <select>.",
        },
        {
          selector: 'JSXOpeningElement[name.name="textarea"]',
          message: "Use <Textarea> from '@mieweb/ui' instead of a raw <textarea>.",
        },
      ],
    },
  },
  {
    /**
     * Grandfathered and genuinely-exempt files.
     *
     * Most entries are controls @mieweb/ui cannot express today rather than
     * work left undone: `Button` renders its children inside a single
     * `truncate` span over a horizontal `inline-flex`, so any control stacking
     * an icon over a label, or pairing a title with a description, collapses
     * to one clipped line. That covers the bottom-nav tabs and FAB, the "More"
     * sheet tiles, and the report-issue option rows.
     *
     * Tests render raw controls in mocks and fixtures by design.
     *
     * Track the rest in #538; delete entries as they migrate.
     */
    files: [
      'src/**/*.test.tsx',
      'src/features/clock/ClockPage.tsx',
      'src/features/dashboard/DashboardPage.tsx',
      'src/features/feedback/ReportIssueModal.tsx',
      'src/features/huddle/AttachmentBar.tsx',
      'src/features/huddle/ComposerAttachments.tsx',
      'src/features/huddle/HuddleComments/index.tsx',
      'src/features/huddle/HuddleComposer.tsx',
      'src/features/huddle/MentionMenu.tsx',
      'src/features/huddle/PostCard/index.tsx',
      'src/features/huddle/PulseAttachButton.tsx',
      'src/features/huddle/TicketPicker.tsx',
      'src/features/inbox/InboxPage.tsx',
      'src/features/notifications/NotificationsPage.tsx',
      'src/features/org/OrganizationChart.tsx',
      // Hidden file input, but spread as `{...mediaInputProps}` so the
      // `type="file"` exemption cannot see it statically.
      'src/features/profile/ProfileFeed.tsx',
      'src/features/profile/ProfilePage.tsx',
      'src/features/profile/UsernameBadge.tsx',
      'src/features/profile/WorkSummaryTags.tsx',
      'src/features/seeder/SeederPage.tsx',
      'src/features/teams/TeamsPage.tsx',
      'src/features/tickets/TicketDetailPage.tsx',
      'src/features/tickets/TicketsPage.tsx',
      'src/features/timers/TodayStatusCard.tsx',
      'src/features/timers/WorkPage.tsx',
      'src/pages/Huddle.tsx',
      'src/ui/BottomNav.tsx',
      'src/ui/CommandPalette.tsx',
      'src/ui/LandingPage.tsx',
      'src/ui/OrgTeamSwitcher.tsx',
      'src/ui/Sidebar.tsx',
      'src/ui/UserDropdown.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
