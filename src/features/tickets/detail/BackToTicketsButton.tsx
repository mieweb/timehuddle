/**
 * The "← TICKETS" pill at the top of a ticket page, shared by the Huddle ticket
 * page and the Redmine issue page so both look and behave the same.
 */
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button } from '@mieweb/ui';
import React from 'react';

import { useRouter } from '../../../ui/router';

export const BackToTicketsButton: React.FC = () => {
  const { navigate } = useRouter();
  return (
    <div className="ticket-detail-back mb-4">
      <Button
        variant="secondary"
        size="sm"
        aria-label="Back to tickets"
        className="rounded-full"
        leftIcon={<FontAwesomeIcon icon={faArrowLeft} size="sm" />}
        onClick={() => navigate('/app/tickets')}
      >
        TICKETS
      </Button>
    </div>
  );
};
