/**
 * Scheduling in the Huddle composer (#596): a chip that sets when the next post
 * is delivered, and a chip listing my posts still waiting, with Send now /
 * Reschedule / Delete. Rules and text live in postSchedule.ts.
 */
import { faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  AlertDialog,
  Button,
  ButtonGroup,
  DateInput,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Radio,
  RadioGroup,
  Sheet,
  SheetBody,
  SheetClose,
  SheetHeader,
  SheetTitle,
  Text,
} from '@mieweb/ui';
import type { HuddleDeliveryMode, HuddlePost } from '@lib/api';
import { AppModal } from '@ui/AppModal';
import { useState } from 'react';

import { ComposerChipButton } from './ComposerChipButton';
import {
  SCHEDULE_TEXT,
  parseLocalInputValue,
  scheduleError,
  schedulePresets,
  toLocalInputValue,
  type PostSchedule,
} from './postSchedule';
import { formatScheduleTime } from './superChatFeed';

const clockIcon = <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5" aria-hidden="true" />;

interface ScheduleDialogProps {
  title: string;
  confirmLabel: string;
  initial?: PostSchedule | null;
  onConfirm: (schedule: PostSchedule) => void | Promise<void>;
  /** Offered when there is a schedule to drop. */
  onClear?: () => void;
  onClose: () => void;
}

