// The Quick Rig markers overlay (M6B-SPEC §0.2 steps 2–4, §0.4.2; C3): the nine markers (`--marker-quickrig`), the
// six left ghosts of the side markers (their (−x, y, z) mirrors, `--marker-quickrig-ghost`, never dragged), the
// selected marker drawn last and larger with its label, and the live skeleton preview (the fit of the current
// markers, both sides) in the ghost style. Constant pixel sizes per pane; drawn over the meshes (no depth test).
import type { EditorApp, QuickRigState } from '@ekza-studio/editor-core';
import { QUICK_RIG_LABELS, QUICK_RIG_MARKERS } from '@ekza-studio/editor-core';
import type { MeshPaneDisplay } from '@ekza-studio/mesh-view';
import type { QuickRigMarker } from '@ekza-studio/rig';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { LAYER } from '../../layers';
import type { ViewportManager } from '../../manager/ViewportManager';
import type { MeshLayerHost } from '../../manager/meshLayers';
import { ghostOf, type MarkerHit } from '../../tools/rig/quickRig/rules';
import { RIG_COLOURS, syncLabels } from '../joints/overlay';
import { onPane, type PanePoint, type PaneProjection, projectPoint, type Vec3, worldPerPx } from '../joints/pane';

/** Marker sizes in CSS px (radius). */
export const MARKER_PX = { marker: 6, selected: 7.5, ghost: 5, preview: 3 } as const;

const IDENTITY = new Quaternion();
const matrix = new Matrix4();
const at = new Vector3();
const size = new Vector3();

function helper<T extends Object3D>(object: T, order: number): T {
  object.layers.set(LAYER.helpers);
  object.renderOrder = order;
  object.frustumCulled = false;
  return object;
}

function overlayMaterial(colour: string, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false, depthWrite: false });
}

function instanced(geometry: SphereGeometry, colour: string, opacity: number, order: number): InstancedMesh {
  const mesh = helper(new InstancedMesh(geometry, overlayMaterial(colour, opacity), 64), order);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  return mesh;
}

