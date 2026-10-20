// SceneSync (ADR 0006 §8, MVP-SPEC §4.11.16): keeps the three scene in step with the character registry and the
// evaluated poses, imperatively and without per-frame allocation. Per evaluated frame, in this order:
//   kernel bone locals → one updateMatrixWorld → VRMC_node_constraint update → constraint destination subtrees →
//   spring bones (preview, only while enabled and playing) → control and skeleton lines.
// M2a (M2A-SPEC §5.5, A2): control visibility is `controlVisibility` (rules 1–3), recomputed on selection,
// hidden-control and preference changes and, per evaluated pose, only when a limb's ikFk crossed a rule-2 threshold
// (a per-slot state array, compared without allocating); limbs' poles get their annotation lines.
import { type Mat4, mat4Compose } from '@ekza-animator/anim-core';
import {
  batchTables,
  type CharacterId,
  type CharacterRecord,
  type ControlId,
  type ControlRecord,
} from '@ekza-animator/doc';
import {
  type CharacterRuntime,
  type ControlVisibility,
  characterMeshRecords,
  controlVisibilityResolver,
  type EditorApp,
  limbVisibilityState,
} from '@ekza-animator/editor-core';
import type { LoadedModel } from '@ekza-animator/io/three';
import { Group, type Material, type Mesh, type Object3D, type Scene } from 'three';
import type { ControlLayer, PoleLink } from '../controls/ControlLayer';
import { LAYER } from '../layers';
import type { SkeletonLayer } from '../overlays/skeleton';
import { type MeshPickTarget, nodeIndexOf } from '../picking/meshPicker';
import { XRAY_OPACITY } from '../theme';

interface MaterialState {
  readonly material: Material;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly depthWrite: boolean;
}

interface CharacterSlot {
  readonly id: CharacterId;
  readonly group: Group;
  runtime: CharacterRuntime;
  model: LoadedModel | null;
  /** Inverse of `model.nodeObjects` (mesh picking). */
  nodeOf: ReadonlyMap<Object3D, number>;
  materials: MaterialState[];
  readonly placement: Float64Array;
  poseDirty: boolean;
  /** Rig program the control and skeleton lines were built from (rebuild when it changes). */
  builtFrom: CharacterRuntime['program'] | null;
  /** §5.5 rule-2 state per limb of the program (`limbVisibilityState`; 255 = not read yet). */
  limbStates: Uint8Array;
  /** The model's objects hidden because mesh-view draws their mesh (Model, made editable; §5.23). */
  hidden: Object3D[];
}

const UNKNOWN_LIMB_STATE = 255;

export interface SceneSyncOptions {
  readonly app: EditorApp;
  readonly scene: Scene;
  readonly controls: ControlLayer;
  readonly skeleton: SkeletonLayer;
  /** Called when something visible changed outside `update()` (e.g. a model arrived): request a render. */
  readonly onChange: () => void;
}

/** Narrow check that a DisplayModel handle is io/three's LoadedModel. */
export function isLoadedModel(handle: unknown): handle is LoadedModel {
  if (typeof handle !== 'object' || handle === null) return false;
  const value = handle as Partial<LoadedModel>;
  return typeof value.root === 'object' && value.root !== null && Array.isArray(value.nodeObjects);
}

export class SceneSync {
  /** Parent of every character group (placement → model root with the facing). */
  readonly characterRoot = new Group();
  private readonly slots = new Map<CharacterId, CharacterSlot>();
  private readonly disposers: (() => void)[] = [];
  private xray = false;
  private structureDirty = true;
  private placementDirty = true;
  /** Visibility inputs changed (selection, hidden controls, preferences) since the last `update()`. */
  private visibilityDirty = false;
  /** The workspace or the character mesh records changed: re-read which glTF meshes mesh-view draws (§5.23). */
  private editableDirty = true;
  private lastSpringTime = -1;
  private stamp = 0;

