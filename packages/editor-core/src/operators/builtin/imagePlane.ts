// Reference image planes (M6A-SPEC §5.26, §6.2; B13): a PNG or JPEG stored as an `AssetRecord` (role
// `reference-image`, content-addressed by SHA-256) and an `ImagePlaneRecord` per plane, drawn only in the panes that
// look through its ortho view (front, side or top), never picked, never exported, saved in `.ekzanim` under `images/`.
//
// - `imagePlane.import {camera, name, bytes}`: with `bytes` (a `Uint8Array`, an `ArrayBuffer` or a number array from a
//   script) it stores the image and creates the plane (default: 2 m high, standing on the ground in front and side
//   views, opacity 0.5, behind the geometry); **without `bytes`** (the Create › Reference Image menu items and the
//   primitives marking menu) it opens the import dialog for that camera and writes nothing.
// - `imagePlane.set {id, patch}`: name, camera, offset, size (> 0), opacity (0…1), depth, locked, visible; a locked
//   plane accepts only `locked` and `visible` ("The image plane is locked") unless the same patch unlocks it.
// - `imagePlane.delete {id}`: soft delete (the image asset stays referenced by the undo history).
// The document writes live in the lazy `contentApply.ts` (M6A-B13-10): `prepare` loads it, `apply` runs its body.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetRecord, ImagePlaneRecord, OrthoCamera } from '@ekza-animator/doc';
import type { EditorApp, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK } from './define';
import { type ContentApplyModule, loadContentApply, loadedContentApply } from './contentLoad';

export const ORTHO_CAMERAS: readonly OrthoCamera[] = ['front', 'side', 'top'];
/** `PROJECT_LIMITS.maxImageBytes` (§5.20): 32 MiB per image. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const LOCKED_REASON = 'The image plane is locked';

/** The dialog's camera (set by a run without bytes, read by the import dialog). */
const pendingCamera = new WeakMap<EditorApp, OrthoCamera>();

/** The camera the image plane import dialog opens for (the last menu run without bytes; default front). */
export function pendingImagePlaneCamera(app: EditorApp): OrthoCamera {
  return pendingCamera.get(app) ?? 'front';
}

/** Image bytes from script args (a typed array, a buffer or a number array), or null. */
export function imageBytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((b) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

/** The image format of `bytes` by its signature: PNG or JPEG, else null. */
export function imageExt(bytes: Uint8Array): 'png' | 'jpg' | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

export const isCamera = (value: unknown): value is OrthoCamera => ORTHO_CAMERAS.includes(value as OrthoCamera);

export const LABEL: Readonly<Record<OrthoCamera, string>> = { front: 'Front', side: 'Side', top: 'Top' };

/** A new plane's offset: standing on the ground (its bottom at y = 0) in front and side views, centred in top. */
export function defaultOffset(camera: OrthoCamera, size: number): readonly [number, number] {
  return camera === 'top' ? [0, 0] : [0, size / 2];
}

function bytesProblem(bytes: Uint8Array | null): string | null {
  if (bytes === null) return 'bytes must be the image file (a Uint8Array)';
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 'The image is larger than 32 MB';
  return imageExt(bytes) === null ? 'Reference images must be PNG or JPEG files' : null;
}

export interface Imported {
  readonly asset: AssetRecord | null;
  readonly impl: ContentApplyModule;
}

const importPlane = defineOperator<'imagePlane.import', Imported>({
  id: 'imagePlane.import',
  label: 'Reference Image',
  description: 'Adds a reference image to the front, side or top view.',
  category: 'imagePlane',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true },
  extraArgs: ['camera', 'name', 'bytes'],
  aliases: ['Image Plane', 'Reference Image', 'Background Image'],
  undoLabel: () => 'Import Image Plane',
  poll(_ctx, args): PollResult {
    if (!isRecord(args)) return fail('expects { camera, name, bytes }');
    if (!isCamera(args['camera'])) return fail('camera must be front, side or top');
    if (args['bytes'] === undefined) return OK; // opens the import dialog
    const problem = bytesProblem(imageBytesOf(args['bytes']));
    return problem === null ? OK : fail(problem);
  },
  async prepare(ctx, args): Promise<Imported> {
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const impl = await loadContentApply();
    if (raw['bytes'] === undefined) {
      pendingCamera.set(ctx.app, args.camera);
      await forward(ctx, 'ui.open', { dialog: 'imagePlaneImport' });
      return { asset: null, impl };
    }
    const bytes = imageBytesOf(raw['bytes']) as Uint8Array;
    const ext = imageExt(bytes) as 'png' | 'jpg';
    const name =
      typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'].trim() : `${args.camera}.${ext}`;
    const asset = await ctx.app.services.assets.put(bytes, { name, ext, role: 'reference-image' });
    return { asset, impl };
  },
  apply: (ctx, args, prepared) => prepared.impl.imagePlaneImport(ctx, args, prepared),
});

const setPlane = defineOperator({
  id: 'imagePlane.set',
  label: 'Image Plane Settings',
  description: "Changes an image plane's offset, size, opacity, depth, lock or visibility.",
  category: 'imagePlane',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true, internal: true },
  extraArgs: ['id', 'patch'],
  poll({ app }, args): PollResult {
    if (!isRecord(args) || typeof args['id'] !== 'string' || !isRecord(args['patch'])) {
      return fail('expects { id, patch }');
    }
    const plane = app.store.get('imagePlanes', args['id']);
    if (plane === undefined) return fail(`Unknown image plane ${args['id']}`);
    // As `mesh.setAttributes`: the field checks load with the bodies (the runner polls again after `prepare`).
    const problem = loadedContentApply()?.planePatchProblem(plane, args['patch']) ?? null;
    return problem === null ? OK : fail(problem);
  },
  prepare: loadContentApply,
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'imagePlane.set runs in a transaction');
    const patch: Record<string, unknown> = { ...args.patch };
    if (typeof patch['name'] === 'string') patch['name'] = patch['name'].trim().slice(0, 64);
    if (typeof patch['opacity'] === 'number') patch['opacity'] = Math.min(1, Math.max(0, patch['opacity']));
    tx.patch('imagePlanes', args.id, patch as Partial<ImagePlaneRecord>);
  },
});

const deletePlane = defineOperator({
  id: 'imagePlane.delete',
  label: 'Delete Image Plane',
  description: 'Removes a reference image plane.',
  category: 'imagePlane',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true },
  extraArgs: ['id'],
  poll({ app }, args): PollResult {
    if (!isRecord(args) || typeof args['id'] !== 'string') return fail('expects { id }');
    return app.store.get('imagePlanes', args['id']) === undefined ? fail(`Unknown image plane ${args['id']}`) : OK;
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'imagePlane.delete runs in a transaction');
    tx.softDelete('imagePlanes', args.id);
  },
});

export const IMAGE_PLANE_OPERATORS: readonly AnyOperator[] = [importPlane, setPlane, deletePlane];
