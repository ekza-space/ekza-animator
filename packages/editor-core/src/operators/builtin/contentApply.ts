// B13's operator bodies (M6A-SPEC §5.13, §5.16, §5.19, §5.26; lazy chunk, M6A-B13-10): the document writes of the
// scene, palette, template and image-plane operators. Their definitions, metadata and polls stay eager (menus, the
// command palette and keymaps need them); each operator's `prepare` loads this module (`contentLoad.ts`) and its
// `apply` runs the matching function here, so the editor's first route carries only the definitions (§5.27).
import {
  EkzaError,
  quatRotateVec3,
  type ReadonlyVec3,
  type ReadonlyXf,
  type Vec3,
  xfIdentity,
  xfInvert,
  coerceArgs,
} from '@ekza-studio/anim-core';
import {
  type BudgetPresetId,
  type ImagePlaneRecord,
  derivedId,
  fractionalIndex,
  type GroupId,
  type GroupRecord,
  type HandheldGrip,
  type IdKind,
  type ImagePlaneId,
  type MeshId,
  type MeshOwner,
  type MeshRecord,
  type PaletteId,
  type PaletteRecord,
  type ReadView,
  SWATCH_SHADER_DEFAULTS,
  type SwatchRecord,
  type Tx,
} from '@ekza-studio/doc';
import type { ComponentSelection } from '@ekza-studio/mesh-core';
import { newRecordId } from '../../app/internals';
import { attachMeshes, type KernelMeshRuntimes, meshKernel } from '../../mesh';
import { localFromWorld, MAX_NAME, orderAfterSiblings, ownerKey, uniqueMeshName } from '../../mesh/records';
import { runSeed } from '../../mesh/seed';
import type { SwatchShaderArgs } from '../args';
import type {
  ApplyContext,
  EditorApp,
  OperatorArgs,
  SceneObjectId,
  SelectionSnapshot,
  SymmetrySettings,
} from '../../types';
import { templateGroupOf } from './create';
import { isRecord, optionalArgs } from './define';
import { defaultOffset, type Imported, isCamera, LABEL, LOCKED_REASON } from './imagePlane';
import { swatchMismatch } from './paintRules';
import {
  activeSwatchOf,
  cleanName,
  lastOrder,
  livePalette,
  materialPlan,
  nextSlot,
  replaceTargets,
  slotArg,
  swatchIdFor,
  swatchTargets,
  targetMeshes,
  BUSY_KERNEL,
  DEFAULT_PALETTE_ID,
  defaultSwatchId,
  parseHex,
  toHex,
} from './palette';
import {
  BUDGET_PRESETS,
  commonOwner,
  isAssetBacked,
  idsArg,
  isGroupId,
  isMeshId,
  objectWorld,
  type SceneObject,
  sceneObject,
  subtree,
  topmost,
  TOON_REASON,
} from './scene';
import {
  DEFAULT_GRIP,
  FROZEN_REASON,
  HANDHELD_CUBE,
  OP,
  type Prepared,
  type Regenerated,
  TEMPLATE_PARAMS,
  type TemplateId,
  type TemplateMesh,
  templateOf,
} from './templates';
// ---------- scene ----------

function transformPoint(xf: ReadonlyXf, p: ReadonlyVec3): Vec3 {
  const scaled: Vec3 = [p[0] * xf.s[0], p[1] * xf.s[1], p[2] * xf.s[2]];
  const r = quatRotateVec3(xf.q, scaled);
  return [r[0] + xf.t[0], r[1] + xf.t[1], r[2] + xf.t[2]];
}

/** World bounding box of objects (their meshes' revisions; an object without geometry counts as its origin). */
export function worldBounds(app: EditorApp, view: ReadView, objects: readonly SceneObject[]): [Vec3, Vec3] | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: ReadonlyVec3): void => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i] as number, p[i] as number);
      hi[i] = Math.max(hi[i] as number, p[i] as number);
    }
  };
  for (const root of objects) {
    for (const object of subtree(view, root)) {
      const world = objectWorld(view, object);
      const data = isMeshId(object.id) ? (app.meshes.get(object.id)?.data() ?? null) : null;
      if (data === null || data.counts.points === 0) {
        add(world.t);
        continue;
      }
      for (let v = 0; v < data.counts.points; v++) {
        add(
          transformPoint(world, [
            data.position[3 * v] as number,
            data.position[3 * v + 1] as number,
            data.position[3 * v + 2] as number,
          ]),
        );
      }
    }
  }
  return lo[0] === Infinity ? null : [lo, hi];
}

