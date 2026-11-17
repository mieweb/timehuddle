import React from 'react';

import { LEGAL_TEXT } from './legal';
import { linkClassName } from './linkify';

/**
 * A link to the Terms of Use or Privacy Policy. Opens outside the app — a new
 * tab on the web, the system browser in the phone apps — so a half-filled
 * sign-up form is still there when the reader comes back.
 */
export const LegalLink: React.FC<{
  href: string;
  children: React.ReactNode;
  /** What the link opens, when its visible text alone (e.g. "View") doesn't say. */
  name?: string;
}> = ({ href, children, name }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
    {children}
    <span className="sr-only">
      {name ? ` ${name}` : ''} {LEGAL_TEXT.opensInNewTab}
    </span>
  </a>
);
