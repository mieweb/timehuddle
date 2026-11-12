/**
 * Huddle conversation topics (#866): the controls that start a workday,
 * create a team or direct conversation, and rename one. Each is a small
 * `@mieweb/ui` piece the Huddle page places; the server owns every rule
 * (who may rename, what a direct conversation is), and an error it refuses
 * with is shown as it says.
 */
import {
  Button,
  ButtonGroup,
  Checkbox,
  Dropdown,
  DropdownItem,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MoreHorizontalIcon,
  PlusIcon,
  Radio,
  RadioGroup,
  Select,
  Text,
} from '@mieweb/ui';
import { useState, type FormEvent } from 'react';

import { huddleApi, type HuddleConversation } from '@lib/api';
import { toDateString } from '@lib/timeUtils';
import { AppModal } from '@ui/AppModal';

import { topicTitle } from './superChatFeed';

/** User-facing text for the conversation controls, kept in one place for translation. */
export const CONVERSATION_TEXT = {
  startHuddle: 'Start huddle',
  startHuddleLabel: "Start today's huddle: closes the current workday and opens a new one",
  huddleStarted: 'Huddle started',
  newConversation: 'New conversation',
  newConversationTitle: 'New conversation',
  kindLabel: 'Kind',
  kindGroup: 'Team conversation',
  kindGroupHint: 'A named conversation with the teammates you pick',
  kindDirect: 'Direct message',
  kindDirectHint: 'Just you and one teammate',
  nameLabel: 'Name',
  membersLabel: 'Members',
  personLabel: 'Person',
  personPlaceholder: 'Pick a teammate',
  create: 'Create',
  cancel: 'Cancel',
  save: 'Save',
  options: (name: string) => `Options for ${name}`,
  renameForEveryone: 'Rename for everyone',
  renameForMe: 'Rename for me',
  renameForEveryoneTitle: 'Rename for everyone',
  renameForMeTitle: 'Your name for this conversation',
  renameForMeHint: 'Only you see this name. Leave it empty to use the default.',
  failed: 'Something went wrong. Try again.',
} as const;
const T = CONVERSATION_TEXT;

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : T.failed;
}

// ─── Start huddle ──────────────────────────────────────────────────────────

/**
 * Starts the team's huddle: the open workday closes and today's opens. Shown
 * as done once today's workday is already open, so it can't be pressed twice.
 */