/** A live group name of `owner` not used by its meshes or groups (`base`, `base 2`, …). */
export function uniqueObjectName(view: ReadView, owner: MeshOwner, base: string, except?: string): string {
  const stem = (base.trim() === '' ? 'Group' : base.trim()).slice(0, MAX_NAME);
  const key = ownerKey(owner);
  const used = new Set<string>();
  for (const mesh of view.query.meshesOfOwner(key)) if (mesh.id !== except) used.add(mesh.name);
  for (const group of view.list('groups')) {
    if (group.id !== except && ownerKey(group.owner) === key) used.add(group.name);
  }
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${stem.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** A name for a renamed object: trimmed, ≤ 64 characters; a mesh name unique among its owner's other meshes. */
function renamedName(view: ReadView, object: SceneObject, name: string): string {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!isMeshId(object.id)) return clean;
  const others = new Set(
    view.query
      .meshesOfOwner(ownerKey(object.owner))
      .filter((mesh) => mesh.id !== object.id)
      .map((mesh) => mesh.name),
  );
  if (!others.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${clean.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!others.has(candidate)) return candidate;
  }
}

function setSelection(app: EditorApp, objects: readonly SceneObjectId[]): void {
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, objects } });
}

/** Patches an object's parent and local placement (keeping its world placement) and orders it last. */
function reparent(tx: Tx, object: SceneObject, parent: GroupId | MeshId | null, world: ReadonlyXf): void {
  const placement = localFromWorld(tx, object.owner, parent, world);
  const order = orderAfterSiblings(tx, object.owner, parent);
  if (isGroupId(object.id)) tx.patch('groups', object.id, { parent: parent as GroupId | null, placement, order });
  else tx.patch('meshes', object.id, { parent, placement, order });
}

/** World placement of a parent (a group or mesh), else the owner root (a character's placement, or identity). */
function parentWorldOf(view: ReadView, owner: MeshOwner, parent: GroupId | MeshId | null): ReadonlyXf {
  if (parent !== null) {
    const node = sceneObject(view, parent);
    if (node !== undefined) return objectWorld(view, node);
  }
  if ('character' in owner) return view.get('characters', owner.character)?.placement ?? xfIdentity();
  return xfIdentity();
}

/** The name a copy counts up from: "Cube 2" → "Cube" (the copy is "Cube 3", Maya's pCube2 → pCube3). */
const copyStem = (name: string): string => name.replace(/ \d+$/, '') || name;

/** Copies an object's subtree under `parent` with new ids; returns the copy of the root. */
function copySubtree(
  app: EditorApp,
  tx: Tx,
  root: SceneObject,
  parent: GroupId | MeshId | null,
  order: string,
): string {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const object of subtree(tx, root)) {
    const copyParent = object.id === root.id ? parent : ((map.get(object.parent ?? '') ?? null) as GroupId | null);
    const copyOrder = object.id === root.id ? order : object.order;
    if (isGroupId(object.id)) {
      const id = newRecordId(app, 'group');
      map.set(object.id, id);
      const record = object as GroupRecord;
      tx.put('groups', {
        ...record,
        id,
        name: uniqueObjectName(tx, record.owner, copyStem(record.name)),
        parent: copyParent as GroupId | null,
        order: copyOrder,
        deleted: null,
      });
    } else {
      const id = newRecordId(app, 'mesh');
      map.set(object.id, id);
      const record = object as MeshRecord;
      const name = uniqueMeshName(tx, record.owner, copyStem(record.name), taken);
      taken.add(name);
      tx.put('meshes', { ...record, id, name, parent: copyParent, order: copyOrder, deleted: null });
    }
  }
  return map.get(root.id) as string;
}

/** §4.2 grip bounds (clamped, as the load repair does). */
export function clampGrip(grip: HandheldGrip): HandheldGrip {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    bone: grip.bone === 'leftHand' ? 'leftHand' : 'rightHand',
    offset: [clamp(grip.offset[0], -0.3, 0.3), clamp(grip.offset[1], -0.3, 0.3), clamp(grip.offset[2], -0.3, 0.3)],
    rotationDegrees: [
      clamp(grip.rotationDegrees[0], -360, 360),
      clamp(grip.rotationDegrees[1], -360, 360),
      clamp(grip.rotationDegrees[2], -360, 360),
    ],
    scale: clamp(grip.scale, 0.25, 2),
  };
}

// ---------- palette ----------

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

