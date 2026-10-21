// The Palette panel's body (M6A-SPEC §5.19, §8.8; research 16 §14; B13; lazy chunk): the project palette dropdown,
// the swatch grid (8 per row, 20 px, a check glyph and ring on the active swatch), the active swatch's name and sRGB hex
// field (a colour popover on double-click), Apply (the active swatch on the selected faces, or on every face of the
// selected mesh objects; refused when the swatch is not in a target's palette), Pick from mesh (the Paint Colour
// tool's `I` eyedropper), Add, Recents, "Used on mesh: n of m · Select faces", "Export colours as" and Duplicate
// palette (a variant). SHADING-SPEC §5: the active swatch's shader (Lambert/Blinn, glossiness, specular) and New
// Lambert / New Blinn (Assign New Material on the selection); Blinn swatches show a highlight dot. Every edit runs an
// operator.
import type { DocumentStore, MeshId, MeshRecord, PaletteId, SwatchId, SwatchRecord } from '@ekza-animator/doc';
import { type EditorApp, PANEL, paintRefusal, parseHex, type SessionState, toHex } from '@ekza-animator/editor-core';
import { type JSX, type KeyboardEvent, type MouseEvent, useCallback, useId, useMemo, useState } from 'react';
import { useDocQuery, usePrefs, useRunOperator, useSession } from '../../hooks';
import { shortcutFor } from '../../shell/menus';
import { type MenuEntry, useContextMenu } from '../channel-box/kit/menu';
import { Popover } from '../channel-box/kit/popover';
import { useMeshRuntimesVersion } from './hooks';
import { BUTTON, CHECK, EMPTY_STATE, INPUT, INVALID, MUTED_TEXT, PANEL_ROOT, SELECT } from '../channel-box/kit/styles';
import {
  contrastOn,
  leadMeshId,
  palettesOf,
  pushRecent,
  shownPalette,
  swatchesOf,
  targetMeshIds,
  usageLine,
  usedSlots,
} from './model';

const PANEL_KIND = 'palette';
const OUTPUTS = [
  { value: 'palette-texture', label: 'Palette texture', hint: 'One material and a small palette PNG (default)' },
  { value: 'vertex-colour', label: 'Vertex colours', hint: 'COLOR_0 with a white base colour' },
  { value: 'material-per-colour', label: 'One material per colour', hint: 'A material per used swatch' },
] as const;

const SHADERS = [
  { value: 'lambert', label: 'Lambert', hint: 'Matte: diffuse light only (glTF roughness 1, metallic 0)' },
  {
    value: 'blinn',
    label: 'Blinn',
    hint: 'Shiny: a highlight (glTF roughness 1 − glossiness, KHR_materials_specular)',
  },
] as const;

const selectActive = (s: SessionState): string | null => s.model.activeSwatch;
const selectLead = (s: SessionState): MeshId | null => leadMeshId(s);
const selectTargets = (s: SessionState): string => targetMeshIds(s).join(',');
const selectMode = (s: SessionState): string => s.model.componentMode;

interface PaletteDoc {
  readonly palettes: ReturnType<typeof palettesOf>;
  readonly mesh: MeshRecord | null;
  readonly store: DocumentStore;
}

