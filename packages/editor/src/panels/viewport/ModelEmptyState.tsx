// The Model start card (M6A-SPEC §8.8; research 16 §16.2; B13; lazy chunk): an empty scene in Model offers the low-poly
// primitives (Cube, Cylinder 8, Sphere 12×8, Plane, Cone 8, Torus), the templates (Humanoid guides, Humanoid body
// smooth or segmented, Handheld, Prop), Import mesh…, "Edit a sample: Polybot (CC0)" and "Generate with AI… · Coming
// later" (disabled), with key hints rendered through the keymap (`⌘E` on macOS, `Ctrl+E` elsewhere).
import { type EditorApp, PANEL } from '@ekza-animator/editor-core';
import { type JSX, useRef, useState } from 'react';
import { useRunOperator, useSession } from '../../hooks';
import { scopeChain } from '../../input/keyboard';
import { shortcutFor } from '../../shell/menus';
import { useOwnPointer } from './ownPointer';

const PRIMITIVES = [
  { kind: 'cube', label: 'Cube', glyph: '▣' },
  { kind: 'cylinder', label: 'Cylinder 8', glyph: '◯' },
  { kind: 'sphere', label: 'Sphere 12×8', glyph: '◍' },
  { kind: 'plane', label: 'Plane', glyph: '▭' },
  { kind: 'cone', label: 'Cone 8', glyph: '△' },
  { kind: 'torus', label: 'Torus', glyph: '◎' },
] as const;

const TEMPLATES = [
  { id: 'humanoid', label: 'Humanoid guides', hint: 'Proportion lines and Object X symmetry for meshes you add' },
  { id: 'handheld', label: 'Handheld', hint: 'A grip at the origin for a sword, tool or staff' },
  { id: 'prop', label: 'Prop', hint: 'A small-prop group with a cube standing on the ground' },
] as const;

const BUTTON =
  'pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] ' +
  'px-2 text-[12px] text-fg hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--accent-text,#a996ff)]';

export default function ModelEmptyState(props: { readonly app: EditorApp; readonly paneId: string }): JSX.Element {
  const { app, paneId } = props;
  const run = useRunOperator();
  const busy = useSession((s) => s.busy !== null);
  const [style, setStyle] = useState<'smooth' | 'segmented'>('smooth');
  const card = useRef<HTMLDivElement>(null);
  useOwnPointer(card);
  const ctx = { panel: PANEL.viewport, paneId, source: 'menu' as const };
  const scopes = scopeChain(app, { kind: PANEL.viewport, scope: PANEL.viewport, paneId }).scopes;
  const key = (op: string, args?: unknown): string | null => shortcutFor(app.keymap, op, args, scopes);
  const hints = [
    [key('select.mode', { mode: 'face' }), 'face mode'],
    [key('mesh.extrude'), 'extrude'],
    ['Shift+drag', 'extrude'],
    [key('model.softSelect.toggle'), 'soft select'],
  ].filter((hint): hint is [string, string] => hint[0] !== null);
  return (
    <div
      ref={card}
      className="pointer-events-auto flex max-w-[34rem] flex-col items-center gap-3 rounded-lg border border-line bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] px-6 py-5 text-center text-[12px] text-fg-2 shadow-lg"
      data-testid="model-start"
    >
      <h2 className="text-[14px] font-semibold text-fg">Start a low-poly model</h2>
      <div className="flex flex-wrap justify-center gap-1.5">
        {PRIMITIVES.map((primitive) => (
          <button
            key={primitive.kind}
            type="button"
            className={BUTTON}
            disabled={busy}
            data-testid={`model-start-${primitive.kind}`}
            onClick={() => void run(`mesh.create.${primitive.kind}`, undefined, ctx)}
          >
            <span aria-hidden="true" className="text-fg-3">
              {primitive.glyph}
            </span>
            {primitive.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <span className="inline-flex items-center">
          <button
            type="button"
            className={`${BUTTON} rounded-r-none`}
            disabled={busy}
            title="One X-symmetric mesh in T-pose, about 500 triangles, grounded and facing +Z"
            data-testid="model-start-template-humanoidBody"
            onClick={() => void run('mesh.create.template', { template: 'humanoidBody', style }, ctx)}
          >
            <span aria-hidden="true" className="text-fg-3">
              ☺
            </span>
            Humanoid body
          </button>
          <select
            className={`${BUTTON} rounded-l-none border-l-0 pr-1`}
            value={style}
            aria-label="Humanoid body style"
            data-testid="model-start-template-humanoidBody-style"
            onChange={(event) => setStyle(event.currentTarget.value === 'segmented' ? 'segmented' : 'smooth')}
          >
            <option value="smooth">Smooth</option>
            <option value="segmented">Segmented</option>
          </select>
        </span>
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={BUTTON}
            disabled={busy}
            title={template.hint}
            data-testid={`model-start-template-${template.id}`}
            onClick={() => void run('mesh.create.template', { template: template.id }, ctx)}
          >
            {template.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          title="Open a .glb, .gltf or .vrm and make its meshes editable"
          data-testid="model-start-import"
          onClick={() => void run('ui.open', { dialog: 'open' }, ctx)}
        >
          Import mesh… <span className="text-fg-3">.glb .gltf .vrm</span>
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={busy}
          title="Polybot by Polygonal Mind (100Avatars), CC0 1.0: real low-poly VRM topology to learn from"
          data-testid="model-start-sample"
          onClick={() => void run('file.loadSample', { sample: 'polybot' }, ctx)}
        >
          Edit a sample: Polybot (CC0)
        </button>
        <button type="button" className={BUTTON} disabled title="Coming later" data-testid="model-start-generate">
          Generate with AI… <span className="text-fg-3">Coming later</span>
        </button>
      </div>
      {hints.length === 0 ? null : (
        <p className="text-[11px] text-fg-3" data-testid="model-start-hints">
          {hints.map(([chord, what], i) => (
            <span key={`${chord}-${what}`}>
              {i === 0 ? '' : ' · '}
              <kbd className="font-sans text-fg-2">{chord}</kbd> {what}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
