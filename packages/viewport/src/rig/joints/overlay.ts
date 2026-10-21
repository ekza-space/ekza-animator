// The joint overlay (M6B-SPEC §8.3; C3): instanced spheres in the side colours (selected `--sel`, lead `--sel-lead`,
// hover lighter; hollow for a joint without a human bone in a humanoid skeleton, a small cross for helpers),
// octahedral bones joint → child (leaf → tail; dashed out of a helper), x-ray as two passes (depth-tested, then the
// occluded parts at 35 %), local axes on the selection (or all), labels on hover (or all) and the dashed ring of a
// missing required bone at the template's guess. One host in the shared scene (`addMeshLayer`): `applyPane` sizes the
// glyphs for each pane (radius ≥ 4 CSS px) and follows that pane's display flags. Picking and projection for the
// joint tools and the test API are screen-space (sphere > bone).
import type { JointId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { MeshPaneDisplay } from '@ekza-studio/mesh-view';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  GreaterDepth,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { LAYER } from '../../layers';
import type { ViewportManager } from '../../manager/ViewportManager';
import type { MeshLayerHost } from '../../manager/meshLayers';
import { PICK, VIEWPORT_THEME } from '../../theme';
import { type DrawnBone, type DrawnJoint, EMPTY_SCENE, type JointSceneData, type MissingBone } from './data';
import {
  onPane,
  type PanePoint,
  type PaneProjection,
  projectPoint,
  segmentDistance,
  type Vec3,
  worldPerPx,
} from './pane';

/** Rig tokens the overlay draws with (packages/ui/css/tokens.css; the viewport may not import the ui package). */
export const RIG_COLOURS = {
  bone: '#aeb2bb',
  missing: '#ef6b6b',
  marker: '#ff9f43',
  markerGhost: '#b8732f',
} as const;
/** Joints are at least this many CSS px in radius (§8.3). */
export const MIN_JOINT_PX = 4;
/** Opacity of the occluded x-ray pass (§8.3, as the controls'). */
export const OCCLUDED_JOINT_ALPHA = 0.35;
const LABEL_PX = 14;

export type JointPick =
  | { readonly kind: 'joint'; readonly joint: JointId; readonly distancePx: number }
  | { readonly kind: 'bone'; readonly joint: JointId; readonly distancePx: number }
  | { readonly kind: 'missing'; readonly missing: MissingBone; readonly distancePx: number };

const SIDE_COLOUR: Readonly<Record<DrawnJoint['side'], string>> = {
  L: VIEWPORT_THEME.rigLeft,
  R: VIEWPORT_THEME.rigRight,
  C: VIEWPORT_THEME.rigCenter,
};

/** The colour of a joint glyph. */
export function jointColour(joint: DrawnJoint, hover: boolean): Color {
  const colour = new Color(
    joint.lead ? VIEWPORT_THEME.selLead : joint.selected ? VIEWPORT_THEME.sel : SIDE_COLOUR[joint.side],
  );
  return hover ? colour.lerp(new Color('#ffffff'), 0.35) : colour;
}

/** A unit octahedral bone along +Y (base at 0, widest at 0.1, tip at 1), width 1 at the widest ring. */
function boneGeometry(): BufferGeometry {
  const ring: Vec3[] = [
    [1, 0.1, 0],
    [0, 0.1, 1],
    [-1, 0.1, 0],
    [0, 0.1, -1],
  ];
  const base: Vec3 = [0, 0, 0];
  const tip: Vec3 = [0, 1, 0];
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = ring[i] as Vec3;
    const b = ring[(i + 1) % 4] as Vec3;
    positions.push(...base, ...b, ...a, ...a, ...b, ...tip);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function onHelpers<T extends Object3D>(object: T, order: number): T {
  object.layers.set(LAYER.helpers);
  object.renderOrder = order;
  object.frustumCulled = false;
  return object;
}

const labelTextures = new Map<string, { texture: CanvasTexture; aspect: number }>();

/** A text chip texture (cached per text and colour). */
export function labelTexture(text: string, colour: string): { texture: CanvasTexture; aspect: number } {
  const key = `${colour}|${text}`;
  const hit = labelTextures.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  const scale = 2;
  const font = `${12 * scale}px system-ui, sans-serif`;
  const context = canvas.getContext('2d');
  let width = text.length * 7 * scale;
  if (context !== null) {
    context.font = font;
    width = Math.ceil(context.measureText(text).width) + 10 * scale;
  }
  canvas.width = Math.max(width, 8);
  canvas.height = LABEL_PX * scale + 4;
  const draw = canvas.getContext('2d');
  if (draw !== null) {
    draw.fillStyle = 'rgba(23, 24, 27, 0.85)';
    draw.fillRect(0, 0, canvas.width, canvas.height);
    draw.font = font;
    draw.fillStyle = colour;
    draw.textBaseline = 'middle';
    draw.fillText(text, 5 * scale, canvas.height / 2);
  }
  const texture = new CanvasTexture(canvas);
  const entry = { texture, aspect: canvas.width / canvas.height };
  labelTextures.set(key, entry);
  return entry;
}

/** A sprite showing a text chip; `place` positions it per pane. */
export function labelSprite(text: string, colour: string, order: number): Sprite {
  const { texture, aspect } = labelTexture(text, colour);
  const sprite = onHelpers(
    new Sprite(new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true })),
    order,
  );
  sprite.center.set(0, 0.5);
  sprite.userData['aspect'] = aspect;
  return sprite;
}

