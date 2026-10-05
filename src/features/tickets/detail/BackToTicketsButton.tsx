/**
 * The "← TICKETS" pill at the top of a ticket page, shared by the Huddle ticket
 * page and the Redmine issue page so both look and behave the same.
 */
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, ButtonGroup } from '@mieweb/ui';
import React from 'react';

import { useRouter } from '../../../ui/router';

export const BackToTicketsButton: React.FC<{ actions?: React.ReactNode }> = ({ actions }) => {
  const { navigate } = useRouter();
  return (
    <ButtonGroup split className="ticket-detail-back mb-4 w-full">
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
      {actions}
    </ButtonGroup>
  );
};