export function StartHuddleButton({
  teamId,
  openWorkday,
  onStarted,
}: {
  teamId: string;
  openWorkday: HuddleConversation | null;
  onStarted: (workday: HuddleConversation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = toDateString(new Date());
  const startedToday = openWorkday?.dateKey === today;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onStarted(await huddleApi.startWorkday(teamId, today));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="huddle-start flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void start()}
        disabled={startedToday || busy}
        isLoading={busy}
        aria-label={startedToday ? T.huddleStarted : T.startHuddleLabel}
      >
        {startedToday ? T.huddleStarted : T.startHuddle}
      </Button>
      {error && (
        <Text as="span" variant="destructive" size="xs" role="alert">
          {error}
        </Text>
      )}
    </span>
  );
}

// ─── New conversation ──────────────────────────────────────────────────────

/** Creates a team conversation (name + members) or opens a direct one with one teammate. */
export function NewConversationButton({
  teamId,
  roster,
  viewerId,
  onCreated,
}: {
  teamId: string;
  /** The team's members, as the mention roster lists them. */
  roster: { id: string; label: string }[];
  viewerId: string;
  onCreated: (conversation: HuddleConversation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'group' | 'direct'>('group');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teammates = roster.filter((m) => m.id !== viewerId);

  const reset = () => {
    setKind('group');
    setName('');
    setMembers([]);
    setPerson('');
    setError(null);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // A second click while the first is in flight would make a second
    // conversation (#866 R18).
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await huddleApi.createConversation(
        kind === 'group'
          ? { teamId, kind, label: name, memberIds: members }
          : { teamId, kind, memberIds: person ? [person] : [] },
      );
      close();
      onCreated(created);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label={T.newConversation}
        title={T.newConversation}
        onClick={() => setOpen(true)}
        className="huddle-new-conversation shrink-0"
      >
        <PlusIcon className="h-4 w-4" aria-hidden />
      </Button>
      <AppModal open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} size="md">
        <ModalHeader>
          <ModalTitle>{T.newConversationTitle}</ModalTitle>
        </ModalHeader>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <ModalBody className="space-y-4">
            <RadioGroup
              name="huddle-new-conversation-kind"
              label={T.kindLabel}
              value={kind}
              onValueChange={(next) => setKind(next as 'group' | 'direct')}
            >
              <Radio value="group" label={T.kindGroup} description={T.kindGroupHint} />
              <Radio value="direct" label={T.kindDirect} description={T.kindDirectHint} />
            </RadioGroup>
            {kind === 'group' ? (
              <>
                <Input
                  label={T.nameLabel}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                />
                <fieldset className="huddle-new-conversation-members space-y-2">
                  <legend className="text-sm font-medium">{T.membersLabel}</legend>
                  {teammates.map((member) => (
                    <Checkbox
                      key={member.id}
                      label={member.label}
                      checked={members.includes(member.id)}
                      onChange={(e) =>
                        setMembers((prev) =>
                          e.target.checked
                            ? [...prev, member.id]
                            : prev.filter((id) => id !== member.id),
                        )
                      }
                    />
                  ))}
                </fieldset>
              </>
            ) : (
              <Select
                label={T.personLabel}
                placeholder={T.personPlaceholder}
                options={teammates.map((m) => ({ value: m.id, label: m.label }))}
                value={person}
                onValueChange={setPerson}
              />
            )}
            {error && (
              <Text variant="destructive" size="xs" as="div" role="alert">
                {error}
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <ButtonGroup>
              <Button variant="ghost" type="button" onClick={close}>
                {T.cancel}
              </Button>
              <Button type="submit" isLoading={busy} disabled={busy}>
                {T.create}
              </Button>
            </ButtonGroup>
          </ModalFooter>
        </form>
      </AppModal>
    </>
  );
}

// ─── Rename ────────────────────────────────────────────────────────────────

/**
 * The open conversation's menu: rename it for everyone (a team conversation,
 * by its creator or a team admin) or just for me (any conversation).
 */
export function ConversationMenu({
  conversation,
  canRenameForEveryone,
  onChanged,
}: {
  conversation: HuddleConversation;
  canRenameForEveryone: boolean;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'everyone' | 'me' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = topicTitle(conversation);

  const begin = (next: 'everyone' | 'me') => {
    setMenuOpen(false);
    setError(null);
    setValue(next === 'everyone' ? (conversation.label ?? '') : (conversation.myLabel ?? ''));
    setMode(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'everyone') await huddleApi.renameConversation(conversation.id, value);
      else await huddleApi.setMyConversationLabel(conversation.id, value);
      setMode(null);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        trigger={
          <Button variant="ghost" size="icon" aria-label={T.options(title)} className="shrink-0">
            <MoreHorizontalIcon className="h-4 w-4" aria-hidden />
          </Button>
        }
      >
        {canRenameForEveryone && (
          <DropdownItem onClick={() => begin('everyone')}>{T.renameForEveryone}</DropdownItem>
        )}
        <DropdownItem onClick={() => begin('me')}>{T.renameForMe}</DropdownItem>
      </Dropdown>
      <AppModal open={mode !== null} onOpenChange={(next) => !next && setMode(null)} size="sm">
        <ModalHeader>
          <ModalTitle>
            {mode === 'everyone' ? T.renameForEveryoneTitle : T.renameForMeTitle}
          </ModalTitle>
        </ModalHeader>
        <form onSubmit={(e) => void submit(e)} noValidate>
          <ModalBody className="space-y-3">
            <Input
              label={T.nameLabel}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={80}
              placeholder={mode === 'me' ? title : undefined}
            />
            {mode === 'me' && (
              <Text as="p" variant="muted" size="xs">
                {T.renameForMeHint}
              </Text>
            )}
            {error && (
              <Text variant="destructive" size="xs" as="div" role="alert">
                {error}
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <ButtonGroup>
              <Button variant="ghost" type="button" onClick={() => setMode(null)}>
                {T.cancel}
              </Button>
              <Button type="submit" isLoading={busy} disabled={busy}>
                {T.save}
              </Button>
            </ButtonGroup>
          </ModalFooter>
        </form>
      </AppModal>
    </>
  );
}
