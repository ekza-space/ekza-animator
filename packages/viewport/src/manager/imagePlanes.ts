// Reference image planes (M6A-SPEC §5.26; B9 draws, B13 owns the records, decoding and UI): textured quads on the
// helpers layer (9), each drawn only in the panes that look through its ortho view preset (front, side, top),
// centred at `offset` in the camera plane (right, up), `size` metres high with the image's aspect and `opacity`.
// `behind` planes draw right after the backdrop without depth (geometry drawn later covers them), `front` planes
// after the geometry and controls without a depth test. They live in their own scene: never picked, never exported.
import type { ViewPreset } from '@ekza-animator/editor-core';
import {
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import { LAYER } from '../layers';

export type ImagePlaneCamera = 'front' | 'side' | 'top';

/** One plane as B13 hands it to the viewport (decoded image, record fields). */
export interface ImagePlaneSpec {
  readonly id: string;
  readonly camera: ImagePlaneCamera;
  /** The decoded image (`createImageBitmap`), or null while it decodes (nothing is drawn). */
  readonly image: TexImageSource | null;
  /** Centre in the camera plane: metres along the view's right and up axes. */
  readonly offset: readonly [number, number];
  /** Height in metres (the width follows the image's aspect). */
  readonly size: number;
  readonly opacity: number;
  readonly depth: 'behind' | 'front';
  readonly visible: boolean;
}

/** The camera plane of each ortho preset (right, up, towards the viewer), matching `createViewCamera`. */
const BASES: Readonly<Record<ImagePlaneCamera, readonly [Vector3, Vector3, Vector3]>> = {
  front: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  side: [new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)],
  top: [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)],
};

interface Entry {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  spec: ImagePlaneSpec;
  texture: Texture | null;
}

function imageAspect(image: TexImageSource): number {
  const sized = image as { width?: unknown; height?: unknown; videoWidth?: unknown; videoHeight?: unknown };
  const w = typeof sized.videoWidth === 'number' && sized.videoWidth > 0 ? sized.videoWidth : sized.width;
  const h = typeof sized.videoHeight === 'number' && sized.videoHeight > 0 ? sized.videoHeight : sized.height;
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? w / h : 1;
}

export class ImagePlaneLayer {
  /** The planes' own scene (drawn per pane by the ViewportManager). */
  readonly scene = new Scene();
  private readonly entries = new Map<string, Entry>();

  constructor() {
    this.scene.name = 'ekza.imagePlanes';
    this.scene.matrixWorldAutoUpdate = false;
  }

  /** Replaces the plane set (diffed by id: new planes are created, changed ones updated, missing ones removed). */
  set(planes: readonly ImagePlaneSpec[]): void {
    const live = new Set<string>();
    for (const spec of planes) {
      live.add(spec.id);
      let entry = this.entries.get(spec.id);
      if (entry === undefined) {
        const material = new MeshBasicMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
          toneMapped: false,
        });
        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.name = `ekza.imagePlane.${spec.id}`;
        mesh.layers.set(LAYER.helpers);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.scene.add(mesh);
        entry = { mesh, spec, texture: null };
        this.entries.set(spec.id, entry);
      }
      this.update(entry, spec);
    }
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      this.remove(entry);
      this.entries.delete(id);
    }
  }

  /** Ids of the planes a pane looking through `preset` draws in a pass (`behind` or `front`). */
  planesFor(preset: ViewPreset | null, depth: 'behind' | 'front'): readonly string[] {
    const out: string[] = [];
    for (const [id, entry] of this.entries) if (this.shows(entry, preset, depth)) out.push(id);
    return out;
  }

  /**
   * Shows exactly the planes of one pass of a pane; returns false when there is nothing to draw (the pass can be
   * skipped). The scene's matrices are current afterwards.
   */
  prepare(preset: ViewPreset | null, depth: 'behind' | 'front'): boolean {
    let any = false;
    for (const entry of this.entries.values()) {
      const show = this.shows(entry, preset, depth);
      entry.mesh.visible = show;
      any ||= show;
    }
    return any;
  }

  get size(): number {
    return this.entries.size;
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.remove(entry);
    this.entries.clear();
  }

  private shows(entry: Entry, preset: ViewPreset | null, depth: 'behind' | 'front'): boolean {
    const spec = entry.spec;
    return (
      spec.visible &&
      spec.image !== null &&
      spec.opacity > 0 &&
      spec.size > 0 &&
      spec.camera === preset &&
      spec.depth === depth
    );
  }

  private update(entry: Entry, spec: ImagePlaneSpec): void {
    const previous = entry.spec;
    entry.spec = spec;
    const material = entry.mesh.material;
    if (spec.image !== previous.image || entry.texture === null) {
      entry.texture?.dispose();
      entry.texture = null;
      if (spec.image !== null) {
        const texture = new Texture(spec.image as never);
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        entry.texture = texture;
      }
      material.map = entry.texture;
      material.needsUpdate = true;
    }
    material.opacity = Math.min(1, Math.max(0, spec.opacity));
    const height = Math.max(spec.size, 0);
    const width = spec.image === null ? height : height * imageAspect(spec.image);
    const [right, up, back] = BASES[spec.camera];
    const position = new Vector3().addScaledVector(right, spec.offset[0]).addScaledVector(up, spec.offset[1]);
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
    entry.mesh.matrix.compose(position, rotation, new Vector3(width, height, 1));
    entry.mesh.matrixWorld.copy(entry.mesh.matrix);
  }

  private remove(entry: Entry): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    entry.texture?.dispose();
  }
}