function uniquePaletteName(view: ReadView, base: string): string {
  const used = new Set(view.list('palettes').map((p) => p.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

const srgbOf = (value: readonly [number, number, number]): [number, number, number] => [
  Math.round(value[0]),
  Math.round(value[1]),
  Math.round(value[2]),
];

function nextOrderAfter(view: ReadView, order: string): string | null {
  let next: string | null = null;
  for (const palette of view.list('palettes')) {
    if (palette.order > order && (next === null || palette.order < next)) next = palette.order;
  }
  return next;
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

// ---------- templates ----------

/** A derived id not used by any record, soft-deleted ones included (the next `seed:k` otherwise, like create.ts). */
function freeDerivedId<K extends 'mesh' | 'group'>(view: ReadView, kind: K, seed: string, n: number) {
  const table = kind === 'mesh' ? 'meshes' : 'groups';
  let id = derivedId(kind as IdKind, OP, [], seed, n);
  for (let k = 1; view.getIncludingDeleted(table, id as never) !== undefined; k++) {
    id = derivedId(kind as IdKind, OP, [], `${seed}:${k}`, n);
  }
  return id as K extends 'mesh' ? MeshId : GroupId;
}

function meshRecord(
  tx: Tx,
  fields: {
    readonly id: MeshId;
    readonly name: string;
    readonly owner: MeshOwner;
    readonly parent: GroupId | null;
    readonly placement?: { readonly t: ReadonlyVec3 };
    readonly pivot?: ReadonlyVec3;
    readonly generator: TemplateMesh;
    readonly data: MeshRecord['data'];
  },
): MeshRecord {
  return {
    id: fields.id,
    name: uniqueMeshName(tx, fields.owner, fields.name),
    owner: fields.owner,
    parent: fields.parent,
    order: orderAfterSiblings(tx, fields.owner, fields.parent),
    placement: fields.placement === undefined ? xfIdentity() : { t: fields.placement.t, q: [0, 0, 0, 1], s: [1, 1, 1] },
    pivot: fields.pivot ?? [0, 0, 0],
    source: null,
    data: fields.data,
    faceted: true,
    generator: { kind: fields.generator.kind, params: fields.generator.params, version: 1 },
    palette: ensureDefaultPalette(tx),
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
  };
}

function groupRecord(
  tx: Tx,
  fields: Pick<GroupRecord, 'id' | 'template' | 'budget' | 'handheld'> & { readonly name: string },
): GroupRecord {
  const owner = { scene: true as const };
  return {
    id: fields.id,
    name: uniqueObjectName(tx, owner, fields.name),
    owner,
    parent: null,
    order: orderAfterSiblings(tx, owner, null),
    placement: xfIdentity(),
    pivot: [0, 0, 0],
    template: fields.template,
    budget: fields.budget,
    handheld: fields.handheld,
    deleted: null,
  };
}

function selectCreated(
  app: EditorApp,
  root: SceneObjectId,
  symmetry?: { mesh: MeshId; settings: SymmetrySettings },
): void {
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, objects: [root] },
    model: {
      ...state.model,
      componentMode: 'object',
      ...(symmetry === undefined
        ? {}
        : { symmetry: new Map(state.model.symmetry).set(symmetry.mesh, symmetry.settings) }),
    },
  });
}

// ---------- imagePlane ----------

// ---------- operator bodies ----------

export function sceneGroup({ app, tx }: ApplyContext, args: OperatorArgs<'scene.group'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.group runs in a transaction');
  const ids = idsArg(app, args) ?? [];
  const roots = topmost(tx, ids);
  const owner = commonOwner(roots) ?? { scene: true as const };
  const firstParent = roots[0]?.parent ?? null;
  const parent = roots.every((o) => o.parent === firstParent) ? firstParent : null;
  const id = newRecordId(app, 'group');
  const worlds = new Map(roots.map((o) => [o.id, objectWorld(tx, o)] as const));
  // Identity under the parent; the pivot at the bounding-box centre, in the group's (= the parent's) space.
  const bounds = worldBounds(app, tx, roots);
  const parentWorld = parentWorldOf(tx, owner, parent);
  const centre: Vec3 =
    bounds === null
      ? [0, 0, 0]
      : [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2, (bounds[0][2] + bounds[1][2]) / 2];
  const pivot = transformPoint(xfInvert(parentWorld), centre);
  const first = roots[0];
  tx.put('groups', {
    id,
    name: uniqueObjectName(tx, owner, 'Group'),
    owner,
    parent: parent as GroupId | null,
    order: first?.parent === parent && first !== undefined ? first.order : orderAfterSiblings(tx, owner, parent),
    placement: xfIdentity(),
    pivot: roots.length === 0 ? [0, 0, 0] : pivot,
    template: null,
    budget: null,
    handheld: null,
    deleted: null,
  });
  for (const object of roots) reparent(tx, object, id, worlds.get(object.id) as ReadonlyXf);
  setSelection(app, [id]);
  return { group: id };
}

export function sceneParent({ app, tx }: ApplyContext, args: OperatorArgs<'scene.parent'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.parent runs in a transaction');
  const raw = optionalArgs(args) ?? {};
  const selection = app.session.getState().selection.objects;
  const parentId = (typeof raw['parent'] === 'string' ? raw['parent'] : selection.at(-1)) as GroupId | MeshId;
  const ids = Array.isArray(raw['ids']) ? (raw['ids'] as string[]) : selection.slice(0, -1);
  for (const object of topmost(tx, ids)) {
    if (object.parent === parentId) continue;
    reparent(tx, object, parentId, objectWorld(tx, object));
  }
}

export function sceneUnparent({ app, tx }: ApplyContext, args: OperatorArgs<'scene.unparent'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.unparent runs in a transaction');
  for (const object of topmost(tx, idsArg(app, args) ?? [])) {
    if (object.parent !== null) reparent(tx, object, null, objectWorld(tx, object));
  }
}

export function sceneDuplicate({ app, tx }: ApplyContext, args: OperatorArgs<'scene.duplicate'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.duplicate runs in a transaction');
  const created: SceneObjectId[] = [];
  for (const root of topmost(tx, idsArg(app, args) ?? [])) {
    // Right after the original among its siblings.
    let next: string | null = null;
    for (const sibling of tx.query.childrenOf(root.parent, ownerKey(root.owner))) {
      if (sibling.order > root.order && (next === null || sibling.order < next)) next = sibling.order;
    }
    created.push(copySubtree(app, tx, root, root.parent, fractionalIndex(root.order, next)) as SceneObjectId);
  }
  setSelection(app, created);
  return { created };
}

export function sceneDelete({ app, tx }: ApplyContext, args: OperatorArgs<'scene.delete'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.delete runs in a transaction');
  const removed = new Set<string>();
  for (const root of topmost(tx, idsArg(app, args) ?? [])) {
    // Children first, so no live record ever points at a deleted parent.
    for (const object of subtree(tx, root).reverse()) {
      if (isGroupId(object.id)) tx.softDelete('groups', object.id);
      else tx.softDelete('meshes', object.id);
      removed.add(object.id);
    }
  }
  const state = app.session.getState();
  const objects = state.selection.objects.filter((id) => !removed.has(id));
  const hilite = state.model.hilite.filter((id) => !removed.has(id));
  app.session.setState({
    selection: { ...state.selection, objects },
    model: hilite.length === state.model.hilite.length ? state.model : { ...state.model, hilite },
  });
  return { count: removed.size };
}

export function sceneRename({ tx }: ApplyContext, args: OperatorArgs<'scene.rename'>) {
  if (tx === null) throw new EkzaError('internal', 'scene.rename runs in a transaction');
  const object = sceneObject(tx, args.id) as SceneObject;
  const name = renamedName(tx, object, args.name);
  if (name === object.name) return;
  if (isGroupId(object.id)) tx.patch('groups', object.id, { name });
  else tx.patch('meshes', object.id, { name });
}

export function meshSetAttributes({ tx }: ApplyContext, args: OperatorArgs<'mesh.setAttributes'>) {
  if (tx === null) throw new EkzaError('internal', 'mesh.setAttributes runs in a transaction');
  const object = sceneObject(tx, args.mesh) as SceneObject;
  const raw = args.patch as Readonly<Record<string, unknown>>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'name') {
      const name = renamedName(tx, object, value as string);
      if (name !== object.name) patch['name'] = name;
    } else if (key === 'handheld') {
      patch['handheld'] = value === null ? null : clampGrip(value as HandheldGrip);
    } else if (key === 'budget') {
      patch['budget'] = value;
    } else {
      patch[key] = value;
    }
  }
  if (Object.keys(patch).length === 0) return;
  if (isGroupId(object.id)) tx.patch('groups', object.id, patch);
  else tx.patch('meshes', object.id, patch);
}

