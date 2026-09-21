import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge, Button, Input } from '@mieweb/ui';
import { AnchoredMenu } from '@ui/AnchoredMenu';
import { fetchTeamTickets } from './api';
import type { Ticket } from './types';

interface TicketPickerProps {
  teamId: string;
  onSelect: (ticketId: string) => void;
  selectedId?: string;
}

export function TicketPicker({ teamId, onSelect, selectedId }: TicketPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Re-fetches on every open (and if teamId resolves/changes while open) —
    // dropping the "already have tickets" guard is what fixes the picker
    // opening before TeamContext's async team resolution finishes, loading
    // an empty list for a stale/blank teamId that never gets retried.
    if (isOpen && teamId) {
      loadTickets();
    }
  }, [isOpen, teamId]);

  const loadTickets = async () => {
    console.log('[TicketPicker] loadTickets called, teamId:', teamId);

    if (!teamId) {
      console.error('[TicketPicker] Cannot load tickets: no teamId');
      return;
    }

    setLoading(true);
    try {
      console.log('[TicketPicker] Fetching tickets for team:', teamId);
      const data = await fetchTeamTickets(teamId);
      console.log(`[TicketPicker] Loaded ${data.length} tickets for team ${teamId}`);
      setTickets(data);
    } catch (error) {
      console.error('[TicketPicker] Failed to load tickets:', error);
      // Show user-friendly error
      setTickets([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (ticketId: string) => {
    onSelect(ticketId);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClose = useCallback(() => setIsOpen(false), []);

  const filteredTickets = tickets.filter((ticket) =>
    ticket.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        /* `ghost` + explicit border, not `outline`: outline draws from
           `border-current`, which tinted this chip orange while its siblings
           (Photo / Video / Doc / Pulse / @Mention) stayed neutral grey. */
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={!teamId}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        leftIcon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
            />
          </svg>
        }
        className="gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-normal text-gray-500 hover:bg-gray-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700"
      >
        Ticket
      </Button>

      <AnchoredMenu
        open={isOpen}
        onClose={handleClose}
        anchorRef={triggerRef}
        width={320}
        label="Attach a ticket"
        testId="ticket-picker-menu"
      >
        {/* Search input */}
        <div className="shrink-0 p-3 border-b border-gray-100 dark:border-neutral-700">
          <Input
            type="text"
            /* The menu is already labelled "Attach a ticket"; the field needs
               its own name without adding visible chrome. */
            label="Search tickets"
            hideLabel
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tickets..."
            className="text-xs"
          />
        </div>

        {/* Ticket list */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {loading ? (
            <div className="p-4 text-center text-xs text-gray-400 dark:text-neutral-500">
              Loading tickets...
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400 dark:text-neutral-500">
              No tickets found
            </div>
          ) : (
            filteredTickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(ticket.id)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 dark:focus-visible:ring-indigo-500 ${
                  selectedId === ticket.id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-700 dark:text-neutral-300'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
                    />
                  </svg>
                  <span className="flex-1 truncate min-w-0">{ticket.title}</span>
                  {ticket.status && (
                    <Badge
                      size="sm"
                      className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
                    >
                      {ticket.status}
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </AnchoredMenu>
    </>
  );
}
