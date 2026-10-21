// Reference image planes, the binding half (M6A-SPEC §5.26; B13; lazy chunk): live `imagePlanes` records → decoded
// images → `ViewportManager.setImagePlanes` (B9 draws them on layer 9 in the panes that look through their ortho
// view, never picked, never exported). Each image asset is decoded once with `createImageBitmap` and shared by the
// planes that show it; a plane draws nothing while its image decodes, and an image that cannot be read is reported
// once (a toast) and stays undrawn.
import type { Disposer } from '@ekza-studio/anim-core';
import type { AssetId, ImagePlaneRecord } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ImagePlaneSpec } from '../manager/imagePlanes';

/** What the binding needs of the viewport (the ViewportManager; tests pass a recorder). */
export interface ImagePlaneTarget {
  setImagePlanes(planes: readonly ImagePlaneSpec[]): Promise<void>;
}

/** Decodes image bytes (PNG or JPEG) into something WebGL can upload. */
export type ImageDecoder = (bytes: Uint8Array, mime: string) => Promise<TexImageSource & { close?: () => void }>;

/** The browser decoder: `createImageBitmap` over a Blob of the bytes. */
export const decodeWithImageBitmap: ImageDecoder = async (bytes, mime) => {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode images');
  return createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
};

interface Decoded {
  image: (TexImageSource & { close?: () => void }) | null;
  /** The decode failed (reported once; not retried while the asset stays the same). */
  failed: boolean;
}

const byOrder = (a: ImagePlaneRecord, b: ImagePlaneRecord): number =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The viewport spec of a plane record with its (possibly not yet decoded) image. */
export function planeSpec(plane: ImagePlaneRecord, image: TexImageSource | null): ImagePlaneSpec {
  return {
    id: plane.id,
    camera: plane.camera,
    image,
    offset: [plane.offset[0], plane.offset[1]],
    size: plane.size,
    opacity: plane.opacity,
    depth: plane.depth,
    visible: plane.visible,
  };
}

export class ImagePlaneBinding {
  private readonly images = new Map<AssetId, Decoded>();
  private readonly disposers: Disposer[] = [];
  private pushed = false;
  private disposed = false;
  private reportedLoad = false;

  constructor(
    private readonly app: EditorApp,
    private readonly target: ImagePlaneTarget,
    private readonly decode: ImageDecoder = decodeWithImageBitmap,
  ) {
    this.disposers.push(
      app.store.subscribe((batch) => {
        if (batch.changes.some((change) => change.table === 'imagePlanes' || change.table === 'assets')) this.sync();
      }),
    );
    this.sync();
  }

  /** Pushes the live planes (decoded or not) to the viewport and starts decoding the images it lacks. */
  sync(): void {
    if (this.disposed) return;
    const planes = [...this.app.store.list('imagePlanes')].sort(byOrder);
    const used = new Set<AssetId>();
    for (const plane of planes) {
      used.add(plane.asset);
      if (!this.images.has(plane.asset)) this.startDecode(plane.asset);
    }
    for (const [id, decoded] of this.images) {
      if (used.has(id)) continue;
      decoded.image?.close?.();
      this.images.delete(id);
    }
    if (planes.length === 0 && !this.pushed) return;
    this.pushed = planes.length > 0;
    const specs = planes.map((plane) => planeSpec(plane, this.images.get(plane.asset)?.image ?? null));
    this.target.setImagePlanes(specs).catch((error: unknown) => {
      if (this.reportedLoad) return;
      this.reportedLoad = true;
      this.app.services.notify.toast({
        kind: 'error',
        text: `Reference images could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    for (const decoded of this.images.values()) decoded.image?.close?.();
    this.images.clear();
    void this.target.setImagePlanes([]).catch(() => {});
  }

  private startDecode(id: AssetId): void {
    const entry: Decoded = { image: null, failed: false };
    this.images.set(id, entry);
    const record = this.app.store.get('assets', id);
    const mime = record?.mime ?? 'image/png';
    const name = record?.name ?? id.slice(0, 8);
    const bytes = this.app.services.assets.peek(id);
    const read = bytes === undefined ? this.app.services.assets.get(id) : Promise.resolve(bytes);
    read
      .then((data) => this.decode(data, mime))
      .then(
        (image) => {
          if (this.disposed || this.images.get(id) !== entry) {
            image.close?.();
            return;
          }
          entry.image = image;
          this.sync();
        },
        (error: unknown) => {
          if (this.disposed || this.images.get(id) !== entry) return;
          entry.failed = true;
          this.app.services.notify.toast({
            kind: 'error',
            text: `The reference image ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
          });
        },
      );
  }
}
