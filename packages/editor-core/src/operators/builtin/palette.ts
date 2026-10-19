// Palettes and swatches (M6A-SPEC §5.19, §6.2; B13). The colour truth is the per-face palette **slot** (the `paint`
// face layer); a `SwatchRecord` maps a palette's slot to an sRGB colour, so recolouring is one swatch patch. Slots are
// u16 0…65534, unique among a palette's swatches **including deleted ones**, and never reused.
//
// - `palette.ensureDefault` (internal; also run inside the first modeling action's transaction through
//   `ensureDefaultPalette`, §10 "Model scene"): "Ekza Default 16", deterministic ids (§3 rule 3), slots 0–15.
// - `palette.create`, `.duplicate` (a variant: the same slots, deleted ones included, with their colours, which the
//   user then changes), `.rename`, `.addSwatch` (the next slot), `.setSwatch`, `.removeSwatch` (soft delete).
// - `palette.assign {meshes?, palette}`: the palette authored meshes paint with (default: the selected mesh objects,
//   else the hilited meshes); imported meshes keep their materials (refused).
// - `palette.replaceSwatch {palette, from, to, meshes?}`: commits the kernel op `mesh.paint.remap {from, to}` on each
//   target (default: every live authored mesh using `palette`) in one transaction (one step).
// - `palette.setActive {swatch}` (session state, not undoable): the swatch Assign Colour and the Paint Colour tool use.
// - `select.mesh.bySwatch {slot?}`: the faces painted with a slot (default: the active swatch's, on the meshes whose
//   palette holds it) on the hilited meshes (or the selected mesh objects, which it hilites in face mode), one
//   "Select" step in Model.
//
// `paintRefusal(app, meshes, swatch)` is the editor-side rule of §5.19 that the kernel cannot see (painting is refused
// on asset-backed meshes, and with a swatch that is not in the mesh's palette); the Palette panel and the Paint Colour
// tool check it before running `mesh.paint`.
// The document writes live in the lazy `contentApply.ts` (M6A-B13-10): `prepare` loads it, `apply` runs its body.
import { EkzaError } from '@ekza-animator/anim-core';
import {
  derivedId,
  type MeshId,
  type MeshRecord,
  type PaletteId,
  type PaletteRecord,
  type ReadView,
  type SwatchId,
  type SwatchRecord,
} from '@ekza-animator/doc';
import { loadMeshKernel, meshKernel } from '../../mesh';
import type { EditorApp, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';
import { loadContentApply } from './contentLoad';

// ---------- the default palette ----------

/** The default palette's id (§3 rule 3; `mesh.create.*` assigns it). */
export const DEFAULT_PALETTE_ID: PaletteId = derivedId('palette', 'palette.default', [], '', 0);
/** The id of the default palette's swatch of `slot` (§3 rule 3). */
export function defaultSwatchId(slot: number): SwatchId {
  return derivedId('swatch', 'palette.default', [DEFAULT_PALETTE_ID], '', slot);
}

/** `#rrggbb` → [r, g, b] (8-bit), or null. */
export function parseHex(text: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim());
  if (match === null) return null;
  let hex = (match[1] as string).toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** [r, g, b] → `#rrggbb`. */
export function toHex(srgb: readonly [number, number, number]): string {
  return `#${srgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// ---------- reading ----------

export function lastOrder(records: readonly { readonly order: string }[]): string | null {
  let last: string | null = null;
  for (const record of records) if (last === null || record.order > last) last = record.order;
  return last;
}

/**
 * The next free slot of a palette: one above every slot it ever used. Live swatches give the maximum; slots are
 * allocated densely upwards with ids derived from the palette and the slot (`swatchIdFor`), so soft-deleted slots
 * above it are found by probing those ids (a deleted swatch with a foreign id, from another tool, is not seen).
 */
export function nextSlot(view: ReadView, palette: PaletteId): number {
  let slot = 0;
  for (const swatch of view.query.swatchesOfPalette(palette)) if (swatch.slot >= slot) slot = swatch.slot + 1;
  while (slot <= 65_535 && view.getIncludingDeleted('swatches', swatchIdFor(palette, slot)) !== undefined) slot += 1;
  return slot;
}

/** A swatch id derived from its palette and slot (unique: slots are never reused within a palette). */
export function swatchIdFor(palette: PaletteId, slot: number): SwatchId {
  return palette === DEFAULT_PALETTE_ID
    ? defaultSwatchId(slot)
    : derivedId('swatch', 'palette.swatch', [palette], '', slot);
}

/** Authored (not asset-backed) live meshes. */
export const isAuthored = (record: MeshRecord): boolean => record.source === null;

/**
 * §5.19: painting is refused on asset-backed (made-editable) meshes in M6a; with `swatch`, also on a mesh whose
 * palette does not hold it (the Palette panel can show and activate another palette's swatch: its slot would paint
 * another colour there, or a slot the mesh's palette lacks). Null when every mesh may be painted.
 */
export function paintRefusal(app: EditorApp, meshes: readonly MeshId[], swatch?: SwatchRecord | null): string | null {
  for (const id of meshes) {
    const record = app.store.get('meshes', id);
    if (record !== undefined && !isAuthored(record)) return 'Painting imported meshes arrives later';
  }
  return swatch === undefined || swatch === null ? null : swatchMismatch(app, meshes, swatch);
}

/** The reason `swatch` cannot paint one of `meshes` (not in its palette), or null. */
export function swatchMismatch(app: EditorApp, meshes: readonly MeshId[], swatch: SwatchRecord): string | null {
  for (const id of meshes) {
    const record = app.store.get('meshes', id);
    if (record === undefined || record.palette === swatch.palette) continue;
    const palette = app.store.get('palettes', swatch.palette)?.name ?? 'its palette';
    return `The active swatch is not in ${record.name}'s palette: assign ${palette} first`;
  }
  return null;
}