export function paletteCreate({ app, tx }: ApplyContext, args: OperatorArgs<'palette.create'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.create runs in a transaction');
  const raw = optionalArgs(args) ?? {};
  const id = newRecordId(app, 'palette');
  const name = uniquePaletteName(tx, cleanName(raw['name']) ?? 'Palette');
  tx.put('palettes', { id, name, order: fractionalIndex(lastOrder(tx.list('palettes')), null), deleted: null });
  return { palette: id };
}

export function paletteDuplicate({ app, tx }: ApplyContext, args: OperatorArgs<'palette.duplicate'>) {
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
}

export function paletteRename({ tx }: ApplyContext, args: OperatorArgs<'palette.rename'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.rename runs in a transaction');
  tx.patch('palettes', args.palette, { name: cleanName(args.name) as string });
}

/** The shader fields of a new swatch: the args' where given, else `SWATCH_SHADER_DEFAULTS` (SHADING-SPEC §1). */
function shaderOf(args: SwatchShaderArgs): Pick<SwatchRecord, 'shader' | 'glossiness' | 'specular'> {
  return {
    shader: args.shader ?? SWATCH_SHADER_DEFAULTS.shader,
    glossiness: args.glossiness ?? SWATCH_SHADER_DEFAULTS.glossiness,
    specular: srgbOf(args.specular ?? SWATCH_SHADER_DEFAULTS.specular),
  };
}

