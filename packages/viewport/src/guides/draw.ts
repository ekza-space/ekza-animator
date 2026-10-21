// Template guides, the drawing (M6A-SPEC §5.16; B13; lazy chunk): line helpers on the helpers layer (9) of the shared
// viewport scene, in the Model workspace only, never picked (the pickers raycast the mesh layer) and never exported
// (they are not document geometry):
// - a "Humanoid" group: the proportion guides of its preset and height — ground, ankle, knee, hip, shoulder, chin and
//   head lines (a square outline at each height, so they read in the front, side and top views), two height lines
//   and the +Z facing arrow on the ground;
// - a "Handheld" group: the grip gizmo at the group origin (the grip) — a ring around +Y, a +Y arrow for the shaft and
//   a +Z arrow for the fingertips.
// Lines are drawn without a depth test (always visible over the model) at reduced opacity.
import type { GroupRecord } from '@ekza-studio/doc';
import { type EditorApp, objectWorld } from '@ekza-studio/editor-core';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { LAYER } from '../layers';
import { GUIDE_HALF_WIDTH, GUIDE_LINES, humanoidGuideLevels } from './levels';

/** Token colours (§8.9): the symmetry-plane blue for proportion guides, the rig centre yellow and axis colours. */
const COLOURS = {
  humanoid: 0x5cc8ff,
  ring: 0xffd84d,
  shaft: 0x5fd36e,
  fingers: 0x4f8dff,
} as const;
const OPACITY = 0.75;
/** Grip gizmo sizes (metres). */
const GRIP = { ring: 0.04, shaft: 0.15, fingers: 0.08, head: 0.015 } as const;

type Segments = number[];

function push(out: Segments, a: readonly number[], b: readonly number[]): void {
  out.push(a[0] as number, a[1] as number, a[2] as number, b[0] as number, b[1] as number, b[2] as number);
}

/** An arrow from `from` along unit axis `dir` (length `len`) with a two-stroke head in the plane of `side`. */
function arrow(
  out: Segments,
  from: readonly number[],
  dir: readonly number[],
  side: readonly number[],
  len: number,
  head: number,
): void {
  const tip = [0, 1, 2].map((i) => (from[i] as number) + (dir[i] as number) * len);
  push(out, from, tip);
  for (const sign of [1, -1]) {
    const back = [0, 1, 2].map(
      (i) => (tip[i] as number) - (dir[i] as number) * head + (side[i] as number) * head * sign,
    );
    push(out, tip, back);
  }
}

/** Segments of a humanoid group's proportion guides (group-local metres). */
export function humanoidGuideSegments(params: Readonly<Record<string, unknown>>): Float32Array {
  const { height, levels } = humanoidGuideLevels(params);
  const w = GUIDE_HALF_WIDTH * height;
  const out: Segments = [];
  for (const line of GUIDE_LINES) {
    const y = levels[line];
    const corners = [
      [-w, y, -w],
      [w, y, -w],
      [w, y, w],
      [-w, y, w],
    ];
    for (let i = 0; i < 4; i++) push(out, corners[i] as number[], corners[(i + 1) % 4] as number[]);
  }
  // Height lines at the right edge (front view) and the back edge (side view).
  push(out, [w, 0, 0], [w, height, 0]);
  push(out, [0, 0, -w], [0, height, -w]);
  // The facing arrow (+Z) on the ground.
  arrow(out, [0, 0, 0], [0, 0, 1], [1, 0, 0], w * 1.25, w * 0.2);
  return Float32Array.from(out);
}

/** Segments of a handheld group's grip gizmo (group-local metres): ring around +Y, +Y shaft arrow, +Z finger arrow. */
export function gripGizmoSegments(): {
  readonly ring: Float32Array;
  readonly shaft: Float32Array;
  readonly fingers: Float32Array;
} {
  const ring: Segments = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    push(
      ring,
      [Math.cos(a) * GRIP.ring, 0, Math.sin(a) * GRIP.ring],
      [Math.cos(b) * GRIP.ring, 0, Math.sin(b) * GRIP.ring],
    );
  }
  const shaft: Segments = [];
  arrow(shaft, [0, 0, 0], [0, 1, 0], [1, 0, 0], GRIP.shaft, GRIP.head);
  const fingers: Segments = [];
  arrow(fingers, [0, 0, 0], [0, 0, 1], [1, 0, 0], GRIP.fingers, GRIP.head);
  return { ring: Float32Array.from(ring), shaft: Float32Array.from(shaft), fingers: Float32Array.from(fingers) };
}

