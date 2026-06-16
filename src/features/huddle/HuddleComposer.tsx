import { useState } from 'react';
import { useTeam } from '@lib/TeamContext';
import { TicketPicker } from './TicketPicker';
import { AttachmentBar } from './AttachmentBar';
import { MentionMenu } from './MentionMenu';
import type { ComposerContent, MediaItem } from './types';

interface HuddleComposerProps {
  onPost: (content: ComposerContent) => void;
  userInitials?: string;
  userColor?: 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';
}

export function HuddleComposer({
  onPost,
  userInitials = 'PD',
  userColor = 'indigo',
}: HuddleComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [mentions, setMentions] = useState<Array<{ userId: string; name: string }>>([]);
  const { selectedTeamId } = useTeam();

  const handleSubmit = () => {
    try {
      console.log('[HuddleComposer] handleSubmit called');
      console.log('[HuddleComposer] Current text:', text);
      console.log('[HuddleComposer] Current attachments:', attachments);
      
      if (!text.trim() && attachments.length === 0) {
        console.log('[HuddleComposer] No text or attachments, skipping');
        return;
      }

      console.log('[HuddleComposer] Submitting post with attachments:', attachments);

      onPost({
        text: text.trim() || '(Image post)',
        json: { text: text.trim() || '(Image post)' },
        ticketId: selectedTicketId,
        attachments,
        mentions,
      });

      // Reset state
      setText('');
      setExpanded(false);
      setSelectedTicketId(undefined);
      setAttachments([]);
      setMentions([]);
    } catch (error) {
      console.error('[HuddleComposer] Error in handleSubmit:', error);
      alert('Failed to post. Please try again.');
    }
  };

  const handleCancel = () => {
    setText('');
    setExpanded(false);
    setSelectedTicketId(undefined);
    setAttachments([]);
    setMentions([]);
  };

  const handleAttachmentAdd = (media: MediaItem) => {
    console.log('[HuddleComposer] Adding attachment:', media);
    setAttachments(prev => {
      const updated = [...prev, media];
      console.log('[HuddleComposer] Updated attachments:', updated);
      return updated;
    });
  };

  const handleAttachmentRemove = (mediaId: string) => {
    setAttachments(prev => prev.filter(m => m.id !== mediaId));
  };

  const handleMentionSelect = (userId: string, name: string) => {
    setMentions(prev => [...prev, { userId, name }]);
    // Insert @mention into text
    const mentionText = `@${name} `;
    setText(prev => prev + mentionText);
  };

  const avatarColorClasses = {
    indigo: 'bg-indigo-100 text-indigo-600',
    teal: 'bg-teal-100 text-teal-600',
    coral: 'bg-red-100 text-red-500',
    amber: 'bg-amber-100 text-amber-600',
    pink: 'bg-pink-100 text-pink-500',
    green: 'bg-green-100 text-green-600',
  };

  // Collapsed state
  if (!expanded) {
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-neutral-800 cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}>
          {userInitials}
        </div>
        <div className="flex-1 bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-full px-4 py-2.5 text-sm text-gray-400 dark:text-neutral-500">
          Share an update...
        </div>
        <button className="w-9 h-9 rounded-full bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-400 dark:text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    );
  }

  // Expanded state
  return (
    <div className="px-5 py-3 border-b border-gray-100 dark:border-neutral-700 bg-white dark:bg-neutral-800">
      <div className="flex gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold shrink-0 ${avatarColorClasses[userColor]}`}>
          {userInitials}
        </div>
        <div className="flex-1">
          {/* Text editor */}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            className="w-full bg-white dark:bg-neutral-800 border border-indigo-300 dark:border-indigo-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-neutral-200 placeholder:text-gray-300 dark:placeholder:text-neutral-600 outline-none resize-none leading-relaxed min-h-20"
          />

          {/* Selected ticket chip */}
          {selectedTicketId && (
            <div className="mt-2 inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-full px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
              </svg>
              Ticket #{selectedTicketId}
              <button
                onClick={() => setSelectedTicketId(undefined)}
                className="hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map(media => (
                <div
                  key={media.id}
                  className="relative bg-gray-100 dark:bg-neutral-700 border border-gray-200 dark:border-neutral-600 rounded-lg p-2 text-xs text-gray-600 dark:text-neutral-300 flex items-center gap-2"
                >
                  {media.filename}
                  <button
                    onClick={() => handleAttachmentRemove(media.id)}
                    className="text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Button bar */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <AttachmentBar onAttachmentAdd={handleAttachmentAdd} />

            {selectedTeamId && (
              <TicketPicker
                teamId={selectedTeamId}
                onSelect={setSelectedTicketId}
                selectedId={selectedTicketId}
              />
            )}

            {selectedTeamId && (
              <MentionMenu
                teamId={selectedTeamId}
                onSelect={handleMentionSelect}
              />
            )}

            <button
              onClick={handleCancel}
              className="text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-400 transition-colors ml-1"
            >
              Cancel
            </button>

            <button
              onClick={(e) => {
                console.log('[HuddleComposer] Post button clicked');
                e.preventDefault();
                e.stopPropagation();
                handleSubmit();
              }}
              disabled={!text.trim() && attachments.length === 0}
              className="ml-auto text-xs font-semibold px-4 py-1.5 rounded-full bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
