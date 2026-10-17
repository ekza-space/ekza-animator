// A growable batch of fat line segments (three's LineSegments2) rewritten in place: control shapes and skeleton
// lines are rebuilt on pose changes without allocating (MVP-SPEC §3 convention 5).
import { GreaterDepth, type InterleavedBufferAttribute, type Object3D } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

/** One render object per material, all sharing the batch geometry (e.g. occluded + visible control passes). */
export class LineBatch {
  readonly geometry = new LineSegmentsGeometry();
  readonly objects: readonly LineSegments2[];
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private capacity = 0;
  private count = 0;

  constructor(materials: readonly { readonly material: LineMaterial; readonly layer: number }[], name: string) {
    this.objects = materials.map(({ material, layer }) => {
      const object = new LineSegments2(this.geometry, material);
      object.name = name;
      object.frustumCulled = false;
      object.matrixAutoUpdate = false;
      object.layers.set(layer);
      object.visible = false;
      return object;
    });
    this.reserve(16);
  }

  /** Segments written since the last `begin()`. */
  get size(): number {
    return this.count;
  }

  /** Starts rewriting the batch; `segments` is an upper bound for this round. */
  begin(segments: number): void {
    if (segments > this.capacity) this.reserve(Math.max(segments, this.capacity * 2));
    this.count = 0;
  }

  /**
   * Appends `n` segments from `source` (xyz pairs) starting at segment `from`, coloured (r, g, b) in linear
   * working colour space.
   */
  push(source: Float32Array, from: number, n: number, r: number, g: number, b: number): void {
    const positions = this.positions;
    const colors = this.colors;
    let o = this.count * 6;
    let s = from * 6;
    for (let i = 0; i < n; i++, o += 6, s += 6) {
      positions[o] = source[s] as number;
      positions[o + 1] = source[s + 1] as number;
      positions[o + 2] = source[s + 2] as number;
      positions[o + 3] = source[s + 3] as number;
      positions[o + 4] = source[s + 4] as number;
      positions[o + 5] = source[s + 5] as number;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
      colors[o + 3] = r;
      colors[o + 4] = g;
      colors[o + 5] = b;
    }
    this.count += n;
  }

  /** Uploads what was written and shows the batch when it holds any segment. */
  end(): void {
    const start = this.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    const colorStart = this.geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute;
    start.data.needsUpdate = true;
    colorStart.data.needsUpdate = true;
    this.geometry.instanceCount = this.count;
    for (const object of this.objects) object.visible = this.count > 0;
  }

  addTo(parent: Object3D): void {
    for (const object of this.objects) parent.add(object);
  }

  dispose(): void {
    for (const object of this.objects) object.removeFromParent();
    this.geometry.dispose();
  }

  private reserve(segments: number): void {
    const positions = new Float32Array(segments * 6);
    const colors = new Float32Array(segments * 6);
    positions.set(this.positions.subarray(0, Math.min(this.positions.length, positions.length)));
    colors.set(this.colors.subarray(0, Math.min(this.colors.length, colors.length)));
    this.positions = positions;
    this.colors = colors;
    this.capacity = segments;
    this.geometry.setPositions(positions);
    this.geometry.setColors(colors);
  }
}

/** Fat-line material with per-vertex colours; width in CSS px (set `resolution` to the pane size before drawing). */
export function lineMaterial(opts: {
  readonly width: number;
  readonly opacity?: number;
  readonly occluded?: boolean;
  readonly depthTest?: boolean;
  readonly vertexColors?: boolean;
  readonly color?: string;
}): LineMaterial {
  const opacity = opts.opacity ?? 1;
  const material = new LineMaterial({
    linewidth: opts.width,
    vertexColors: opts.vertexColors ?? true,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    depthTest: opts.depthTest ?? true,
    toneMapped: false,
  });
  if (opts.color !== undefined) material.color.set(opts.color);
  if (opts.occluded === true) material.depthFunc = GreaterDepth;
  return material;
}
