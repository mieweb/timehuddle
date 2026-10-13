/**
 * LinkifiedText — plain text someone typed, with its http(s) links clickable.
 *
 * For text that is not Markdown (a timesheet explanation, a decline note, a
 * bio): the text is shown exactly as typed and only the URLs in it become
 * links. Markdown fields use {@link ./MarkdownContent} instead, which links
 * bare URLs the same way.
 *
 * Never put this inside a button or another link: a link can't nest there.
 */
import React from 'react';

import { linkClassName, splitLinks } from './linkify';

export const LinkifiedText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {splitLinks(text).map((part, i) =>
      part.href ? (
        <a
          key={i}
          href={part.href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName}
        >
          {part.text}
        </a>
      ) : (
        <React.Fragment key={i}>{part.text}</React.Fragment>
      ),
    )}
  </>
);
