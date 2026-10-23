// view_capture cameras (MCP-SPEC §5.15.1, MVP cut §0.4.1 item 5): preset cameras on both sides of the character,
// computed from the rest joint positions in character space (+Y up, +Z forward, +X the character's left), so a
// front view always shows the character's left on the image's right. Plain arrays only (no viewport import).
import type { Vec3 } from '@ekza-studio/anim-core';
import type { CaptureCamera, CaptureView } from '@ekza-studio/editor-core';
import type { SkeletonDesc } from '@ekza-studio/rig';

export type CaptureCrop = 'body' | 'upper_body' | 'legs' | 'hands' | 'head';

/** Bounds padding (§5.15.1). */
export const CAMERA_PADDING = 1.1;
/** Vertical field of view of the three-quarter cameras, degrees. */
export const THREE_QUARTER_FOV_DEG = 30;
const THREE_QUARTER_AZIMUTH_DEG = 45;
const THREE_QUARTER_ELEVATION_DEG = 10;

const UPPER =
  /^(hips|spine|chest|upperChest|neck|head|leftEye|rightEye|jaw)$|Shoulder$|Arm$|Hand$|Thumb|Index|Middle|Ring|Little/;
const LEGS = /^hips$|Leg$|Foot$|Toes$/;
const HANDS = /Hand$|Thumb|Index|Middle|Ring|Little/;
const HEAD = /^(neck|head|leftEye|rightEye|jaw)$/;
const CROPS: Readonly<Record<Exclude<CaptureCrop, 'body'>, RegExp>> = {
  upper_body: UPPER,
  legs: LEGS,
  hands: HANDS,
  head: HEAD,
};

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Bounds of the joints a crop shows, from rest bone worlds (column-major mat4 per node, canonical character space).
 * `body` also reaches the floor and the skeleton's height (joints stop below the top of the head); a crop without
 * humanoid bones falls back to the whole body.
 */
export function cropBounds(skeleton: SkeletonDesc, boneWorld: Float64Array, crop: CaptureCrop): Bounds {
  let nodes: number[] = skeleton.nodes.map((_node, i) => i);
  const humanoid = skeleton.humanoid;
  if (crop !== 'body' && humanoid !== null) {
    const pattern = CROPS[crop];
    const picked = Object.entries(humanoid)
      .filter(([name]) => pattern.test(name))
      .flatMap(([, node]) => (node === undefined ? [] : [node]));
    if (picked.length > 0) nodes = picked;
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    for (let axis = 0; axis < 3; axis++) {
      const value = boneWorld[node * 16 + 12 + axis] as number;
      if (!Number.isFinite(value)) continue;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [-0.5, 0, -0.5], max: [0.5, 1.8, 0.5] };
  const height = Number.isFinite(skeleton.height) && skeleton.height > 0 ? skeleton.height : max[1] - min[1];
  // Joints are centres: grow by a margin so hands, the head top and the feet fit (a tenth of the height, ≥ 5 cm).
  const margin = Math.max(0.05, height * (crop === 'hands' || crop === 'head' ? 0.06 : 0.1));
  for (let axis = 0; axis < 3; axis++) {
    min[axis] = (min[axis] as number) - margin;
    max[axis] = (max[axis] as number) + margin;
  }
  if (crop === 'body') {
    min[1] = Math.min(min[1], 0);
    max[1] = Math.max(max[1], height);
  }
  return { min, max };
}

const center = (b: Bounds): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const add = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/**
 * The camera of a preset view framing `bounds` in a tile of aspect `aspect` (width / height), character space. `user`,
 * `shot` and `follow` are not presets (null).
 */
export function presetCamera(view: CaptureView, bounds: Bounds, aspect: number): CaptureCamera | null {
  const c = center(bounds);
  const size: Vec3 = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  const reach = Math.hypot(size[0], size[1], size[2]);
  const distance = reach * 2 + 1;
  const ortho = (dir: Vec3, up: Vec3, across: number, tall: number): CaptureCamera => ({
    projection: 'orthographic',
    position: add(c, dir, distance),
    target: c,
    up,
    fovYDeg: 0,
    orthoHeightM: Math.max(tall, across / aspect) * CAMERA_PADDING,
  });
  switch (view) {
    case 'front':
      return ortho([0, 0, 1], [0, 1, 0], size[0], size[1]);
    case 'back':
      return ortho([0, 0, -1], [0, 1, 0], size[0], size[1]);
    case 'left':
      return ortho([1, 0, 0], [0, 1, 0], size[2], size[1]);
    case 'right':
      return ortho([-1, 0, 0], [0, 1, 0], size[2], size[1]);
    case 'top':
      return ortho([0, 1, 0], [0, 0, 1], size[0], size[2]);
    case 'three_quarter_left':
    case 'three_quarter_right': {
      const side = view === 'three_quarter_left' ? 1 : -1;
      const az = (THREE_QUARTER_AZIMUTH_DEG * Math.PI) / 180;
      const el = (THREE_QUARTER_ELEVATION_DEG * Math.PI) / 180;
      const dir: Vec3 = [side * Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      const halfV = (THREE_QUARTER_FOV_DEG * Math.PI) / 360;
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      const radius = (reach / 2) * CAMERA_PADDING;
      const dist = radius / Math.sin(Math.min(halfV, halfH));
      return {
        projection: 'perspective',
        position: add(c, dir, dist),
        target: c,
        up: [0, 1, 0],
        fovYDeg: THREE_QUARTER_FOV_DEG,
        orthoHeightM: 0,
      };
    }
    case 'user':
    case 'shot':
    case 'follow':
      return null;
  }
}
