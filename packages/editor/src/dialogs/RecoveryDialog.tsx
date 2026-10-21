// Recovery dialog (M2A-SPEC §5.20, FR-PROJ-05): the autosaved projects whose page closed before they were saved —
// project name, when, characters, clips, size — with Recover (`file.recover`), Discard (asks first;
// `file.discardRecovery`) and Later (keeps them; the shell does not prompt again in this page load).
import { autosaveOf } from '@ekza-studio/editor-core';
import type { AutosaveSlotInfo } from '@ekza-studio/editor-core';
import { Button, Dialog, DialogContent, DialogFooter } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { useSession } from '../hooks';
import { useShell } from '../shell/context';
import { count } from './format';

/** "just now", "5 min ago", "3 h ago", "2 days ago" relative to `now`. */
export function relativeTime(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return count(Math.round(hours / 24), 'day', 'days').concat(' ago');
}

/** Bytes in decimal units: "980 B", "12.3 kB", "10.8 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function SlotRow(props: {
  readonly slot: AutosaveSlotInfo;
  readonly now: number;
  readonly busy: boolean;
  readonly onRecover: () => void;
  readonly onDiscard: () => void;
}): JSX.Element {
  const { slot } = props;
  return (
    <li
      className="flex items-center gap-3 rounded-button border border-line bg-field p-2"
      data-testid={`recovery-row-${slot.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-ui font-semibold text-fg" title={slot.projectName}>
          {slot.projectName}
        </span>
        <span className="text-ui-dense text-fg-3">
          <time dateTime={new Date(slot.savedAt).toISOString()} title={new Date(slot.savedAt).toLocaleString()}>
            {relativeTime(slot.savedAt, props.now)}
          </time>
          {' · '}
          {count(slot.characters, 'character')} · {count(slot.clips, 'clip')} ·{' '}
          <span className="ekza-numeric">{sizeText(slot.bytes)}</span>
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={props.busy}
        data-testid={`recovery-discard-${slot.id}`}
        onClick={props.onDiscard}
      >
        Discard
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={props.busy}
        data-testid={`recovery-recover-${slot.id}`}
        onClick={props.onRecover}
      >
        Recover
      </Button>
    </li>
  );
}

export function RecoveryDialog(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const slots = useSession((s) => s.recovery);
  const dirty = useSession((s) => s.dirty);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  // File › Recover… looks again: another tab may have closed since the start.
  useEffect(() => {
    void autosaveOf(app)
      ?.refreshRecovery()
      .catch(() => {});
  }, [app]);

  const close = (): void => {
    void shell.runFromUi('ui.close');
  };

  const recover = async (slot: AutosaveSlotInfo): Promise<void> => {
    if (dirty) {
      const replace = await shell.confirm({
        title: 'Recover project',
        text: 'The current project has unsaved changes. Recovering replaces it.',
        confirmLabel: 'Replace and recover',
      });
      if (!replace) return;
    }
    setBusy(true);
    try {
      await shell.runFromUi('file.recover', { slot: slot.id });
    } finally {
      setBusy(false);
    }
  };

  const discard = async (slot: AutosaveSlotInfo): Promise<void> => {
    const confirmed = await shell.confirm({
      title: 'Discard recovery point',
      text: `'${slot.projectName}' (${relativeTime(slot.savedAt, now)}) will be deleted. This cannot be undone.`,
      confirmLabel: 'Discard',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await shell.runFromUi('file.discardRecovery', { slot: slot.id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title="Recover unsaved work"
        description="These projects were autosaved in this browser but their page closed before they were saved."
        width="md"
        data-testid="recovery-dialog"
      >
        {slots.length === 0 ? (
          <p className="text-ui text-fg-3" data-testid="recovery-empty">
            Nothing to recover.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto" aria-label="Recovery points">
            {slots.map((slot) => (
              <SlotRow
                key={slot.id}
                slot={slot}
                now={now}
                busy={busy}
                onRecover={() => void recover(slot)}
                onDiscard={() => void discard(slot)}
              />
            ))}
          </ul>
        )}
        <DialogFooter>
          <span className="mr-auto self-center text-ui-dense text-fg-3">
            Recovered work opens unsaved: save it to keep it.
          </span>
          <Button variant="ghost" data-testid="recovery-later" onClick={close}>
            {slots.length === 0 ? 'Close' : 'Later'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
