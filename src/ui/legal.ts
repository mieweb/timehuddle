/**
 * Where the Terms of Use and Privacy Policy live, and the app's words for
 * them, in one place until the app has i18n. Both pages are served by GitHub
 * Pages from `docs/`, so they open without signing in and match what the
 * store listings link to.
 */
const LEGAL_BASE_URL = 'https://mieweb.github.io/timehuddle';

export const TERMS_URL = `${LEGAL_BASE_URL}/terms.html`;
export const PRIVACY_URL = `${LEGAL_BASE_URL}/privacy.html`;

export const LEGAL_TEXT = {
  terms: 'Terms of Use',
  privacy: 'Privacy Policy',
  /** Before the links on the sign-in and sign-up screens. */
  agreeBefore: 'By continuing, you agree to the',
  and: 'and',
  /** Said by screen readers, since the links open outside the app. */
  opensInNewTab: '(opens in a new tab)',
  termsHint: 'What you can post, and what happens when the rules are broken.',
  privacyHint: 'What we collect, how we use it, and your rights.',
  view: 'View',
} as const;
