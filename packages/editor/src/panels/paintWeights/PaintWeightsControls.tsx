// The Paint Skin Weights controls (M6B-SPEC §8.7, §5.10–§5.12; C6; AUTORIG-SPEC §5.4, §9 CR-AR-1 — D4 extracted them
// from the Paint Weights panel): host-agnostic (props `app`, `compact`; no dock imports). The panel view (./index.tsx)
// renders them unchanged: the meshes, the influence list (the union of the target meshes' palettes; click = active
// influence, the lock = Hold of the JOINT on every bound mesh of the character, §5.10; the number = points with
// weight; helpers and props in italics), Hold all / Release, the operation (Replace / Add / Scale / Smooth), Value and
// Opacity with Flood, the brush (radius, falloff, Surface / Volume, front faces only, X-mirror stroke), the weight
// display and the normalization note (the panel adds its empty state). `compact` is Auto-Rig's reduced panel (§5.4): the influence list labelled by
// body part (*Left upper arm* …), Replace / Add / Smooth, Value, Radius, Mirror stroke, Flood, Mirror weights L→R and
// C6's "Hidden or inner points…" hint with the two controls it names (Volume, Front faces only). Every control runs a
// C6 operator for the panel.
import type { MeshId } from '@ekza-studio/doc';
import { type BrushSettings, type EditorApp, PANEL, type RunContext, skinTargets } from '@ekza-studio/editor-core';
import { Checkbox, NativeSelect, NumberField } from '@ekza-studio/ui';
import { type JSX, useState } from 'react';
import { usePrefs, useRunOperator, useSession } from '../../hooks';
import { displayMode, type InfluenceRow, influenceRows, setDisplayMode } from './data';

const CTX: RunContext = { panel: PANEL.paintWeights };
const OPS: readonly { readonly op: BrushSettings['op']; readonly label: string }[] = [
  { op: 'replace', label: 'Replace' },
  { op: 'add', label: 'Add' },
  { op: 'scale', label: 'Scale' },
  { op: 'smooth', label: 'Smooth' },
];
/** The operations of the reduced panel (§5.4). */
const COMPACT_OPS: ReadonlySet<BrushSettings['op']> = new Set(['replace', 'add', 'smooth']);
const BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';
const SECTION = 'flex flex-col gap-1 border-t border-line pt-2';
const HEADING = 'text-[10px] uppercase tracking-wide text-fg-3';
const fraction = (value: number): string => value.toFixed(3);

