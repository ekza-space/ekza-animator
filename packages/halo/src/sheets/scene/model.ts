// The Scene sheet, the model (STUDIO-TOUCH-SPEC §6.5, §15 rows 1.10, 5.16; P5, P13; T6b): Studio Pro's Model Outliner
// as a list at touch density. Objects: the scene's groups and meshes in their hierarchy, then each character with its
// meshes and skeleton (a character row selects its root control, so it becomes the active character; a skeleton row
// selects its root joint). Characters: the active character and its bulk selections. References: the image planes.
// Cameras: the shot cameras. Reparent: *Parent to…* and *Unparent* for the selection (the lift-and-drop twin).
// Visibility: "N hidden · Show all" and the parts left out of the character. Every control is one or more operator
// calls (the sheet runs them through `ctx.run`, in order); rows carry the targets they may be parented to, so the drop
// recognizer and *Parent to…* agree on what is allowed. React-free: the sheet renders it, the unit tests drive it.
import type {
  CameraRecord,
  CharacterId,
  CharacterRecord,
  ControlRecord,
  GroupRecord,
  ImagePlaneRecord,
  JointRecord,
  MeshRecord,
  SkeletonRecord,
} from '@ekza-studio/doc';
import {
  buildModelOutlinerRows,
  type ContainerMeshes,
  characterKey,
  containerMeshes,
  type ModelOutlinerRow,
  meshesKey,
  planeKey,
  readModelOutlinerDoc,
  SCENE_KEY,
} from '@ekza-studio/editor/models';
import type { EditorApp, OperatorId } from '@ekza-studio/editor-core';

/** Halo's one canvas pane (§4.1); a camera row looks through it. */
export const SCENE_PANE = 'pane-single';

export interface OperatorCall {
  readonly op: OperatorId;
  readonly args?: unknown;
}

/** A control of the sheet: one or more operator calls run in order (the next only when the previous finished). */
export interface SceneAction {
  readonly id: string;
  /** The plain label (§1.3). */
  readonly label: string;
  /** Studio Pro's name, in grey, when it differs. */
  readonly pro: string | null;
  readonly calls: readonly OperatorCall[];
  readonly enabled: boolean;
  /** Why it is greyed (the first call's poll), or null. */
  readonly reason: string | null;
}

/** Where a row may be parented: another row (`scene.parent`) or its owner's top level (`scene.unparent`). */
export interface ParentTarget {
  readonly key: string;
  readonly name: string;
  readonly call: OperatorCall;
}

export type SceneRowKind = 'scene' | 'group' | 'mesh' | 'asset' | 'character' | 'skeleton' | 'plane' | 'camera';

export interface SceneRow {
  /** Stable key (the Outliner's: `obj:<id>`, `chr:<id>`, `plane:<id>`; `skel:<id>`, `cam:<id>`, `section:scene`). */
  readonly key: string;
  /** The record id, or null (the Scene root). */
  readonly id: string | null;
  readonly kind: SceneRowKind;
  readonly name: string;
  /** The grey second line: what it is, its state. */
  readonly detail: string | null;
  /** Indent level inside its section. */
  readonly depth: number;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly selected: boolean;
  /** Character rows: the active character. */
  readonly active: boolean;
  /** Hidden for this user (itself, or under a hidden parent). */
  readonly hidden: boolean;
  /** A tap: select it (null: a tap opens the row menu). */
  readonly select: SceneAction | null;
  /** The eye: show or hide (null: no eye on this row). */
  readonly eye: SceneAction | null;
  /** The row menu (long-press, right-click, ⋯): everything else, Rename and Parent to… excluded. */
  readonly menu: readonly SceneAction[];
  /** Rename: the call for a new name, or null. */
  readonly rename: ((name: string) => OperatorCall) | null;
  /** A reference image's *Replace image…*: the picked file's bytes into `imagePlane.replace` (one undo step). */
  readonly replaceImage?: (bytes: Uint8Array, name: string) => OperatorCall;
  /** Where it may be dropped or parented; empty: it cannot be lifted. */
  readonly parentTargets: readonly ParentTarget[];
}

