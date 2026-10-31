/**
 * VideoMenu — a video's ⋯ menu: Open video page and Copy link (to that page)
 * for anyone who can see it — the page is public, as playback is, so the link
 * works for whoever it's sent to — Rename (or Add a name) for its owner, and
 * Remove where the host lets the viewer take it off. The same menu on the
 * video's card and in Huddle's media view, so a video is renamed the same way
 * wherever it's watched: in place, where its name shows (VideoNameEditor), as
 * a message is edited. On a card the card does that; `VideoActions` does it
 * beside a title.
 */
import {
  Button,
  Dropdown,
  DropdownItem,
  ExternalLinkIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@mieweb/ui';
import React, { useState } from 'react';

import { useCopyLink } from '@lib/useCopyLink';
import { watchPath } from './artifact';
import { VideoNameEditor } from './VideoNameEditor';

/**
 * A button over a corner of the card (the ⋯ menu's trigger, and the card's expand):
 * no background, so it sits lightly on a poster, a shadow to keep it readable
 * on a bright one, thumb-sized on a touch screen.
 */
export const CORNER_BUTTON =
  'h-8 w-8 rounded-full bg-transparent pointer-coarse:h-10 pointer-coarse:w-10 [&_svg]:block! text-white/90 [filter:drop-shadow(0_0_1px_rgb(0_0_0/0.9))_drop-shadow(0_1px_3px_rgb(0_0_0/0.6))] hover:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-white';

/** User-facing copy, kept together for translation. */
export const VIDEO_MENU_COPY = {
  more: (video: string) => `More for ${video}`,
  open: 'Open video page',
  copyLink: 'Copy link',
  rename: 'Rename',
  addName: 'Add a name',
  remove: 'Remove',
};

interface VideoMenuProps {
  /** The video's PulseVault artifact id. */
  video: string;
  /** Its name now (null: none yet, so the menu offers Add a name). */
  name: string | null;
  /** What to call it in the button's label ("More for …"). */
  label: string;
  /** The viewer owns it: Rename, which edits the name in place there. The server checks ownership again. */
  onRename?: () => void;
  /** Where the host lets the viewer take it off: Remove. */
  onRemove?: () => void;
  /** Offer Open video page (default true; not on that page itself). */
  openable?: boolean;
}

export function VideoMenu({
  video,
  name,
  label,
  onRename,
  onRemove,
  openable = true,
}: VideoMenuProps) {
  const copyLink = useCopyLink();
  // Controlled: the library's menu doesn't close when an item is chosen.
  const [menuOpen, setMenuOpen] = useState(false);
  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  return (
    <>
      <Dropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        placement="bottom-end"
        trigger={
          // The library's Button sets its icon inline on a text line, 1.3px
          // low; CORNER_BUTTON makes it a block, dead centre.
          <Button
            variant="ghost"
            size="icon"
            aria-label={VIDEO_MENU_COPY.more(label)}
            className={CORNER_BUTTON}
          >
            <MoreHorizontalIcon className="h-5 w-5" />
          </Button>
        }
      >
        {openable && (
          // Outside the app shell (main.tsx mounts it), so a page load.
          <DropdownItem
            icon={<ExternalLinkIcon className="h-4 w-4" />}
            onClick={choose(() => window.location.assign(watchPath(video)))}
          >
            {VIDEO_MENU_COPY.open}
          </DropdownItem>
        )}
        <DropdownItem
          icon={<LinkIcon className="h-4 w-4" />}
          onClick={choose(() => void copyLink(watchPath(video)))}
        >
          {VIDEO_MENU_COPY.copyLink}
        </DropdownItem>
        {onRename && (
          <DropdownItem icon={<PencilIcon className="h-4 w-4" />} onClick={choose(onRename)}>
            {name ? VIDEO_MENU_COPY.rename : VIDEO_MENU_COPY.addName}
          </DropdownItem>
        )}
        {onRemove && (
          <DropdownItem
            variant="danger"
            icon={<TrashIcon className="h-4 w-4" />}
            onClick={choose(onRemove)}
          >
            {VIDEO_MENU_COPY.remove}
          </DropdownItem>
        )}
      </Dropdown>
    </>
  );
}

/**
 * A video's ⋯ menu beside its title (the media view, its own page), which
 * becomes the name's editor there on Rename and the menu again when done.
 */
export function VideoActions({
  renamable,
  onRenamed,
  ...menu
}: Omit<VideoMenuProps, 'onRename'> & {
  /** The viewer owns it: Rename. */
  renamable?: boolean;
  /** After a rename, with the name the server kept (null: none). */
  onRenamed?: (name: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <VideoNameEditor
      video={menu.video}
      name={menu.name}
      editing
      onEditingChange={setEditing}
      onRenamed={onRenamed}
      className="w-64 max-w-[60vw]"
    />
  ) : (
    <VideoMenu {...menu} onRename={renamable ? () => setEditing(true) : undefined} />
  );
}
