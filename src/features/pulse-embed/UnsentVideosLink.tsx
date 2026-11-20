/**
 * "Unsent videos (n)" (PLAN §5.1 Unsent videos): the link a ticket's Videos
 * card, the Clock page and the composer show while videos recorded there
 * haven't been sent, with the attention count (failed sends, and kept videos
 * not yet moved or dismissed) as a badge. Renders nothing at zero.
 *
 * Presentational: the caller counts (usePulseDrafts) and says where it goes.
 */
import { Badge, Button } from '@mieweb/ui';

import { PULSE_EMBED_TEXT } from './pulseEmbedStrings';

const T = PULSE_EMBED_TEXT.unsent;

export interface UnsentVideosLinkProps {
  /** Videos not yet sent. */
  count: number;
  /** Of those (and kept receipts), how many need the person. */
  attention?: number;
  onOpen: () => void;
  className?: string;
}

export function UnsentVideosLink({
  count,
  attention = 0,
  onOpen,
  className,
}: UnsentVideosLinkProps) {
  if (count <= 0 && attention <= 0) return null;
  return (
    <span className={`unsent-videos-link inline-flex items-center gap-2 ${className ?? ''}`.trim()}>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onOpen}>
        {T.link(count)}
      </Button>
      {attention > 0 && (
        <Badge size="sm" variant="danger" className="unsent-videos-attention">
          {T.attention(attention)}
        </Badge>
      )}
    </span>
  );
}
