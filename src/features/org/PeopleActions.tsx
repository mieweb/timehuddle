/**
 * PeopleActions — the People page's header buttons for organization admins:
 * Organization settings, Add existing user and Invite by email, each add or
 * invite in its own dialog. `onChanged` tells the panels to reload.
 */
import {
  Alert,
  Button,
  Input,
  MailIcon,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SettingsIcon,
  Text,
  UserPlusIcon,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, orgApi, type DefaultOrganizationRole } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { AppModal } from '../../ui/AppModal';
import { useRouter } from '../../ui/router';
import { settingsPath } from '../settings/settingsSections';
import { PEOPLE_STRINGS } from './peopleStrings';

const ROLE_OPTIONS = (['owner', 'admin', 'member'] as const).map((role) => ({
  value: role,
  label: PEOPLE_STRINGS.roles[role],
}));

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

const AddExistingUserDialog: React.FC<{ onClose: () => void; onAdded: () => void }> = ({
  onClose,
  onAdded,
}) => {
  const S = PEOPLE_STRINGS.add;
  const { selectedOrgId } = useTeam();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<DefaultOrganizationRole>('member');
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedOrgId) return;
    void orgApi
      .searchUsers(selectedOrgId, '')
      .then((found) =>
        setOptions(
          found.map((u) => ({
            value: u.id,
            label: u.username ? `${u.name} (@${u.username})` : u.name,
          })),
        ),
      )
      .catch(() => setOptions([]));
  }, [selectedOrgId]);

  const add = async () => {
    if (!selectedOrgId || !userId) return;
    setSaving(true);
    setError(null);
    try {
      await orgApi.setMemberRole(selectedOrgId, userId, role);
      onAdded();
      onClose();
    } catch (err) {
      setError(errorText(err, PEOPLE_STRINGS.errors.add));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal open onOpenChange={(open) => !open && !saving && onClose()}>
      <ModalHeader>{S.title}</ModalHeader>
      <ModalBody className="space-y-3">
        {error && <Alert variant="danger">{error}</Alert>}
        <Select
          label={S.user}
          placeholder={S.userPlaceholder}
          searchable
          searchPlaceholder={S.userSearch}
          noResultsText={S.noUsers}
          value={userId}
          onValueChange={setUserId}
          options={options}
          disabled={saving}
        />
        <Select
          label={S.role}
          value={role}
          onValueChange={(value) => setRole(value as DefaultOrganizationRole)}
          options={ROLE_OPTIONS}
          disabled={saving}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {PEOPLE_STRINGS.cancel}
        </Button>
        <Button onClick={() => void add()} disabled={saving || !userId}>
          {saving ? S.confirming : S.confirm}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};

const InviteDialog: React.FC<{ onClose: () => void; onInvited: () => void }> = ({
  onClose,
  onInvited,
}) => {
  const S = PEOPLE_STRINGS.invite;
  const { selectedOrgId } = useTeam();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const send = async () => {
    const address = email.trim();
    if (!selectedOrgId || !address || sending) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const result = await orgApi.inviteMember(selectedOrgId, address);
      // A pending invite is sent by email; anyone else was added straight away.
      setStatus(result.status === 'pending' ? S.sent(address) : null);
      setEmail('');
      onInvited();
    } catch (err) {
      setError(errorText(err, PEOPLE_STRINGS.errors.invite));
    } finally {
      setSending(false);
    }
  };

  return (
    <AppModal open onOpenChange={(open) => !open && !sending && onClose()}>
      <ModalHeader>{S.title}</ModalHeader>
      <ModalBody className="space-y-3">
        <Text variant="muted" size="sm">
          {S.help}
        </Text>
        <Input
          label={S.email}
          type="email"
          placeholder={S.placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          error={error ?? undefined}
          disabled={sending}
        />
        {status && (
          <Text variant="success" size="sm" role="status" aria-live="polite">
            {status}
          </Text>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={sending}>
          {PEOPLE_STRINGS.cancel}
        </Button>
        <Button onClick={() => void send()} disabled={sending || !email.trim()}>
          {sending ? S.confirming : S.confirm}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};

/** On a phone the three header buttons are icons only; the aria-label keeps their names. */
const ButtonLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="max-md:hidden">{children}</span>
);

export const PeopleActions: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const S = PEOPLE_STRINGS.actions;
  const { navigate } = useRouter();
  const { selectedOrgId } = useTeam();
  const [dialog, setDialog] = useState<'add' | 'invite' | null>(null);
  const close = () => setDialog(null);

  return (
    <div className="people-actions flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        leftIcon={<SettingsIcon className="h-4 w-4" />}
        // Carry the org, so Settings opens the one shown here, not the stored pick.
        onClick={() =>
          navigate(`${settingsPath('organization')}${selectedOrgId ? `&org=${selectedOrgId}` : ''}`)
        }
        aria-label={S.organizationSettings}
      >
        <ButtonLabel>{S.organizationSettings}</ButtonLabel>
      </Button>
      <Button
        variant="secondary"
        leftIcon={<UserPlusIcon className="h-4 w-4" />}
        onClick={() => setDialog('add')}
        aria-label={S.addExisting}
      >
        <ButtonLabel>{S.addExisting}</ButtonLabel>
      </Button>
      <Button
        leftIcon={<MailIcon className="h-4 w-4" />}
        onClick={() => setDialog('invite')}
        aria-label={S.invite}
      >
        <ButtonLabel>{S.invite}</ButtonLabel>
      </Button>
      {dialog === 'add' && <AddExistingUserDialog onClose={close} onAdded={onChanged} />}
      {dialog === 'invite' && <InviteDialog onClose={close} onInvited={onChanged} />}
    </div>
  );
};