/** Places a label sprite to the right of a world point at a constant pixel height in a pane. */
export function placeLabel(sprite: Sprite, view: PaneProjection, at: Vec3, offsetPx: number): void {
  const perPx = worldPerPx(view, at);
  const right = new Vector3(1, 0, 0).applyQuaternion(view.camera.quaternion);
  sprite.position.set(at[0], at[1], at[2]).addScaledVector(right, offsetPx * perPx);
  const height = LABEL_PX * perPx;
  sprite.scale.set(height * (sprite.userData['aspect'] as number), height, 1);
  sprite.updateMatrixWorld();
}

/** Keeps one sprite per wanted label (reused by text and colour) and places each in the pane. */
export function syncLabels(
  group: Group,
  wanted: readonly { readonly text: string; readonly colour: string; readonly at: Vec3; readonly offset: number }[],
  view: PaneProjection,
  order = 30,
): void {
  const keep = new Set<Object3D>();
  const free = new Map<string, Sprite[]>();
  for (const child of group.children) {
    const key = child.userData['key'] as string;
    const list = free.get(key);
    if (list === undefined) free.set(key, [child as Sprite]);
    else list.push(child as Sprite);
  }
  for (const label of wanted) {
    const key = `${label.colour}|${label.text}`;
    let sprite = free.get(key)?.pop();
    if (sprite === undefined) {
      sprite = labelSprite(label.text, label.colour, order);
      sprite.userData['key'] = key;
      group.add(sprite);
    }
    keep.add(sprite);
    placeLabel(sprite, view, label.at, label.offset);
  }
  for (const child of group.children.slice()) {
    if (keep.has(child)) continue;
    group.remove(child);
    (child as Sprite).material.dispose();
  }
}

interface Instances {
  readonly mesh: InstancedMesh;
  readonly occluded: InstancedMesh;
}

