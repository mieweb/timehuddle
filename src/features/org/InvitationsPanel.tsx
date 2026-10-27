/** InvitationsPanel — the People page's Pending invitations tab, for organization admins. */
import {
  Alert,
  Badge,
  Button,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { ApiError, orgApi, type OrganizationInvitation } from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { PEOPLE_STRINGS } from './peopleStrings';

const S = PEOPLE_STRINGS.invitations;

function statusVariant(
  status: OrganizationInvitation['status'],
): 'warning' | 'success' | 'outline' | 'danger' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'accepted':
      return 'success';
    case 'delivery_failed':
      return 'danger';
    default:
      return 'outline';
  }
}

export const InvitationsPanel: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const { selectedOrgId } = useTeam();
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) {
      setInvitations([]);
      return;
    }
    setLoading(true);
    try {
      setInvitations(await orgApi.getPendingInvitations(selectedOrgId));
    } catch {
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useRefresh(load);

  const revoke = async (invitationId: string) => {
    setRevokingId(invitationId);
    setError(null);
    try {
      await orgApi.revokeInvitation(invitationId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : PEOPLE_STRINGS.errors.revoke);
    } finally {
      setRevokingId(null);
    }
  };

  if (loading && invitations.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="sm" label={S.loading} />
      </div>
    );
  }

  return (
    <div className="invitations-panel space-y-4">
      {error && <Alert variant="danger">{error}</Alert>}
      <Table responsive>
        <TableHeader>
          <TableRow>
            <TableHead>{S.columns.email}</TableHead>
            <TableHead>{S.columns.status}</TableHead>
            <TableHead>{S.columns.sent}</TableHead>
            <TableHead>{S.columns.expires}</TableHead>
            <TableHead className="w-28">
              <span className="sr-only">{PEOPLE_STRINGS.members.actionsColumn}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>{inv.email}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(inv.status)}>{inv.status}</Badge>
              </TableCell>
              <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
              <TableCell>{new Date(inv.expiresAt).toLocaleDateString()}</TableCell>
              <TableCell>
                {inv.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(inv.id)}
                    isLoading={revokingId === inv.id}
                    disabled={revokingId === inv.id}
                    aria-label={S.revokeFor(inv.email)}
                    className="text-red-600 dark:text-red-400"
                  >
                    {S.revoke}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {invitations.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <Text size="sm" variant="muted" className="py-2">
                  {S.empty}
                </Text>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