export default function PaletteView(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const run = useRunOperator();
  const ids = useId();
  const lead = useSession(selectLead);
  const targetsKey = useSession(selectTargets);
  const mode = useSession(selectMode);
  const activeId = useSession(selectActive);
  const recents = usePrefs((p) => p.modeling.paletteRecents);
  const [choice, setChoice] = useState<PaletteId | null>(null);
  const [editing, setEditing] = useState<{ readonly swatch: SwatchId; readonly anchor: HTMLElement } | null>(null);
  const menu = useContextMenu();

  const read = useCallback(
    (store: DocumentStore): PaletteDoc => ({
      palettes: palettesOf(store),
      mesh: lead === null ? null : (store.get('meshes', lead) ?? null),
      store,
    }),
    [lead],
  );
  const doc = useDocQuery(read, ['palettes', 'swatches', 'meshes']);
  const palette = shownPalette(doc.palettes, choice, doc.mesh);
  const swatches = useMemo(() => swatchesOf(doc.store, palette), [doc, palette]);
  const active = useMemo(
    () => (activeId === null ? null : (doc.store.get('swatches', activeId as SwatchId) ?? null)),
    [doc, activeId],
  );
  // The mesh's runtime data (its paint layer) changes with mesh revisions, which the `meshes` table reports.
  // The mesh's paint layer lives in its runtime: re-read when runtimes load or rebuild (revisions change the doc).
  useMeshRuntimesVersion(app);
  const used = lead === null ? null : usedSlots(app, lead);
  const targets = useMemo(() => (targetsKey === '' ? [] : (targetsKey.split(',') as MeshId[])), [targetsKey]);

  const setActive = (swatch: SwatchRecord): void => {
    void run('palette.setActive', { swatch: swatch.id }, { panel: PANEL_KIND });
    const modeling = app.prefs.getState().modeling;
    const next = pushRecent(modeling.paletteRecents, swatch.id);
    if (next.join() !== modeling.paletteRecents.join()) {
      void run('prefs.set', { patch: { modeling: { ...modeling, paletteRecents: next } } }, { panel: PANEL_KIND });
    }
  };

  const apply = (): void => {
    if (active === null) return;
    const state = app.session.getState();
    const hilite = state.model.hilite;
    const faceMode = state.model.componentMode === 'face' && hilite.length > 0;
    // A swatch of another palette would paint its slot's colour of the mesh's palette: refuse (Assign offers it).
    const problem = paintRefusal(app, faceMode ? hilite : targetMeshIds(state), active);
    if (problem !== null) {
      app.services.notify.toast({ kind: 'warning', text: problem });
      return;
    }
    if (faceMode) {
      void run('mesh.paint', { kind: 'face', slot: active.slot }, { panel: PANEL_KIND });
      return;
    }
    // Object mode: every face of the selected authored meshes (Maya assigns to the whole object), one `mesh.paint`
    // run per mesh — its `faces` list is shared by all its targets (M6A-B13-17).
    const meshes = targetMeshIds(state);
    for (const mesh of meshes) {
      const faces = app.meshes.get(mesh)?.data()?.counts.faces ?? 0;
      void run(
        'mesh.paint',
        { meshes: [mesh], kind: 'face', slot: active.slot, faces: Array.from({ length: faces }, (_, f) => f) },
        { panel: PANEL_KIND },
      );
    }
  };
  const applyProblem =
    active === null
      ? 'Pick a swatch first'
      : mode === 'face'
        ? paintRefusal(app, app.session.getState().model.hilite, active)
        : targets.length === 0
          ? 'Select a mesh or faces first'
          : paintRefusal(app, targets, active);

  const pick = (): void => {
    void run('view.tool', { panel: PANEL.viewport, tool: 'paint' }, { panel: PANEL_KIND });
    app.services.notify.toast({ kind: 'info', text: 'Hold I and click a face to pick its colour' });
  };

  const add = (): void => {
    if (palette === null) return;
    const srgb = active?.srgb ?? ([128, 128, 128] as const);
    void run('palette.addSwatch', { palette, srgb: [...srgb] }, { panel: PANEL_KIND }).then((result) => {
      if (result.status !== 'finished') return;
      const swatch = (result.value as { swatch: SwatchId }).swatch;
      const record = app.store.get('swatches', swatch);
      if (record !== undefined) setActive(record);
    });
  };

  const openMenu = (swatch: SwatchRecord, event: MouseEvent<HTMLElement>): void => {
    const anchor = event.currentTarget;
    const entries: MenuEntry[] = [
      { kind: 'item', id: 'active', label: 'Make Active', onSelect: () => setActive(swatch) },
      {
        kind: 'item',
        id: 'edit',
        label: 'Edit Colour…',
        testId: 'palette-menu-edit',
        onSelect: () => setEditing({ swatch: swatch.id, anchor }),
      },
      {
        kind: 'item',
        id: 'replace',
        label: active === null ? 'Replace with Active Swatch' : `Replace with ${active.name}`,
        testId: 'palette-menu-replace',
        disabled: active === null || active.id === swatch.id || palette === null,
        title: 'Repaints every face of this swatch with the active swatch on the meshes using the palette',
        onSelect: () => {
          if (active === null || palette === null) return;
          void run('palette.replaceSwatch', { palette, from: swatch.slot, to: active.slot }, { panel: PANEL_KIND });
        },
      },
      { kind: 'separator', id: 'sep' },
      {
        kind: 'item',
        id: 'remove',
        label: 'Remove Swatch',
        testId: 'palette-menu-remove',
        onSelect: () => void run('palette.removeSwatch', { swatch: swatch.id }, { panel: PANEL_KIND }),
      },
    ];
    menu.open(event, swatch.name, entries);
  };

  if (doc.palettes.length === 0 || palette === null) {
    return (
      <div className={PANEL_ROOT} data-testid="palette-empty">
        <div className={`${EMPTY_STATE} flex flex-col gap-2`}>
          <p>No palette in this project</p>
          <button
            type="button"
            className={BUTTON}
            data-testid="palette-use-default"
            onClick={() => void run('palette.ensureDefault', undefined, { panel: PANEL_KIND })}
          >
            Use Ekza Default 16
          </button>
        </div>
      </div>
    );
  }

  const recentSwatches = recents
    .map((id) => doc.store.get('swatches', id as SwatchId))
    .filter((swatch): swatch is SwatchRecord => swatch !== undefined && swatch.palette === palette);
  const usage = usageLine(used, swatches);
  const mesh = doc.mesh;
  const outputEditable = mesh !== null && mesh.source === null;
  const selectFacesProblem =
    active === null
      ? 'Pick a swatch first'
      : lead === null
        ? 'Select a mesh first'
        : targets.length > 0 && targets.every((id) => doc.store.get('meshes', id)?.palette !== active.palette)
          ? "The active swatch is not in the selected meshes' palette"
          : null;
  const applyKey = shortcutFor(app.keymap, 'mesh.paint', undefined);

  return (
    <div className={`${PANEL_ROOT} overflow-auto`} data-testid="palette-view">
      <div className="flex flex-col gap-2 p-2">
        <label className="flex items-center gap-2 text-fg-2" htmlFor={`${ids}-palette`}>
          <span className="shrink-0">Project palette</span>
          <select
            id={`${ids}-palette`}
            className={`${SELECT} min-w-0 flex-1`}
            value={palette}
            data-testid="palette-select"
            onChange={(event) => setChoice(event.currentTarget.value as PaletteId)}
          >
            {doc.palettes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {mesh !== null && mesh.source === null && mesh.palette !== palette ? (
            <button
              type="button"
              className={BUTTON}
              data-testid="palette-assign"
              title="Paint the selected meshes with this palette"
              onClick={() => void run('palette.assign', { palette, meshes: targets }, { panel: PANEL_KIND })}
            >
              Assign
            </button>
          ) : null}
        </label>

        <fieldset aria-label="Swatches" className="grid w-fit grid-cols-8 gap-1" data-testid="palette-swatches">
          {swatches.map((swatch) => (
            <SwatchCell
              key={swatch.id}
              swatch={swatch}
              active={swatch.id === active?.id}
              onActivate={() => setActive(swatch)}
              onEdit={(anchor) => {
                setActive(swatch);
                setEditing({ swatch: swatch.id, anchor });
              }}
              onMenu={(event) => openMenu(swatch, event)}
            />
          ))}
        </fieldset>

        <ActiveRow app={app} active={active} run={run} />
        {active === null ? null : <ShaderSection key={`${active.id}:${active.glossiness}`} swatch={active} run={run} />}

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className={BUTTON}
            disabled={applyProblem !== null}
            title={
              applyProblem ?? `Paint the selection with the active swatch${applyKey === null ? '' : ` (${applyKey})`}`
            }
            data-testid="palette-apply"
            onClick={apply}
          >
            Apply ⏎
          </button>
          <button
            type="button"
            className={BUTTON}
            title="Paint Colour tool: hold I and click a face"
            data-testid="palette-pick"
            onClick={pick}
          >
            Pick from mesh <kbd className="text-fg-3">I</kbd>
          </button>
          <button
            type="button"
            className={BUTTON}
            title="Add a swatch (a new slot) with the active colour"
            aria-label="Add swatch"
            data-testid="palette-add"
            onClick={add}
          >
            +
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1" data-testid="palette-new-material">
          <span className={`${MUTED_TEXT} mr-1`}>New material</span>
          {SHADERS.map((shader) => (
            <button
              key={shader.value}
              type="button"
              className={BUTTON}
              title={`Assign New Material › ${shader.label}: a new ${shader.label} swatch on the selected faces or objects`}
              data-testid={`palette-new-${shader.value}`}
              onClick={() => void run('palette.assignMaterial', { shader: shader.value }, { panel: PANEL_KIND })}
            >
              {shader.label}
            </button>
          ))}
        </div>

        {recentSwatches.length === 0 ? null : (
          <div className="flex items-center gap-1" data-testid="palette-recents">
            <span className={`${MUTED_TEXT} mr-1`}>Recent</span>
            {recentSwatches.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                className="size-4 rounded-[3px] border border-line"
                style={{ background: toHex(swatch.srgb) }}
                title={`${swatch.name} · ${toHex(swatch.srgb)}`}
                aria-label={`Recent: ${swatch.name}`}
                data-testid={`palette-recent-${swatch.slot}`}
                onClick={() => setActive(swatch)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 text-fg-2" data-testid="palette-usage">
          <span>{usage ?? 'Used on mesh: select a mesh'}</span>
          <span className={MUTED_TEXT}>·</span>
          <button
            type="button"
            className={BUTTON}
            disabled={selectFacesProblem !== null}
            title={selectFacesProblem ?? 'Select the faces painted with the active swatch'}
            data-testid="palette-select-faces"
            onClick={() => void run('select.mesh.bySwatch', undefined, { panel: PANEL_KIND })}
          >
            Select faces
          </button>
        </div>

        <fieldset className="flex flex-col gap-1" disabled={!outputEditable} data-testid="palette-output">
          <legend className="mb-1 text-fg-2">Export colours as</legend>
          {OUTPUTS.map((output) => (
            <label key={output.value} className="flex items-center gap-1.5 text-fg" title={output.hint}>
              <input
                type="radio"
                className={CHECK}
                name={`${ids}-output`}
                checked={mesh?.colourOutput === output.value}
                data-testid={`palette-output-${output.value}`}
                onChange={() =>
                  void run(
                    'mesh.setAttributes',
                    { mesh: mesh?.id, patch: { colourOutput: output.value } },
                    { panel: PANEL_KIND },
                  ).then(() => {
                    for (const other of targets) {
                      if (other === mesh?.id) continue;
                      void run(
                        'mesh.setAttributes',
                        { mesh: other, patch: { colourOutput: output.value } },
                        { panel: PANEL_KIND },
                      );
                    }
                  })
                }
              />
              {output.label}
            </label>
          ))}
          {outputEditable ? null : (
            <p className={MUTED_TEXT}>
              {mesh === null ? 'Select a mesh to set its export colours.' : 'Imported meshes keep their materials.'}
            </p>
          )}
        </fieldset>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={BUTTON}
            title="Copy this palette with the same slots: change its colours for a team or skin variant"
            data-testid="palette-duplicate"
            onClick={() =>
              void run('palette.duplicate', { palette }, { panel: PANEL_KIND }).then((result) => {
                if (result.status === 'finished') setChoice((result.value as { palette: PaletteId }).palette);
              })
            }
          >
            Duplicate palette (variant)
          </button>
        </div>
      </div>
      {editing === null ? null : (
        <ColourPopover
          app={app}
          swatch={doc.store.get('swatches', editing.swatch) ?? null}
          anchor={editing.anchor}
          run={run}
          onClose={() => setEditing(null)}
        />
      )}
      {menu.element}
    </div>
  );
}

type Run = ReturnType<typeof useRunOperator>;

function SwatchCell(props: {
  readonly swatch: SwatchRecord;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onEdit: (anchor: HTMLElement) => void;
  readonly onMenu: (event: MouseEvent<HTMLElement>) => void;
}): JSX.Element {
  const { swatch, active } = props;
  const hex = toHex(swatch.srgb);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'F2') {
      event.preventDefault();
      props.onEdit(event.currentTarget);
    }
  };
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${swatch.name} ${hex}${swatch.shader === 'blinn' ? ' Blinn' : ''}${active ? ' (active)' : ''}`}
      title={`${swatch.name} · ${hex} · ${swatch.shader === 'blinn' ? 'Blinn' : 'Lambert'} · slot ${swatch.slot}`}
      className={
        'relative grid size-5 place-items-center rounded-[3px] border text-[11px] leading-none ' +
        (active
          ? 'border-[var(--accent-text,#a996ff)] outline-2 outline-offset-1 outline-[var(--accent-text,#a996ff)]'
          : 'border-line')
      }
      style={{ background: hex, color: contrastOn(swatch.srgb) }}
      data-testid={`palette-swatch-${swatch.slot}`}
      data-active={active ? 'true' : undefined}
      data-shader={swatch.shader}
      onClick={props.onActivate}
      onDoubleClick={(event) => props.onEdit(event.currentTarget)}
      onContextMenu={props.onMenu}
      onKeyDown={onKeyDown}
    >
      {active ? '✓' : ''}
      {swatch.shader === 'blinn' ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[2px] right-[2px] size-[5px] rounded-full bg-white shadow-[0_0_1px_1px_rgba(0,0,0,0.45)]"
        />
      ) : null}
    </button>
  );
}

/**
 * The active swatch's shader (SHADING-SPEC §5): Lambert or Blinn; for Blinn the glossiness (slider and field, one undo
 * step per release or Enter) and the specular colour.
 */
function ShaderSection(props: { readonly swatch: SwatchRecord; readonly run: Run }): JSX.Element {
  const { swatch, run } = props;
  const ids = useId();
  const [gloss, setGloss] = useState(swatch.glossiness);
  const commitGloss = (value: number): void => {
    const next = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    setGloss(next);
    if (Number.isFinite(next) && next !== swatch.glossiness) {
      void run('palette.setSwatch', { swatch: swatch.id, glossiness: next }, { panel: PANEL_KIND });
    }
  };
  const hint = SHADERS.find((shader) => shader.value === swatch.shader)?.hint;
  return (
    <div className="flex flex-col gap-1" data-testid="palette-shader">
      <label className="flex items-center gap-2 text-fg-2" htmlFor={`${ids}-shader`} title={hint}>
        <span className="w-16 shrink-0">Shader</span>
        <select
          id={`${ids}-shader`}
          className={`${SELECT} min-w-0 flex-1`}
          value={swatch.shader}
          data-testid="palette-shader-type"
          onChange={(event) =>
            void run(
              'palette.setSwatch',
              { swatch: swatch.id, shader: event.currentTarget.value as SwatchRecord['shader'] },
              { panel: PANEL_KIND },
            )
          }
        >
          {SHADERS.map((shader) => (
            <option key={shader.value} value={shader.value}>
              {shader.label}
            </option>
          ))}
        </select>
      </label>
      {swatch.shader !== 'blinn' ? null : (
        <>
          <label className="flex items-center gap-2 text-fg-2" htmlFor={`${ids}-gloss`}>
            <span className="w-16 shrink-0">Glossiness</span>
            <input
              id={`${ids}-gloss`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              className="min-w-0 flex-1"
              value={gloss}
              aria-label="Glossiness"
              data-testid="palette-glossiness"
              onChange={(event) => setGloss(Number(event.currentTarget.value))}
              onPointerUp={(event) => commitGloss(Number(event.currentTarget.value))}
              onKeyUp={(event) => commitGloss(Number(event.currentTarget.value))}
              onBlur={(event) => commitGloss(Number(event.currentTarget.value))}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className={`${INPUT} w-14 font-mono`}
              value={gloss}
              aria-label="Glossiness value"
              data-testid="palette-glossiness-value"
              onChange={(event) => setGloss(Number(event.currentTarget.value))}
              onBlur={(event) => commitGloss(Number(event.currentTarget.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitGloss(Number(event.currentTarget.value));
                }
                event.stopPropagation();
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-fg-2" title="Highlight colour: white is full strength">
            <span className="w-16 shrink-0">Specular</span>
            <input
              type="color"
              value={toHex(swatch.specular)}
              aria-label="Specular colour"
              data-testid="palette-specular"
              onChange={(event) => {
                const specular = parseHex(event.currentTarget.value);
                if (specular !== null) {
                  void run('palette.setSwatch', { swatch: swatch.id, specular }, { panel: PANEL_KIND });
                }
              }}
            />
            <span className={`${MUTED_TEXT} font-mono`}>{toHex(swatch.specular)}</span>
          </label>
        </>
      )}
    </div>
  );
}

/** The active swatch's name and hex field (Enter or leaving the field applies; Esc reverts). */
function ActiveRow(props: {
  readonly app: EditorApp;
  readonly active: SwatchRecord | null;
  readonly run: Run;
}): JSX.Element {
  const { active, run } = props;
  if (active === null) {
    return (
      <p className={MUTED_TEXT} data-testid="palette-active">
        Click a swatch to make it active.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-1.5" data-testid="palette-active">
      <span className="size-4 shrink-0 rounded-[3px] border border-line" style={{ background: toHex(active.srgb) }} />
      <span className="min-w-0 truncate text-fg" title={active.name}>
        {active.name}
      </span>
      <span className={MUTED_TEXT}>{active.slot}</span>
      <HexField key={`${active.id}:${toHex(active.srgb)}`} swatch={active} run={run} testId="palette-hex" />
    </div>
  );
}

function HexField(props: { readonly swatch: SwatchRecord; readonly run: Run; readonly testId: string }): JSX.Element {
  const { swatch, run } = props;
  const current = toHex(swatch.srgb);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const commit = (): void => {
    if (draft.trim().toLowerCase() === current) {
      setError(null);
      return;
    }
    const srgb = parseHex(draft);
    if (srgb === null) {
      setError('Type a colour as #rrggbb');
      return;
    }
    setError(null);
    void run('palette.setSwatch', { swatch: swatch.id, srgb }, { panel: PANEL_KIND });
  };
  return (
    <input
      type="text"
      spellCheck={false}
      aria-label={`${swatch.name} colour (sRGB hex)`}
      aria-invalid={error !== null}
      title={error ?? 'sRGB hex, e.g. #e04646'}
      className={`${INPUT} ml-auto w-[5.5rem] font-mono ${error === null ? '' : INVALID}`}
      value={draft}
      data-testid={props.testId}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(current);
          setError(null);
        }
        event.stopPropagation();
      }}
    />
  );
}

/** Double-click on a swatch: a colour picker, the hex field and the name. */
function ColourPopover(props: {
  readonly app: EditorApp;
  readonly swatch: SwatchRecord | null;
  readonly anchor: HTMLElement;
  readonly run: Run;
  readonly onClose: () => void;
}): JSX.Element | null {
  const { swatch, run } = props;
  const [name, setName] = useState(swatch?.name ?? '');
  if (swatch === null) return null;
  const hex = toHex(swatch.srgb);
  return (
    <Popover
      anchor={props.anchor}
      label={`Edit ${swatch.name}`}
      onClose={props.onClose}
      testId="palette-popover"
      width={220}
    >
      <div className="flex flex-col gap-2 p-2 text-xs">
        <label className="flex items-center gap-2 text-fg-2">
          <span className="w-12">Colour</span>
          <input
            type="color"
            value={hex}
            aria-label="Pick a colour"
            data-testid="palette-popover-colour"
            onChange={(event) => {
              const srgb = parseHex(event.currentTarget.value);
              if (srgb !== null) void run('palette.setSwatch', { swatch: swatch.id, srgb }, { panel: PANEL_KIND });
            }}
          />
          <HexField key={hex} swatch={swatch} run={run} testId="palette-popover-hex" />
        </label>
        <label className="flex items-center gap-2 text-fg-2">
          <span className="w-12">Name</span>
          <input
            type="text"
            className={`${INPUT} min-w-0 flex-1`}
            value={name}
            data-testid="palette-popover-name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && name.trim() !== '' && name !== swatch.name) {
                void run('palette.setSwatch', { swatch: swatch.id, name }, { panel: PANEL_KIND });
              }
            }}
            onBlur={() => {
              if (name.trim() !== '' && name !== swatch.name) {
                void run('palette.setSwatch', { swatch: swatch.id, name }, { panel: PANEL_KIND });
              }
            }}
          />
        </label>
      </div>
    </Popover>
  );
}
