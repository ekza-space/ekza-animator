// The Rig Toolkit (M6B-SPEC §8.6, §0.4.5, §5.21; C7 frame, sections by their owners): a lazy chunk — panels/index.ts
// registers the panel with `lazyPanelDef`, so nothing of this directory is in the editor route. Top to bottom: header
// (character · preset · joint count · glyph), mode switcher, the MVP setup checklist (① Place markers … ⑥ Export,
// collapsing to `Setup 6/6 · ●`), the owners' sections (Skeleton C3, Skin C6, Character C10, Clip Library C12) and
// the footer hand-off (Validation summary, Export Character…, Open in Animate ▸). Buttons run operators with
// `source: 'toolkit'`; a disabled button shows the poll reason. Without a character: the empty state with Quick Rig
// on the selected meshes.
import type { DocumentStore } from '@ekza-studio/doc';
import {
  type ChecklistStep,
  checklistSummary,
  type EditorApp,
  PANEL,
  type RigMode,
  type RunContext,
  type WorkspaceStatus,
} from '@ekza-studio/editor-core';
import { ToggleGroup, ToggleGroupItem } from '@ekza-studio/ui';
import { type JSX, useState } from 'react';
import { useDocQuery, useRunOperator, useSession } from '../../hooks';
import { useReasons, useRig } from '../../shell/rig/hooks';
import type { PanelProps } from '../types';
import { RIG_TOOLKIT_SECTIONS } from './sections';

const CTX: RunContext = { panel: PANEL.rigToolkit, source: 'toolkit' };
const STEP_GLYPH: Readonly<Record<ChecklistStep['glyph'], string>> = { done: '✓', attention: '◐', todo: '○' };
const TAB_GLYPH: Readonly<Record<WorkspaceStatus['glyph'], string>> = {
  done: '●',
  attention: '◐',
  todo: '○',
  none: '○',
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];
const BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';

const MODES: readonly { readonly mode: RigMode; readonly label: string }[] = [
  { mode: 'object', label: 'Object' },
  { mode: 'skeleton', label: 'Skeleton' },
  { mode: 'skin', label: 'Skin' },
];
const MODE_POLLS = MODES.map((entry) => ['rig.mode', { mode: entry.mode }] as const);

/** The header line of a character: name · preset · joint count. */
function header(store: DocumentStore, character: string | null): string | null {
  const record = character === null ? undefined : store.get('characters', character as never);
  if (record === undefined) return null;
  const skeleton = store.query.skeletonOfCharacter(record.id);
  if (skeleton === undefined) return record.name;
  const joints = store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null).length;
  return `${record.name} · ${skeleton.preset} · ${joints} joints`;
}

function OpButton(props: {
  readonly app: EditorApp;
  readonly op: string;
  readonly args?: unknown;
  readonly label: string;
  readonly testId?: string;
}): JSX.Element {
  const run = useRunOperator();
  const [reason] = useReasons(props.app, [[props.op, props.args]]);
  return (
    <button
      type="button"
      className={BUTTON}
      disabled={reason !== null}
      title={reason ?? undefined}
      data-testid={props.testId ?? `rtk-btn-${props.op}`}
      onClick={() => void run(props.op, props.args, CTX)}
    >
      {props.label}
    </button>
  );
}