/** Pick a time and a delivery mode. Render it only while open, so each opening starts fresh. */
function ScheduleDialog({
  title,
  confirmLabel,
  initial,
  onConfirm,
  onClear,
  onClose,
}: ScheduleDialogProps) {
  const [value, setValue] = useState(() => (initial ? toLocalInputValue(initial.deliverAt) : ''));
  const [mode, setMode] = useState<HuddleDeliveryMode>(initial?.deliveryMode ?? 'silent');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (saving) return;
    const deliverAt = parseLocalInputValue(value);
    const problem = scheduleError(deliverAt, Date.now());
    if (problem || !deliverAt) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onConfirm({ deliverAt, deliveryMode: mode });
    } catch {
      setError(SCHEDULE_TEXT.actionFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppModal open onOpenChange={(next) => !next && onClose()} aria-label={title}>
      <ModalHeader>
        <ModalTitle>
          <span className="flex items-center gap-2">
            <FontAwesomeIcon icon={faClock} aria-hidden="true" />
            {title}
          </span>
        </ModalTitle>
        <ModalClose />
      </ModalHeader>

      <ModalBody>
        <div className="schedule-dialog-body flex flex-col gap-4 py-2">
          <ButtonGroup aria-label={SCHEDULE_TEXT.presetsLabel}>
            {schedulePresets(new Date()).map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant="outline"
                onClick={() => {
                  setValue(toLocalInputValue(preset.at));
                  setError(null);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </ButtonGroup>
          <DateInput
            label={SCHEDULE_TEXT.when}
            inputType="datetime-local"
            minuteStep={5}
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
          />
          <RadioGroup
            name="schedule-delivery-mode"
            label={SCHEDULE_TEXT.modeLabel}
            value={mode}
            onValueChange={(next) => setMode(next as HuddleDeliveryMode)}
            size="sm"
          >
            <Radio value="silent" label={SCHEDULE_TEXT.modeSilent} />
            <Radio value="hidden" label={SCHEDULE_TEXT.modeHidden} />
          </RadioGroup>
          {error && (
            <Text size="xs" className="text-destructive" role="alert">
              {error}
            </Text>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <ButtonGroup>
          {onClear && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              {SCHEDULE_TEXT.clear}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {SCHEDULE_TEXT.cancel}
          </Button>
          <Button size="sm" onClick={confirm} isLoading={saving} disabled={!value}>
            {confirmLabel}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>
  );
}

interface ScheduleSendButtonProps {
  schedule: PostSchedule | null;
  onChange: (schedule: PostSchedule | null) => void;
  disabled?: boolean;
}

/** Composer chip: "Schedule", or the time the next post is set for. */
export function ScheduleSendButton({ schedule, onChange, disabled }: ScheduleSendButtonProps) {
  const [open, setOpen] = useState(false);
  const when = schedule ? formatScheduleTime(schedule.deliverAt.getTime()) : null;
  return (
    <>
      <ComposerChipButton
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={when ? SCHEDULE_TEXT.scheduledAria(when) : SCHEDULE_TEXT.scheduleAria}
        leftIcon={clockIcon}
      >
        {when ?? SCHEDULE_TEXT.schedule}
      </ComposerChipButton>
      {open && (
        <ScheduleDialog
          title={SCHEDULE_TEXT.dialogTitle}
          confirmLabel={SCHEDULE_TEXT.confirm}
          initial={schedule}
          onConfirm={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClear={
            schedule
              ? () => {
                  onChange(null);
                  setOpen(false);
                }
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ScheduledPostsButtonProps {
  /** My posts still waiting to be delivered. */
  posts: HuddlePost[];
  onSendNow: (post: HuddlePost) => Promise<void>;
  onReschedule: (post: HuddlePost, schedule: PostSchedule) => Promise<void>;
  onDelete: (post: HuddlePost) => Promise<void>;
}

const excerpt = (post: HuddlePost) => {
  const text = post.content.text.trim().replace(/\s+/g, ' ');
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
};

/** Composer chip "Scheduled (n)" opening a sheet of my waiting posts. Hidden when there are none. */
export function ScheduledPostsButton({
  posts,
  onSendNow,
  onReschedule,
  onDelete,
}: ScheduledPostsButtonProps) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<HuddlePost | null>(null);
  const [deleting, setDeleting] = useState<HuddlePost | null>(null);

  if (posts.length === 0 && !open) return null;

  async function run(post: HuddlePost, action: () => Promise<void>) {
    setBusyId(post.id);
    setError(null);
    try {
      await action();
    } catch (err) {
      console.error('[Huddle] scheduled post action failed:', err);
      setError(SCHEDULE_TEXT.actionFailed);
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...posts].sort(
    (a, b) => new Date(a.deliverAt ?? 0).getTime() - new Date(b.deliverAt ?? 0).getTime(),
  );

  return (
    <>
      <ComposerChipButton
        onClick={() => setOpen(true)}
        aria-label={SCHEDULE_TEXT.pendingAria(posts.length)}
        leftIcon={clockIcon}
      >
        {SCHEDULE_TEXT.pendingCount(posts.length)}
      </ComposerChipButton>

      <Sheet open={open} onOpenChange={setOpen} side="end" aria-label={SCHEDULE_TEXT.sheetTitle}>
        <SheetHeader>
          <SheetTitle>{SCHEDULE_TEXT.sheetTitle}</SheetTitle>
          <SheetClose />
        </SheetHeader>
        <SheetBody>
          {error && (
            <Text size="sm" className="text-destructive" role="alert">
              {error}
            </Text>
          )}
          {sorted.length === 0 ? (
            <Text size="sm" className="text-muted-foreground">
              {SCHEDULE_TEXT.sheetEmpty}
            </Text>
          ) : (
            <ul className="scheduled-posts-list flex flex-col divide-y divide-border">
              {sorted.map((post) => (
                <li key={post.id} className="scheduled-post-item flex flex-col gap-2 py-3">
                  <Text size="xs" className="text-muted-foreground">
                    {formatScheduleTime(new Date(post.deliverAt!).getTime())} ·{' '}
                    {post.deliveryMode === 'hidden'
                      ? SCHEDULE_TEXT.modeHidden
                      : SCHEDULE_TEXT.modeSilent}
                  </Text>
                  <Text size="sm" className="break-words">
                    {excerpt(post)}
                  </Text>
                  <ButtonGroup>
                    <Button
                      size="sm"
                      onClick={() => run(post, () => onSendNow(post))}
                      isLoading={busyId === post.id}
                      disabled={busyId !== null}
                    >
                      {SCHEDULE_TEXT.sendNow}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRescheduling(post)}
                      disabled={busyId !== null}
                    >
                      {SCHEDULE_TEXT.reschedule}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleting(post)}
                      disabled={busyId !== null}
                    >
                      {SCHEDULE_TEXT.delete}
                    </Button>
                  </ButtonGroup>
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </Sheet>

      {rescheduling && (
        <ScheduleDialog
          title={SCHEDULE_TEXT.rescheduleTitle}
          confirmLabel={SCHEDULE_TEXT.confirmReschedule}
          initial={{
            deliverAt: new Date(rescheduling.deliverAt!),
            deliveryMode: rescheduling.deliveryMode ?? 'silent',
          }}
          onConfirm={async (schedule) => {
            await onReschedule(rescheduling, schedule);
            setRescheduling(null);
          }}
          onClose={() => setRescheduling(null)}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={SCHEDULE_TEXT.deleteTitle}
        description={SCHEDULE_TEXT.deleteDescription}
        variant="destructive"
        actionLabel={SCHEDULE_TEXT.delete}
        onAction={() => {
          const post = deleting;
          setDeleting(null);
          if (post) void run(post, () => onDelete(post));
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
