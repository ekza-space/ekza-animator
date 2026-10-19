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
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetRecord, ImagePlaneId, ImagePlaneRecord, OrthoCamera } from '@ekza-animator/doc';
import { fractionalIndex } from '@ekza-animator/doc';
import { newRecordId } from '../../app/internals';
import type { EditorApp, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK } from './define';

export const ORTHO_CAMERAS: readonly OrthoCamera[] = ['front', 'side', 'top'];
/** `PROJECT_LIMITS.maxImageBytes` (§5.20): 32 MiB per image. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const LOCKED_REASON = 'The image plane is locked';
const PLANE_FIELDS = new Set(['name', 'camera', 'offset', 'size', 'opacity', 'depth', 'locked', 'visible']);

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

const isCamera = (value: unknown): value is OrthoCamera => ORTHO_CAMERAS.includes(value as OrthoCamera);

const LABEL: Readonly<Record<OrthoCamera, string>> = { front: 'Front', side: 'Side', top: 'Top' };

/** A new plane's offset: standing on the ground (its bottom at y = 0) in front and side views, centred in top. */
export function defaultOffset(camera: OrthoCamera, size: number): readonly [number, number] {
  return camera === 'top' ? [0, 0] : [0, size / 2];
}

function bytesProblem(bytes: Uint8Array | null): string | null {
  if (bytes === null) return 'bytes must be the image file (a Uint8Array)';
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 'The image is larger than 32 MB';
  return imageExt(bytes) === null ? 'Reference images must be PNG or JPEG files' : null;
}

interface Imported {
  readonly asset: AssetRecord | null;
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
    if (raw['bytes'] === undefined) {
      pendingCamera.set(ctx.app, args.camera);
      await forward(ctx, 'ui.open', { dialog: 'imagePlaneImport' });
      return { asset: null };
    }
    const bytes = imageBytesOf(raw['bytes']) as Uint8Array;
    const ext = imageExt(bytes) as 'png' | 'jpg';
    const name =
      typeof raw['name'] === 'string' && raw['name'].trim() !== '' ? raw['name'].trim() : `${args.camera}.${ext}`;
    const asset = await ctx.app.services.assets.put(bytes, { name, ext, role: 'reference-image' });
    return { asset };
  },
  apply({ app, tx }, args, prepared) {
    if (prepared.asset === null) return { id: null as unknown as ImagePlaneId };
    if (tx === null) throw new EkzaError('internal', 'imagePlane.import runs in a transaction');
    const { asset } = prepared;
    if (tx.get('assets', asset.id) === undefined) tx.put('assets', asset);
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const id = newRecordId(app, 'imagePlane');
    let last: string | null = null;
    for (const plane of tx.list('imagePlanes')) if (last === null || plane.order > last) last = plane.order;
    const size = 2;
    const name =
      typeof raw['name'] === 'string' && raw['name'].trim() !== ''
        ? raw['name'].trim().slice(0, 64)
        : `${LABEL[args.camera]} reference`;
    tx.put('imagePlanes', {
      id,
      name,
      camera: args.camera,
      asset: asset.id,
      offset: defaultOffset(args.camera, size),
      size,
      opacity: 0.5,
      depth: 'behind',
      locked: false,
      visible: true,
      order: fractionalIndex(last, null),
      deleted: null,
    });
    return { id };
  },
});

/** The first problem of a plane patch, or null. */
export function planePatchProblem(plane: ImagePlaneRecord, patch: Readonly<Record<string, unknown>>): string | null {
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'Nothing to change';
  for (const key of keys) if (!PLANE_FIELDS.has(key)) return `An image plane has no field '${key}'`;
  // A locked plane takes only its lock and visibility, unless the same patch unlocks it.
  if (plane.locked && patch['locked'] !== false && keys.some((key) => key !== 'locked' && key !== 'visible')) {
    return LOCKED_REASON;
  }
  const value = (key: string): unknown => patch[key];
  if ('name' in patch && (typeof value('name') !== 'string' || (value('name') as string).trim() === '')) {
    return 'The name must not be empty';
  }
  if ('camera' in patch && !isCamera(value('camera'))) return 'camera must be front, side or top';
  if ('offset' in patch) {
    const offset = value('offset');
    if (
      !Array.isArray(offset) ||
      offset.length !== 2 ||
      !offset.every((c) => typeof c === 'number' && Number.isFinite(c))
    ) {
      return 'offset must be two numbers (metres right and up)';
    }
  }
  if ('size' in patch) {
    const size = value('size');
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return 'size must be above 0 m';
  }
  if ('opacity' in patch) {
    const opacity = value('opacity');
    if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return 'opacity must be a number (0…1)';
  }
  if ('depth' in patch && value('depth') !== 'behind' && value('depth') !== 'front') return 'depth: behind or front';
  for (const key of ['locked', 'visible']) {
    if (key in patch && typeof value(key) !== 'boolean') return `${key} must be true or false`;
  }
  return null;
}

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
    const problem = planePatchProblem(plane, args['patch']);
    return problem === null ? OK : fail(problem);
  },
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