/** Puts a new swatch at the palette's next slot (`palette.addSwatch`, `palette.assignMaterial`). */
function putSwatch(
  tx: Tx,
  palette: PaletteId,
  srgb: readonly [number, number, number],
  name: string,
  shader: SwatchShaderArgs,
): { readonly swatch: SwatchRecord['id']; readonly slot: number } {
  const slot = nextSlot(tx, palette);
  const id = swatchIdFor(palette, slot);
  const live = tx.query.swatchesOfPalette(palette);
  tx.put('swatches', {
    id,
    palette,
    slot,
    order: fractionalIndex(lastOrder(live), null),
    name,
    srgb: srgbOf(srgb),
    kind: 'flat',
    ramp: null,
    ...shaderOf(shader),
    deleted: null,
  });
  return { swatch: id, slot };
}

export function paletteAddSwatch({ tx }: ApplyContext, args: OperatorArgs<'palette.addSwatch'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.addSwatch runs in a transaction');
  return putSwatch(tx, args.palette, args.srgb, cleanName(args.name) ?? toHex(srgbOf(args.srgb)), args);
}

export function paletteSetSwatch({ tx }: ApplyContext, args: OperatorArgs<'palette.setSwatch'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.setSwatch runs in a transaction');
  const patch: {
    -readonly [K in 'srgb' | 'name' | 'shader' | 'glossiness' | 'specular']?: SwatchRecord[K];
  } = {};
  if (args.srgb !== undefined) patch.srgb = srgbOf(args.srgb);
  if (args.name !== undefined) patch.name = cleanName(args.name) as string;
  if (args.shader !== undefined) patch.shader = args.shader;
  if (args.glossiness !== undefined) patch.glossiness = args.glossiness;
  if (args.specular !== undefined) patch.specular = srgbOf(args.specular);
  tx.patch('swatches', args.swatch, patch);
}

