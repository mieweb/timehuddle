/**
 * HuddleNotifyMenu — the bell in a Huddle conversation's header (#784): how
 * much of this team's Huddle notifies the user. A dropdown on a computer, a
 * bottom sheet on a phone. Same setting as Settings › Notifications › Huddle,
 * per team.
 */
import {
  BellIcon,
  BellOffIcon,
  Button,
  CheckIcon,
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  RadioGroup,
  Radio,
  Sheet,
  SheetBody,
  SheetClose,
  SheetHeader,
  SheetTitle,
  useMediaQuery,
} from '@mieweb/ui';
import React, { useState } from 'react';

import { settingsPath } from '../settings/settingsSections';
import { HUDDLE_TEAM_LEVELS, NOTIFICATION_STRINGS as S } from '../notifications/notificationCopy';
import { useNotificationPrefs } from '../notifications/useNotificationPrefs';
import type { HuddleTeamLevel } from '../../lib/api';
import { useRouter } from '../../ui/router';

interface HuddleNotifyMenuProps {
  teamId: string;
  teamName: string;
}

export function HuddleNotifyMenu({ teamId, teamName }: HuddleNotifyMenuProps) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery('(max-width: 767px)');
  const { navigate } = useRouter();
  const { prefs, teamLevel, setTeamLevel } = useNotificationPrefs();
  if (!prefs) return null;

  const level = teamLevel(teamId);
  const levelLabel = HUDDLE_TEAM_LEVELS.find((option) => option.level === level)?.label ?? '';
  const pick = (next: HuddleTeamLevel) => {
    if (next !== level) setTeamLevel(teamId, next);
    setOpen(false);
  };
  const openSettings = () => {
    setOpen(false);
    navigate(settingsPath('notifications'));
  };

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={S.bellLabel(teamName, levelLabel)}
      aria-haspopup={phone ? 'dialog' : 'menu'}
      onClick={phone ? () => setOpen(true) : undefined}
      className={`huddle-notify-trigger shrink-0 ${level === 'mute' ? 'text-muted-foreground' : 'text-primary-700 dark:text-primary-400'}`}
    >
      {level === 'mute' ? (
        <BellOffIcon className="h-4 w-4" aria-hidden />
      ) : (
        <BellIcon className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          aria-label={S.bellHeading(teamName)}
        >
          <SheetHeader>
            <SheetTitle>{S.bellHeading(teamName)}</SheetTitle>
            <SheetClose />
          </SheetHeader>
          <SheetBody className="huddle-notify-sheet space-y-4">
            <RadioGroup
              name={`huddle-level-${teamId}`}
              value={level}
              onValueChange={(next) => pick(next as HuddleTeamLevel)}
            >
              {HUDDLE_TEAM_LEVELS.map((option) => (
                <Radio
                  key={option.level}
                  value={option.level}
                  label={option.label}
                  description={option.description}
                />
              ))}
            </RadioGroup>
            <Button variant="link" onClick={openSettings}>
              {S.allSettings}
            </Button>
          </SheetBody>
        </Sheet>
      </>
    );
  }

  return (
    <Dropdown open={open} onOpenChange={setOpen} trigger={trigger} placement="bottom-end">
      <DropdownLabel>{S.bellHeading(teamName)}</DropdownLabel>
      {HUDDLE_TEAM_LEVELS.map((option) => (
        <DropdownItem
          key={option.level}
          role="menuitemradio"
          aria-checked={option.level === level}
          icon={
            <CheckIcon
              className={`h-4 w-4 ${option.level === level ? '' : 'invisible'}`}
              aria-hidden
            />
          }
          onClick={() => pick(option.level)}
        >
          <span className="flex flex-col">
            <span>{option.label}</span>
            <span className="max-w-56 whitespace-normal text-xs text-muted-foreground">
              {option.description}
            </span>
          </span>
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <DropdownItem onClick={openSettings}>{S.allSettings}</DropdownItem>
    </Dropdown>
  );
}
