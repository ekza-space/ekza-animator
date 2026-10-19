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
// - `select.mesh.bySwatch {slot?}`: the faces painted with a slot (default: the active swatch's) on the hilited meshes
//   (or the selected mesh objects, which it hilites in face mode), one "Select" step in Model.
//
// `paintRefusal(app, meshes)` is the editor-side rule of §5.19 that the kernel cannot see (painting is refused on
// asset-backed meshes); the Palette panel and the Paint Colour tool check it before running `mesh.paint`.
import { EkzaError } from '@ekza-animator/anim-core';
import {
  derivedId,
  fractionalIndex,
  type MeshId,
  type MeshRecord,
  type PaletteId,
  type PaletteRecord,
  type ReadView,
  type SwatchId,
  type SwatchRecord,
  type Tx,
} from '@ekza-animator/doc';
import type { ComponentSelection } from '@ekza-animator/mesh-core';
import { newRecordId } from '../../app/internals';
import { attachMeshes, loadMeshKernel, meshKernel } from '../../mesh';
import { runSeed } from '../../mesh/seed';
import type { EditorApp, PollResult, SelectionSnapshot } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';

// ---------- the default palette ----------

/** The default palette's id (§3 rule 3; `mesh.create.*` assigns it). */
export const DEFAULT_PALETTE_ID: PaletteId = derivedId('palette', 'palette.default', [], '', 0);
export const DEFAULT_PALETTE_NAME = 'Ekza Default 16';

/** §5.19: the 16 default colours (slot = index) with their names. */
export const DEFAULT_SWATCHES: readonly { readonly name: string; readonly hex: string }[] = [
  { name: 'White', hex: '#f4f4f4' },
  { name: 'Light Grey', hex: '#c2c3c7' },
  { name: 'Grey', hex: '#6e7179' },
  { name: 'Charcoal', hex: '#2b2d33' },
  { name: 'Red', hex: '#e04646' },
  { name: 'Orange', hex: '#f08a3c' },
  { name: 'Yellow', hex: '#f2c84b' },
  { name: 'Lime', hex: '#8bc34a' },
  { name: 'Green', hex: '#3b9b5a' },
  { name: 'Cyan', hex: '#3fa7c9' },
  { name: 'Blue', hex: '#3d6fd8' },
  { name: 'Purple', hex: '#7b4fc9' },
  { name: 'Pink', hex: '#e07bb5' },
  { name: 'Tan', hex: '#c98b5b' },
  { name: 'Brown', hex: '#8a5a3b' },
  { name: 'Dark Brown', hex: '#4a3426' },
];

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

/**
 * Creates "Ekza Default 16" inside `tx` when the project has no live default palette (a soft-deleted one is restored
 * with its swatches) and returns its id. The first modeling action calls it (`mesh.create.*`, templates).
 */
export function ensureDefaultPalette(tx: Tx): PaletteId {
  const existing = tx.getIncludingDeleted('palettes', DEFAULT_PALETTE_ID);
  if (existing !== undefined) {
    if (existing.deleted !== null) tx.restore('palettes', DEFAULT_PALETTE_ID);
    for (let slot = 0; slot < DEFAULT_SWATCHES.length; slot++) {
      const swatch = tx.getIncludingDeleted('swatches', defaultSwatchId(slot));
      if (swatch !== undefined && swatch.deleted !== null && existing.deleted !== null) {
        tx.restore('swatches', swatch.id);
      }
    }
    return DEFAULT_PALETTE_ID;
  }
  const order = fractionalIndex(lastOrder(tx.list('palettes')), null);
  tx.put('palettes', { id: DEFAULT_PALETTE_ID, name: DEFAULT_PALETTE_NAME, order, deleted: null });
  let swatchOrder: string | null = null;
  DEFAULT_SWATCHES.forEach((swatch, slot) => {
    swatchOrder = fractionalIndex(swatchOrder, null);
    tx.put('swatches', {
      id: defaultSwatchId(slot),
      palette: DEFAULT_PALETTE_ID,
      slot,
      order: swatchOrder,
      name: swatch.name,
      srgb: parseHex(swatch.hex) as [number, number, number],
      kind: 'flat',
      ramp: null,
      deleted: null,
    });
  });
  return DEFAULT_PALETTE_ID;
}

// ---------- reading ----------

