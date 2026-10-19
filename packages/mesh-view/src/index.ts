// `@ekza-animator/mesh-view` (M6A-SPEC §4.4): edit-mode overlays, static mesh surfaces and component picking — a LAZY
// chunk that `viewport/src/mesh/**` imports dynamically. B0a's skeleton: the final class shapes, whose constructors
// throw `EkzaError('not-implemented')` until B6 lands the bodies. Every entry module references `VIEW_MARKER`, the
// `check-size` marker of the `mesh-view` boundary (§2), so eager code that pulls mesh-view in fails the size gate.
import { EkzaError } from '@ekza-animator/anim-core';
import type {
  ComponentKind,
  ComponentSelection,
  DirtySet,
  EditMesh,
  HiddenSet,
  MeshData,
  MeshProblem,
  Normals,
  Triangulation,
} from '@ekza-animator/mesh-core';
import type { Camera, Object3D, Ray } from 'three';
import type { MeshPaneDisplay, MeshViewLayers, MeshViewTheme, PickHit, PickOptions } from './types';

export type * from './types';

/** `check-size` marker of the mesh-view chunk (§2); referenced by every mesh-view entry module. */
export const VIEW_MARKER = 'ekza-mesh-view' as const;

function notImplemented(symbol: string): EkzaError {
  return new EkzaError('not-implemented', `mesh-view.${symbol}`, { view: VIEW_MARKER });
}

/** Edit-mode overlays of one mesh in component mode (draw list of research 13 §7.1). */
export class EditMeshView {
  declare readonly root: Object3D;
  constructor(_opts: { readonly theme: MeshViewTheme; readonly layers: MeshViewLayers }) {
    throw notImplemented('EditMeshView');
  }
  setMesh(_mesh: EditMesh, _tri: Triangulation, _normals: Normals): void {
    throw notImplemented('EditMeshView.setMesh');
  }
  update(_mesh: EditMesh, _dirty: DirtySet, _tri: Triangulation, _normals: Normals): void {
    throw notImplemented('EditMeshView.update');
  }
  setWorld(_matrix: Float64Array): void {
    throw notImplemented('EditMeshView.setWorld');
  }
  /** `mirrored`: the partners the symmetry expansion adds (expanded minus stored, §5.6), drawn `--comp-selected` at
   *  60 %; `hover.partner` is the hovered component's partner (−1 none), pre-highlighted with it. */
  setState(
    _sel: ComponentSelection,
    _hidden: HiddenSet | null,
    _hover: { readonly kind: ComponentKind; readonly index: number; readonly partner: number } | null,
    _mirrored: ComponentSelection | null,
  ): void {
    throw notImplemented('EditMeshView.setState');
  }
  setSoftWeights(_weights: Float32Array | null): void {
    throw notImplemented('EditMeshView.setSoftWeights');
  }
  setPaint(_colours: ReadonlyMap<number, readonly [number, number, number]> | null): void {
    throw notImplemented('EditMeshView.setPaint');
  }
  setLints(_problems: readonly MeshProblem[]): void {
    throw notImplemented('EditMeshView.setLints');
  }
  setSymmetryPlane(_plane: { readonly axis: 'x' | 'y' | 'z'; readonly offset: number } | null): void {
    throw notImplemented('EditMeshView.setSymmetryPlane');
  }
  applyPane(_display: MeshPaneDisplay): void {
    throw notImplemented('EditMeshView.applyPane');
  }
  dispose(): void {
    throw notImplemented('EditMeshView.dispose');
  }
}

/** Static display of a mesh outside component mode (props in every workspace): no edit links needed. */
export class MeshSurface {
  declare readonly root: Object3D;
  constructor(_opts: { readonly theme: MeshViewTheme; readonly layers: MeshViewLayers }) {
    throw notImplemented('MeshSurface');
  }
  setData(
    _data: MeshData,
    _tri: Triangulation,
    _normals: Normals,
    _paint: ReadonlyMap<number, readonly [number, number, number]> | null,
  ): void {
    throw notImplemented('MeshSurface.setData');
  }
  setWorld(_matrix: Float64Array): void {
    throw notImplemented('MeshSurface.setWorld');
  }
  applyPane(_display: MeshPaneDisplay): void {
    throw notImplemented('MeshSurface.applyPane');
  }
  dispose(): void {
    throw notImplemented('MeshSurface.dispose');
  }
}

/** CPU picking with a three-mesh-bvh BVH (refit after position commits, rebuild after topology commits, deferred to
 *  the first pick or idle) and a screen-space grid for vertices and edges. */
export class ComponentPicker {
  constructor() {
    throw notImplemented('ComponentPicker');
  }
  setMesh(_mesh: EditMesh, _tri: Triangulation, _world: Float64Array, _topologyChanged: boolean): void {
    throw notImplemented('ComponentPicker.setMesh');
  }
  hover(
    _camera: Camera,
    _ndc: readonly [number, number],
    _viewport: { readonly w: number; readonly h: number },
    _kind: ComponentKind,
    _opts: PickOptions,
  ): PickHit | null {
    throw notImplemented('ComponentPicker.hover');
  }
  /** Faces under the ray (first hit), for camera-based tests and Tweak. */
  raycastFace(
    _ray: Ray,
    _opts: PickOptions,
  ): { readonly face: number; readonly point: readonly [number, number, number] } | null {
    throw notImplemented('ComponentPicker.raycastFace');
  }
  marquee(
    _camera: Camera,
    _rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
    _viewport: { readonly w: number; readonly h: number },
    _kind: ComponentKind,
    _opts: PickOptions,
  ): Uint32Array {
    throw notImplemented('ComponentPicker.marquee');
  }
  dispose(): void {
    throw notImplemented('ComponentPicker.dispose');
  }
}