/** `Lambert 1`, `Blinn 2`, …: the first name of the form `<base> <n>` no live swatch of the palette has. */
function uniqueSwatchName(view: ReadView, palette: PaletteId, base: string): string {
  const taken = new Set(view.query.swatchesOfPalette(palette).map((swatch) => swatch.name));
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The sRGB colour of the first face Assign New Material paints (keeps the look when only the shader changes). */
function firstFaceColour(
  app: EditorApp,
  view: ReadView,
  palette: PaletteId,
  mesh: MeshId,
  faceMode: boolean,
): readonly [number, number, number] | null {
  let face = 0;
  if (faceMode) {
    const faces = attachMeshes(app)?.selectionFor(mesh, 'face')?.faces;
    let first = -1;
    faces?.forEach((f) => {
      if (first === -1) first = f;
    });
    if (first === -1) return null;
    face = first;
  }
  const slot = faceSlotsOf(app, mesh)?.[face];
  if (slot === undefined) return null;
  return view.query.swatchBySlot(palette, slot)?.srgb ?? null;
}

/**
 * `palette.assignMaterial` (SHADING-SPEC §5; Maya's Assign New Material): in one transaction a new swatch with the
 * shader in the targets' palette, painted on the selected faces (face mode) or on every face of the target meshes;
 * targets whose material preset is `unlit` become `lit`; the swatch becomes the active one.
 */
export function paletteAssignMaterial(ctx: ApplyContext, args: OperatorArgs<'palette.assignMaterial'>) {
  const { app, tx } = ctx;
  const kernel = meshKernel();
  const op = kernel?.MESH_OPS['mesh.paint'];
  const meshes = attachMeshes(app);
  if (tx === null || op === undefined || meshes === null) throw new EkzaError('mesh-loading', BUSY_KERNEL);
  const plan = materialPlan(app, args);
  const first = plan.meshes[0];
  const palette = first === undefined ? null : (tx.get('meshes', first)?.palette ?? null);
  if (first === undefined || palette === null) throw new EkzaError('op-refused', 'Select faces or a mesh first');
  const base = args.shader === 'blinn' ? 'Blinn' : 'Lambert';
  const colour = args.srgb ?? firstFaceColour(app, tx, palette, first, plan.faceMode) ?? [128, 128, 128];
  const name = cleanName(args.name) ?? uniqueSwatchName(tx, palette, base);
  const created = putSwatch(tx, palette, colour, name, { shader: args.shader });
  const seed = runSeed(ctx, 'palette.assignMaterial');
  if (plan.faceMode) {
    meshes.commitOp(tx, op, plan.meshes, { slot: created.slot, faces: null }, { seed, kind: 'face' });
  } else {
    // Every face of each object: one run per mesh, its `faces` list is its own (M6A-B13-17).
    for (const mesh of plan.meshes) {
      const faces = app.meshes.get(mesh)?.data()?.counts.faces ?? 0;
      meshes.commitOp(
        tx,
        op,
        [mesh],
        { slot: created.slot, faces: Array.from({ length: faces }, (_, f) => f) },
        { seed, kind: 'face' },
      );
    }
  }
  for (const mesh of plan.meshes) {
    const record = tx.get('meshes', mesh);
    if (record !== undefined && 'preset' in record.material && record.material.preset === 'unlit') {
      tx.patch('meshes', mesh, { material: { preset: 'lit' } });
    }
  }
  const model = app.session.getState().model;
  if (model.activeSwatch !== created.swatch) {
    app.session.setState({ model: { ...model, activeSwatch: created.swatch } });
  }
  return { swatch: created.swatch, slot: created.slot, meshes: [...plan.meshes] };
}

export function paletteRemoveSwatch({ app, tx }: ApplyContext, args: OperatorArgs<'palette.removeSwatch'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.removeSwatch runs in a transaction');
  tx.softDelete('swatches', args.swatch);
  const model = app.session.getState().model;
  if (model.activeSwatch === args.swatch) app.session.setState({ model: { ...model, activeSwatch: null } });
}

export function paletteAssign({ app, tx }: ApplyContext, args: OperatorArgs<'palette.assign'>) {
  if (tx === null) throw new EkzaError('internal', 'palette.assign runs in a transaction');
  for (const id of targetMeshes(app, args.meshes)) {
    if (tx.get('meshes', id)?.palette !== args.palette) tx.patch('meshes', id, { palette: args.palette });
  }
}

export function paletteReplaceSwatch(ctx: ApplyContext, args: OperatorArgs<'palette.replaceSwatch'>) {
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

/** Select by Swatch's refusal when the active swatch is in none of the targets' palettes (else null). */
export function bySwatchProblem(app: EditorApp, args: unknown, targets: readonly MeshId[]): string | null {
  const active = activeSwatchOf(app);
  if (active === null || targets.some((id) => swatchSlotOn(app, args, id) !== null)) return null;
  return swatchMismatch(app, targets, active);
}

export function selectBySwatch({ app }: ApplyContext, args: OperatorArgs<'select.mesh.bySwatch'>) {
  const kernel = meshKernel();
  const meshes = attachMeshes(app);
  if (kernel === null || meshes === null) throw new EkzaError('mesh-loading', BUSY_KERNEL);
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
      // The active swatch's slot only on meshes of its palette (elsewhere it is another colour): none selected there.
      const slot = swatchSlotOn(app, args, id);
      const faces: number[] = [];
      if (slot !== null) for (let f = 0; f < slots.length; f++) if (slots[f] === slot) faces.push(f);
      const sel: ComponentSelection = kernel.selectionOf('face', faces, data.counts);
      meshes.select(id, sel);
    }
  });
}

/** The humanoid height (metres) when the run names none and no Humanoid guides host the body. */
export const DEFAULT_HUMANOID_HEIGHT = 1.6;

/**
 * The height a humanoid template run builds: the run's `height`; when it is auto (null), for a body created into a
 * Humanoid guides group (the lead of the selection) the group's `template.params.height`, so the body matches the
 * guides; else 1.6 m (M6A-B13-19).
 */
export function templateHeight(app: EditorApp, template: TemplateId, height: unknown): number {
  if (typeof height === 'number' && Number.isFinite(height)) return height;
  const host = template === 'humanoidBody' ? templateGroupOf(app) : null;
  const guides = host?.template?.kind === 'humanoid' ? host.template.params['height'] : undefined;
  return typeof guides === 'number' && Number.isFinite(guides) ? guides : DEFAULT_HUMANOID_HEIGHT;
}

