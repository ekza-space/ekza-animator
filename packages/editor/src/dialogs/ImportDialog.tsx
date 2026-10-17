// Import dialog (research 09 §10.2; MVP-SPEC §7 WP-8): summary of the dropped model (format, size, licence badge),
// the embedded-clip checklist, clip frame rate and key reduction, then `file.importModel` with those options.
import { DEFAULT_REDUCE } from '@ekza-animator/rig';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  NativeSelect,
  TriangleAlert,
} from '@ekza-animator/ui';
import { type JSX, useId, useState } from 'react';
import { usePrefs } from '../hooks';
import { useShell, useShellUi } from '../shell/context';
import { formatBytes, type ModelSummary } from '../shell/summary';
import type { PendingImport } from '../shell/types';
import { FilePickerDialog } from './OpenDialog';

const FPS_CHOICES = ['source', '24', '25', '30', '48', '50', '60'] as const;

/** ImportModelOptions (MVP-SPEC §4.5) from the dialog state; unset fields keep the operator's defaults. */
export function importOptions(state: {
  readonly selected: ReadonlySet<number>;
  readonly clipCount: number;
  readonly fps: (typeof FPS_CHOICES)[number];
  readonly reduce: boolean | null;
  readonly secondaryControls: boolean;
}): Record<string, unknown> {
  const options: Record<string, unknown> = { secondaryControls: state.secondaryControls };
  if (state.clipCount > 0) {
    options['clips'] =
      state.selected.size === state.clipCount
        ? 'all'
        : state.selected.size === 0
          ? 'none'
          : [...state.selected].sort((a, b) => a - b);
  }
  options['clipFps'] = state.fps === 'source' ? 'source' : { num: Number(state.fps), den: 1 };
  if (state.reduce !== null) options['reduce'] = state.reduce ? DEFAULT_REDUCE : null;
  return options;
}