export class QuickRigMarkerOverlay implements MeshLayerHost {
  readonly root = new Group();
  private state: QuickRigState | null = null;
  private hovered: QuickRigMarker | null = null;
  private readonly geometry = new SphereGeometry(1, 16, 12);
  private readonly markers = instanced(this.geometry, RIG_COLOURS.marker, 1, 42);
  private readonly ghosts = instanced(this.geometry, RIG_COLOURS.markerGhost, 0.75, 41);
  private readonly previewJoints = instanced(this.geometry, RIG_COLOURS.bone, 0.9, 40);
  private readonly previewBones = helper(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: RIG_COLOURS.bone, transparent: true, opacity: 0.85, depthTest: false }),
    ),
    39,
  );
  private readonly selected = helper(new Mesh(this.geometry, overlayMaterial('#ffffff')), 44);
  private readonly selectedRing = helper(new Mesh(this.geometry, overlayMaterial(RIG_COLOURS.marker)), 45);
  private readonly labels = new Group();
  /** Drawn markers in instance order (R) and the ghosts (L). */
  private markerSlots: QuickRigMarker[] = [];
  private ghostSlots: QuickRigMarker[] = [];

  constructor(
    private readonly vm: Pick<ViewportManager, 'paneView' | 'paneState'>,
    private readonly app: EditorApp,
  ) {
    this.root.name = 'ekza.rig.quickRig';
    this.root.matrixAutoUpdate = false;
    this.root.add(
      this.previewBones,
      this.previewJoints,
      this.ghosts,
      this.markers,
      this.selected,
      this.selectedRing,
      this.labels,
    );
    this.root.visible = false;
  }

  get current(): QuickRigState | null {
    return this.state;
  }

  setHover(name: QuickRigMarker | null): boolean {
    if (this.hovered === name) return false;
    this.hovered = name;
    return true;
  }

  /** Rebuilds from Quick Rig's state (null hides everything). */
  update(state: QuickRigState | null): void {
    this.state = state;
    if (state === null) {
      this.markerSlots = [];
      this.ghostSlots = [];
      return;
    }
    this.markerSlots = QUICK_RIG_MARKERS.filter((name) => state.markers[name] !== undefined);
    this.ghostSlots = this.markerSlots.filter((name) => (state.markers[name]?.[0] ?? 0) !== 0);
    const moved = new Color(RIG_COLOURS.marker);
    const guessed = new Color(RIG_COLOURS.marker).lerp(new Color('#ffffff'), 0.25);
    this.markerSlots.forEach((name, i) => this.markers.setColorAt(i, state.moved.has(name) ? moved : guessed));
    if (this.markers.instanceColor !== null) this.markers.instanceColor.needsUpdate = true;
    const preview = state.preview ?? [];
    const byKey = new Map(preview.map((joint) => [joint.key, joint]));
    const lines: number[] = [];
    for (const joint of preview) {
      if (joint.parent !== null) {
        const parent = byKey.get(joint.parent);
        if (parent !== undefined) lines.push(...parent.position, ...joint.position);
      }
      if (joint.tail !== null && !preview.some((other) => other.parent === joint.key)) {
        lines.push(...joint.position, ...joint.tail);
      }
    }
    this.previewBones.geometry.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
    this.previewBones.geometry.computeBoundingSphere();
  }

  /** A marker's point (R) or its ghost's (L) in character space = world (scene meshes), or null. */
  pointOf(name: QuickRigMarker, side: 'R' | 'L'): Vec3 | null {
    const point = this.state?.markers[name];
    if (point === undefined) return null;
    if (side === 'R') return point;
    return point[0] === 0 ? null : ghostOf(point);
  }

  private shown(paneId: string): boolean {
    return (
      this.state !== null &&
      this.app.session.getState().workspace === 'rig' &&
      this.vm.paneState(paneId) !== null &&
      this.vm.paneView(paneId) !== null
    );
  }

  applyPane(_display: MeshPaneDisplay, paneId: string): void {
    const view = this.vm.paneView(paneId);
    const state = this.state;
    const show = state !== null && view !== null && this.shown(paneId);
    this.root.visible = show;
    if (!show || view === null || state === null) return;
    const place = (mesh: InstancedMesh, slots: readonly QuickRigMarker[], side: 'R' | 'L', px: number): void => {
      slots.forEach((name, i) => {
        const p = this.pointOf(name, side) as Vec3;
        const r = px * worldPerPx(view, p);
        matrix.compose(at.set(p[0], p[1], p[2]), IDENTITY, size.set(r, r, r));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.markers, this.markerSlots, 'R', MARKER_PX.marker);
    place(this.ghosts, this.ghostSlots, 'L', MARKER_PX.ghost);
    const preview = state.preview ?? [];
    preview.forEach((joint, i) => {
      if (i >= 64) return;
      const r = MARKER_PX.preview * worldPerPx(view, joint.position);
      matrix.compose(at.set(joint.position[0], joint.position[1], joint.position[2]), IDENTITY, size.set(r, r, r));
      this.previewJoints.setMatrixAt(i, matrix);
    });
    this.previewJoints.count = Math.min(preview.length, 64);
    this.previewJoints.instanceMatrix.needsUpdate = true;
    // The selected (else hovered) marker on top, larger, with its label.
    const top = state.selected ?? this.hovered;
    const point = top === null ? null : this.pointOf(top, 'R');
    this.selected.visible = point !== null;
    this.selectedRing.visible = point !== null;
    const labels: { text: string; colour: string; at: Vec3; offset: number }[] = [];
    if (top !== null && point !== null) {
      const perPx = worldPerPx(view, point);
      this.selectedRing.position.set(point[0], point[1], point[2]);
      this.selectedRing.scale.setScalar(MARKER_PX.selected * perPx);
      this.selectedRing.updateMatrixWorld();
      this.selected.position.set(point[0], point[1], point[2]);
      this.selected.scale.setScalar((MARKER_PX.selected + 2) * perPx);
      this.selected.updateMatrixWorld();
      labels.push({ text: QUICK_RIG_LABELS[top], colour: '#ffffff', at: point, offset: MARKER_PX.selected + 6 });
    }
    syncLabels(this.labels, labels, view, 46);
  }

  /** A marker's (R) or ghost's (L) centre in a pane (CSS px); null when not drawn there or off the pane. */
  screenOf(name: QuickRigMarker, side: 'R' | 'L', paneId: string): PanePoint | null {
    const view = this.vm.paneView(paneId);
    const p = this.pointOf(name, side);
    if (view === null || p === null || !this.shown(paneId)) return null;
    const point = projectPoint(view, p);
    return onPane(view, point) ? point : null;
  }

  /** Every marker and ghost with its distance to a pane point (the pick rule filters by radius). */
  hits(paneId: string, x: number, y: number): MarkerHit[] {
    const view: PaneProjection | null = this.vm.paneView(paneId);
    if (view === null || !this.shown(paneId)) return [];
    const out: MarkerHit[] = [];
    for (const name of this.markerSlots) {
      for (const side of ['R', 'L'] as const) {
        const p = this.pointOf(name, side);
        const point = p === null ? null : projectPoint(view, p);
        if (point !== null) out.push({ name, side, distPx: Math.hypot(point.x - x, point.y - y) });
      }
    }
    return out;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const mesh of [this.markers, this.ghosts, this.previewJoints]) {
      mesh.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.selected.material.dispose();
    this.selectedRing.material.dispose();
    this.previewBones.geometry.dispose();
    this.previewBones.material.dispose();
    syncLabels(this.labels, [], { camera: this.selected as never, width: 1, height: 1 });
  }
}
