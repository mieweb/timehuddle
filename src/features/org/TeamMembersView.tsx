import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, teamApi, type TeamMember } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';

interface TeamWithMembers {
  id: string;
  name: string;
  members: TeamMember[];
}

export const TeamMembersView: React.FC = () => {
  const { user } = useSession();
  const [teamsWithMembers, setTeamsWithMembers] = useState<TeamWithMembers[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadTeamsAndMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all teams first
      const allTeams = await teamApi.getTeams();

      if (allTeams.length === 0) {
        setTeamsWithMembers([]);
        return;
      }

      // Load members for each team
      const teamsData: TeamWithMembers[] = [];
      for (const team of allTeams) {
        try {
          const members = await teamApi.getMembers(team.id);
          teamsData.push({
            id: team.id,
            name: team.name,
            members,
          });
        } catch (err) {
          console.error(`Failed to load members for team ${team.name}:`, err);
        }
      }

      setTeamsWithMembers(teamsData);

      // Set first team as default
      if (teamsData.length > 0 && !selectedTeamId) {
        setSelectedTeamId(teamsData[0].id);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load team members');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTeamId]);

  useEffect(() => {
    void loadTeamsAndMembers();
  }, []);

  const selectedTeam = useMemo(() => {
    return teamsWithMembers.find((t) => t.id === selectedTeamId);
  }, [teamsWithMembers, selectedTeamId]);

  const filteredMembers = useMemo(() => {
    if (!selectedTeam) return [];

    return selectedTeam.members.filter(
      (member) =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (member.username?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false),
    );
  }, [selectedTeam, searchTerm]);

  const teamOptions = useMemo(
    () => teamsWithMembers.map((team) => ({ value: team.id, label: team.name })),
    [teamsWithMembers],
  );

  if (teamsWithMembers.length === 0 && !loading) {
    return (
      <AppPage>
        <Card padding="lg" className="mx-auto max-w-2xl text-center">
          <CardHeader>
            <CardTitle>No Teams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Text variant="muted" size="sm">
              You are not a member of any teams yet. Contact your organization administrator to be
              added to a team.
            </Text>
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <Card padding="lg" className="space-y-4">
        <CardHeader className="">
          <div>
            <CardTitle>Team Members</CardTitle>
            <Text variant="muted" size="sm">
              View members from your teams
            </Text>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Text
              size="sm"
              className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </Text>
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Select
                label="Team"
                size="sm"
                value={selectedTeamId || ''}
                onValueChange={setSelectedTeamId}
                options={teamOptions}
                disabled={loading}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadTeamsAndMembers()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>

          <Input
            placeholder="Search by name, email, or username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
            size="sm"
            disabled={loading}
          />

          <div className="flex items-center justify-between">
            <Text variant="muted" size="sm">
              {filteredMembers.length} member{filteredMembers.length !== 1 ? 's' : ''}
              {selectedTeam && ` in ${selectedTeam.name}`}
            </Text>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" label="Loading members" />
            </div>
          ) : (
            <Table responsive>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center">
                      <Text variant="muted" size="sm">
                        No members found
                      </Text>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMembers.map((member) => {
                    const isCurrent = member.id === user?.id;
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Text size="sm" weight="medium">
                              {member.name}
                            </Text>
                            {isCurrent && <Badge variant="secondary">You</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>{member.username ? `@${member.username}` : '—'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
};
