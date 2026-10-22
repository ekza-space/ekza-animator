// The Quick Rig panel body (M6B-SPEC §0.2 steps 1–5, §0.4.2; C3): host-agnostic (CR-AR-1 `QuickRigPanelBody`: props
// `app` and `compact`, no dock imports), shown by the Quick Rig panel and inside the Rig Toolkit's Skeleton section
// while Quick Rig runs. Top to bottom: the start-check notice with its fixes (Center and ground, Rotate to face +Z),
// the re-run line, the A-pose notice and a failed guess's reason; the marker list (name and state — guessed, moved,
// missing — the selected marker highlighted, a click selects it); after Clear the next marker to click in the front
// view; the template select (locked on a re-run); Guess, Clear, Create Skeleton (disabled with the reason until the
// checks pass) and Cancel. A re-run on a bound character asks "Rebind replaces painted weights" before it commits.
import {
  A_POSE_NOTICE,
  CHECK_REASONS,
  type EditorApp,
  nextMissingMarker,
  PANEL,
  PRESET_LOCKED,
  QUICK_RIG_LABELS,
  QUICK_RIG_MARKERS,
  type QuickRigState,
  quickRigCommitArgs,
  quickRigCommitBlock,
  REBIND_CONFIRM,
  type RunContext,
} from '@ekza-studio/editor-core';
import type { QuickRigMarker, SkeletonPreset } from '@ekza-studio/rig';
import { type JSX, useState } from 'react';
import { useRunOperator, useSession } from '../../hooks';

const CTX: RunContext = { panel: PANEL.rigToolkit, source: 'toolkit' };

export const QUICK_RIG_BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY =
  'inline-flex h-6 items-center rounded-[4px] bg-[var(--accent,#3d7bfd)] px-2 text-[11px] font-semibold text-white ' +
  'hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';

export const PRESET_LABELS: Readonly<Record<SkeletonPreset, string>> = {
  lite17: 'Lite 17',
  core21: 'Core 21',
  standard33: 'Standard 33',
  full52: 'Full 52',
};

/** The state word of a marker in the list. */
export function markerStatus(state: QuickRigState, name: QuickRigMarker): 'missing' | 'moved' | 'guessed' {
  if (state.markers[name] === undefined) return 'missing';
  return state.moved.has(name) ? 'moved' : 'guessed';
}

export interface QuickRigPanelBodyProps {
  readonly app: EditorApp;
  /** Denser layout (the Rig Toolkit section, other shells). */
  readonly compact?: boolean;
}