export function createTemplate(ctx: ApplyContext, args: OperatorArgs<'mesh.create.template'>, prepared: Prepared) {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('internal', `${OP} runs in a transaction`);
  const meshes = attachMeshes(app) as KernelMeshRuntimes;
  const template = templateOf(args) as TemplateId;
  const raw = coerceArgs(TEMPLATE_PARAMS, args).args;
  const seed = runSeed(ctx, OP);
  ensureDefaultPalette(tx);
  const created: SceneObjectId[] = [];
  const store = (mesh: TemplateMesh) => meshes.storeRevision(mesh.data, null, []);

  if (template === 'humanoidBody') {
    const mesh = prepared.mesh as TemplateMesh;
    const host = templateGroupOf(app);
    const owner = host?.owner ?? { scene: true as const };
    const id = freeDerivedId(tx, 'mesh', seed, 0);
    tx.put(
      'meshes',
      meshRecord(tx, { id, name: 'Body', owner, parent: host?.id ?? null, generator: mesh, data: store(mesh) }),
    );
    created.push(id);
    const symmetry =
      host?.template?.kind === 'humanoid'
        ? {
            mesh: id,
            settings: {
              mode: 'object-x' as const,
              tolerance: app.prefs.getState().modeling.symmetryTolerance,
              preserveSeam: true,
            },
          }
        : undefined;
    selectCreated(app, id, symmetry);
    return { root: id, created };
  }

  const group = freeDerivedId(tx, 'group', seed, 0);
  if (template === 'humanoid') {
    tx.put(
      'groups',
      groupRecord(tx, {
        id: group,
        name: 'Humanoid',
        template: {
          kind: 'humanoid',
          params: { height: templateHeight(app, 'humanoid', raw['height']), preset: raw['preset'] as string },
        },
        budget: { preset: 'hero' },
        handheld: null,
      }),
    );
    selectCreated(app, group);
    return { root: group, created: [group] };
  }

  const handheld = template === 'handheld';
  tx.put(
    'groups',
    groupRecord(tx, {
      id: group,
      name: handheld ? 'Handheld' : 'Prop',
      template: { kind: template, params: {} },
      budget: { preset: handheld ? 'handheld' : 'small-prop' },
      handheld: handheld ? DEFAULT_GRIP : null,
    }),
  );
  created.push(group);
  const mesh = prepared.mesh as TemplateMesh;
  const half = (handheld ? HANDHELD_CUBE.height : 1) / 2;
  const id = freeDerivedId(tx, 'mesh', seed, 1);
  tx.put(
    'meshes',
    meshRecord(tx, {
      id,
      name: 'Cube',
      owner: { scene: true },
      parent: group,
      // Standing on the group origin (the ground for a prop, the grip for a handheld) with the pivot at its base.
      placement: { t: [0, half, 0] },
      pivot: [0, -half, 0],
      generator: mesh,
      data: store(mesh),
    }),
  );
  created.push(id);
  selectCreated(app, group);
  return { root: group, created };
}

export function primitiveSet(
  { app, tx }: ApplyContext,
  args: OperatorArgs<'mesh.primitive.set'>,
  prepared: Regenerated,
) {
  if (tx === null) throw new EkzaError('internal', 'mesh.primitive.set runs in a transaction');
  const record = tx.get('meshes', args.mesh);
  if (record?.generator === null || record?.generator === undefined || record.generator.kind !== prepared.kind) {
    throw new EkzaError('unsupported', FROZEN_REASON);
  }
  tx.patch('meshes', args.mesh, { generator: { kind: prepared.kind, params: prepared.params, version: 1 } });
  app.meshes.writeData(tx, args.mesh, prepared.data);
  try {
    app.components.clear(args.mesh);
  } catch {
    // No component selection service: nothing is stored.
  }
}

export function imagePlaneImport(
  { app, tx }: ApplyContext,
  args: OperatorArgs<'imagePlane.import'>,
  prepared: Imported,
) {
  if (prepared.asset === null) return { id: null as unknown as ImagePlaneId };
  if (tx === null) throw new EkzaError('internal', 'imagePlane.import runs in a transaction');
  const { asset } = prepared;
  if (tx.get('assets', asset.id) === undefined) tx.put('assets', asset);
  const raw = args as unknown as Readonly<Record<string, unknown>>;
  const id = newRecordId(app, 'imagePlane');
  let last: string | null = null;
  for (const plane of tx.list('imagePlanes')) if (last === null || plane.order > last) last = plane.order;
  const size = 2;
  const name =
    typeof raw['name'] === 'string' && raw['name'].trim() !== ''
      ? raw['name'].trim().slice(0, 64)
      : `${LABEL[args.camera]} reference`;
  tx.put('imagePlanes', {
    id,
    name,
    camera: args.camera,
    asset: asset.id,
    offset: defaultOffset(args.camera, size),
    size,
    opacity: 0.5,
    depth: 'behind',
    locked: false,
    visible: true,
    order: fractionalIndex(last, null),
    deleted: null,
  });
  return { id };
}

// ---------- attribute and plane patch checks (the polls run them once this module has loaded) ----------

const COLOUR_OUTPUTS = ['palette-texture', 'vertex-colour', 'material-per-colour'] as const;
const GROUP_FIELDS = new Set(['name', 'budget', 'handheld']);
const MESH_FIELDS = new Set(['name', 'faceted', 'colourOutput', 'material', 'budget', 'handheld', 'palette']);

