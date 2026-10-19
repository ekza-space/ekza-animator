// Preview lines and points of the topology tools (M6A-SPEC §5.11, §5.12; B12b): the Multi-Cut path and its rubber
// band, the Insert Edge Loop hover/slide preview, the Target Weld rubber band and target ring. World-space fat lines
// and screen-size points on the helpers layer, drawn above the geometry (depth test off) in every pane.
import { BufferAttribute, BufferGeometry, Group, Points, PointsMaterial, Vector4, type WebGLRenderer } from 'three';
import { LAYER } from '../../../layers';
import { LineBatch, lineMaterial } from '../../../overlays/lineBatch';

/** Linear RGB triples of the preview colours. */
export const PREVIEW = {
  cut: [1, 0.85, 0.3],
  rubber: [1, 0.95, 0.7],
  loop: [1, 0.85, 0.3],
  mirror: [0.55, 0.8, 1],
  weld: [0.5, 1, 0.55],
} as const;

type Rgb = readonly [number, number, number];

export class ToolOverlay {
  readonly root = new Group();
  private readonly material = lineMaterial({ width: 2, depthTest: false });
  private readonly lines = new LineBatch([{ material: this.material, layer: LAYER.helpers }], 'ekza.toolPreview');
  private readonly pointGeometry = new BufferGeometry();
  private readonly pointMaterial = new PointsMaterial({
    size: 7,
    sizeAttenuation: false,
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  private readonly points = new Points(this.pointGeometry, this.pointMaterial);
  private segments: { readonly from: Float32Array; readonly color: Rgb }[] = [];
  private readonly viewport = new Vector4();

  constructor() {
    this.root.name = 'ekza.toolOverlay';
    this.root.matrixAutoUpdate = false;
    this.lines.addTo(this.root);
    for (const object of this.lines.objects) {
      object.renderOrder = 1001;
      object.onBeforeRender = (renderer) => this.resolution(renderer);
    }
    this.points.layers.set(LAYER.helpers);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.renderOrder = 1002;
    this.points.visible = false;
    this.root.add(this.points);
  }

  /** Replaces the preview: segment lists (xyz pairs, world) with their colours, and points (xyz, world). */
  set(
    segments: readonly { readonly positions: ArrayLike<number>; readonly color: Rgb }[],
    points: readonly { readonly at: readonly [number, number, number]; readonly color: Rgb }[] = [],
  ): void {
    this.segments = segments.map((s) => ({ from: Float32Array.from(s.positions), color: s.color }));
    const total = this.segments.reduce((n, s) => n + Math.floor(s.from.length / 6), 0);
    this.lines.begin(total);
    for (const s of this.segments) {
      this.lines.push(s.from, 0, Math.floor(s.from.length / 6), s.color[0], s.color[1], s.color[2]);
    }
    this.lines.end();
    const position = new Float32Array(points.length * 3);
    const color = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      position.set(p.at, 3 * i);
      color.set(p.color, 3 * i);
    });
    this.pointGeometry.setAttribute('position', new BufferAttribute(position, 3));
    this.pointGeometry.setAttribute('color', new BufferAttribute(color, 3));
    this.pointGeometry.computeBoundingSphere();
    this.points.visible = points.length > 0;
  }

  clear(): void {
    this.set([], []);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.lines.dispose();
    this.material.dispose();
    this.pointGeometry.dispose();
    this.pointMaterial.dispose();
  }

  private resolution(renderer: WebGLRenderer): void {
    renderer.getCurrentViewport(this.viewport);
    const ratio = renderer.getPixelRatio() || 1;
    this.material.resolution.set(this.viewport.z / ratio, this.viewport.w / ratio);
  }
}
