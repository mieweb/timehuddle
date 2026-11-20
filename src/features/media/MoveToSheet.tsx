/**
 * Move to… (PLAN §5.1): where an unsent, failed or kept video goes instead.
 * The targets are any ticket the person can see, found by search (H5: every
 * ticket, Redmine- and GitHub-linked ones included, since each row on the
 * Tickets page is a TimeHuddle ticket), the open clock session, and My
 * library. The place the video is for now isn't offered again.
 *
 * A clock video whose clock action ran (O13) is never moved: the sheet only
 * says which clock-in or clock-out it belongs to.
 *
 * The page does the move (mediaActions.ts): a draft gets the new place and is
 * sent; a kept video is retargeted on the server, then dismissed.
 */
import {
  Button,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Text,
} from '@mieweb/ui';
import { ClipboardList, Clock, Library } from 'lucide-react';
import { useEffect, useId, useState, type ReactElement } from 'react';

import type { PulseUploadTypeInfo, Ticket } from '../../lib/api';
import { AppModal } from '../../ui/AppModal';
import { pulsePlace, type PulsePlace } from '../pulse-embed/place';
import { shouldSearchServer } from '../tickets/redmine/suggestions';
import { useTicketSearch } from '../tickets/redmine/useTicketSearch';
import { MEDIA_TEXT } from './mediaStrings';

const T = MEDIA_TEXT.move;

export interface MoveToSheetProps {
  open: boolean;
  /** The video's name, for the sheet's subtitle. */
  name: string;
  /** The key of the place it is for now (not offered again). */
  currentKey: string | null;
  /** Set for a clock-bound video: the sheet says this and offers nothing. */
  clockNote?: string | null;
  /** Who searches (tickets.search runs as them); null: no ticket search. */
  userId: string | null;
  /** The ticket type as the server offers it; null: tickets aren't offered. */
  ticketType: PulseUploadTypeInfo | null;
  /** The open clock session as a place; null when there is none. */
  session: PulsePlace | null;
  /** My library as a place; null when it isn't offered (a kept video is in it already). */
  library: PulsePlace | null;
  onPick: (place: PulsePlace) => void;
  onClose: () => void;
}

/** A ticket from the search as the place a video can go. */
export function ticketPlace(ticket: Ticket, type: PulseUploadTypeInfo | null): PulsePlace | null {
  return pulsePlace({
    type: 'ticket.video',
    ticketId: ticket.id,
    label: ticket.title,
    uploadType: type,
  });
}

function Target({
  icon,
  label,
  detail,
  onPick,
}: {
  icon: ReactElement;
  label: string;
  detail?: string;
  onPick: () => void;
}) {
  return (
    <li>
      <Button
        variant="ghost"
        fullWidth
        className="move-to-target h-auto justify-start gap-3 px-3 py-2 text-start"
        leftIcon={icon}
        onClick={onPick}
      >
        <span className="flex min-w-0 flex-col items-start">
          <span className="max-w-full truncate">{label}</span>
          {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        </span>
      </Button>
    </li>
  );
}

export function MoveToSheet({
  open,
  name,
  currentKey,
  clockNote = null,
  userId,
  ticketType,
  session,
  library,
  onPick,
  onClose,
}: MoveToSheetProps) {
  const titleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const searchable = !clockNote && !!ticketType && !!userId;
  const search = useTicketSearch(searchable && open ? userId : null, query);
  const asking = searchable && shouldSearchServer(query);
  const tickets = (asking ? search.tickets : [])
    .map((t) => ({ ticket: t, place: ticketPlace(t, ticketType) }))
    .filter(
      (t): t is { ticket: Ticket; place: PulsePlace } =>
        t.place !== null && t.place.context.key !== currentKey,
    );
  const elsewhere = [session, library].filter(
    (p): p is PulsePlace => p !== null && p.context.key !== currentKey,
  );

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>{T.title}</ModalTitle>
      </ModalHeader>
      <ModalBody className="move-to-sheet flex flex-col gap-4">
        {clockNote ? (
          <Text className="move-to-clock">{clockNote}</Text>
        ) : (
          <>
            <Text size="sm" variant="muted">
              {T.subtitle(name)}
            </Text>
            {searchable && (
              <section className="move-to-tickets flex flex-col gap-2" aria-labelledby={searchId}>
                <h3 id={searchId} className="text-sm font-medium">
                  {T.ticketsHeading}
                </h3>
                <Input
                  type="search"
                  label={T.searchLabel}
                  hideLabel
                  placeholder={T.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
                {!asking ? (
                  <Text size="xs" variant="muted">
                    {T.searchHint}
                  </Text>
                ) : !search.settled ? (
                  <div className="flex justify-center py-2" aria-busy="true">
                    <Spinner size="sm" label={T.searching} />
                  </div>
                ) : tickets.length === 0 ? (
                  <Text size="sm" variant="muted" role="status">
                    {T.noTickets}
                  </Text>
                ) : (
                  <ul className="flex flex-col gap-1" aria-label={T.ticketsHeading}>
                    {tickets.map(({ ticket, place }) => (
                      <Target
                        key={ticket.id}
                        icon={<ClipboardList className="size-4" aria-hidden />}
                        label={ticket.title}
                        onPick={() => onPick(place)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
            {elsewhere.length > 0 && (
              <section className="move-to-elsewhere flex flex-col gap-2">
                <h3 className="text-sm font-medium">{T.elsewhereHeading}</h3>
                <ul className="flex flex-col gap-1" aria-label={T.elsewhereHeading}>
                  {elsewhere.map((place) => (
                    <Target
                      key={place.context.key}
                      icon={
                        place.type === 'library.video' ? (
                          <Library className="size-4" aria-hidden />
                        ) : (
                          <Clock className="size-4" aria-hidden />
                        )
                      }
                      label={
                        place.type === 'library.video' ? T.library : T.session(place.context.label)
                      }
                      onPick={() => onPick(place)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {T.cancel}
        </Button>
      </ModalFooter>
    </AppModal>
  );
}
