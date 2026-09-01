import { useState, useEffect, useRef, useCallback } from 'react';
import { AnchoredMenu } from '@ui/AnchoredMenu';
import { fetchTeamMembers } from './api';
import type { TeamMember } from './types';

interface MentionMenuProps {
  teamId: string;
  onSelect: (userId: string, name: string) => void;
}

export function MentionMenu({ teamId, onSelect }: MentionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && members.length === 0 && teamId) {
      loadMembers();
    }
  }, [isOpen, teamId]);

  const loadMembers = async () => {
    if (!teamId) return;

    setLoading(true);
    try {
      const data = await fetchTeamMembers(teamId);
      setMembers(data);
    } catch (error) {
      console.error('Failed to load team members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (userId: string, name: string) => {
    onSelect(userId, name);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClose = useCallback(() => setIsOpen(false), []);

  const filteredMembers = members.filter((member) =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={!teamId}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"
          />
        </svg>
        @Mention
      </button>

      <AnchoredMenu
        open={isOpen}
        onClose={handleClose}
        anchorRef={triggerRef}
        width={288}
        label="Mention a team member"
        testId="mention-menu"
      >
        {/* Search input — deliberately not autofocused: stealing focus on open
            scrolls the composer's scroll container to reveal the input, which
            reads as the editor jumping upward (and pops the mobile keyboard
            over the very list you're trying to pick from). */}
        <div className="shrink-0 p-3 border-b border-gray-100 dark:border-neutral-700">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members..."
            className="w-full bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs text-gray-700 dark:text-neutral-300 placeholder:text-gray-400 dark:placeholder:text-neutral-600 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Members list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-xs text-gray-400 dark:text-neutral-500">
              Loading members...
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400 dark:text-neutral-500">
              No members found
            </div>
          ) : (
            filteredMembers.map((member) => (
              <button
                key={member.id}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(member.id, member.name)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors text-gray-700 dark:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 dark:focus-visible:ring-indigo-500"
              >
                <div className="flex items-center gap-2">
                  {member.image ? (
                    <img
                      src={member.image}
                      alt={member.name}
                      className="w-6 h-6 rounded-full shrink-0"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
                      {member.name.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{member.name}</div>
                    <div className="text-[10px] text-gray-400 dark:text-neutral-500 truncate">
                      {member.email}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </AnchoredMenu>
    </>
  );
}
