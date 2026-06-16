import { useState, useEffect, useRef } from 'react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && tickets.length === 0) {
      loadTickets();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

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

  const filteredTickets = tickets.filter(ticket =>
    ticket.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={!teamId}
        className="flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
        </svg>
        Ticket
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden z-50">
          {/* Search input */}
          <div className="p-3 border-b border-gray-100">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tickets..."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder:text-gray-400 outline-none focus:border-indigo-400 transition-colors"
            />
          </div>

          {/* Ticket list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-xs text-gray-400">Loading tickets...</div>
            ) : filteredTickets.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">No tickets found</div>
            ) : (
              filteredTickets.map(ticket => (
                <button
                  key={ticket.id}
                  onClick={() => handleSelect(ticket.id)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                    selectedId === ticket.id ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                    </svg>
                    <span className="flex-1 truncate">#{ticket.id} — {ticket.title}</span>
                    {ticket.status && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 shrink-0">
                        {ticket.status}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
