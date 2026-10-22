// The character thumbnail (M6B-SPEC §5.22 `char.renderThumbnail`; C10): a 1024 × 1024 PNG of the character's meshes
// at the bind pose, front three-quarter view, palette colours with a soft key light on an opaque background.
//
// Rendered in software, not from a GPU pane (deviation M6B-C10-3): the same records give the same pixels on any
// machine, in Node tests and in a worker, without a WebGL context or a port into the viewport. The image is stored as
// an asset and re-exports read the stored bytes, so exports stay byte-identical whichever way it was made.
//
// - Camera: perspective, 30° vertical field of view, looking at the bounds' centre from 30° towards +X (the
//   character's left) and 10° above, at the distance that fits the bounding sphere.
// - Faces: fan-triangulated (low-poly faces are convex or nearly so), depth-tested on 1/z, two-sided, each face flat
//   in its paint swatch's colour (slot 0's colour for a slot without a swatch; light grey without a palette).
// - 2 × 2 supersampling, box-filtered; the PNG writer is io's deterministic encoder.
import type { MeshData } from '@ekza-studio/mesh-core';
import { encodePngRgb } from '../png/encode';
import type { CharacterMeshIn, CharacterWriteInput } from '../types';

export const THUMBNAIL_SIZE = 1024;
const SUPERSAMPLE = 2;
const FOV = (30 * Math.PI) / 180;
const AZIMUTH = (30 * Math.PI) / 180;
const ELEVATION = (10 * Math.PI) / 180;
const BACKGROUND: readonly [number, number, number] = [46, 51, 59];
const NO_PALETTE: readonly [number, number, number] = [200, 200, 204];
const KEY = normalize([0.45, 0.8, 0.55]);
const FILL = normalize([-0.6, 0.2, 0.3]);

type Vec3 = [number, number, number];

function normalize(v: readonly number[]): Vec3 {
  const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number) || 1;
  return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l];
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb8 = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

interface Triangle {
  readonly p: readonly [Vec3, Vec3, Vec3];
  readonly colour: readonly [number, number, number];
}

/** The triangles of one mesh's faces (fan triangulation) with their swatch colours. */
function trianglesOf(data: MeshData, colourOf: (slot: number) => readonly [number, number, number]): Triangle[] {
  const out: Triangle[] = [];
  const paint = data.layers.get('paint');
  const at = (v: number): Vec3 => [
    data.position[3 * v] as number,
    data.position[3 * v + 1] as number,
    data.position[3 * v + 2] as number,
  ];
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    const verts: number[] = [];
    let c = first;
    do {
      verts.push(data.cornerVert[c] as number);
      c = data.cornerNext[c] as number;
    } while (c !== first && verts.length <= data.counts.corners);
    const colour = colourOf(paint === undefined ? 0 : (paint.data[f] as number));
    for (let i = 1; i + 1 < verts.length; i++) {
      out.push({ p: [at(verts[0] as number), at(verts[i] as number), at(verts[i + 1] as number)], colour });
    }
  }
  return out;
}

/** The thumbnail PNG of a character's meshes (character space, bind pose). */
export function renderCharacterThumbnail(
  meshes: readonly CharacterMeshIn[],
  palettes: CharacterWriteInput['palettes'],
  size: number = THUMBNAIL_SIZE,
): Uint8Array {
  const triangles: Triangle[] = [];
  for (const mesh of meshes) {
    const swatches = mesh.paletteId === null ? undefined : palettes.get(mesh.paletteId);
    const bySlot = new Map((swatches ?? []).map((swatch) => [swatch.slot, swatch.srgb] as const));
    const colourOf = (slot: number) => bySlot.get(slot) ?? bySlot.get(0) ?? NO_PALETTE;
    triangles.push(...trianglesOf(mesh.data, colourOf));
  }
  const W = size * SUPERSAMPLE;
  const colour = new Float32Array(W * W * 3);
  for (let i = 0; i < W * W; i++) {
    colour[3 * i] = toLinear(BACKGROUND[0]);
    colour[3 * i + 1] = toLinear(BACKGROUND[1]);
    colour[3 * i + 2] = toLinear(BACKGROUND[2]);
  }
  if (triangles.length > 0) rasterize(triangles, colour, W);
  // Box filter to the output size, then sRGB.
  const rgb = new Uint8Array(size * size * 3);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let dy = 0; dy < SUPERSAMPLE; dy++) {
          for (let dx = 0; dx < SUPERSAMPLE; dx++) {
            sum += colour[3 * ((y * SUPERSAMPLE + dy) * W + x * SUPERSAMPLE + dx) + k] as number;
          }
        }
        rgb[3 * (y * size + x) + k] = toSrgb8(sum / n);
      }
    }
  }
  return encodePngRgb(size, size, rgb);
}

