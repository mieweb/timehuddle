/**
 * One video on the Unsent videos section (PLAN §5.1): its poster, name,
 * place, duration and age, its state chip (text and an icon, never colour
 * alone), and its ⋯ menu (Send, Move to…, Rename, Delete as its state allows,
 * rowActions.ts). Tapping the name opens the editor, the row's sheet or the
 * video's page, by state.
 *
 * Presentational: the section hands it the row and its facts.
 */
import {
  Button,
  Dropdown,
  DropdownItem,
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SendIcon,
  TrashIcon,
} from '@mieweb/ui';
import { Film } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';

import { rowChip } from '../pulse-embed/chips';
import type { PulseRow } from '../pulse-embed/mergeRows';
import { PulseChip } from '../pulse-embed/OnThisPhoneRows';
import { PULSE_EMBED_TEXT } from '../pulse-embed/pulseEmbedStrings';
import { MEDIA_TEXT } from './mediaStrings';
import { menuActions, rowTap, type MenuAction, type RowFacts } from './rowActions';

const T = MEDIA_TEXT;

const MENU: Record<MenuAction, { label: string; icon: ReactElement }> = {
  send: { label: T.action.send, icon: <SendIcon className="h-4 w-4" /> },
  move: { label: T.action.move, icon: <FolderIcon className="h-4 w-4" /> },
  rename: { label: T.action.rename, icon: <PencilIcon className="h-4 w-4" /> },
  delete: { label: T.action.delete, icon: <TrashIcon className="h-4 w-4" /> },
};

export interface UnsentVideoRowProps {
  row: PulseRow;
  facts: RowFacts;
  headless?: boolean;
  /** Now, for the row's age. */
  now: number;
  /** A tap on the row (editor, sheet or the video's page, by state). */
  onOpen: (row: PulseRow) => void;
  /** An item of its ⋯ menu. */
  onMenu: (action: MenuAction, row: PulseRow) => void;
}

export function UnsentVideoRow({
  row,
  facts,
  headless = false,
  now,
  onOpen,
  onMenu,
}: UnsentVideoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const name = row.name || T.row.untitled;
  const chip = rowChip(row, { headless });
  const menu = menuActions(facts);
  const tappable = rowTap(facts) !== 'nothing';
  const place = T.row.place(row.local?.context?.label ?? '');
  const recordedAt = row.local?.createdAt ?? row.sortAt;

  const choose = (action: MenuAction) => () => {
    setMenuOpen(false);
    trigger.current?.focus();
    onMenu(action, row);
  };

  return (
    <li className="unsent-video-row flex items-center gap-3" data-state={chip.state}>
      <div className="unsent-video-poster flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {row.localPoster ? (
          <img
            src={row.localPoster}
            alt={PULSE_EMBED_TEXT.rows.poster(name)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Film className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {tappable ? (
          <Button
            variant="link"
            size="sm"
            className="unsent-video-name h-auto max-w-full p-0 text-start"
            aria-label={T.row.open(name)}
            onClick={() => onOpen(row)}
          >
            {name}
          </Button>
        ) : (
          <span className="unsent-video-name max-w-full truncate text-sm font-medium">{name}</span>
        )}
        {place && (
          <span className="unsent-video-place max-w-full truncate text-xs text-muted-foreground">
            {place}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PulseChip chip={chip} />
          {row.durationMs != null && row.durationMs > 0 && (
            <span className="unsent-video-duration text-xs text-muted-foreground">
              {PULSE_EMBED_TEXT.rows.duration(row.durationMs)}
            </span>
          )}
          <span className="unsent-video-age text-xs text-muted-foreground">
            {T.row.age(now - recordedAt)}
          </span>
        </div>
      </div>
      {menu.length > 0 && (
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
          trigger={
            <Button
              ref={trigger}
              variant="ghost"
              size="icon"
              aria-label={T.row.more(name)}
              className="unsent-video-menu shrink-0"
            >
              <MoreHorizontalIcon className="h-5 w-5" />
            </Button>
          }
        >
          {menu.map((action) => (
            <DropdownItem
              key={action}
              icon={MENU[action].icon}
              variant={action === 'delete' ? 'danger' : undefined}
              onClick={choose(action)}
            >
              {MENU[action].label}
            </DropdownItem>
          ))}
        </Dropdown>
      )}
    </li>
  );
}