function lines(positions: Float32Array, colour: number, name: string): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: colour,
    transparent: true,
    opacity: OPACITY,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const object = new LineSegments(geometry, material);
  object.name = name;
  object.layers.set(LAYER.helpers);
  object.frustumCulled = false;
  object.renderOrder = 10;
  return object;
}

/** What the guides need of the viewport: the shared scene's root to hang them on and a redraw request. */
export interface GuideTarget {
  readonly scene: { add(object: Group): unknown; remove(object: Group): unknown };
  invalidate(): void;
}

/** The ids of the template groups the guides draw (live, Model workspace, not hidden). */
export function guideGroups(app: EditorApp): readonly GroupRecord[] {
  const state = app.session.getState();
  if (state.workspace !== 'model') return [];
  const hidden = state.model.hiddenObjects;
  return app.store
    .list('groups')
    .filter(
      (group) =>
        (group.template?.kind === 'humanoid' || group.template?.kind === 'handheld') &&
        !hidden.has(group.id) &&
        'scene' in group.owner,
    );
}

export class GuideLayer {
  readonly root = new Group();
  private readonly disposers: (() => void)[] = [];
  private disposed = false;
  private key = '';

  constructor(
    private readonly app: EditorApp,
    private readonly target: GuideTarget,
  ) {
    this.root.name = 'ekza.guides';
    this.root.matrixAutoUpdate = false;
    target.scene.add(this.root);
    this.disposers.push(
      app.store.subscribe((batch) => {
        if (batch.changes.some((change) => change.table === 'groups')) this.sync();
      }),
      app.session.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace || state.model.hiddenObjects !== previous.model.hiddenObjects) {
          this.sync();
        }
      }),
    );
    this.sync();
  }

  /** Rebuilds the guides when the template groups, their placements or their params changed. */
  sync(): void {
    if (this.disposed) return;
    const groups = guideGroups(this.app);
    const placed = groups.map((group) => ({ group, world: objectWorld(this.app.store, group) }));
    const key = JSON.stringify(placed.map(({ group, world }) => [group.id, group.template, world]));
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const { group, world } of placed) {
      const node = new Group();
      node.name = `ekza.guides.${group.id}`;
      node.matrixAutoUpdate = false;
      node.matrix.copy(placementMatrix(world));
      if (group.template?.kind === 'humanoid') {
        node.add(lines(humanoidGuideSegments(group.template.params), COLOURS.humanoid, 'humanoid'));
      } else {
        const gizmo = gripGizmoSegments();
        node.add(lines(gizmo.ring, COLOURS.ring, 'grip-ring'));
        node.add(lines(gizmo.shaft, COLOURS.shaft, 'grip-shaft'));
        node.add(lines(gizmo.fingers, COLOURS.fingers, 'grip-fingers'));
      }
      this.root.add(node);
    }
    this.root.updateMatrixWorld(true);
    this.target.invalidate();
  }

  /** The drawn guide groups and their line names (tests). */
  drawn(): readonly { readonly id: string; readonly lines: readonly string[]; readonly matrix: readonly number[] }[] {
    return this.root.children.map((node) => ({
      id: node.name.replace('ekza.guides.', ''),
      lines: node.children.map((child) => child.name),
      matrix: [...(node as Group).matrix.elements],
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.clear();
    this.target.scene.remove(this.root);
    this.target.invalidate();
  }

  private clear(): void {
    for (const node of this.root.children.slice()) {
      this.root.remove(node);
      node.traverse((object) => {
        if (!(object instanceof LineSegments)) return;
        const line = object as LineSegments<BufferGeometry, LineBasicMaterial>;
        line.geometry.dispose();
        line.material.dispose();
      });
    }
  }
}

/** World-from-local matrix of a placement. */
export function placementMatrix(world: {
  readonly t: readonly number[];
  readonly q: readonly number[];
  readonly s: readonly number[];
}): Matrix4 {
  return new Matrix4().compose(
    new Vector3(world.t[0], world.t[1], world.t[2]),
    new Quaternion(world.q[0], world.q[1], world.q[2], world.q[3]),
    new Vector3(world.s[0], world.s[1], world.s[2]),
  );
}