function ModeSwitcher(props: { readonly app: EditorApp }): JSX.Element {
  const mode = useSession((s) => s.rig.mode);
  const reasons = useReasons(props.app, MODE_POLLS);
  const run = useRunOperator();
  return (
    <ToggleGroup
      type="single"
      value={mode}
      aria-label="Rig & Skin mode"
      data-testid="rtk-modes"
      onValueChange={(value) => {
        if (value !== '' && value !== mode) void run('rig.mode', { mode: value }, CTX);
      }}
    >
      {MODES.map((entry, i) => {
        const reason = entry.mode === mode ? null : (reasons[i] ?? null);
        return (
          <ToggleGroupItem
            key={entry.mode}
            value={entry.mode}
            aria-label={reason === null ? entry.label : `${entry.label} (${reason})`}
            title={reason ?? undefined}
            disabled={reason !== null}
            data-testid={`rtk-mode-${entry.mode}`}
          >
            <span className="text-ui">{entry.label}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function Checklist(props: {
  readonly app: EditorApp;
  readonly steps: readonly ChecklistStep[];
  readonly glyph: string;
}): JSX.Element {
  const complete = props.steps.every((step) => step.glyph === 'done');
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !complete;
  return (
    <section data-testid="rtk-checklist" data-complete={complete}>
      <button
        type="button"
        className="flex w-full items-center justify-between text-left font-semibold text-fg"
        aria-expanded={expanded}
        data-testid="rtk-checklist-toggle"
        onClick={() => setOpen(!expanded)}
      >
        <span>{expanded ? 'Setup' : checklistSummary(props.steps, props.glyph)}</span>
        <span className="text-fg-3">{expanded ? '⌄' : '›'}</span>
      </button>
      {expanded ? (
        <ol className="mt-1 flex flex-col gap-1">
          {props.steps.map((step) => (
            <li
              key={step.step}
              className="flex items-center gap-2"
              data-testid={`rtk-step-${step.step}`}
              data-glyph={step.glyph}
            >
              <span aria-label={step.glyph} className="w-3 text-center">
                {STEP_GLYPH[step.glyph]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-fg">
                  {CIRCLED[step.step - 1]} {step.label}
                </span>
                {step.detail === null ? null : <span className="block text-[10px] text-fg-3">{step.detail}</span>}
              </span>
              {step.button === null ? null : (
                <OpButton
                  app={props.app}
                  op={step.button.op}
                  args={step.button.args}
                  label={step.button.label}
                  testId={`rtk-step-${step.step}-btn`}
                />
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default function RigToolkitView(props: PanelProps): JSX.Element {
  const { app } = props;
  const validation = useRig(app);
  const character = useSession((s) => s.rig.character);
  const quickRig = useSession((s) => s.rig.quickRig !== null);
  const title = useDocQuery((store) => header(store, character), ['characters', 'skeletons', 'joints']);
  if (validation === null) {
    return (
      <div className="grid h-full place-items-center p-4 text-ui text-fg-3" data-testid="rtk-panel">
        Loading Rig & Skin…
      </div>
    );
  }
  const status = character === null ? null : validation.status(character, null);
  const glyph = TAB_GLYPH[status?.glyph ?? 'todo'];
  const steps = validation.checklist(character);
  const rows = character === null ? [] : validation.rows(character, null);
  const errors = rows.filter((row) => row.severity === 'error').length;
  const warnings = rows.filter((row) => row.severity === 'warning').length;
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-2 text-ui text-fg-2" data-testid="rtk-panel">
      <header className="flex items-center justify-between gap-2" data-testid="rtk-header">
        <span className="truncate font-semibold text-fg">
          {title ?? (quickRig ? 'Quick Rig: new character' : 'No character')}
        </span>
        <span title={status?.reasons.join('\n') ?? 'No skeleton yet'} data-testid="rtk-glyph">
          {glyph}
        </span>
      </header>
      {character === null && quickRig ? (
        <p className="text-fg-3" data-testid="rtk-quickrig">
          Drag the markers in the front and side views, then Create Skeleton in the Quick Rig panel.
        </p>
      ) : character === null ? (
        <p className="text-fg-3" data-testid="rtk-empty">
          Select a mesh to turn into a character, or a character. Quick Rig places the joint markers for you.
        </p>
      ) : (
        <ModeSwitcher app={app} />
      )}
      <Checklist app={app} steps={steps} glyph={glyph} />
      {RIG_TOOLKIT_SECTIONS.map((section) => (
        <section key={section.id} data-testid={`rtk-section-${section.id}`}>
          <h3 className="font-semibold text-fg">{section.title}</h3>
          <section.component app={app} />
        </section>
      ))}
      <footer className="mt-auto flex flex-col gap-1 border-t border-line pt-2" data-testid="rtk-footer">
        <span className="text-fg-3" data-testid="rtk-validation-summary">
          {character === null
            ? 'Validation: no character'
            : `Validation: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}
        </span>
        <div className="flex flex-wrap gap-1">
          <OpButton
            app={app}
            op="workspace.showPanel"
            args={{ panel: PANEL.validation }}
            label="Validation"
            testId="rtk-open-validation"
          />
          <OpButton app={app} op="ui.open" args={{ dialog: 'export' }} label="Export Character…" testId="rtk-export" />
          <OpButton
            app={app}
            op="workspace.set"
            args={{ workspace: 'animate' }}
            label="Open in Animate ›"
            testId="rtk-animate"
          />
        </div>
      </footer>
    </div>
  );
}