export interface CharacterEntry {
  readonly key: string;
  readonly id: CharacterId;
  readonly name: string;
  readonly detail: string;
  readonly active: boolean;
  /** Make it the active character (its root control). */
  readonly select: SceneAction;
  readonly allControls: SceneAction;
  readonly allJoints: SceneAction | null;
}

export interface ReparentModel {
  /** The selected scene objects (meshes and groups). */
  readonly ids: readonly string[];
  readonly names: readonly string[];
  readonly targets: readonly ParentTarget[];
  readonly unparent: SceneAction;
  readonly note: string | null;
}

export interface VisibilityModel {
  readonly hiddenCount: number;
  /** "N hidden · Show all" (`view.showAll`). */
  readonly showAll: SceneAction;
  /** The scene meshes left out of the character (`autorig.parts`). */
  readonly leftOut: readonly string[];
  readonly hideParts: SceneAction;
  readonly showParts: SceneAction;
}

export interface SceneModel {
  readonly objects: readonly SceneRow[];
  readonly characters: readonly CharacterEntry[];
  readonly references: readonly SceneRow[];
  readonly cameras: readonly SceneRow[];
  readonly reparent: ReparentModel;
  readonly visibility: VisibilityModel;
  /** Every row of every section by key. */
  readonly rows: ReadonlyMap<string, SceneRow>;
}

export interface SceneInput {
  /** Expanded state by row key (default: expanded). */
  readonly expanded?: ReadonlyMap<string, boolean>;
  readonly paneId?: string;
}

// ---------- reading ----------

type ObjectRecord = MeshRecord | GroupRecord;

const isGroupId = (id: string): boolean => id.startsWith('grp_');

function objectOf(app: EditorApp, id: string): ObjectRecord | undefined {
  if (isGroupId(id)) return app.store.get('groups', id as GroupRecord['id']);
  return app.store.get('meshes', id as MeshRecord['id']);
}

const ownerOf = (object: ObjectRecord): string => ('scene' in object.owner ? 'scene' : object.owner.character);

const assetBacked = (object: ObjectRecord): boolean => 'source' in object && object.source !== null;

const byOrder = (
  a: { readonly order: string; readonly id: string },
  b: { readonly order: string; readonly id: string },
) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The object and its ancestors (a cycle in a damaged document ends the walk). */
function lineage(app: EditorApp, id: string): string[] {
  const out: string[] = [];
  let at: string | null = id;
  while (at !== null && !out.includes(at)) {
    out.push(at);
    at = objectOf(app, at)?.parent ?? null;
  }
  return out;
}

/**
 * Whether `child` may be parented under `parent` (`scene.parent`'s own rules): both live, one owner, neither imported
 * (asset-backed), no cycle, a group only under a group, and not where it already is.
 */
export function canParent(app: EditorApp, child: string, parent: string): boolean {
  if (child === parent) return false;
  const c = objectOf(app, child);
  const p = objectOf(app, parent);
  if (c === undefined || p === undefined) return false;
  if (ownerOf(c) !== ownerOf(p) || assetBacked(c) || assetBacked(p)) return false;
  if (isGroupId(c.id) && !isGroupId(p.id)) return false;
  if (c.parent === p.id) return false;
  return !lineage(app, p.id).includes(c.id);
}

/** The poll reason of a call, or null when it may run (an unknown operator is left to the run's own toast). */
function reasonOf(app: EditorApp, call: OperatorCall | undefined): string | null {
  if (call === undefined || app.operators.get(call.op) === undefined) return null;
  const verdict = app.operators.poll(call.op, undefined, call.args);
  return verdict === true ? null : verdict.reason;
}

function action(
  app: EditorApp,
  id: string,
  label: string,
  pro: string | null,
  calls: readonly OperatorCall[],
  blocked: string | null = null,
): SceneAction {
  const reason = blocked ?? reasonOf(app, calls[0]);
  return { id, label, pro, calls, enabled: reason === null, reason };
}

/** Whether Hide acts on objects now (Make in object mode, Rig in Object mode), else why not. */
function objectHideBlocked(app: EditorApp): string | null {
  const state = app.session.getState();
  if (state.workspace === 'model') {
    return state.model.componentMode === 'object'
      ? null
      : 'Hide works on whole objects: leave the points, edges or faces';
  }
  if (state.workspace === 'rig') return state.rig.mode === 'object' ? null : 'Hide works on objects in Object mode';
  return 'Hide and show objects in Make or Rig';
}

