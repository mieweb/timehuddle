/**
 * OrganizationDialog — create an organization in the selected enterprise, or
 * edit one: name, slug (checked for availability as you type) and auto-join.
 */
import {
  Alert,
  Button,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Switch,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useEffect, useRef, useState } from 'react';

import { ApiError, orgApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { ENTERPRISE_STRINGS } from './enterpriseStrings';

const S = ENTERPRISE_STRINGS.orgDialog;

type Organization = ReturnType<typeof useTeam>['organizations'][number];
type SlugStatus = 'idle' | 'checking' | 'available' | 'taken';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

interface OrganizationDialogProps {
  /** The organization to edit; none to create a new one. */
  organization?: Organization;
  /** The enterprise default, used as a new organization's starting value. */
  defaultAutoJoin: boolean;
  /** The enterprise locked auto-join, so organizations can't change it. */
  autoJoinLocked: boolean;
  onClose: () => void;
}

export const OrganizationDialog: React.FC<OrganizationDialogProps> = ({
  organization,
  defaultAutoJoin,
  autoJoinLocked,
  onClose,
}) => {
  const { selectedEnterpriseId, refetchOrganizations, setSelectedOrgId } = useTeam();
  const editing = Boolean(organization);
  const [name, setName] = useState(organization?.name ?? '');
  const [slug, setSlug] = useState(organization?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(editing);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [autoJoin, setAutoJoin] = useState(organization?.allowAutoJoin ?? defaultAutoJoin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const checkSlug = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!next.trim() || next.trim() === organization?.slug) return setSlugStatus('idle');
    setSlugStatus('checking');
    timer.current = setTimeout(() => {
      void orgApi
        .checkSlugAvailability(next.trim(), organization?.id)
        .then((available) => setSlugStatus(available ? 'available' : 'taken'));
    }, 400);
  };

  const changeName = (next: string) => {
    setName(next);
    if (slugEdited) return;
    const derived = slugify(next);
    setSlug(derived);
    checkSlug(derived);
  };

  const changeSlug = (next: string) => {
    setSlug(next);
    setSlugEdited(true);
    checkSlug(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (organization) {
        await orgApi.updateOrganization(organization.id, {
          name: name.trim() || undefined,
          slug: slug.trim() !== organization.slug ? slug.trim() : undefined,
          allowAutoJoin: autoJoin,
        });
      } else {
        if (!selectedEnterpriseId) throw new Error(S.noEnterprise);
        const created = await orgApi.createOrganization({
          enterpriseId: selectedEnterpriseId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          allowAutoJoin: autoJoin,
        });
        setSelectedOrgId(created.id);
      }
      refetchOrganizations();
      onClose();
    } catch (err) {
      const fallback = editing ? S.updateFailed : S.createFailed;
      setError(err instanceof ApiError || err instanceof Error ? err.message : fallback);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal open onOpenChange={(open) => !open && !saving && onClose()}>
      <ModalHeader>{editing ? S.editTitle : S.createTitle}</ModalHeader>
      <ModalBody className="space-y-4">
        {error && <Alert variant="danger">{error}</Alert>}
        <Input
          label={S.name}
          value={name}
          onChange={(e) => changeName(e.target.value)}
          placeholder={S.namePlaceholder}
          disabled={saving}
        />
        <div>
          <Input
            label={S.slug}
            value={slug}
            onChange={(e) => changeSlug(e.target.value)}
            placeholder={S.slugPlaceholder}
            disabled={saving}
          />
          {slugStatus !== 'idle' && (
            <Text
              size="xs"
              role="status"
              variant={
                slugStatus === 'taken'
                  ? 'destructive'
                  : slugStatus === 'available'
                    ? 'success'
                    : 'muted'
              }
              className="mt-1"
            >
              {S[slugStatus]}
            </Text>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
          <div>
            <Text size="sm" weight="medium">
              {S.autoJoin}
            </Text>
            <Text variant="muted" size="xs">
              {S.autoJoinHelp}
            </Text>
          </div>
          <Switch
            checked={autoJoin}
            onCheckedChange={setAutoJoin}
            disabled={saving || autoJoinLocked}
            aria-label={S.autoJoinToggle}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {S.cancel}
        </Button>
        <Button
          onClick={() => void save()}
          disabled={saving || !name.trim() || slugStatus === 'taken'}
        >
          {editing ? (saving ? S.saving : S.save) : saving ? S.creating : S.create}
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
