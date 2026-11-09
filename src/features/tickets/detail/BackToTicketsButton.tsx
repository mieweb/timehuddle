/**
 * The "‹ Tickets" back link at the top of a ticket page, shared by the Huddle
 * ticket page and the Redmine issue page so both look and behave the same.
 * Quiet on purpose: it is navigation, not one of the page's actions. It stays
 * at the top as the page scrolls, holding the page's own actions beside it.
 */
import { Button, ButtonGroup } from '@mieweb/ui';
import { ChevronLeft } from 'lucide-react';
import React from 'react';

import { useRouter } from '../../../ui/router';

export const BackToTicketsButton: React.FC<{ actions?: React.ReactNode }> = ({ actions }) => {
  const { navigate } = useRouter();
  // Pinned to the top of the page's scroller, edge to edge of its column (the
  // negative margins undo AppPage's padding), with the page blurred behind it.
  return (
    <div className="ticket-detail-back-bar sticky top-0 z-20 -mx-4 -mt-4 mb-4 bg-neutral-50/75 px-4 py-2 backdrop-blur-md md:-mx-6 md:-mt-6 md:px-6 dark:bg-neutral-950/75">
      <ButtonGroup split className="ticket-detail-back w-full">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Back to tickets"
          className="-ms-2 rounded-full ps-1 text-muted-foreground hover:text-foreground"
          leftIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          onClick={() => navigate('/app/tickets')}
        >
          Tickets
        </Button>
        {actions}
      </ButtonGroup>
    </div>
  );
};