function controlsOf(app: EditorApp, character: CharacterRecord): ControlRecord[] {
  return app.store
    .list('controls')
    .filter((control) => control.rig === character.rig && control.deleted === null)
    .sort(byOrder);
}

/** The control a character row selects: its root (no parent; `root` first). */
function rootControlOf(controls: readonly ControlRecord[]): ControlRecord | undefined {
  const roots = controls.filter((control) => control.parent === null);
  return roots.find((control) => control.key === 'root') ?? roots[0];
}

function skeletonsOf(app: EditorApp, character: CharacterId): SkeletonRecord[] {
  return app.store
    .list('skeletons')
    .filter((skeleton) => skeleton.character === character && skeleton.deleted === null);
}

function jointsOf(app: EditorApp, skeleton: SkeletonRecord): JointRecord[] {
  return app.store
    .list('joints')
    .filter((joint) => joint.skeleton === skeleton.id && joint.deleted === null)
    .sort(byOrder);
}

function containersOf(app: EditorApp): Map<CharacterId, ContainerMeshes> {
  const out = new Map<CharacterId, ContainerMeshes>();
  for (const runtime of app.characters.list()) {
    const json = (runtime.container as { readonly json?: unknown } | undefined)?.json;
    if (json !== null && typeof json === 'object')
      out.set(runtime.id, containerMeshes(json as Record<string, unknown>));
  }
  return out;
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const VIEW_WORD: Readonly<Record<string, string>> = { front: 'Front', side: 'Side', top: 'Top' };

// ---------- building ----------

interface Ctx {
  readonly app: EditorApp;
  readonly paneId: string;
  readonly selected: ReadonlySet<string>;
  readonly hidden: ReadonlySet<string>;
  readonly hideBlocked: string | null;
  readonly showAll: SceneAction;
}

function selectObject(ctx: Ctx, id: string): SceneAction {
  return action(ctx.app, 'select', 'Select', null, [{ op: 'select.objects', args: { ids: [id], mode: 'replace' } }]);
}

/** The eye of a scene object: Hide (select it, then hide the selection), or Show all when it is hidden. */
function objectEye(ctx: Ctx, id: string): SceneAction {
  const hiddenHere = lineage(ctx.app, id).some((at) => ctx.hidden.has(at));
  if (hiddenHere) return { ...ctx.showAll, id: 'show', label: `Show all hidden (${ctx.hidden.size})` };
  return action(
    ctx.app,
    'hide',
    'Hide',
    null,
    [
      { op: 'select.objects', args: { ids: [id], mode: 'replace' } },
      { op: 'view.hide', args: { target: 'selected' } },
    ],
    ctx.hideBlocked,
  );
}

/** Every row of `owner` this object may move to: other objects, or the top level when it has a parent. */
function targetsFor(
  ctx: Ctx,
  object: ObjectRecord,
  candidates: readonly ObjectRecord[],
  rootKey: string,
): ParentTarget[] {
  if (assetBacked(object)) return [];
  const out: ParentTarget[] = [];
  if (object.parent !== null) {
    out.push({
      key: rootKey,
      name: rootKey === SCENE_KEY ? 'Scene (top level)' : 'Top of the character',
      call: { op: 'scene.unparent', args: { ids: [object.id] } },
    });
  }
  for (const candidate of candidates) {
    if (!canParent(ctx.app, object.id, candidate.id)) continue;
    out.push({
      key: `obj:${candidate.id}`,
      name: candidate.name,
      call: { op: 'scene.parent', args: { ids: [object.id], parent: candidate.id } },
    });
  }
  return out;
}

function objectRow(
  ctx: Ctx,
  row: Extract<ModelOutlinerRow, { kind: 'object' }>,
  depth: number,
  all: readonly ObjectRecord[],
): SceneRow {
  const object = row.object;
  const group = isGroupId(object.id);
  const owner = ownerOf(object);
  const rootKey = owner === 'scene' ? SCENE_KEY : characterKey(owner as CharacterId);
  const hiddenSelf = ctx.hidden.has(object.id);
  const hiddenAbove = !hiddenSelf && lineage(ctx.app, object.id).some((at) => ctx.hidden.has(at));
  const imported = assetBacked(object);
  const detail = [
    group ? 'Group' : imported ? 'Imported mesh' : 'Mesh',
    hiddenSelf ? 'hidden' : hiddenAbove ? 'hidden with its parent' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const menu: SceneAction[] = [selectObject(ctx, object.id)];
  if (object.parent !== null && !imported) {
    menu.push(action(ctx.app, 'unparent', 'Unparent', null, [{ op: 'scene.unparent', args: { ids: [object.id] } }]));
  }
  return {
    key: row.key,
    id: object.id,
    kind: group ? 'group' : 'mesh',
    name: object.name,
    detail,
    depth,
    expandable: row.expandable,
    expanded: row.expanded,
    selected: ctx.selected.has(object.id),
    active: false,
    hidden: hiddenSelf || hiddenAbove,
    select: selectObject(ctx, object.id),
    eye: objectEye(ctx, object.id),
    menu,
    rename: (name) => ({ op: 'scene.rename', args: { id: object.id, name } }),
    parentTargets: targetsFor(
      ctx,
      object,
      all.filter((candidate) => ownerOf(candidate) === owner),
      rootKey,
    ),
  };
}

function characterRow(ctx: Ctx, record: CharacterRecord, row: ModelOutlinerRow, active: boolean): SceneRow {
  const controls = controlsOf(ctx.app, record);
  const root = rootControlOf(controls);
  const selection = ctx.app.session.getState().selection.controls;
  const own = new Set(controls.map((control) => control.id as string));
  const select =
    root === undefined
      ? action(ctx.app, 'select', 'Make active', 'Select Controls', [], 'Not rigged yet: it has no controls')
      : action(ctx.app, 'select', 'Make active', 'Select Controls', [
          { op: 'select.controls', args: { ids: [root.id], mode: 'replace' } },
        ]);
  return {
    key: row.key,
    id: record.id,
    kind: 'character',
    name: record.name,
    detail: active ? 'Character · active' : 'Character',
    depth: 0,
    expandable: row.expandable,
    expanded: row.expanded,
    selected: selection.some((id) => own.has(id)),
    active,
    hidden: false,
    select,
    eye: null,
    menu: [select],
    rename: null,
    parentTargets: [],
  };
}

function skeletonRow(ctx: Ctx, skeleton: SkeletonRecord, depth: number): SceneRow {
  const joints = jointsOf(ctx.app, skeleton);
  const root = joints.find((joint) => joint.parent === null);
  const picked = new Set<string>(ctx.app.session.getState().selection.joints);
  const select =
    root === undefined
      ? action(ctx.app, 'select', 'Select', 'Select Joints', [], 'The skeleton has no joints yet')
      : action(ctx.app, 'select', 'Select', 'Select Joints', [
          { op: 'select.joints', args: { ids: [root.id], mode: 'replace' } },
        ]);
  const all = action(ctx.app, 'allJoints', 'Select all joints', 'Select Joints', [
    { op: 'select.joints', args: { ids: joints.map((joint) => joint.id), mode: 'replace' } },
  ]);
  return {
    key: `skel:${skeleton.id}`,
    id: skeleton.id,
    kind: 'skeleton',
    name: 'Skeleton',
    detail: plural(joints.length, 'joint'),
    depth,
    expandable: false,
    expanded: false,
    selected: joints.some((joint) => picked.has(joint.id)),
    active: false,
    hidden: false,
    select,
    eye: null,
    menu: joints.length === 0 ? [select] : [select, all],
    rename: null,
    parentTargets: [],
  };
}

function assetRow(row: Extract<ModelOutlinerRow, { kind: 'asset' }>, depth: number): SceneRow {
  return {
    key: row.key,
    id: row.id,
    kind: 'asset',
    name: row.name,
    detail: `Imported mesh · ${row.skinned ? 'skinned · ' : ''}edit it in Make to change it`,
    depth,
    expandable: false,
    expanded: false,
    selected: false,
    active: false,
    hidden: false,
    select: null,
    eye: null,
    menu: [],
    rename: null,
    parentTargets: [],
  };
}

function planeRow(ctx: Ctx, plane: ImagePlaneRecord): SceneRow {
  const set = (patch: Record<string, unknown>): OperatorCall => ({
    op: 'imagePlane.set',
    args: { id: plane.id, patch },
  });
  const detail = [
    `${VIEW_WORD[plane.camera] ?? plane.camera} view`,
    `${Math.round(plane.opacity * 100)} %`,
    plane.visible ? null : 'hidden',
    plane.locked ? 'locked' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const eye = action(ctx.app, plane.visible ? 'hide' : 'show', plane.visible ? 'Hide' : 'Show', 'Visible', [
    set({ visible: !plane.visible }),
  ]);
  const lock = action(ctx.app, plane.locked ? 'unlock' : 'lock', plane.locked ? 'Unlock' : 'Lock', 'Locked', [
    set({ locked: !plane.locked }),
  ]);
  return {
    key: planeKey(plane.id),
    id: plane.id,
    kind: 'plane',
    name: plane.name,
    detail,
    depth: 0,
    expandable: false,
    expanded: false,
    selected: false,
    active: false,
    hidden: !plane.visible,
    select: null,
    eye,
    // T6-INT: the canvas cannot select a plane yet (P-T6B-7), so its row carries Delete as well
    menu: [
      eye,
      lock,
      action(ctx.app, 'delete', 'Delete', 'Delete', [{ op: 'imagePlane.delete', args: { id: plane.id } }]),
    ],
    rename: (name) => set({ name }),
    replaceImage: (bytes, name) => ({ op: 'imagePlane.replace', args: { id: plane.id, bytes, name } }),
    parentTargets: [],
  };
}

function cameraRow(ctx: Ctx, camera: CameraRecord): SceneRow {
  const look = action(ctx.app, 'lookThrough', 'Look through', 'Look Through', [
    { op: 'view.lookThrough', args: { paneId: ctx.paneId, camera: { kind: 'shot', cameraId: camera.id } } },
  ]);
  const lock = action(ctx.app, camera.locked ? 'unlock' : 'lock', camera.locked ? 'Unlock' : 'Lock', 'Camera Lock', [
    { op: 'view.toggleCameraLock', args: { cameraId: camera.id } },
  ]);
  return {
    key: `cam:${camera.id}`,
    id: camera.id,
    kind: 'camera',
    name: camera.name,
    detail: [camera.projection === 'perspective' ? 'Shot camera' : 'Flat shot camera', camera.locked ? 'locked' : null]
      .filter((part) => part !== null)
      .join(' · '),
    depth: 0,
    expandable: false,
    expanded: false,
    selected: false,
    active: false,
    hidden: false,
    select: look,
    eye: null,
    menu: [look, lock],
    rename: null,
    parentTargets: [],
  };
}

function characterEntry(ctx: Ctx, record: CharacterRecord, active: boolean): CharacterEntry {
  const controls = controlsOf(ctx.app, record);
  const root = rootControlOf(controls);
  const joints = skeletonsOf(ctx.app, record.id).flatMap((skeleton) => jointsOf(ctx.app, skeleton));
  const select =
    root === undefined
      ? action(ctx.app, 'select', 'Make active', 'Select Controls', [], 'Not rigged yet: it has no controls')
      : action(ctx.app, 'select', 'Make active', 'Select Controls', [
          { op: 'select.controls', args: { ids: [root.id], mode: 'replace' } },
        ]);
  const allControls = action(
    ctx.app,
    'allControls',
    'Select all controls',
    'Select Controls',
    [{ op: 'select.controls', args: { ids: controls.map((control) => control.id), mode: 'replace' } }],
    controls.length === 0 ? 'Not rigged yet: it has no controls' : null,
  );
  const allJoints =
    joints.length === 0
      ? null
      : action(ctx.app, 'allJoints', 'Select all joints', 'Select Joints', [
          { op: 'select.joints', args: { ids: joints.map((joint) => joint.id), mode: 'replace' } },
        ]);
  return {
    key: characterKey(record.id),
    id: record.id,
    name: record.name,
    detail: [
      active ? 'Active' : null,
      controls.length === 0 ? 'not rigged yet' : plural(controls.length, 'control'),
      joints.length === 0 ? null : plural(joints.length, 'joint'),
    ]
      .filter((part) => part !== null)
      .join(' · '),
    active,
    select,
    allControls,
    allJoints,
  };
}

function reparentFor(ctx: Ctx, all: readonly ObjectRecord[]): ReparentModel {
  const ids = ctx.app.session
    .getState()
    .selection.objects.filter((id) => objectOf(ctx.app, id) !== undefined)
    .map(String);
  const objects = ids.map((id) => objectOf(ctx.app, id) as ObjectRecord);
  const targets: ParentTarget[] = [];
  if (ids.length > 0) {
    for (const candidate of all) {
      if (!ids.every((id) => canParent(ctx.app, id, candidate.id))) continue;
      targets.push({
        key: `obj:${candidate.id}`,
        name: candidate.name,
        call: { op: 'scene.parent', args: { ids, parent: candidate.id } },
      });
    }
  }
  const parented = objects.some((object) => object.parent !== null);
  const unparent = action(
    ctx.app,
    'unparent',
    'Unparent',
    null,
    [{ op: 'scene.unparent', args: { ids } }],
    ids.length === 0 ? 'Select an object first' : parented ? null : 'The selection has no parent',
  );
  return {
    ids,
    names: objects.map((object) => object.name),
    targets,
    unparent,
    note:
      ids.length === 0
        ? 'Select objects first, or hold a row and drop it on another.'
        : targets.length === 0
          ? 'Nothing here can take the selection as a child.'
          : null,
  };
}

function visibilityFor(ctx: Ctx, characters: readonly CharacterRecord[]): VisibilityModel {
  const leftOut =
    characters.length === 0
      ? []
      : ctx.app.store
          .list('meshes')
          .filter((mesh) => mesh.deleted === null && 'scene' in mesh.owner)
          .sort(byOrder)
          .map((mesh) => mesh.id as string);
  const noCharacter = characters.length === 0 ? 'Make a character first' : null;
  const hideParts = action(
    ctx.app,
    'hideParts',
    `Hide the parts left out (${leftOut.length})`,
    'Parts & fingers · Hide Left-Out Parts',
    [{ op: 'autorig.parts', args: { hidden: leftOut } }],
    noCharacter ?? (leftOut.length === 0 ? 'Every part is in the character' : null),
  );
  const showParts = action(
    ctx.app,
    'showParts',
    'Give them back',
    'Parts & fingers',
    [{ op: 'autorig.parts', args: { hidden: [] } }],
    noCharacter,
  );
  return { hiddenCount: ctx.hidden.size, showAll: ctx.showAll, leftOut, hideParts, showParts };
}

/** The Scene sheet's rows and controls for the app now. */
export function sceneModel(app: EditorApp, input: SceneInput = {}): SceneModel {
  const state = app.session.getState();
  const hidden = new Set<string>(
    [...state.model.hiddenObjects].filter((id) => objectOf(app, id) !== undefined).map(String),
  );
  const hiddenCount = hidden.size;
  const showAll = action(
    app,
    'showAll',
    hiddenCount === 0 ? 'Nothing hidden' : `${hiddenCount} hidden · Show all`,
    'Show All',
    [{ op: 'view.showAll' }],
    hiddenCount === 0 ? 'Nothing is hidden' : null,
  );
  const ctx: Ctx = {
    app,
    paneId: input.paneId ?? SCENE_PANE,
    selected: new Set<string>(state.selection.objects),
    hidden,
    hideBlocked: objectHideBlocked(app),
    showAll,
  };

  // The Outliner's tree, every character's Meshes level opened and flattened into the character.
  const doc = readModelOutlinerDoc(app.store);
  const expanded = new Map(input.expanded ?? []);
  for (const { record } of doc.characters) expanded.set(meshesKey(record.id), true);
  const tree = buildModelOutlinerRows(doc, { filter: '', expanded, containers: containersOf(app) });
  const all: ObjectRecord[] = [
    ...app.store.list('meshes').filter((mesh) => mesh.deleted === null),
    ...app.store.list('groups').filter((group) => group.deleted === null),
  ].sort(byOrder);
  const records = new Map(doc.characters.map(({ record }) => [record.id as string, record]));

  const objects: SceneRow[] = [];
  let character: CharacterRecord | null = null;
  const closeCharacter = (): void => {
    const open = character === null ? false : (expanded.get(characterKey(character.id)) ?? true);
    if (character !== null && open) {
      for (const skeleton of skeletonsOf(app, character.id)) objects.push(skeletonRow(ctx, skeleton, 1));
    }
    character = null;
  };
  for (const row of tree) {
    if (row.kind === 'section') {
      if (row.section !== 'scene') continue;
      closeCharacter();
      objects.push({
        key: SCENE_KEY,
        id: null,
        kind: 'scene',
        name: 'Scene',
        detail: plural(row.count, 'object'),
        depth: 0,
        expandable: row.expandable,
        expanded: row.expanded,
        selected: false,
        active: false,
        hidden: false,
        select: null,
        eye: null,
        menu: [],
        rename: null,
        parentTargets: [],
      });
    } else if (row.kind === 'character') {
      closeCharacter();
      character = records.get(row.character.id) ?? row.character;
      objects.push(characterRow(ctx, character, row, state.activeCharacter === row.character.id));
    } else if (row.kind === 'object') {
      // Scene objects sit at depth 1 under Scene; a character's at 2 under its Meshes level, flattened to 1.
      const depth = character === null ? row.depth : row.depth - 1;
      objects.push(objectRow(ctx, row, depth, all));
    } else if (row.kind === 'asset') {
      objects.push(assetRow(row, 1));
    }
  }
  closeCharacter();

  const characters = doc.characters.map(({ record }) =>
    characterEntry(ctx, record, state.activeCharacter === record.id),
  );
  const references = doc.planes.map((plane) => planeRow(ctx, plane));
  const cameras = app.store
    .list('cameras')
    .filter((camera) => camera.deleted === null)
    .sort(byOrder)
    .map((camera) => cameraRow(ctx, camera));
  const rows = new Map<string, SceneRow>();
  for (const row of [...objects, ...references, ...cameras]) rows.set(row.key, row);
  return {
    objects,
    characters,
    references,
    cameras,
    reparent: reparentFor(ctx, all),
    visibility: visibilityFor(
      ctx,
      doc.characters.map(({ record }) => record),
    ),
    rows,
  };
}

/** The call of dropping row `key` on row `target`, or null when that drop is not allowed. */
export function dropCall(model: SceneModel, key: string, target: string): OperatorCall | null {
  if (key === target) return null;
  return model.rows.get(key)?.parentTargets.find((candidate) => candidate.key === target)?.call ?? null;
}

export type SceneSectionId = 'objects' | 'characters' | 'references' | 'cameras' | 'reparent' | 'visibility';

/** Every operator call a control of the sheet runs, by section (the parity test's view of the sheet). */
export function sceneCalls(
  model: SceneModel,
): readonly { readonly section: SceneSectionId; readonly call: OperatorCall }[] {
  const out: { section: SceneSectionId; call: OperatorCall }[] = [];
  const add = (section: SceneSectionId, actions: readonly (SceneAction | null)[]): void => {
    for (const each of actions) for (const call of each?.calls ?? []) out.push({ section, call });
  };
  const rowCalls = (section: SceneSectionId, rows: readonly SceneRow[]): void => {
    for (const row of rows) {
      add(section, [row.select, row.eye, ...row.menu]);
      if (row.rename !== null) out.push({ section, call: row.rename(row.name) });
      if (row.replaceImage !== undefined) out.push({ section, call: row.replaceImage(new Uint8Array(), row.name) });
    }
  };
  rowCalls('objects', model.objects);
  for (const entry of model.characters) add('characters', [entry.select, entry.allControls, entry.allJoints]);
  rowCalls('references', model.references);
  rowCalls('cameras', model.cameras);
  for (const target of model.reparent.targets) out.push({ section: 'reparent', call: target.call });
  for (const row of model.objects)
    for (const target of row.parentTargets) out.push({ section: 'reparent', call: target.call });
  add('reparent', [model.reparent.unparent]);
  add('visibility', [model.visibility.showAll, model.visibility.hideParts, model.visibility.showParts]);
  return out;
}