function lastOrder(records: readonly { readonly order: string }[]): string | null {
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

/** Every swatch a palette ever had in slots below `nextSlot`: live ones, and deleted ones found by their ids. */
function everySwatchOf(view: ReadView, palette: PaletteId): SwatchRecord[] {
  const out = [...view.query.swatchesOfPalette(palette)];
  const live = new Set(out.map((swatch) => swatch.slot));
  const end = nextSlot(view, palette);
  for (let slot = 0; slot < end; slot++) {
    if (live.has(slot)) continue;
    const swatch = view.getIncludingDeleted('swatches', swatchIdFor(palette, slot));
    if (swatch !== undefined && swatch.palette === palette) out.push(swatch);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** A swatch id derived from its palette and slot (unique: slots are never reused within a palette). */
export function swatchIdFor(palette: PaletteId, slot: number): SwatchId {
  return palette === DEFAULT_PALETTE_ID
    ? defaultSwatchId(slot)
    : derivedId('swatch', 'palette.swatch', [palette], '', slot);
}

/** Authored (not asset-backed) live meshes. */
const isAuthored = (record: MeshRecord): boolean => record.source === null;

/**
 * §5.19: painting is refused on asset-backed (made-editable) meshes in M6a; null when every mesh may be painted.
 */
export function paintRefusal(app: EditorApp, meshes: readonly MeshId[]): string | null {
  for (const id of meshes) {
    const record = app.store.get('meshes', id);
    if (record !== undefined && !isAuthored(record)) return 'Painting imported meshes arrives later';
  }
  return null;
}

/** The palette a mesh paints with, else null. */
export function paletteOfMesh(app: EditorApp, mesh: MeshId): PaletteId | null {
  return app.store.get('meshes', mesh)?.palette ?? null;
}

/** The slots a mesh's faces paint with (face index → slot; slot 0 without a paint layer), or null without data. */
export function faceSlotsOf(app: EditorApp, mesh: MeshId): Uint16Array | null {
  const data = app.meshes.get(mesh)?.data() ?? null;
  if (data === null) return null;
  const out = new Uint16Array(data.counts.faces);
  const layer = data.layers.get('paint');
  if (layer !== undefined) out.set(layer.data.subarray(0, data.counts.faces));
  return out;
}

// ---------- args ----------

function isSrgb(value: unknown): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255)
  );
}

const srgbOf = (value: readonly [number, number, number]): [number, number, number] => [
  Math.round(value[0]),
  Math.round(value[1]),
  Math.round(value[2]),
];

const MAX_NAME = 64;

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, MAX_NAME);
  return name === '' ? null : name;
}

function livePalette(app: EditorApp, id: unknown): PaletteRecord | undefined {
  return typeof id === 'string' ? app.store.get('palettes', id as PaletteId) : undefined;
}

function liveSwatch(app: EditorApp, id: unknown): SwatchRecord | undefined {
  return typeof id === 'string' ? app.store.get('swatches', id as SwatchId) : undefined;
}

function uniquePaletteName(view: ReadView, base: string): string {
  const used = new Set(view.list('palettes').map((p) => p.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** The meshes a palette operator targets: explicit, else the selected mesh objects, else the hilited meshes. */
function targetMeshes(app: EditorApp, explicit: unknown): MeshId[] {
  if (Array.isArray(explicit)) return explicit.filter((id): id is MeshId => typeof id === 'string');
  const state = app.session.getState();
  const objects = state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
  return objects.length > 0 ? objects : [...state.model.hilite];
}

const BUSY_KERNEL = 'Mesh tools are loading';

// ---------- operators ----------

const META = { category: 'palette', scope: 'model', workspaces: ['model'] } as const;

const ensureDefault = defineOperator({
  id: 'palette.ensureDefault',
  label: 'Use Ekza Default 16',
  description: 'Creates the default palette when the project has none.',
  ...META,
  flags: { undo: true, internal: true },
  apply({ tx }) {
    if (tx === null) throw new EkzaError('internal', 'palette.ensureDefault runs in a transaction');
    return { palette: ensureDefaultPalette(tx) };
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.create runs in a transaction');
    const raw = optionalArgs(args) ?? {};
    const id = newRecordId(app, 'palette');
    const name = uniquePaletteName(tx, cleanName(raw['name']) ?? 'Palette');
    tx.put('palettes', { id, name, order: fractionalIndex(lastOrder(tx.list('palettes')), null), deleted: null });
    return { palette: id };
  },
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.duplicate runs in a transaction');
    const source = livePalette(app, args.palette) as PaletteRecord;
    const id = newRecordId(app, 'palette');
    tx.put('palettes', {
      id,
      name: uniquePaletteName(tx, `${source.name} variant`),
      order: fractionalIndex(source.order, nextOrderAfter(tx, source.order)),
      deleted: null,
    });
    // Every slot the source ever used, deleted ones as deleted records: the variant allocates the same next slot.
    for (const swatch of everySwatchOf(tx, source.id)) {
      const copy: SwatchRecord = { ...swatch, id: swatchIdFor(id, swatch.slot), palette: id, deleted: null };
      tx.put('swatches', copy);
      if (swatch.deleted !== null) tx.softDelete('swatches', copy.id);
    }
    return { palette: id };
  },
});

function nextOrderAfter(view: ReadView, order: string): string | null {
  let next: string | null = null;
  for (const palette of view.list('palettes')) {
    if (palette.order > order && (next === null || palette.order < next)) next = palette.order;
  }
  return next;
}

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
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.rename runs in a transaction');
    tx.patch('palettes', args.palette, { name: cleanName(args.name) as string });
  },
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
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.addSwatch runs in a transaction');
    const slot = nextSlot(tx, args.palette);
    const id = swatchIdFor(args.palette, slot);
    const live = tx.query.swatchesOfPalette(args.palette);
    tx.put('swatches', {
      id,
      palette: args.palette,
      slot,
      order: fractionalIndex(lastOrder(live), null),
      name: cleanName(args.name) ?? toHex(srgbOf(args.srgb)),
      srgb: srgbOf(args.srgb),
      kind: 'flat',
      ramp: null,
      deleted: null,
    });
    return { swatch: id, slot };
  },
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
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.setSwatch runs in a transaction');
    const patch: { srgb?: [number, number, number]; name?: string } = {};
    if (args.srgb !== undefined) patch.srgb = srgbOf(args.srgb);
    if (args.name !== undefined) patch.name = cleanName(args.name) as string;
    tx.patch('swatches', args.swatch, patch);
  },
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.removeSwatch runs in a transaction');
    tx.softDelete('swatches', args.swatch);
    const model = app.session.getState().model;
    if (model.activeSwatch === args.swatch) app.session.setState({ model: { ...model, activeSwatch: null } });
  },
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'palette.assign runs in a transaction');
    for (const id of targetMeshes(app, args.meshes)) {
      if (tx.get('meshes', id)?.palette !== args.palette) tx.patch('meshes', id, { palette: args.palette });
    }
  },
});