/** A VRM human bone as body-part words: `leftUpperArm` → "Left upper arm". */
export function bodyPartLabel(humanBone: string): string {
  const words = humanBone.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function MeshLine(props: { readonly app: EditorApp; readonly meshes: readonly MeshId[] }): JSX.Element {
  const names = props.meshes.map((id) => props.app.store.get('meshes', id)?.name ?? id);
  return (
    <div className="flex items-center justify-between gap-2" data-testid="pw-mesh">
      <span className="font-semibold text-fg">Paint Weights</span>
      <span className="truncate text-fg-3" title={names.join(', ')}>
        {names.join(', ')}
      </span>
    </div>
  );
}

function rowName(row: InfluenceRow, compact: boolean): string {
  if (compact && row.humanBone !== null) return bodyPartLabel(row.humanBone);
  return `${row.name}${row.role === 'bone' ? '' : ` (${row.role})`}`;
}

function Influences(props: {
  readonly app: EditorApp;
  readonly meshes: readonly MeshId[];
  readonly compact: boolean;
}): JSX.Element {
  const { app, meshes, compact } = props;
  const run = useRunOperator();
  const sort = usePrefs((p) => p.rigging.influenceSort);
  const active = useSession((s) => s.rig.activeInfluence?.joint ?? null);
  useSession((s) => s.rig.holds);
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const rows = influenceRows(app, compact ? 'hierarchy' : sort).filter(
    (row) =>
      needle === '' || row.name.toLowerCase().includes(needle) || (row.humanBone ?? '').toLowerCase().includes(needle),
  );
  return (
    <section className={SECTION} aria-label="Influences">
      <div className="flex items-center gap-2">
        <span className={HEADING}>{compact ? 'Body part' : 'Influences'}</span>
        {compact ? null : (
          <>
            <input
              className="h-5 min-w-0 flex-1 rounded-[3px] border border-line bg-field px-1 text-[11px] text-fg"
              placeholder="filter…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              data-testid="pw-filter"
              aria-label="Filter influences"
            />
            <NativeSelect
              className="h-5 text-[11px]"
              aria-label="Sort influences"
              data-testid="pw-sort"
              value={sort}
              options={[
                { value: 'hierarchy', label: 'Hierarchy' },
                { value: 'alpha', label: 'Alphabetical' },
                { value: 'flat', label: 'Flat' },
              ]}
              onChange={(event) => {
                const prefs = app.prefs.getState();
                app.prefs.setState({
                  rigging: { ...prefs.rigging, influenceSort: event.target.value as typeof sort },
                });
              }}
            />
          </>
        )}
      </div>
      <ul className="flex max-h-64 flex-col overflow-auto" aria-label="Influences">
        {rows.map((row) => (
          <li
            key={row.key}
            aria-current={row.key === active}
            className={`flex items-center gap-1 rounded-[3px] px-1 ${row.key === active ? 'bg-[var(--sel-bg,#2b3a55)] text-fg' : 'hover:bg-[var(--bg-hover,#30323a)]'}`}
            style={{ paddingLeft: `${4 + 8 * (compact ? 0 : row.depth)}px` }}
          >
            <button
              type="button"
              className={`min-w-0 flex-1 truncate text-left ${row.role === 'bone' ? '' : 'italic'}`}
              data-testid={`pw-influence-${row.key}`}
              data-active={row.key === active}
              title={row.humanBone ?? row.name}
              onClick={() => {
                const mesh = meshes[0];
                if (mesh !== undefined) void run('skin.influence.setActive', { mesh, joint: row.key }, CTX);
              }}
            >
              {row.key === active ? '● ' : ''}
              {rowName(row, compact)}
            </button>
            <span className="w-8 text-right tabular-nums text-fg-3">{row.count}</span>
            {compact ? null : (
              <button
                type="button"
                className="w-5 text-center"
                aria-pressed={row.held}
                aria-label={row.held ? `Release ${row.name}` : `Hold ${row.name}`}
                title={row.held ? 'Held (locked): release' : 'Hold (lock) this joint'}
                data-testid={`pw-hold-${row.key}`}
                data-held={row.held}
                onClick={() => void run('skin.influence.hold', { joint: row.key, on: !row.held }, CTX)}
              >
                {row.held ? '🔒' : '🔓'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {compact ? null : (
        <div className="flex gap-1">
          <button
            type="button"
            className={BUTTON}
            data-testid="pw-btn-holdAll"
            onClick={() => void run('skin.influence.holdAll', undefined, CTX)}
          >
            Hold all
          </button>
          <button
            type="button"
            className={BUTTON}
            data-testid="pw-btn-releaseAll"
            onClick={() => void run('skin.influence.releaseAll', undefined, CTX)}
          >
            Release
          </button>
        </div>
      )}
    </section>
  );
}

function Operation(props: { readonly brush: BrushSettings; readonly compact: boolean }): JSX.Element {
  const { brush, compact } = props;
  const run = useRunOperator();
  const set = (patch: Partial<BrushSettings>): void => void run('skin.paint.set', { patch }, CTX);
  return (
    <section className={SECTION} aria-label="Operation">
      <span className={HEADING}>Operation</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Paint operation">
        {OPS.filter((entry) => !compact || COMPACT_OPS.has(entry.op)).map((entry) => (
          <label key={entry.op} className="inline-flex items-center gap-1">
            <input
              type="radio"
              name="pw-op"
              checked={brush.op === entry.op}
              onChange={() => set({ op: entry.op })}
              data-testid={`pw-op-${entry.op}`}
            />
            {entry.label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <span>Value</span>
        <NumberField
          className="h-5 text-[11px]"
          value={brush.value}
          min={brush.op === 'add' ? -1 : 0}
          max={1}
          step={0.1}
          format={fraction}
          onCommit={(value) => set({ value })}
          data-testid="pw-value"
          aria-label="Value"
        />
        {compact ? null : (
          <>
            <span>Opacity</span>
            <NumberField
              className="h-5 text-[11px]"
              value={brush.opacity}
              min={0}
              max={1}
              step={0.1}
              format={fraction}
              onCommit={(opacity) => set({ opacity })}
              data-testid="pw-opacity"
              aria-label="Opacity"
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={BUTTON}
          data-testid="pw-flood"
          title="Apply the operation to every point of the meshes"
          onClick={() => void run('skin.weights.flood', {}, CTX)}
        >
          Flood
        </button>
        {compact ? (
          <button
            type="button"
            className={BUTTON}
            data-testid="pw-mirror-weights"
            title="Copy the weights of the character's left side onto its right side"
            onClick={() => void run('skin.weights.mirror', { direction: 'positive-to-negative' }, CTX)}
          >
            Mirror weights L→R
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Brush(props: { readonly brush: BrushSettings; readonly compact: boolean }): JSX.Element {
  const { brush, compact } = props;
  const run = useRunOperator();
  const set = (patch: Partial<BrushSettings>): void => void run('skin.paint.set', { patch }, CTX);
  return (
    <section className={SECTION} aria-label="Brush">
      <span className={HEADING}>Brush</span>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <span>Radius</span>
        <NumberField
          className="h-5 text-[11px]"
          value={brush.radiusPx}
          min={1}
          max={1000}
          step={5}
          format={(value) => `${Math.round(value)} px`}
          parse={(text) => {
            const value = Number.parseFloat(text);
            return Number.isFinite(value) ? value : null;
          }}
          onCommit={(radiusPx) => set({ radiusPx })}
          data-testid="pw-radius"
          aria-label="Radius (px)"
        />
        {compact ? null : (
          <>
            <span>Falloff</span>
            <NativeSelect
              className="h-5 text-[11px]"
              value={brush.falloff}
              aria-label="Falloff"
              data-testid="pw-falloff"
              options={[
                { value: 'smooth', label: 'Smooth' },
                { value: 'linear', label: 'Linear' },
                { value: 'constant', label: 'Constant' },
              ]}
              onChange={(event) => set({ falloff: event.target.value as BrushSettings['falloff'] })}
            />
          </>
        )}
      </div>
      <div className="flex gap-3" role="radiogroup" aria-label="Reach">
        {(['surface', 'volume'] as const).map((reach) => (
          <label key={reach} className="inline-flex items-center gap-1">
            <input
              type="radio"
              name="pw-reach"
              checked={brush.reach === reach}
              onChange={() => set({ reach })}
              data-testid={`pw-reach-${reach}`}
            />
            {reach === 'surface' ? 'Surface' : 'Volume'}
          </label>
        ))}
      </div>
      <Checkbox
        label="Front faces only"
        checked={brush.frontOnly}
        onChange={(event) => set({ frontOnly: event.target.checked })}
        data-testid="pw-front"
      />
      <Checkbox
        label="Mirror stroke (X)"
        checked={brush.mirror}
        onChange={() => void run('skin.paint.mirrorToggle', undefined, CTX)}
        data-testid="pw-mirror"
      />
      {/* M6b acceptance: Surface stays on the part under the brush and Front faces only skips hidden points, so the
          inner end of a limb box (inside the torso, or on the far side) is out of reach until both are relaxed. */}
      <p className="text-[10px] leading-snug text-fg-3" data-testid="pw-reach-hint">
        {brush.reach === 'volume' && !brush.frontOnly
          ? 'Volume, all faces: the brush reaches every point inside its sphere, hidden and inner ones too.'
          : 'Hidden or inner points (a limb’s end inside the torso, the far side)? Use Volume and untick Front faces only.'}
      </p>
    </section>
  );
}

function Display(props: { readonly app: EditorApp }): JSX.Element {
  const [, bump] = useState(0);
  const mode = displayMode(props.app);
  return (
    <section className={SECTION} aria-label="Display">
      <span className={HEADING}>Display</span>
      <NativeSelect
        className="h-5 text-[11px]"
        aria-label="Weight display"
        data-testid="pw-display"
        value={mode}
        options={[
          { value: 'greyscale', label: 'Greyscale' },
          { value: 'ramp', label: 'Ramp' },
          { value: 'influences', label: 'Influence colours' },
          { value: 'off', label: 'Off' },
        ]}
        onChange={(event) => {
          setDisplayMode(props.app, event.target.value as typeof mode);
          bump((n) => n + 1);
        }}
      />
      <span className="text-[10px] text-fg-3">Normalization: interactive · max 4 influences</span>
    </section>
  );
}

export interface PaintWeightsControlsProps {
  readonly app: EditorApp;
  /** The target meshes; default C6's `skinTargets` (the hilited bound meshes of the active character, else all). */
  readonly meshes?: readonly MeshId[];
  /** The reduced Auto-Rig panel (body-part labels, fewer rows). */
  readonly compact?: boolean;
}

export function PaintWeightsControls(props: PaintWeightsControlsProps): JSX.Element {
  const { app } = props;
  const meshes = props.meshes ?? skinTargets(app);
  const compact = props.compact === true;
  const brush = useSession((s) => s.rig.paint.brush);
  if (compact) {
    return (
      <div className="flex flex-col gap-2 text-ui text-fg-2" data-testid="pw-controls" data-compact="true">
        <Influences app={app} meshes={meshes} compact />
        <Operation brush={brush} compact />
        <Brush brush={brush} compact />
      </div>
    );
  }
  return (
    <>
      <MeshLine app={app} meshes={meshes} />
      <div className="flex gap-3" role="radiogroup" aria-label="Paint mode">
        <label className="inline-flex items-center gap-1">
          <input type="radio" name="pw-mode" checked readOnly data-testid="pw-mode-paint" />
          Paint
        </label>
      </div>
      <Influences app={app} meshes={meshes} compact={false} />
      <Operation brush={brush} compact={false} />
      <Brush brush={brush} compact={false} />
      <Display app={app} />
    </>
  );
}
