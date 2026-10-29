/**
 * "What notifies you" (#784): each event's Desktop and Phone setting.
 *
 * A table on a computer; on a phone, one tab per device with a switch per
 * event, since three columns don't fit. Each change saves on its own and is
 * undone on screen if the save fails. Rendered inside a Settings card.
 */
import {
  Checkbox,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  useMediaQuery,
} from '@mieweb/ui';
import React from 'react';

import type { NotificationDevices } from '../../lib/api';
import {
  NOTIFICATION_DEVICES,
  NOTIFICATION_EVENT_GROUPS,
  NOTIFICATION_STRINGS as S,
  type NotificationDevice,
  type NotificationEventCopy,
  type NotificationEventGroup,
} from './notificationCopy';
import { PrefsStatus } from './PrefsStatus';
import { useNotificationPrefs } from './useNotificationPrefs';

type Events = Record<string, NotificationDevices>;
type Toggle = (key: string, device: NotificationDevice, on: boolean) => void;

/** The groups and events the server knows about, in display order. */
function visibleGroups(events: Events): NotificationEventGroup[] {
  return NOTIFICATION_EVENT_GROUPS.map((group) => ({
    ...group,
    events: group.events.filter((event) => events[event.key]),
  })).filter((group) => group.events.length > 0);
}

const EventLabel: React.FC<{ event: NotificationEventCopy }> = ({ event }) => (
  <div className="notification-event-label min-w-0">
    <Text size="sm" weight="medium">
      {event.label}
    </Text>
    {event.hint && (
      <Text variant="muted" size="xs">
        {event.hint}
      </Text>
    )}
  </div>
);

const GroupLabel: React.FC<{ label: string }> = ({ label }) => (
  <Text as="span" size="xs" weight="semibold" className="uppercase tracking-wide text-primary-700">
    {label}
  </Text>
);

const EventTable: React.FC<{
  events: Events;
  groups: NotificationEventGroup[];
  onToggle: Toggle;
}> = ({ events, groups, onToggle }) => (
  <Table className="notification-event-table">
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{S.eventColumn}</TableHead>
        {NOTIFICATION_DEVICES.map((device) => (
          <TableHead key={device} scope="col" className="w-24 text-center">
            {S.device[device]}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {groups.map((group) => (
        <React.Fragment key={group.label}>
          <TableRow className="notification-event-group">
            <TableHead scope="colgroup" colSpan={NOTIFICATION_DEVICES.length + 1}>
              <GroupLabel label={group.label} />
            </TableHead>
          </TableRow>
          {group.events.map((event) => (
            <TableRow key={event.key} className="notification-event-row">
              <TableCell>
                <EventLabel event={event} />
              </TableCell>
              {NOTIFICATION_DEVICES.map((device) => (
                <TableCell key={device}>
                  <div className="flex justify-center">
                    <Checkbox
                      checked={events[event.key][device]}
                      onChange={(e) => onToggle(event.key, device, e.target.checked)}
                      aria-label={S.cellLabel(event.label, device)}
                    />
                  </div>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </React.Fragment>
      ))}
    </TableBody>
  </Table>
);

const EventTabs: React.FC<{
  events: Events;
  groups: NotificationEventGroup[];
  onToggle: Toggle;
}> = ({ events, groups, onToggle }) => (
  <Tabs defaultValue="desktop" variant="pills" className="notification-event-tabs px-4 py-3">
    <TabsList aria-label={S.deviceTabsLabel}>
      {NOTIFICATION_DEVICES.map((device) => (
        <TabsTrigger key={device} value={device}>
          {S.device[device]}
        </TabsTrigger>
      ))}
    </TabsList>
    {NOTIFICATION_DEVICES.map((device) => (
      <TabsContent key={device} value={device} className="space-y-4 pt-3">
        {groups.map((group) => (
          <div key={group.label} className="notification-event-group">
            <GroupLabel label={group.label} />
            <ul className="notification-event-list divide-y divide-neutral-100 dark:divide-neutral-800">
              {group.events.map((event) => (
                <li key={event.key} className="flex items-center justify-between gap-4 py-3">
                  <EventLabel event={event} />
                  <Switch
                    checked={events[event.key][device]}
                    onCheckedChange={(on) => onToggle(event.key, device, on)}
                    aria-label={S.cellLabel(event.label, device)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </TabsContent>
    ))}
  </Tabs>
);

export const NotificationEventSettings: React.FC = () => {
  const { prefs, error, setEvent } = useNotificationPrefs();
  const phone = useMediaQuery('(max-width: 767px)');

  return (
    <div className="notification-event-settings">
      <PrefsStatus loading={!prefs} error={error} />
      {prefs &&
        (phone ? (
          <EventTabs
            events={prefs.events}
            groups={visibleGroups(prefs.events)}
            onToggle={setEvent}
          />
        ) : (
          <EventTable
            events={prefs.events}
            groups={visibleGroups(prefs.events)}
            onToggle={setEvent}
          />
        ))}
    </div>
  );
};
