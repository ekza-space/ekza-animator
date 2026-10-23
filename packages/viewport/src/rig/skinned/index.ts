// The Rig & Skin skinned display (M6B-SPEC §5.1 Display, §4.7; C1): in Rig & Skin the active character's bound meshes
// draw through mesh-view's `SkinnedSurface` (live weights, partial uploads, bones from the kernel per pose version),
// one host per bound mesh through `addMeshLayer`; the character's ModelLoader display hides its skinned meshes while
// this display shows them (its static meshes stay: they follow the root). Unbound meshes keep the ModelLoader path.
// Mounted by the Rig & Skin shell (C7) or the weight display (C6) through the lazy viewport rig module:
// `loadViewportRig().then((rig) => rig.attachSkinnedDisplay(app, vm, mod))`; it follows the workspace, the active
// character, the document (binds, weight edits, joint edits) and the evaluation (pose versions) by itself.
import type { Disposer } from '@ekza-studio/anim-core';
import { mat4Compose, mat4Invert, type ReadonlyXf, xfMultiply } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId, MeshRecord, PaletteId } from '@ekza-studio/doc';
import { type EditorApp, meshKernel } from '@ekza-studio/editor-core';
import type * as MeshViewModule from '@ekza-studio/mesh-view';
import type { MeshViewLayers, MeshViewThemeInput, SkinnedSurface } from '@ekza-studio/mesh-view';
import type { SkeletonDesc } from '@ekza-studio/rig';
import type { MeshLayerHost } from '../../manager/meshLayers';
import { MESH_LAYERS } from '../../mesh/layers';
import { surfaceMaps } from '../../mesh/maps';

/** The part of the viewport the display needs (B9's `addMeshLayer` and a redraw request). */
export interface SkinnedDisplayTarget {
  addMeshLayer(host: MeshLayerHost): Disposer;
  invalidate(): void;
}

interface Entry {
  readonly id: MeshId;
  readonly surface: SkinnedSurface;
  readonly dispose: Disposer;
  /** Mesh runtime version and record the surface was built from. */
  version: number;
  record: MeshRecord;
  /** The pose version the bones were last set for (−1: none). */
  pose: number;
  skeleton: SkeletonDesc;
}

/** Inverse rest worlds (16 × nodes) of a SkeletonDesc (bind = rest, §5.1). */
export function inverseBindOf(skeleton: SkeletonDesc): Float64Array {
  const worlds: ReadonlyXf[] = [];
  const out = new Float64Array(16 * skeleton.nodes.length);
  skeleton.nodes.forEach((node, i) => {
    const parent = node.parent === -1 ? undefined : worlds[node.parent];
    const world = parent === undefined ? node.restLocal : xfMultiply(parent, node.restLocal);
    worlds.push(world);
    const inverse = mat4Invert(mat4Compose(world));
    if (inverse !== null) out.set(inverse, 16 * i);
  });
  return out;
}

/** Palette index (JointId keys) → SkeletonDesc node, through the joints' stable keys (−1: not a node). */
export function paletteToBoneOf(
  app: EditorApp,
  skeleton: SkeletonDesc,
  palette: readonly { readonly key: string }[],
): Int32Array {
  const nodeOfKey = new Map((skeleton.jointKeys ?? []).map((key, i) => [key, i]));
  return Int32Array.from(palette, (entry) => {
    const joint = app.store.get('joints', entry.key as never);
    return joint === undefined ? -1 : (nodeOfKey.get(joint.key) ?? -1);
  });
}

/** The live swatch colours (slot → sRGB) of a palette, null without one. */
function paintOf(app: EditorApp, palette: PaletteId | null): Map<number, readonly [number, number, number]> | null {
  if (palette === null) return null;
  const out = new Map<number, readonly [number, number, number]>();
  for (const swatch of app.store.query.swatchesOfPalette(palette)) {
    if (!out.has(swatch.slot)) out.set(swatch.slot, swatch.srgb);
  }
  return out;
}

export class SkinnedCharacterDisplay {
  private readonly entries = new Map<MeshId, Entry>();
  private readonly disposers: Disposer[] = [];
  private character: CharacterId | null = null;
  private hidden: { visible: boolean }[] = [];
  private disposed = false;

  constructor(
    private readonly app: EditorApp,
    private readonly target: SkinnedDisplayTarget,
    private readonly mod: typeof MeshViewModule,
    private readonly opts: { readonly theme: MeshViewThemeInput; readonly layers?: MeshViewLayers },
  ) {
    this.disposers.push(
      app.session.subscribe(() => this.sync()),
      app.store.subscribe(() => this.sync()),
      app.characters.subscribe(() => this.sync()),
      app.meshes.subscribe(() => this.sync()),
      app.evaluation.subscribe(() => this.update()),
    );
    this.sync();
  }

  /** The active character of Rig & Skin, or null outside the workspace (or without a model character). */
  private activeCharacter(): CharacterId | null {
    const state = this.app.session.getState();
    if (state.workspace !== 'rig') return null;
    const id = state.rig.character ?? state.activeCharacter ?? null;
    const character = id === null ? undefined : this.app.store.get('characters', id);
    return character?.source?.kind === 'model' ? character.id : null;
  }

  /** The bound meshes of the active character (MeshRecord.skin names its skeleton). */
  private boundMeshes(character: CharacterId): MeshRecord[] {
    const record = this.app.store.get('characters', character);
    if (record?.source?.kind !== 'model') return [];
    const skeleton = record.source.skeleton;
    return this.app.store.query
      .meshesOfOwner(character)
      .filter((mesh) => mesh.skin !== null && 'skeleton' in mesh.skin && mesh.skin.skeleton === skeleton);
  }