  constructor(private readonly opts: SceneSyncOptions) {
    this.characterRoot.name = 'ekza.characters';
    opts.scene.add(this.characterRoot);
    const { app } = opts;
    this.disposers.push(
      app.characters.subscribe((event) => {
        if (event.type === 'removed') this.removeSlot(event.id);
        else this.syncSlot(event.id);
        this.opts.onChange();
      }),
      app.evaluation.subscribe((event) => {
        for (const id of event.characters) {
          const slot = this.slots.get(id);
          if (slot !== undefined) slot.poseDirty = true;
        }
      }),
      app.store.subscribe((batch) => {
        // M-1: the batch's table set (`batchTables`, one scan per batch for every listener).
        const tables = batchTables(batch);
        if (tables.has('characters')) this.placementDirty = true;
        const touched = batch.origin === 'load' || tables.has('controls');
        if (touched) this.structureDirty = true;
        if (tables.has('meshes') || batch.origin === 'load') this.editableDirty = true;
        if (touched || this.placementDirty || this.editableDirty) this.opts.onChange();
      }),
      app.session.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace) {
          this.editableDirty = true;
          this.opts.onChange();
        }
        if (
          state.hiddenControls !== previous.hiddenControls ||
          state.showSecondary !== previous.showSecondary ||
          state.selection.controls !== previous.selection.controls
        ) {
          // Rule 3: a selected control the IK/FK rule hides is a ghost (overrides re-evaluate the pose first).
          if (this.refreshVisibility()) this.opts.onChange();
        }
      }),
      app.prefs.subscribe((prefs, previous) => {
        if (prefs.ikFkVisibility !== previous.ikFkVisibility && this.refreshVisibility()) this.opts.onChange();
      }),
    );
    for (const runtime of app.characters.list()) this.syncSlot(runtime.id);
  }

  /** Characters currently in the scene. */
  characterIds(): readonly CharacterId[] {
    return [...this.slots.keys()];
  }

  model(character: CharacterId): LoadedModel | null {
    return this.slots.get(character)?.model ?? null;
  }

  /** Character group (scene placement), e.g. for framing. */
  group(character: CharacterId): Group | null {
    return this.slots.get(character)?.group ?? null;
  }

  /** Changes whenever any pose, model or placement changed in `update()` (cache key for posed geometry). */
  get poseStamp(): number {
    return this.stamp;
  }

  /** Characters with a display model, for mesh picking. */
  *meshTargets(): IterableIterator<MeshPickTarget> {
    for (const slot of this.slots.values()) {
      if (slot.model !== null) yield { character: slot.id, model: slot.model, nodeOf: slot.nodeOf };
    }
  }

  /** Scene matrix of a character's placement (column-major). */
  placement(character: CharacterId): Mat4 | null {
    return this.slots.get(character)?.placement ?? null;
  }

  /**
   * Applies pending structure and pose changes. Returns true when anything visible changed. `springs` enables the
   * VRM spring-bone preview (only during playback, MVP-SPEC §4.11.16); `nowMs` drives its time step.
   */
  update(opts: { readonly springs: boolean; readonly nowMs: number }): boolean {
    let changed = false;
    if (this.editableDirty) {
      this.editableDirty = false;
      for (const slot of this.slots.values()) if (this.applyEditableHides(slot)) changed = true;
    }
    if (this.structureDirty) {
      this.structureDirty = false;
      for (const slot of this.slots.values()) this.rebuildLines(slot);
      changed = true;
    }
    if (this.placementDirty) {
      this.placementDirty = false;
      for (const slot of this.slots.values()) {
        this.readPlacement(slot);
        slot.poseDirty = true;
      }
    }

    let anyPose = false;
    for (const slot of this.slots.values()) {
      if (!slot.poseDirty) continue;
      anyPose = true;
      if (slot.model !== null) writeBoneLocals(slot.model, slot.runtime.pose.boneLocal);
    }
    if (anyPose || changed) {
      // One world-matrix pass for the whole scene (matrixWorldAutoUpdate is off).
      this.opts.scene.updateMatrixWorld();
      for (const slot of this.slots.values()) {
        if (slot.model === null) continue;
        if (slot.model.nodeConstraints !== null) {
          slot.model.nodeConstraints.update();
          for (const node of slot.runtime.skeleton.constrainedNodes) {
            slot.model.nodeObjects[node]?.updateMatrixWorld(true);
          }
        }
      }
    }
    if (opts.springs) {
      const dt =
        this.lastSpringTime < 0 ? 1 / 60 : Math.min(Math.max((opts.nowMs - this.lastSpringTime) / 1000, 0), 0.1);
      this.lastSpringTime = opts.nowMs;
      for (const slot of this.slots.values()) slot.model?.springBones?.update(dt);
      changed = true;
    } else if (this.lastSpringTime >= 0) {
      this.lastSpringTime = -1;
      for (const slot of this.slots.values()) slot.model?.springBones?.reset();
    }

    for (const slot of this.slots.values()) {
      if (!slot.poseDirty) continue;
      slot.poseDirty = false;
      // §5.5 rule 5: an animated ikFk can switch the visible set; only a crossed threshold re-runs the rule.
      if (this.limbStatesChanged(slot)) this.visibilityDirty = true;
      this.opts.controls.updatePose(slot.id, slot.placement, slot.runtime.pose.controlWorld);
      this.opts.controls.updatePoles(
        slot.id,
        slot.placement,
        slot.runtime.pose.boneWorld,
        slot.runtime.pose.controlWorld,
      );
      this.opts.skeleton.updatePose(slot.id, slot.placement, slot.runtime.pose.boneWorld);
      changed = true;
    }
    if (this.visibilityDirty && this.refreshVisibility()) changed = true;
    if (changed || anyPose) this.stamp++;
    return changed;
  }

  /** Marks every pose dirty (e.g. after a context restore or a layout-independent refresh). */
  invalidatePoses(): void {
    for (const slot of this.slots.values()) slot.poseDirty = true;
  }

  /**
   * X-ray for the next pane: meshes at 50 % opacity without depth writes, so control lines stay fully visible.
   * Cheap to call per pane: it only touches materials when the state flips.
   */
  setXray(on: boolean): void {
    if (on === this.xray) return;
    this.xray = on;
    for (const slot of this.slots.values()) {
      for (const state of slot.materials) {
        if (on) applyXray(state);
        else restoreMaterial(state);
      }
    }
  }

  /** Attaches a loaded display model to a character (normally from the registry's 'display' event). */
  attachModel(character: CharacterId, model: LoadedModel): void {
    const slot = this.slots.get(character);
    if (slot === undefined || slot.model === model) return;
    this.detachModel(slot);
    slot.model = model;
    slot.nodeOf = nodeIndexOf(model);
    slot.group.add(model.root);
    model.root.traverse((object) => prepareObject(object, slot.materials));
    slot.hidden = [];
    this.editableDirty = true;
    slot.poseDirty = true;
    this.opts.onChange();
  }

  /** §5.5: visible (drawn and pickable); a ghost or hidden control is not. */
  isControlVisible(id: ControlId): boolean {
    return this.visibilityOf(id) === 'visible';
  }

  /** The §5.5 visibility of a control (`controlVisibility`, rules 1–3). */
  visibilityOf(id: ControlId): ControlVisibility {
    if (this.opts.app.store.get('controls', id) === undefined) return 'hidden';
    return controlVisibilityResolver(this.opts.app)(id);
  }

  /**
   * Reads each limb's rule-2 state (IK, between, FK) from the evaluated ikFk into the slot; true when one changed.
   * Allocation-free per frame (the state array is replaced only when the program's limb count changes).
   */
  private limbStatesChanged(slot: CharacterSlot): boolean {
    const limbs = slot.runtime.program.limbs;
    if (slot.limbStates.length !== limbs.length) {
      slot.limbStates = new Uint8Array(limbs.length).fill(UNKNOWN_LIMB_STATE);
    }
    let changed = false;
    for (let i = 0; i < limbs.length; i++) {
      const limb = limbs[i];
      if (limb === undefined) continue;
      const state = limbVisibilityState(this.opts.app.evaluation.ikFk(slot.id, limb.id) ?? 0);
      if (state !== slot.limbStates[i]) {
        slot.limbStates[i] = state;
        changed = true;
      }
    }
    return changed;
  }

  /** Re-applies the visibility rule to every control; true when anything visible changed. */
  private refreshVisibility(): boolean {
    this.visibilityDirty = false;
    const resolve = controlVisibilityResolver(this.opts.app);
    return this.opts.controls.updateVisibility(resolve);
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const id of this.slots.keys()) this.removeSlot(id);
    this.characterRoot.removeFromParent();
  }

  private syncSlot(id: CharacterId): void {
    const runtime = this.opts.app.characters.get(id);
    if (runtime === undefined) {
      this.removeSlot(id);
      return;
    }
    let slot = this.slots.get(id);
    if (slot === undefined) {
      const group = new Group();
      group.name = `ekza.character.${id}`;
      this.characterRoot.add(group);
      slot = {
        id,
        group,
        runtime,
        model: null,
        nodeOf: new Map(),
        materials: [],
        placement: new Float64Array(16),
        poseDirty: true,
        builtFrom: null,
        limbStates: new Uint8Array(0),
        hidden: [],
      };
      this.slots.set(id, slot);
      this.readPlacement(slot);
    }
    slot.runtime = runtime;
    slot.poseDirty = true;
    if (slot.builtFrom !== runtime.program) this.rebuildLines(slot);
    const display = runtime.display;
    if (display !== null && display.kind === 'three' && isLoadedModel(display.handle))
      this.attachModel(id, display.handle);
  }

  private removeSlot(id: CharacterId): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.detachModel(slot);
    slot.group.removeFromParent();
    this.opts.controls.removeCharacter(id);
    this.opts.skeleton.removeCharacter(id);
    this.slots.delete(id);
  }

  private detachModel(slot: CharacterSlot): void {
    if (slot.model === null) return;
    // The character registry owns the model's lifetime (DisplayModel.dispose); only detach it here.
    if (this.xray) for (const state of slot.materials) restoreMaterial(state);
    slot.model.root.removeFromParent();
    for (const object of slot.hidden) object.layers.set(LAYER.mesh);
    slot.hidden = [];
    slot.model = null;
    slot.nodeOf = new Map();
    slot.materials = [];
  }

  /**
   * In Model a character's glTF meshes made editable are drawn by mesh-view at bind pose (§5.17, §5.23): the loaded
   * display hides them (no layer: neither drawn nor picked), so the posed body is never drawn on top of the editable
   * one. Elsewhere the display shows everything (the rebuilt container carries the edits). True when anything changed.
   */
  private applyEditableHides(slot: CharacterSlot): boolean {
    const model = slot.model;
    if (model === null) return false;
    const next: Object3D[] = [];
    if (this.opts.app.session.getState().workspace === 'model' && model.meshObjects !== undefined) {
      for (const record of characterMeshRecords(this.opts.app.store, slot.id)) {
        const index = record.source?.mesh;
        if (index !== undefined) next.push(...(model.meshObjects.get(index) ?? []));
      }
    }
    if (next.length === slot.hidden.length && next.every((object, i) => object === slot.hidden[i])) return false;
    for (const object of slot.hidden) object.layers.set(LAYER.mesh);
    for (const object of next) object.layers.disableAll();
    slot.hidden = next;
    return true;
  }

  private rebuildLines(slot: CharacterSlot): void {
    const { app } = this.opts;
    const session = app.session.getState();
    const records: ControlRecord[] = slot.runtime.program.controls.map(
      (record) => app.store.get('controls', record.id) ?? record,
    );
    const resolve = controlVisibilityResolver(app);
    const poles: PoleLink[] = slot.runtime.program.limbs.map((limb) => ({
      pole: limb.params.pole,
      midNode: limb.nodes.mid,
    }));
    this.opts.controls.setCharacter(
      slot.id,
      records,
      (record) => (controlVisible(record, session) ? resolve(record.id) : 'hidden'),
      poles,
    );
    this.opts.skeleton.setCharacter(slot.id, slot.runtime.skeleton);
    slot.builtFrom = slot.runtime.program;
    slot.limbStates = new Uint8Array(slot.runtime.program.limbs.length).fill(UNKNOWN_LIMB_STATE);
    slot.poseDirty = true;
  }

  private readPlacement(slot: CharacterSlot): void {
    const record: CharacterRecord | undefined = this.opts.app.store.get('characters', slot.id);
    const placement = record?.placement ?? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    mat4Compose(placement, slot.placement);
    slot.group.position.set(placement.t[0], placement.t[1], placement.t[2]);
    slot.group.quaternion.set(placement.q[0], placement.q[1], placement.q[2], placement.q[3]);
    slot.group.scale.set(placement.s[0], placement.s[1], placement.s[2]);
  }
}