// ---------- args ----------

function isSrgb(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255)
  );
}

export const MAX_NAME = 64;

export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, MAX_NAME);
  return name === '' ? null : name;
}

export function livePalette(app: EditorApp, id: unknown): PaletteRecord | undefined {
  return typeof id === 'string' ? app.store.get('palettes', id as PaletteId) : undefined;
}

function liveSwatch(app: EditorApp, id: unknown): SwatchRecord | undefined {
  return typeof id === 'string' ? app.store.get('swatches', id as SwatchId) : undefined;
}

/** The meshes a palette operator targets: explicit, else the selected mesh objects, else the hilited meshes. */
export function targetMeshes(app: EditorApp, explicit: unknown): MeshId[] {
  if (Array.isArray(explicit)) return explicit.filter((id): id is MeshId => typeof id === 'string');
  const state = app.session.getState();
  const objects = state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
  return objects.length > 0 ? objects : [...state.model.hilite];
}

export const BUSY_KERNEL = 'Mesh tools are loading';

// ---------- operators ----------

const META = { category: 'palette', scope: 'model', workspaces: ['model'] } as const;

const ensureDefault = defineOperator({
  id: 'palette.ensureDefault',
  label: 'Use Ekza Default 16',
  description: 'Creates the default palette when the project has none.',
  ...META,
  flags: { undo: true, internal: true },
  prepare: loadContentApply,
  apply({ tx }, _args, impl) {
    if (tx === null) throw new EkzaError('internal', 'palette.ensureDefault runs in a transaction');
    return { palette: impl.ensureDefaultPalette(tx) };
  },
});