function rasterize(triangles: readonly Triangle[], colour: Float32Array, W: number): void {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) {
    for (const p of t.p) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[k] as number);
        max[k] = Math.max(max[k] as number, p[k] as number);
      }
    }
  }
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const distance = (radius / Math.sin(FOV / 2)) * 1.02;
  const toEye: Vec3 = [
    Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    Math.sin(ELEVATION),
    Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  ];
  const eye: Vec3 = [centre[0] + toEye[0] * distance, centre[1] + toEye[1] * distance, centre[2] + toEye[2] * distance];
  const forward = normalize([-toEye[0], -toEye[1], -toEye[2]]);
  // right = forward × +Y; up = right × forward.
  const right = normalize([-forward[2], 0, forward[0]]);
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const focal = W / 2 / Math.tan(FOV / 2);
  const depth = new Float32Array(W * W);
  const sx = new Float64Array(3);
  const sy = new Float64Array(3);
  const sw = new Float64Array(3);
  for (const t of triangles) {
    let behind = false;
    for (let i = 0; i < 3; i++) {
      const p = t.p[i] as Vec3;
      const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
      const z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
      if (z <= 1e-6) behind = true;
      const w = 1 / z;
      sx[i] = W / 2 + (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) * w * focal;
      sy[i] = W / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * w * focal;
      sw[i] = w;
    }
    if (behind) continue;
    const shade = shadeOf(t, eye);
    const area =
      ((sx[1] as number) - (sx[0] as number)) * ((sy[2] as number) - (sy[0] as number)) -
      ((sx[2] as number) - (sx[0] as number)) * ((sy[1] as number) - (sy[0] as number));
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[0] as number, sx[1] as number, sx[2] as number)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0] as number, sx[1] as number, sx[2] as number)));
    const y0 = Math.max(0, Math.floor(Math.min(sy[0] as number, sy[1] as number, sy[2] as number)));
    const y1 = Math.min(W - 1, Math.ceil(Math.max(sy[0] as number, sy[1] as number, sy[2] as number)));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const e0 = edge(sx[1] as number, sy[1] as number, sx[2] as number, sy[2] as number, px, py) / area;
        const e1 = edge(sx[2] as number, sy[2] as number, sx[0] as number, sy[0] as number, px, py) / area;
        const e2 = 1 - e0 - e1;
        if (e0 < 0 || e1 < 0 || e2 < 0) continue;
        const w = e0 * (sw[0] as number) + e1 * (sw[1] as number) + e2 * (sw[2] as number);
        const i = y * W + x;
        if (w <= (depth[i] as number)) continue;
        depth[i] = w;
        colour[3 * i] = shade[0];
        colour[3 * i + 1] = shade[1];
        colour[3 * i + 2] = shade[2];
      }
    }
  }
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** Linear colour of a flat face: ambient plus a key and a fill light, two-sided. */
function shadeOf(t: Triangle, eye: Vec3): Vec3 {
  const [a, b, c] = t.p;
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
  const toEye: Vec3 = [eye[0] - a[0], eye[1] - a[1], eye[2] - a[2]];
  if (n[0] * toEye[0] + n[1] * toEye[1] + n[2] * toEye[2] < 0) n = [-n[0], -n[1], -n[2]];
  const key = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  const fill = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2]);
  const light = 0.32 + 0.6 * key + 0.18 * fill;
  return [toLinear(t.colour[0]) * light, toLinear(t.colour[1]) * light, toLinear(t.colour[2]) * light];
}