/** Visible unless hidden per user, or a hidden-by-default secondary control while secondaries are off. */
export function controlVisible(
  record: ControlRecord,
  session: { readonly hiddenControls: ReadonlySet<ControlId>; readonly showSecondary: boolean },
): boolean {
  if (record.deleted !== null || session.hiddenControls.has(record.id)) return false;
  return !record.hiddenByDefault || session.showSecondary;
}

/** Kernel bone locals (t, q, s per node; raw glTF node space) into the model's node objects. */
function writeBoneLocals(model: LoadedModel, boneLocal: Float64Array): void {
  const nodes = model.nodeObjects;
  for (let i = 0; i < nodes.length; i++) {
    const object = nodes[i];
    const o = i * 10;
    if (object === null || object === undefined || o + 10 > boneLocal.length) continue;
    object.position.set(boneLocal[o] as number, boneLocal[o + 1] as number, boneLocal[o + 2]);
    object.quaternion.set(
      boneLocal[o + 3] as number,
      boneLocal[o + 4] as number,
      boneLocal[o + 5] as number,
      boneLocal[o + 6] as number,
    );
    object.scale.set(boneLocal[o + 7] as number, boneLocal[o + 8] as number, boneLocal[o + 9]);
  }
}

/** Puts meshes on the mesh layer, disables culling of skinned meshes and records materials for x-ray. */
function prepareObject(object: Object3D, materials: MaterialState[]): void {
  const mesh = object as Mesh;
  if (mesh.isMesh !== true) return;
  mesh.layers.set(LAYER.mesh);
  if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) mesh.frustumCulled = false;
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of list) {
    if (materials.some((state) => state.material === material)) continue;
    materials.push({
      material,
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
    });
  }
}

function applyXray(state: MaterialState): void {
  setTransparent(state.material, true);
  state.material.opacity = state.opacity * XRAY_OPACITY;
  state.material.depthWrite = false;
}

function restoreMaterial(state: MaterialState): void {
  setTransparent(state.material, state.transparent);
  state.material.opacity = state.opacity;
  state.material.depthWrite = state.depthWrite;
}

/**
 * `transparent` feeds three's `OPAQUE` shader define (alpha forced to 1), which WebGLRenderer does not re-check on
 * its own: flipping it needs a program lookup (`needsUpdate`). Both variants stay in the material's program cache,
 * so switching per pane costs a cache-key computation, not a recompile.
 */
function setTransparent(material: Material, transparent: boolean): void {
  if (material.transparent === transparent) return;
  material.transparent = transparent;
  material.needsUpdate = true;
}
