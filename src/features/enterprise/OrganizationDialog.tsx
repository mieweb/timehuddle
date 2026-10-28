/**
 * OrganizationDialog — create an organization in the selected enterprise, or
 * edit one: name, slug (checked for availability as you type) and auto-join.
 */
import {
  Alert,
  Button,
  ButtonGroup,
  Input,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  Text,
} from '@mieweb/ui';
import { AppModal, EMPTY_SUBMIT } from '@ui/AppModal';
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
  const [autoJoin, setAutoJoin] = useState(defaultAutoJoin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every edit advances this, so an answer for an older slug is ignored.
  const slugSeq = useRef(0);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const checkSlug = (next: string) => {
    const seq = ++slugSeq.current;
    if (timer.current) clearTimeout(timer.current);
    // The server saves the slugified value, so that is the one to check.
    const candidate = slugify(next);
    if (!candidate || candidate === organization?.slug) return setSlugStatus('idle');
    setSlugStatus('checking');
    timer.current = setTimeout(() => {
      void orgApi.checkSlugAvailability(candidate, organization?.id).then((available) => {
        if (seq === slugSeq.current) setSlugStatus(available ? 'available' : 'taken');
      });
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

  const incomplete = !name.trim() || slugStatus === 'taken';

  const save = async () => {
    if (saving || incomplete) return;
    setSaving(true);
    setError(null);
    try {
      if (organization) {
        await orgApi.updateOrganization(organization.id, {
          name: name.trim() || undefined,
          slug: slug.trim() !== organization.slug ? slug.trim() : undefined,
        });
        void refetchOrganizations();
      } else {
        if (!selectedEnterpriseId) throw new Error(S.noEnterprise);
        const created = await orgApi.createOrganization({
          enterpriseId: selectedEnterpriseId,
          name: name.trim(),
          slug: slug.trim() || undefined,
          allowAutoJoin: autoJoin,
        });
        // Select it once it is in the list, or TeamContext resets an unknown id.
        await refetchOrganizations();
        setSelectedOrgId(created.id);
      }
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
      <ModalHeader>
        <ModalTitle>{editing ? S.editTitle : S.createTitle}</ModalTitle>
      </ModalHeader>
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
        {/* A new organization starts with this; afterwards it is edited only
            in Settings → Organization, with the other organization defaults. */}
        {!editing && (
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
        )}
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {S.cancel}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving}
            aria-disabled={incomplete}
            className={EMPTY_SUBMIT}
          >
            {editing ? (saving ? S.saving : S.save) : saving ? S.creating : S.create}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>
  );
};