/** Targets of Replace Swatch: explicit, else every live authored mesh painting with `palette`. */
function replaceTargets(app: EditorApp, palette: PaletteId, explicit: unknown): MeshId[] {
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
    await loadMeshKernel();
  },
  apply(ctx, args) {
    const { app, tx } = ctx;
    const kernel = meshKernel();
    const op = kernel?.MESH_OPS['mesh.paint.remap'];
    const meshes = attachMeshes(app);
    if (tx === null || op === undefined || meshes === null) throw new EkzaError('mesh-loading', BUSY_KERNEL);
    meshes.commitOp(
      tx,
      op,
      replaceTargets(app, args.palette, args.meshes),
      { from: args.from, to: args.to },
      {
        seed: runSeed(ctx, 'palette.replaceSwatch'),
        kind: null,
      },
    );
  },
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
function swatchTargets(app: EditorApp): MeshId[] {
  const state = app.session.getState();
  if (state.model.hilite.length > 0) return [...state.model.hilite];
  return state.selection.objects.filter((id): id is MeshId => id.startsWith('msh_'));
}

function slotArg(app: EditorApp, args: unknown): number | null {
  const raw = optionalArgs(args);
  const slot = raw?.['slot'];
  if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot <= 65_534) return slot;
  if (slot !== undefined && slot !== null) return null;
  return activeSwatchOf(app)?.slot ?? null;
}

/** §5.6: one "Select" step per gesture in workspaces that record selection steps (the interface parts only). */
function recordSelect(app: EditorApp, meshes: readonly MeshId[], fn: () => void): void {
  const undo = app.prefs.getState().modeling.undoSelection[app.session.getState().workspace] === true;
  let before: SelectionSnapshot | null = null;
  try {
    before = undo ? app.components.snapshot(meshes) : null;
  } catch {
    before = null;
  }
  fn();
  if (before === null) return;
  let after: SelectionSnapshot;
  try {
    after = app.components.snapshot(meshes);
  } catch {
    return;
  }
  if (JSON.stringify(snapshotKey(before)) === JSON.stringify(snapshotKey(after))) return;
  app.history.recordSelection({ kind: 'select', gesture: 'replace', before, after }, 'Select');
}

function snapshotKey(snapshot: SelectionSnapshot): unknown {
  return {
    objects: snapshot.objects,
    mode: snapshot.componentMode,
    hilite: snapshot.hilite,
    meshes: Object.entries(snapshot.meshes).map(([id, mesh]) => [
      id,
      mesh.manifest,
      mesh.kind,
      [...mesh.faces],
      [...mesh.edges],
      [...mesh.verts],
    ]),
  };
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
    return OK;
  },
  apply({ app }, args) {
    const kernel = meshKernel();
    const meshes = attachMeshes(app);
    if (kernel === null || meshes === null) throw new EkzaError('mesh-loading', BUSY_KERNEL);
    const slot = slotArg(app, args) as number;
    const targets = swatchTargets(app);
    const state = app.session.getState();
    recordSelect(app, targets, () => {
      // From object mode the meshes are hilited in face mode (the selection shows where it lives).
      if (state.model.componentMode !== 'face' || state.model.hilite.length === 0) {
        app.session.setState({
          model: { ...state.model, componentMode: 'face', lastComponentMode: 'face', hilite: targets },
        });
      }
      for (const id of targets) {
        const slots = faceSlotsOf(app, id);
        const data = app.meshes.get(id)?.data() ?? null;
        if (slots === null || data === null) continue;
        const faces: number[] = [];
        for (let f = 0; f < slots.length; f++) if (slots[f] === slot) faces.push(f);
        const sel: ComponentSelection = kernel.selectionOf('face', faces, data.counts);
        meshes.select(id, sel);
      }
    });
  },
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