const createPalette = defineOperator({
  id: 'palette.create',
  label: 'New Palette',
  description: 'Creates an empty palette.',
  ...META,
  flags: { undo: true },
  extraArgs: ['name'],
  poll(_ctx, args): PollResult {
    const raw = optionalArgs(args);
    if (raw === null) return fail('expects { name }');
    if (raw['name'] !== undefined && cleanName(raw['name']) === null) return fail('The palette needs a name');
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteCreate(ctx, args),
});

const duplicatePalette = defineOperator({
  id: 'palette.duplicate',
  label: 'Duplicate Palette',
  description: 'Copies a palette with its swatches (a variant: the same slots, new colours).',
  ...META,
  flags: { undo: true },
  extraArgs: ['palette'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { palette }');
    return livePalette(app, args['palette']) === undefined ? fail('Unknown palette') : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteDuplicate(ctx, args),
});

const renamePalette = defineOperator({
  id: 'palette.rename',
  label: 'Rename Palette',
  description: 'Renames a palette.',
  ...META,
  flags: { undo: true, internal: true },
  extraArgs: ['palette', 'name'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { palette, name }');
    if (livePalette(app, args['palette']) === undefined) return fail('Unknown palette');
    return cleanName(args['name']) === null ? fail('The palette needs a name') : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteRename(ctx, args),
});

const addSwatch = defineOperator({
  id: 'palette.addSwatch',
  label: 'Add Swatch',
  description: 'Adds a colour to a palette (its slot is new and never reused).',
  ...META,
  flags: { undo: true },
  extraArgs: ['palette', 'srgb', 'name'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { palette, srgb }');
    if (livePalette(app, args['palette']) === undefined) return fail('Unknown palette');
    if (!isSrgb(args['srgb'])) return fail('srgb must be three 8-bit values (0…255)');
    if (args['name'] !== undefined && cleanName(args['name']) === null) return fail('The swatch needs a name');
    if (nextSlot(app.store, args['palette']) > 65_534) return fail('The palette has no free slot left');
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteAddSwatch(ctx, args),
});

const setSwatch = defineOperator({
  id: 'palette.setSwatch',
  label: 'Edit Swatch',
  description: "Changes a swatch's colour or name (every face using it is recoloured).",
  ...META,
  flags: { undo: true, internal: true },
  extraArgs: ['swatch', 'srgb', 'name'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { swatch, srgb?, name? }');
    if (liveSwatch(app, args['swatch']) === undefined) return fail('Unknown swatch');
    if (args['srgb'] !== undefined && !isSrgb(args['srgb'])) return fail('srgb must be three 8-bit values (0…255)');
    if (args['name'] !== undefined && cleanName(args['name']) === null) return fail('The swatch needs a name');
    return args['srgb'] === undefined && args['name'] === undefined ? fail('Nothing to change') : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteSetSwatch(ctx, args),
});

const removeSwatch = defineOperator({
  id: 'palette.removeSwatch',
  label: 'Remove Swatch',
  description: 'Removes a swatch (its slot is never reused; faces painted with it keep the slot).',
  ...META,
  flags: { undo: true },
  extraArgs: ['swatch'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { swatch }');
    return liveSwatch(app, args['swatch']) === undefined ? fail('Unknown swatch') : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteRemoveSwatch(ctx, args),
});

const assignPalette = defineOperator({
  id: 'palette.assign',
  label: 'Assign Palette',
  description: 'Makes a palette the colour source of the selected meshes.',
  ...META,
  flags: { undo: true },
  extraArgs: ['meshes', 'palette'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { meshes?, palette }');
    if (livePalette(app, args['palette']) === undefined) return fail('Unknown palette');
    const meshes = targetMeshes(app, args['meshes']);
    if (meshes.length === 0) return fail('Select a mesh first');
    for (const id of meshes) {
      const record = app.store.get('meshes', id);
      if (record === undefined) return fail(`Unknown mesh ${id}`);
      if (!isAuthored(record)) return fail('Imported meshes keep their materials');
    }
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.paletteAssign(ctx, args),
});

/** Targets of Replace Swatch: explicit, else every live authored mesh painting with `palette`. */
export function replaceTargets(app: EditorApp, palette: PaletteId, explicit: unknown): MeshId[] {
  if (Array.isArray(explicit)) return explicit.filter((id): id is MeshId => typeof id === 'string');
  return app.store
    .list('meshes')
    .filter((mesh) => mesh.palette === palette && isAuthored(mesh) && mesh.data !== null)
    .map((mesh) => mesh.id);
}

const replaceSwatch = defineOperator({
  id: 'palette.replaceSwatch',
  label: 'Replace Swatch',
  description: 'Repaints every face of one swatch with another on the meshes using the palette.',
  ...META,
  flags: { undo: true },
  extraArgs: ['palette', 'from', 'to', 'meshes'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { palette, from, to, meshes? }');
    if (livePalette(app, args['palette']) === undefined) return fail('Unknown palette');
    for (const key of ['from', 'to'] as const) {
      const slot = args[key];
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 65_534) {
        return fail(`${key} must be a swatch slot (0…65534)`);
      }
    }
    if (meshKernel() === null) {
      void loadMeshKernel();
      return fail(BUSY_KERNEL);
    }
    const targets = replaceTargets(app, args['palette'], args['meshes']);
    if (targets.length === 0) return fail('No mesh paints with this palette');
    for (const id of targets) {
      const record = app.store.get('meshes', id);
      if (record === undefined) return fail(`Unknown mesh ${id}`);
      if (!isAuthored(record)) return fail('Painting imported meshes arrives later');
      if (record.palette !== args['palette']) return fail(`${record.name} paints with another palette`);
      const runtime = app.meshes.get(id);
      if (runtime?.state === 'loading') return fail('Mesh is loading');
      if (runtime?.state === 'error') return fail(runtime.error ?? 'Mesh data is missing');
    }
    return OK;
  },
  async prepare() {
    const [, impl] = await Promise.all([loadMeshKernel(), loadContentApply()]);
    return impl;
  },
  apply: (ctx, args, impl) => impl.paletteReplaceSwatch(ctx, args),
});

const setActive = defineOperator({
  id: 'palette.setActive',
  label: 'Active Swatch',
  description: 'Picks the swatch Assign Colour and the Paint Colour tool paint with.',
  ...META,
  flags: { internal: true },
  extraArgs: ['swatch'],
  poll({ app }, args): PollResult {
    if (!isRecord(args)) return fail('expects { swatch }');
    if (args['swatch'] === null) return OK;
    return liveSwatch(app, args['swatch']) === undefined ? fail('Unknown swatch') : OK;
  },
  apply({ app }, args) {
    const model = app.session.getState().model;
    if (model.activeSwatch !== args.swatch) app.session.setState({ model: { ...model, activeSwatch: args.swatch } });
  },
});

// ---------- select by swatch ----------

/** The active swatch's slot and palette, or null. */
export function activeSwatchOf(app: EditorApp): SwatchRecord | null {
  const id = app.session.getState().model.activeSwatch;
  return id === null ? null : (app.store.get('swatches', id as SwatchId) ?? null);
}

/** The meshes Select by Swatch reads: the hilited meshes, else the selected mesh objects. */
export function swatchTargets(app: EditorApp): MeshId[] {
  const state = app.session.getState();
  if (state.model.hilite.length > 0) return [...state.model.hilite];
  return state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
}

export function slotArg(app: EditorApp, args: unknown): number | null {
  const raw = optionalArgs(args);
  const slot = raw?.['slot'];
  if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot <= 65_534) return slot;
  if (slot !== undefined && slot !== null) return null;
  return activeSwatchOf(app)?.slot ?? null;
}

/**
 * The slot Select by Swatch reads on `mesh`: the explicit `slot`, else the active swatch's — only when the mesh paints
 * with the active swatch's palette (another palette's slot means another colour there); null: select nothing.
 */
export function swatchSlotOn(app: EditorApp, args: unknown, mesh: MeshId): number | null {
  const explicit = optionalArgs(args)?.['slot'];
  if (explicit !== undefined && explicit !== null) return slotArg(app, args);
  const active = activeSwatchOf(app);
  if (active === null) return null;
  return app.store.get('meshes', mesh)?.palette === active.palette ? active.slot : null;
}

const selectBySwatch = defineOperator({
  id: 'select.mesh.bySwatch',
  label: 'Select by Swatch',
  description: 'Selects the faces painted with a swatch (default: the active swatch).',
  category: 'select',
  scope: 'model',
  workspaces: ['model'],
  flags: { selection: true },
  extraArgs: ['slot'],
  poll({ app }, args): PollResult {
    if (app.session.getState().workspace !== 'model') return fail('Selecting by swatch works in the Model workspace');
    if (slotArg(app, args) === null) return fail('Pick a swatch in the Palette first');
    if (meshKernel() === null) {
      void loadMeshKernel();
      return fail(BUSY_KERNEL);
    }
    const targets = swatchTargets(app);
    if (targets.length === 0) return fail('Select a mesh first');
    if (targets.some((id) => app.meshes.get(id)?.state !== 'ready')) return fail('Mesh is loading');
    // The active swatch selects only on meshes whose palette holds it: refuse when that is none of them.
    const active = activeSwatchOf(app);
    const mismatch = active === null ? null : swatchMismatch(app, targets, active);
    if (mismatch !== null && targets.every((id) => swatchSlotOn(app, args, id) === null)) return fail(mismatch);
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.selectBySwatch(ctx, args),
});

export const PALETTE_OPERATORS: readonly AnyOperator[] = [
  ensureDefault,
  createPalette,
  duplicatePalette,
  renamePalette,
  addSwatch,
  setSwatch,
  removeSwatch,
  assignPalette,
  replaceSwatch,
  setActive,
  selectBySwatch,
];