function Summary(props: { readonly pending: PendingImport; readonly summary: ModelSummary | null }): JSX.Element {
  const { summary } = props;
  return (
    <section className="flex flex-col gap-2" aria-label="Summary">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-ui font-semibold text-fg" title={props.pending.name}>
          {props.pending.name}
        </span>
        <span className="text-ui text-fg-3">{formatBytes(props.pending.bytes.byteLength)}</span>
        <Badge tone="accent" data-testid="import-format-badge">
          {summary?.formatLabel ?? props.pending.importer.label}
        </Badge>
        <Badge
          tone={
            summary === null ? 'neutral' : summary.restricted ? 'warn' : summary.license === null ? 'neutral' : 'ok'
          }
          data-testid="import-license-badge"
          title={summary?.license?.licenseUrl ?? undefined}
        >
          {summary?.licenseLabel ?? 'Licence unknown'}
        </Badge>
      </div>
      {summary === null ? null : (
        <p className="text-ui text-fg-3">
          {summary.meshes} meshes · {summary.nodes} nodes · {summary.skins} skins · {summary.clips.length} embedded
          clips
        </p>
      )}
      {summary?.restricted === true ? (
        <p className="text-ui text-warn">
          The VRM licence forbids modification or redistribution: baking clips into this model needs your
          acknowledgement at export. Separate VRMA files are always allowed.
        </p>
      ) : null}
      {summary?.license?.authors !== undefined && summary.license.authors.length > 0 ? (
        <p className="text-ui text-fg-3">Credits: {summary.license.authors.join(', ')}</p>
      ) : null}
      {props.pending.summaryError === null ? null : (
        <p className="flex items-start gap-1.5 text-ui text-warn" role="alert">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          Could not read the file details ({props.pending.summaryError}). The import may still work.
        </p>
      )}
      {summary === null || summary.warnings.length === 0 ? null : (
        <ul className="list-disc pl-5 text-ui text-fg-3">
          {summary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PendingImportDialog(props: { readonly pending: PendingImport }): JSX.Element {
  const shell = useShell();
  const reducePref = usePrefs((p) => p.reduceOnImport);
  const clips = props.pending.summary?.clips ?? [];
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(clips.map((clip) => clip.index)));
  const [fps, setFps] = useState<(typeof FPS_CHOICES)[number]>('source');
  const [reduce, setReduce] = useState<boolean | null>(null);
  const [secondaryControls, setSecondaryControls] = useState(true);
  const [importing, setImporting] = useState(false);
  const ids = useId();

  const toggleClip = (index: number, checked: boolean): void => {
    const next = new Set(selected);
    if (checked) next.add(index);
    else next.delete(index);
    setSelected(next);
  };

  const confirm = async (): Promise<void> => {
    setImporting(true);
    try {
      await shell.files.confirmImport(
        importOptions({ selected, clipCount: clips.length, fps, reduce, secondaryControls }),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent title="Import model" width="lg" data-testid="import-dialog">
        <div className="flex flex-col gap-4">
          <Summary pending={props.pending} summary={props.pending.summary} />
          {clips.length === 0 ? null : (
            <section className="flex flex-col gap-2" aria-label="Embedded clips">
              <div className="flex items-center gap-2">
                <h3 className="text-ui font-semibold text-fg-2">Embedded clips</h3>
                <span className="text-ui-dense text-fg-3">
                  {selected.size} of {clips.length} selected
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  data-testid="import-clips-all"
                  onClick={() => setSelected(new Set(clips.map((clip) => clip.index)))}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="import-clips-none"
                  onClick={() => setSelected(new Set())}
                >
                  None
                </Button>
              </div>
              <ul className="flex max-h-56 flex-col gap-0.5 overflow-auto rounded-button border border-line bg-field p-1.5">
                {clips.map((clip) => (
                  <li key={clip.index}>
                    <Checkbox
                      checked={selected.has(clip.index)}
                      onChange={(event) => toggleClip(clip.index, event.currentTarget.checked)}
                      data-testid={`import-clip-${clip.index}`}
                      label={
                        <span className="flex gap-2">
                          <span className="truncate">{clip.name}</span>
                          <span className="ekza-numeric text-fg-3">
                            {clip.duration === null ? '' : `${clip.duration.toFixed(2)} s · `}
                            {clip.channels} channels
                          </span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-ui text-fg-2" htmlFor={`${ids}-fps`}>
                  Clip frame rate
                  <NativeSelect
                    id={`${ids}-fps`}
                    value={fps}
                    data-testid="import-fps"
                    onChange={(event) => {
                      const value = FPS_CHOICES.find((choice) => choice === event.currentTarget.value);
                      if (value !== undefined) setFps(value);
                    }}
                    options={FPS_CHOICES.map((choice) => ({
                      value: choice,
                      label: choice === 'source' ? 'Source (detected)' : `${choice} fps`,
                    }))}
                  />
                </label>
                <Checkbox
                  checked={reduce ?? reducePref !== 'never'}
                  onChange={(event) => setReduce(event.currentTarget.checked)}
                  data-testid="import-reduce"
                  label="Reduce keys (error-bounded)"
                />
              </div>
            </section>
          )}
          <Checkbox
            checked={secondaryControls}
            onChange={(event) => setSecondaryControls(event.currentTarget.checked)}
            data-testid="import-secondary"
            label="Create secondary controls for extra joints (hidden by default)"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" data-testid="import-cancel" onClick={() => void shell.runFromUi('ui.close')}>
            Cancel
          </Button>
          <Button variant="primary" disabled={importing} data-testid="import-confirm" onClick={() => void confirm()}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The import dialog: the pending file's options, or a file picker when nothing is pending (File › Import…). */
export function ImportDialog(): JSX.Element {
  const pending = useShellUi((s) => s.pendingImport);
  if (pending === null) return <FilePickerDialog mode="import" />;
  return <PendingImportDialog key={`${pending.name}:${pending.bytes.byteLength}`} pending={pending} />;
}