  /** Brings the hosts in line with the workspace, the character, its bound meshes and their revisions. */
  sync(): void {
    if (this.disposed) return;
    const character = this.activeCharacter();
    const runtime = character === null ? undefined : this.app.characters.get(character);
    const kernel = meshKernel();
    const wanted = character === null || runtime === undefined || kernel === null ? [] : this.boundMeshes(character);
    const keep = new Set(wanted.map((mesh) => mesh.id));
    // INT (§5.25 idle gate): a frame only when something drawn changed — not on every session or store event.
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (keep.has(id)) continue;
      entry.dispose();
      entry.surface.dispose();
      this.entries.delete(id);
      changed = true;
    }
    this.character = wanted.length === 0 ? null : character;
    if (runtime !== undefined && kernel !== null) {
      for (const record of wanted) {
        const mesh = this.app.meshes.get(record.id);
        const data = mesh?.data() ?? null;
        if (mesh === undefined || data === null) continue;
        let entry = this.entries.get(record.id);
        if (
          entry !== undefined &&
          entry.version === mesh.version &&
          entry.record === record &&
          entry.skeleton === runtime.skeleton
        ) {
          continue;
        }
        const skin = kernel.readSkin(data);
        if (skin === null) continue;
        if (entry === undefined) {
          const surface = new this.mod.SkinnedSurface({
            theme: this.opts.theme,
            layers: this.opts.layers ?? MESH_LAYERS,
          });
          const host: MeshLayerHost = {
            root: surface.root,
            applyPane: (display) => surface.applyPane(display),
            dispose: () => {},
          };
          entry = {
            id: record.id,
            surface,
            dispose: this.target.addMeshLayer(host),
            version: -1,
            record,
            pose: -1,
            skeleton: runtime.skeleton,
          };
          this.entries.set(record.id, entry);
        }
        entry.surface.setData(
          data,
          mesh.triangulation(),
          mesh.normals(),
          skin,
          paintOf(this.app, record.palette),
          paletteToBoneOf(this.app, runtime.skeleton, skin.palette),
        );
        const shown = entry;
        // An imported model's base colour image (AR-D8-1): set once it is loaded.
        shown.surface.setMap(
          surfaceMaps(this.app).mapOf(record, () => {
            if (this.entries.get(shown.id) !== shown) return;
            shown.surface.setMap(surfaceMaps(this.app).mapOf(shown.record, () => {}));
            this.target.invalidate();
          }),
        );
        entry.version = mesh.version;
        entry.record = record;
        entry.skeleton = runtime.skeleton;
        entry.pose = -1;
        changed = true;
      }
    }
    if (this.applyHides()) changed = true;
    this.update();
    if (changed) this.target.invalidate();
  }

  /** Sets the bones of every surface whose character pose changed (once per pose version). */
  update(): boolean {
    const runtime = this.character === null ? undefined : this.app.characters.get(this.character);
    if (runtime === undefined) return false;
    let changed = false;
    let inverse: Float64Array | null = null;
    for (const entry of this.entries.values()) {
      if (entry.pose === runtime.pose.version && entry.skeleton === runtime.skeleton) continue;
      inverse ??= inverseBindOf(runtime.skeleton);
      entry.surface.setBones(runtime.pose.boneWorld, inverse);
      entry.pose = runtime.pose.version;
      changed = true;
    }
    if (changed) this.target.invalidate();
    return changed;
  }

  /** CPU-skinned points of a shown mesh (posed picking and painting), null when not shown. */
  posedPoints(mesh: MeshId): Float32Array | null {
    const entry = this.entries.get(mesh);
    const data = entry?.surface.current;
    if (entry === undefined || data === null || data === undefined) return null;
    const out = new Float32Array(3 * data.counts.points);
    entry.surface.cpuSkin(out);
    return out;
  }

  /** The surface of a shown mesh (C6's weight display drives it). */
  surfaceOf(mesh: MeshId): SkinnedSurface | null {
    return this.entries.get(mesh)?.surface ?? null;
  }

  /** Hides the ModelLoader display's skinned meshes of the shown character (restores the previous ones). */
  /** Hides the character's own skinned meshes under the surfaces; true when the hidden set changed. */
  private applyHides(): boolean {
    const before = this.hidden;
    for (const object of this.hidden) object.visible = true;
    this.hidden = [];
    const same = (): boolean =>
      before.length === this.hidden.length && before.every((object, i) => object === this.hidden[i]);
    if (this.character === null || this.entries.size === 0) return !same();
    const handle = this.app.characters.get(this.character)?.display?.handle as
      | { readonly skinnedMeshes?: readonly { visible: boolean }[] }
      | undefined;
    for (const object of handle?.skinnedMeshes ?? []) {
      if (!object.visible) continue;
      object.visible = false;
      this.hidden.push(object);
    }
    return !same();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const entry of this.entries.values()) {
      entry.dispose();
      entry.surface.dispose();
    }
    this.entries.clear();
    for (const object of this.hidden) object.visible = true;
    this.hidden = [];
  }
}

/** Mounts the skinned display on a viewport (the mesh-view module comes from `loadMeshView()`). */
export function attachSkinnedDisplay(
  app: EditorApp,
  target: SkinnedDisplayTarget,
  mod: typeof MeshViewModule,
  opts: { readonly theme: MeshViewThemeInput; readonly layers?: MeshViewLayers },
): SkinnedCharacterDisplay {
  return new SkinnedCharacterDisplay(app, target, mod, opts);
}
