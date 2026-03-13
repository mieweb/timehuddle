/**
 * TeamContext — Shared selected-team state + subscriptions.
 *
 * Provides:
 *   • teams           — all teams the user belongs to
 *   • selectedTeamId  — persisted in localStorage
 *   • activeClockEvent — the user's current open clock event (if any)
 *   • currentTime     — ticks every second for live timers
 */
import { Meteor } from 'meteor/meteor';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { ClockEventDoc } from '../features/clock/schema';
import type { TeamDoc } from '../features/teams/schema';

// We import collections from their api modules. These are isomorphic — the
// Mongo.Collection constructors run on both client and server.
import { ClockEvents } from '../features/clock/api';
import { Teams } from '../features/teams/api';

const TEAM_KEY = 'app:selectedTeamId';

export interface TeamContextValue {
  teams: TeamDoc[];
  teamsReady: boolean;
  selectedTeamId: string | null;
  selectedTeam: TeamDoc | null;
  setSelectedTeamId: (id: string) => void;
  isAdmin: boolean;
  activeClockEvent: ClockEventDoc | null;
  clockReady: boolean;
  currentTime: number;
}

const TeamCtx = createContext<TeamContextValue>({
  teams: [],
  teamsReady: false,
  selectedTeamId: null,
  selectedTeam: null,
  setSelectedTeamId: () => {},
  isAdmin: false,
  activeClockEvent: null,
  clockReady: false,
  currentTime: Date.now(),
});

export const useTeam = () => useContext(TeamCtx);

export const TeamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const userId = Meteor.userId();

  // Subscriptions — useSubscribe returns an isLoading() function
  const teamsLoading = useSubscribe('userTeams');
  const clockLoading = useSubscribe('clockEventsForUser');

  // Data
  const teams = useFind(() => Teams.find({}, { sort: { isPersonal: -1, name: 1 } as any }), []);

  // Selected team
  const [selectedTeamId, _setSelectedTeamId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TEAM_KEY);
  });

  const setSelectedTeamId = useCallback((id: string) => {
    _setSelectedTeamId(id);
    localStorage.setItem(TEAM_KEY, id);
  }, []);

  // Auto-select first team when none selected
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0]._id!);
    }
  }, [selectedTeamId, teams, setSelectedTeamId]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t._id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const isAdmin = useMemo(
    () => !!(userId && selectedTeam?.admins.includes(userId)),
    [userId, selectedTeam],
  );

  // Active clock event for selected team
  const activeClockEvent = useFind(
    () =>
      ClockEvents.find(
        { userId: userId ?? '__none__', teamId: selectedTeamId ?? '__none__', endTime: null },
        { limit: 1 },
      ),
    [userId, selectedTeamId],
  )?.[0] ?? null;

  // Live timer — ticks every second
  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const value = useMemo<TeamContextValue>(
    () => ({
      teams,
      teamsReady: !teamsLoading(),
      selectedTeamId,
      selectedTeam,
      setSelectedTeamId,
      isAdmin,
      activeClockEvent,
      clockReady: !clockLoading(),
      currentTime,
    }),
    [teams, teamsLoading, selectedTeamId, selectedTeam, setSelectedTeamId, isAdmin, activeClockEvent, clockLoading, currentTime],
  );

  return <TeamCtx.Provider value={value}>{children}</TeamCtx.Provider>;
};