/** Two instanced passes over one geometry (depth-tested, then the occluded parts) sharing their instance buffers. */
function instancedPair(geometry: BufferGeometry, capacity: number, wire: boolean, order: number): Instances {
  const mesh = onHelpers(
    new InstancedMesh(geometry, new MeshBasicMaterial({ color: 0xffffff, wireframe: wire }), capacity),
    order,
  );
  const occluded = onHelpers(
    new InstancedMesh(
      geometry,
      new MeshBasicMaterial({
        color: 0xffffff,
        wireframe: wire,
        transparent: true,
        opacity: OCCLUDED_JOINT_ALPHA,
        depthFunc: GreaterDepth,
        depthWrite: false,
      }),
      capacity,
    ),
    order + 1,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  occluded.instanceMatrix = mesh.instanceMatrix;
  mesh.count = 0;
  occluded.count = 0;
  return { mesh, occluded };
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const up = new Vector3(0, 1, 0);
const direction = new Vector3();
const position = new Vector3();
const scale = new Vector3();

export class JointOverlay implements MeshLayerHost {
  readonly root = new Group();
  private data: JointSceneData = EMPTY_SCENE;
  private hover: JointId | null = null;
  private capacity = 0;
  private readonly sphereGeometry = new SphereGeometry(1, 16, 12);
  private readonly octahedron = boneGeometry();
  private spheres: Instances;
  private hollow: Instances;
  private bones: Instances;
  /** Index of each drawn joint / bone in its instanced mesh. */
  private sphereSlots: DrawnJoint[] = [];
  private hollowSlots: DrawnJoint[] = [];
  private boneSlots: DrawnBone[] = [];
  private readonly crosses = onHelpers(
    new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: VIEWPORT_THEME.rigCenter })),
    12,
  );
  private readonly dashed = onHelpers(
    new LineSegments(
      new BufferGeometry(),
      new LineDashedMaterial({ color: RIG_COLOURS.bone, dashSize: 0.02, gapSize: 0.015 }),
    ),
    12,
  );
  private readonly axes = onHelpers(
    new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false })),
    20,
  );
  private readonly rings = new Group();
  private readonly labels = new Group();
  private readonly ringGeometry: BufferGeometry;
  private disposed = false;

  constructor(
    private readonly vm: Pick<ViewportManager, 'paneView' | 'paneState'>,
    private readonly app: EditorApp,
  ) {
    this.root.name = 'ekza.rig.joints';
    this.root.matrixAutoUpdate = false;
    this.spheres = instancedPair(this.sphereGeometry, 1, false, 10);
    this.hollow = instancedPair(this.sphereGeometry, 1, true, 10);
    this.bones = instancedPair(this.octahedron, 1, false, 8);
    const circle: number[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      circle.push(Math.cos(a), Math.sin(a), 0);
    }
    this.ringGeometry = new BufferGeometry();
    this.ringGeometry.setAttribute('position', new BufferAttribute(new Float32Array(circle), 3));
    this.root.add(this.crosses, this.dashed, this.axes, this.rings, this.labels);
    this.allocate(64);
  }

  get scene(): JointSceneData {
    return this.data;
  }

  /** The drawn joint of an id, or undefined. */
  joint(id: JointId): DrawnJoint | undefined {
    return this.data.joints.find((joint) => joint.id === id);
  }

  setHover(joint: JointId | null): boolean {
    if (this.hover === joint) return false;
    this.hover = joint;
    this.paint();
    return true;
  }

  get hovered(): JointId | null {
    return this.hover;
  }

  /** Replaces what is drawn (the rebuild: instance colours; matrices follow per pane). */
  setData(data: JointSceneData): void {
    this.data = data;
    this.sphereSlots = data.joints.filter((joint) => !joint.helper && !joint.hollow);
    this.hollowSlots = data.joints.filter((joint) => joint.hollow);
    this.boneSlots = data.bones.filter((bone) => !bone.dashed);
    const needed = Math.max(this.sphereSlots.length, this.hollowSlots.length, this.boneSlots.length);
    if (needed > this.capacity) this.allocate(Math.max(needed, this.capacity * 2));
    this.spheres.mesh.count = this.spheres.occluded.count = this.sphereSlots.length;
    this.hollow.mesh.count = this.hollow.occluded.count = this.hollowSlots.length;
    this.bones.mesh.count = this.bones.occluded.count = this.boneSlots.length;
    this.paint();
    this.rebuildLines();
    this.rebuildRings();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per pane

  applyPane(_display: MeshPaneDisplay, paneId: string): void {
    const view = this.vm.paneView(paneId);
    const display = this.vm.paneState(paneId)?.display ?? null;
    const state = this.app.session.getState();
    const show =
      view !== null &&
      display !== null &&
      display.joints &&
      state.workspace === 'rig' &&
      (this.data.joints.length > 0 || this.data.missing.length > 0);
    this.root.visible = show;
    if (!show || view === null || display === null) return;
    const xray = display.xrayJoints;
    this.spheres.occluded.visible = xray;
    this.hollow.occluded.visible = xray;
    this.bones.occluded.visible = xray;
    const radii = new Map<JointId, number>();
    for (const joint of this.data.joints) {
      radii.set(joint.id, Math.max(joint.radius, MIN_JOINT_PX * worldPerPx(view, joint.position)));
    }
    this.placeSpheres(this.spheres, this.sphereSlots, radii);
    this.placeSpheres(this.hollow, this.hollowSlots, radii);
    this.placeBones(radii);
    this.placeCrosses(radii);
    this.placeAxes(display.jointAxes, radii);
    this.placeRings(view, state.rig.mode === 'skeleton');
    this.placeLabels(view, display.jointLabels, radii, state.rig.mode === 'skeleton');
  }

  private placeSpheres(target: Instances, slots: readonly DrawnJoint[], radii: ReadonlyMap<JointId, number>): void {
    slots.forEach((joint, i) => {
      const r = radii.get(joint.id) ?? joint.radius;
      matrix.compose(
        position.set(joint.position[0], joint.position[1], joint.position[2]),
        quaternion.identity(),
        scale.set(r, r, r),
      );
      target.mesh.setMatrixAt(i, matrix);
    });
    target.mesh.instanceMatrix.needsUpdate = true;
  }

  private placeBones(radii: ReadonlyMap<JointId, number>): void {
    this.boneSlots.forEach((bone, i) => {
      direction.set(bone.to[0] - bone.from[0], bone.to[1] - bone.from[1], bone.to[2] - bone.from[2]);
      const length = direction.length();
      if (length < 1e-9) {
        matrix.makeScale(0, 0, 0);
      } else {
        quaternion.setFromUnitVectors(up, direction.normalize());
        const width = Math.min(0.1 * length, radii.get(bone.joint) ?? bone.radius);
        matrix.compose(
          position.set(bone.from[0], bone.from[1], bone.from[2]),
          quaternion,
          scale.set(width, length, width),
        );
      }
      this.bones.mesh.setMatrixAt(i, matrix);
    });
    this.bones.mesh.instanceMatrix.needsUpdate = true;
  }

  private placeCrosses(radii: ReadonlyMap<JointId, number>): void {
    const helpers = this.data.joints.filter((joint) => joint.helper);
    const out = new Float32Array(helpers.length * 18);
    helpers.forEach((joint, i) => {
      const r = (radii.get(joint.id) ?? joint.radius) * 1.4;
      const [x, y, z] = joint.position;
      out.set([x - r, y, z, x + r, y, z, x, y - r, z, x, y + r, z, x, y, z - r, x, y, z + r], i * 18);
    });
    this.crosses.geometry.setAttribute('position', new BufferAttribute(out, 3));
    this.crosses.geometry.computeBoundingSphere();
  }

  private placeAxes(mode: 'none' | 'selected' | 'all', radii: ReadonlyMap<JointId, number>): void {
    const shown = mode === 'none' ? [] : this.data.joints.filter((joint) => mode === 'all' || joint.selected);
    const positions = new Float32Array(shown.length * 18);
    const colours = new Float32Array(shown.length * 18);
    const axisColours = [VIEWPORT_THEME.axisX, VIEWPORT_THEME.axisY, VIEWPORT_THEME.axisZ].map((hex) => new Color(hex));
    shown.forEach((joint, i) => {
      const length = 3 * (radii.get(joint.id) ?? joint.radius);
      quaternion.set(joint.rotation[0], joint.rotation[1], joint.rotation[2], joint.rotation[3]);
      for (let k = 0; k < 3; k++) {
        const axis = new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(quaternion);
        const base = i * 18 + k * 6;
        positions.set(
          [
            joint.position[0],
            joint.position[1],
            joint.position[2],
            joint.position[0] + axis.x * length,
            joint.position[1] + axis.y * length,
            joint.position[2] + axis.z * length,
          ],
          base,
        );
        const c = axisColours[k] as Color;
        colours.set([c.r, c.g, c.b, c.r, c.g, c.b], base);
      }
    });
    this.axes.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.axes.geometry.setAttribute('color', new BufferAttribute(colours, 3));
    this.axes.geometry.computeBoundingSphere();
  }

  private placeRings(view: PaneProjection, skeletonMode: boolean): void {
    this.rings.visible = skeletonMode;
    if (!skeletonMode) return;
    this.data.missing.forEach((missing, i) => {
      const ring = this.rings.children[i];
      if (ring === undefined) return;
      const r = Math.max(missing.radius, 6 * worldPerPx(view, missing.position));
      ring.position.set(missing.position[0], missing.position[1], missing.position[2]);
      ring.quaternion.copy(view.camera.quaternion);
      ring.scale.set(r, r, r);
      ring.updateMatrixWorld();
      (ring as LineLoop).computeLineDistances();
    });
  }

  private placeLabels(
    view: PaneProjection,
    mode: 'none' | 'hover' | 'all',
    radii: ReadonlyMap<JointId, number>,
    skeletonMode: boolean,
  ): void {
    const wanted: { text: string; colour: string; at: Vec3; offset: number }[] = [];
    const shown =
      mode === 'all'
        ? this.data.joints
        : mode === 'hover' && this.hover !== null
          ? this.data.joints.filter((joint) => joint.id === this.hover)
          : [];
    for (const joint of shown) {
      const r = radii.get(joint.id) ?? joint.radius;
      wanted.push({
        text: joint.humanBone ?? joint.name,
        colour: '#e6e7ea',
        at: joint.position,
        offset: r / Math.max(worldPerPx(view, joint.position), 1e-9) + 4,
      });
    }
    if (skeletonMode) {
      for (const missing of this.data.missing) {
        wanted.push({
          text: `${missing.bone} missing`,
          colour: RIG_COLOURS.missing,
          at: missing.position,
          offset: 10,
        });
      }
    }
    syncLabels(this.labels, wanted, view);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // rebuild

  private allocate(capacity: number): void {
    for (const pair of [this.spheres, this.hollow, this.bones]) {
      this.root.remove(pair.mesh, pair.occluded);
      pair.mesh.dispose();
      pair.occluded.dispose();
    }
    this.capacity = capacity;
    this.spheres = instancedPair(this.sphereGeometry, capacity, false, 10);
    this.hollow = instancedPair(this.sphereGeometry, capacity, true, 10);
    this.bones = instancedPair(this.octahedron, capacity, false, 8);
    this.root.add(
      this.bones.mesh,
      this.bones.occluded,
      this.spheres.mesh,
      this.spheres.occluded,
      this.hollow.mesh,
      this.hollow.occluded,
    );
  }

  /** Instance colours (selection, lead, hover). */
  private paint(): void {
    const bone = new Color(RIG_COLOURS.bone);
    const colour = (pair: Instances, slots: readonly DrawnJoint[]): void => {
      slots.forEach((joint, i) => pair.mesh.setColorAt(i, jointColour(joint, joint.id === this.hover)));
      if (pair.mesh.instanceColor !== null) {
        pair.mesh.instanceColor.needsUpdate = true;
        pair.occluded.instanceColor = pair.mesh.instanceColor;
      }
    };
    colour(this.spheres, this.sphereSlots);
    colour(this.hollow, this.hollowSlots);
    this.boneSlots.forEach((slot, i) => {
      const joint = this.joint(slot.joint);
      this.bones.mesh.setColorAt(i, joint?.selected === true ? jointColour(joint, false) : bone);
    });
    if (this.bones.mesh.instanceColor !== null) {
      this.bones.mesh.instanceColor.needsUpdate = true;
      this.bones.occluded.instanceColor = this.bones.mesh.instanceColor;
    }
  }

  private rebuildLines(): void {
    const dashed = this.data.bones.filter((bone) => bone.dashed);
    const out = new Float32Array(dashed.length * 6);
    dashed.forEach((bone, i) => out.set([...bone.from, ...bone.to], i * 6));
    this.dashed.geometry.setAttribute('position', new BufferAttribute(out, 3));
    this.dashed.geometry.computeBoundingSphere();
    this.dashed.computeLineDistances();
  }

  private rebuildRings(): void {
    while (this.rings.children.length > this.data.missing.length) {
      const last = this.rings.children.at(-1) as LineLoop;
      this.rings.remove(last);
      (last.material as LineDashedMaterial).dispose();
    }
    while (this.rings.children.length < this.data.missing.length) {
      const ring = onHelpers(
        new LineLoop(
          this.ringGeometry,
          new LineDashedMaterial({ color: RIG_COLOURS.missing, dashSize: 0.25, gapSize: 0.18, depthTest: false }),
        ),
        25,
      );
      ring.matrixAutoUpdate = true;
      this.rings.add(ring);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // projection and picking (pane CSS px)

  private view(paneId: string): PaneProjection | null {
    return this.vm.paneView(paneId);
  }

  /** Whether the joints draw in a pane now. */
  drawsIn(paneId: string): boolean {
    const display = this.vm.paneState(paneId)?.display ?? null;
    return display !== null && display.joints && this.app.session.getState().workspace === 'rig';
  }

  /** The sphere centre of a joint in a pane; null when not drawn there or off the pane. */
  screenOf(joint: JointId, paneId: string): PanePoint | null {
    const view = this.view(paneId);
    const drawn = this.joint(joint);
    if (view === null || drawn === undefined || !this.drawsIn(paneId)) return null;
    const point = projectPoint(view, drawn.position);
    return onPane(view, point) ? point : null;
  }

  /** A point at `t` along the bone joint → child (child = the joint id, or `tail`) in a pane, or null. */
  screenOfBone(joint: JointId, child: string, paneId: string, t: number): PanePoint | null {
    const view = this.view(paneId);
    if (view === null || !this.drawsIn(paneId)) return null;
    const bone = this.data.bones.find(
      (candidate) => candidate.joint === joint && (candidate.child ?? 'tail') === child,
    );
    if (bone === undefined) return null;
    const p: Vec3 = [0, 1, 2].map(
      (k) => (bone.from[k] as number) + ((bone.to[k] as number) - (bone.from[k] as number)) * t,
    ) as unknown as Vec3;
    const point = projectPoint(view, p);
    return onPane(view, point) ? point : null;
  }

  /** §8.3 picking: the nearest sphere within its radius (≥ 6 px), else the nearest bone, else a missing ring. */
  pick(paneId: string, x: number, y: number, opts?: { readonly lockedToo?: boolean }): JointPick | null {
    const view = this.view(paneId);
    if (view === null || !this.drawsIn(paneId)) return null;
    let best: { joint: DrawnJoint; distance: number; depth: number } | null = null;
    for (const joint of this.data.joints) {
      if (joint.locked && opts?.lockedToo !== true) continue;
      const p = projectPoint(view, joint.position);
      if (p === null) continue;
      const radiusPx = Math.max(joint.radius / worldPerPx(view, joint.position), MIN_JOINT_PX, PICK.jointPx);
      const distance = Math.hypot(p.x - x, p.y - y);
      if (distance > radiusPx) continue;
      if (
        best === null ||
        distance < best.distance - 1e-6 ||
        (Math.abs(distance - best.distance) <= 1e-6 && p.depth < best.depth)
      ) {
        best = { joint, distance, depth: p.depth };
      }
    }
    if (best !== null) return { kind: 'joint', joint: best.joint.id, distancePx: best.distance };
    let bone: { bone: DrawnBone; distance: number } | null = null;
    for (const candidate of this.data.bones) {
      const owner = this.joint(candidate.joint);
      if (owner === undefined || (owner.locked && opts?.lockedToo !== true)) continue;
      const a = projectPoint(view, candidate.from);
      const b = projectPoint(view, candidate.to);
      if (a === null || b === null) continue;
      const { distance } = segmentDistance({ x, y }, a, b);
      const halfWidth = Math.max(
        Math.min(0.1 * Math.hypot(b.x - a.x, b.y - a.y), candidate.radius / worldPerPx(view, candidate.from)),
        4,
      );
      if (distance <= halfWidth && (bone === null || distance < bone.distance)) bone = { bone: candidate, distance };
    }
    if (bone !== null) return { kind: 'bone', joint: bone.bone.joint, distancePx: bone.distance };
    if (this.app.session.getState().rig.mode === 'skeleton') {
      for (const missing of this.data.missing) {
        const p = projectPoint(view, missing.position);
        if (p === null) continue;
        const r = Math.max(missing.radius / worldPerPx(view, missing.position), 6);
        const distance = Math.hypot(p.x - x, p.y - y);
        if (distance <= r + 3) return { kind: 'missing', missing, distancePx: distance };
      }
    }
    return null;
  }

  /** The pickable joints whose sphere centres lie inside a pane rectangle (CSS px). */
  marquee(paneId: string, rect: { x0: number; y0: number; x1: number; y1: number }): JointId[] {
    const view = this.view(paneId);
    if (view === null || !this.drawsIn(paneId)) return [];
    const [x0, x1] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
    const [y0, y1] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
    const out: JointId[] = [];
    for (const joint of this.data.joints) {
      if (joint.locked) continue;
      const p = projectPoint(view, joint.position);
      if (p !== null && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(joint.id);
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pair of [this.spheres, this.hollow, this.bones]) {
      pair.mesh.dispose();
      pair.occluded.dispose();
      (pair.mesh.material as MeshBasicMaterial).dispose();
      (pair.occluded.material as MeshBasicMaterial).dispose();
    }
    this.sphereGeometry.dispose();
    this.octahedron.dispose();
    this.ringGeometry.dispose();
    for (const line of [this.crosses, this.dashed, this.axes]) {
      line.geometry.dispose();
      line.material.dispose();
    }
    for (const child of [...this.rings.children, ...this.labels.children]) {
      ((child as LineLoop | Sprite).material as LineBasicMaterial).dispose();
    }
  }
}