const isVec3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c));

function gripProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isRecord(value)) return 'handheld must be a grip { bone, offset, rotationDegrees, scale } or null';
  if (value['bone'] !== 'rightHand' && value['bone'] !== 'leftHand') return 'grip bone: rightHand or leftHand';
  if (!isVec3(value['offset']) || !isVec3(value['rotationDegrees'])) return 'grip offset and rotation: three numbers';
  const scale = value['scale'];
  return typeof scale === 'number' && Number.isFinite(scale) ? null : 'grip scale: a number';
}

function budgetProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isRecord(value)) return 'budget must be { preset }, { tris } or null';
  if ('preset' in value) return BUDGET_PRESETS.includes(value['preset'] as BudgetPresetId) ? null : 'unknown preset';
  const tris = value['tris'];
  return typeof tris === 'number' && Number.isInteger(tris) && tris >= 1 ? null : 'tris must be a whole number ≥ 1';
}

/** The first problem of an attribute patch for `object`, or null. */
export function patchProblem(
  app: EditorApp,
  object: SceneObject,
  patch: Readonly<Record<string, unknown>>,
): string | null {
  const allowed = isGroupId(object.id) ? GROUP_FIELDS : MESH_FIELDS;
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'Nothing to change';
  for (const key of keys) {
    if (!allowed.has(key)) return `${isGroupId(object.id) ? 'A group' : 'A mesh'} has no attribute '${key}'`;
    const value = patch[key];
    switch (key) {
      case 'name':
        if (typeof value !== 'string' || value.trim() === '') return 'The name must not be empty';
        break;
      case 'faceted':
        if (typeof value !== 'boolean') return 'faceted must be true or false';
        break;
      case 'colourOutput':
        if (!COLOUR_OUTPUTS.includes(value as (typeof COLOUR_OUTPUTS)[number])) return 'unknown colour output';
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        break;
      case 'material': {
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        const preset = isRecord(value) ? value['preset'] : undefined;
        if (preset === 'toon') return TOON_REASON;
        if (preset !== 'unlit' && preset !== 'lit') return 'material must be { preset: unlit | lit }';
        break;
      }
      case 'budget': {
        const problem = budgetProblem(value);
        if (problem !== null) return problem;
        break;
      }
      case 'handheld': {
        const problem = gripProblem(value);
        if (problem !== null) return problem;
        break;
      }
      case 'palette':
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        if (
          value !== null &&
          (typeof value !== 'string' || app.store.get('palettes', value as PaletteId) === undefined)
        ) {
          return 'Unknown palette';
        }
        break;
    }
  }
  return null;
}

const PLANE_FIELDS = new Set(['name', 'camera', 'offset', 'size', 'opacity', 'depth', 'locked', 'visible']);

/** The first problem of a plane patch, or null. */
export function planePatchProblem(plane: ImagePlaneRecord, patch: Readonly<Record<string, unknown>>): string | null {
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'Nothing to change';
  for (const key of keys) if (!PLANE_FIELDS.has(key)) return `An image plane has no field '${key}'`;
  // A locked plane takes only its lock and visibility, unless the same patch unlocks it.
  if (plane.locked && patch['locked'] !== false && keys.some((key) => key !== 'locked' && key !== 'visible')) {
    return LOCKED_REASON;
  }
  const value = (key: string): unknown => patch[key];
  if ('name' in patch && (typeof value('name') !== 'string' || (value('name') as string).trim() === '')) {
    return 'The name must not be empty';
  }
  if ('camera' in patch && !isCamera(value('camera'))) return 'camera must be front, side or top';
  if ('offset' in patch) {
    const offset = value('offset');
    if (
      !Array.isArray(offset) ||
      offset.length !== 2 ||
      !offset.every((c) => typeof c === 'number' && Number.isFinite(c))
    ) {
      return 'offset must be two numbers (metres right and up)';
    }
  }
  if ('size' in patch) {
    const size = value('size');
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return 'size must be above 0 m';
  }
  if ('opacity' in patch) {
    const opacity = value('opacity');
    if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return 'opacity must be a number (0…1)';
  }
  if ('depth' in patch && value('depth') !== 'behind' && value('depth') !== 'front') return 'depth: behind or front';
  for (const key of ['locked', 'visible']) {
    if (key in patch && typeof value(key) !== 'boolean') return `${key} must be true or false`;
  }
  return null;
}

// ---------- the default palette (the first modeling action creates it, §5.19) ----------

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
      ...SWATCH_SHADER_DEFAULTS,
      deleted: null,
    });
  });
  return DEFAULT_PALETTE_ID;
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