export function QuickRigPanelBody(props: QuickRigPanelBodyProps): JSX.Element {
  const state = useSession((s) => s.rig.quickRig);
  const run = useRunOperator();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state === null) {
    return (
      <div className="text-ui text-fg-3" data-testid="quickrig-panel" data-open="false">
        Select the meshes of your character, then Quick Rig places markers on them.
      </div>
    );
  }

  const failing = (['centred', 'grounded', 'facing'] as const).filter((key) => !state.checks[key]);
  const block = quickRigCommitBlock(state);
  const next = nextMissingMarker(state.markers);
  const commit = async (confirmed: boolean): Promise<void> => {
    setError(null);
    setBusy(true);
    const result = await run(
      'skel.quickRig.commit',
      { ...quickRigCommitArgs(state), ...(confirmed ? { confirm: true } : {}) },
      CTX,
    );
    setBusy(false);
    if (result.status === 'failed' && result.error.code === 'confirm-required') {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    if (result.status === 'failed') setError(result.error.message);
    else if (result.status === 'cancelled') setError(result.reason);
  };

  return (
    <div
      className={`flex flex-col ${props.compact === true ? 'gap-1.5' : 'gap-2 p-2'} text-ui text-fg`}
      data-testid="quickrig-panel"
      data-open="true"
    >
      {failing.length > 0 ? (
        <div
          className="flex flex-col gap-1 rounded-[4px] border border-[var(--warn,#e8b04a)] p-1.5"
          role="alert"
          data-testid="quickrig-notice"
        >
          {failing.map((key) => (
            <span key={key} data-testid={`quickrig-check-${key}`}>
              {CHECK_REASONS[key]}
            </span>
          ))}
          <span className="flex gap-1">
            {failing.includes('centred') || failing.includes('grounded') ? (
              <button
                type="button"
                className={QUICK_RIG_BUTTON}
                data-testid="quickrig-fix-center"
                onClick={() => void run('skel.quickRig.center', { meshes: state.meshes }, CTX)}
              >
                Center and ground
              </button>
            ) : null}
            {failing.includes('facing') ? (
              <button
                type="button"
                className={QUICK_RIG_BUTTON}
                data-testid="quickrig-fix-face"
                onClick={() => void run('skel.quickRig.faceForward', { meshes: state.meshes }, CTX)}
              >
                Rotate to face +Z
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {state.refit !== null ? (
        <p className="text-[11px] text-fg-3" data-testid="quickrig-refit">
          Refits the {PRESET_LABELS[state.preset]} skeleton in place (same joints).
        </p>
      ) : null}
      {state.guess?.aPose === true ? (
        <p className="text-[11px] text-warn" role="note" data-testid="quickrig-apose">
          {A_POSE_NOTICE}
        </p>
      ) : null}
      {state.guess?.failed !== null && state.guess?.failed !== undefined ? (
        <p className="text-[11px] text-fg-3" data-testid="quickrig-guess-failed">
          {state.guess.failed}
        </p>
      ) : null}
      <ol className="flex flex-col" aria-label="Quick Rig markers" data-testid="quickrig-markers">
        {QUICK_RIG_MARKERS.map((name) => {
          const status = markerStatus(state, name);
          const selected = state.selected === name;
          return (
            <li key={name}>
              <button
                type="button"
                className={`flex h-6 w-full items-center justify-between rounded-[3px] px-1.5 text-left ${
                  selected ? 'bg-[var(--bg-selected,#2f4f8f)] text-white' : 'hover:bg-[var(--bg-hover,#30323a)]'
                }`}
                aria-pressed={selected}
                data-testid={`quickrig-marker-${name}`}
                data-status={status}
                onClick={() => void run('skel.quickRig.pick', { marker: selected ? null : name }, CTX)}
              >
                <span>{QUICK_RIG_LABELS[name]}</span>
                <span className={status === 'missing' ? 'text-warn' : 'text-fg-3'}>{status}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {next !== null && failing.length === 0 ? (
        <p className="text-[11px] text-fg-3" data-testid="quickrig-next" data-marker={next}>
          Click in the front view to place: {QUICK_RIG_LABELS[next]}
        </p>
      ) : (
        <p className="text-[11px] text-fg-3" data-testid="quickrig-hint">
          Front view moves X/Y, side view Z/Y. Select a marker here to drag it where markers overlap.
        </p>
      )}
      <label className="flex items-center justify-between gap-2">
        <span>Template</span>
        <select
          className="h-6 rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-1 text-[11px] text-fg"
          value={state.preset}
          disabled={state.refit !== null}
          title={state.refit !== null ? PRESET_LOCKED : undefined}
          data-testid="quickrig-preset"
          onChange={(event) => void run('skel.quickRig.setPreset', { preset: event.target.value }, CTX)}
        >
          {(Object.keys(PRESET_LABELS) as SkeletonPreset[]).map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={QUICK_RIG_BUTTON}
          disabled={failing.length > 0}
          title={failing.length > 0 ? CHECK_REASONS[failing[0] ?? 'centred'] : 'Place every marker from the silhouette'}
          data-testid="quickrig-guess"
          onClick={() => void run('skel.quickRig.guess', undefined, CTX)}
        >
          Guess
        </button>
        <button
          type="button"
          className={QUICK_RIG_BUTTON}
          data-testid="quickrig-clear"
          onClick={() => void run('skel.quickRig.clear', undefined, CTX)}
        >
          Clear
        </button>
        <button
          type="button"
          className={QUICK_RIG_BUTTON}
          data-testid="quickrig-cancel"
          onClick={() => void run('skel.quickRig.cancel', undefined, CTX)}
        >
          Cancel
        </button>
        <button
          type="button"
          className={PRIMARY}
          disabled={block !== null || busy || confirm}
          title={block ?? undefined}
          data-testid="quickrig-commit"
          onClick={() => void commit(false)}
        >
          Create Skeleton
        </button>
      </div>
      {confirm ? (
        <div
          className="flex flex-col gap-1 rounded-[4px] border border-[var(--warn,#e8b04a)] p-1.5"
          role="alertdialog"
          aria-label={REBIND_CONFIRM}
          data-testid="quickrig-rebind-confirm"
        >
          <span>{REBIND_CONFIRM}</span>
          <span className="flex gap-1">
            <button
              type="button"
              className={PRIMARY}
              data-testid="quickrig-rebind-yes"
              onClick={() => void commit(true)}
            >
              Rebind
            </button>
            <button
              type="button"
              className={QUICK_RIG_BUTTON}
              data-testid="quickrig-rebind-no"
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {error === null ? null : (
        <p className="text-[11px] text-danger" role="alert" data-testid="quickrig-error">
          {error}
        </p>
      )}
    </div>
  );
}
