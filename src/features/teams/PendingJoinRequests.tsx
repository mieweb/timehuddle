/**
 * PendingJoinRequests — Admin UI for managing team join requests.
 *
 * Displays all pending join requests for a team with approve/decline actions.
 */
import { faCheck, faTimes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

import { teamApi, type TeamJoinRequestWithUser } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { UserAvatar } from '../../ui/UserAvatar';

interface PendingJoinRequestsProps {
  teamId: string;
}

export const PendingJoinRequests: React.FC<PendingJoinRequestsProps> = ({ teamId }) => {
  const { refetchTeams } = useTeam();
  const [requests, setRequests] = useState<TeamJoinRequestWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const fetchRequests = useCallback(() => {
    setLoading(true);
    teamApi
      .getPendingJoinRequests(teamId)
      .then((r) => setRequests(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [teamId]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = useCallback(
    async (requestId: string) => {
      setProcessing((prev) => new Set(prev).add(requestId));
      try {
        await teamApi.approveJoinRequest(requestId);
        // Remove from local list
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        // Refresh teams to show new member
        refetchTeams();
      } catch (err) {
        console.error('Failed to approve request:', err);
      } finally {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [refetchTeams],
  );

  const handleDecline = useCallback(async (requestId: string) => {
    setProcessing((prev) => new Set(prev).add(requestId));
    try {
      await teamApi.declineJoinRequest(requestId);
      // Remove from local list
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err) {
      console.error('Failed to decline request:', err);
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="sm" label="Loading pending requests…" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Text variant="muted" size="sm" className="text-center">
          No pending join requests
        </Text>
      </div>
    );
  }

  return (
    <div className="py-1">
      <div className="mb-3">
        <Text variant="muted" size="xs" weight="semibold" className="uppercase tracking-widest">
          Pending Requests ({requests.length})
        </Text>
      </div>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {requests.map((request) => {
          const isProcessing = processing.has(request.id);
          const timeAgo = formatDistanceToNow(new Date(request.requestedAt), { addSuffix: true });

          return (
            <li key={request.id} className="flex items-center gap-3 py-3">
              <div className="flex-shrink-0">
                <UserAvatar name={request.user.name} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="medium" className="truncate">
                  {request.user.name}
                </Text>
                <Text variant="muted" size="xs" className="truncate">
                  {request.user.email}
                </Text>
                <Text variant="muted" size="xs" className="mt-0.5">
                  Requested {timeAgo}
                </Text>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDecline(request.id)}
                  disabled={isProcessing}
                  className="w-full sm:w-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <FontAwesomeIcon icon={faTimes} className="mr-1" />
                  Decline
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleApprove(request.id)}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  <FontAwesomeIcon icon={faCheck} className="mr-1" />
                  Approve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
