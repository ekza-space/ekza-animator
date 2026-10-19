// Reference image planes (M6A-SPEC §5.26, §6.2; B13): import stores a content-addressed `reference-image` asset and a
// plane record (one step); without bytes the menu path opens the import dialog for its camera and writes nothing;
// `imagePlane.set` validates and clamps, a locked plane takes only lock and visibility; delete is a soft delete; a
// project with a plane needs the v3 writer.
import type { ImagePlaneId } from '@ekza-animator/doc';
import { requiredWriterVersion } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { imageBytesOf, imageExt, LOCKED_REASON, pendingImagePlaneCamera } from '../../../src';
import { JPEG_HEADER, meshTestApp, PNG_1X1, pollReason, runValue } from './support';

describe('imagePlane.import', () => {
  it('stores the PNG as a reference-image asset and creates the plane standing on the ground (one step)', async () => {
    const t = await meshTestApp();
    const { id } = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', {
      camera: 'side',
      name: 'Side ref',
      bytes: PNG_1X1,
    });
    const plane = t.app.store.get('imagePlanes', id);
    expect(plane).toMatchObject({
      name: 'Side ref',
      camera: 'side',
      offset: [0, 1],
      size: 2,
      opacity: 0.5,
      depth: 'behind',
      locked: false,
      visible: true,
    });
    const asset = t.app.store.get('assets', plane?.asset as never);
    expect(asset).toMatchObject({ ext: 'png', mime: 'image/png', role: 'reference-image', size: PNG_1X1.length });
    expect(await t.app.services.assets.get(asset?.id as never)).toEqual(PNG_1X1);
    expect(t.app.history.peekUndo()?.label).toBe('Import Image Plane');
    expect(requiredWriterVersion(t.app.store.snapshot().tables)).toBe(3);
    t.app.history.undo();
    expect(t.app.store.get('imagePlanes', id)).toBeUndefined();
    expect(t.app.store.list('assets')).toHaveLength(0);
  });

  it('the same image twice is one asset; a top plane is centred; scripts may pass number arrays and JPEGs', async () => {
    const t = await meshTestApp();
    const a = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'front', bytes: PNG_1X1 });
    const b = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'top', bytes: [...PNG_1X1] });
    expect(t.app.store.list('assets')).toHaveLength(1);
    expect(t.app.store.get('imagePlanes', a.id)?.name).toBe('Front reference');
    expect(t.app.store.get('imagePlanes', b.id)).toMatchObject({ camera: 'top', offset: [0, 0] });
    const c = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'front', bytes: JPEG_HEADER });
    expect(t.app.store.get('assets', t.app.store.get('imagePlanes', c.id)?.asset as never)?.mime).toBe('image/jpeg');
    const orders = [a.id, b.id, c.id].map((id) => t.app.store.get('imagePlanes', id)?.order ?? '');
    expect(orders).toEqual([...orders].sort());
  });

  it('refuses other files and bad cameras', async () => {
    const t = await meshTestApp();
    expect(pollReason(t, 'imagePlane.import', { camera: 'front', bytes: Uint8Array.from([1, 2, 3]) })).toBe(
      'Reference images must be PNG or JPEG files',
    );
    expect(pollReason(t, 'imagePlane.import', { camera: 'back', bytes: PNG_1X1 })).toBe(
      'camera must be front, side or top',
    );
    expect(pollReason(t, 'imagePlane.import', { camera: 'front', bytes: 'nope' })).toMatch(/Uint8Array/);
    expect(imageExt(PNG_1X1)).toBe('png');
    expect(imageExt(JPEG_HEADER)).toBe('jpg');
    expect(imageBytesOf(PNG_1X1.buffer)).toEqual(PNG_1X1);
  });

  it('without bytes (menus) it opens the import dialog for its camera and writes nothing', async () => {
    const t = await meshTestApp();
    const opened: unknown[] = [];
    t.app.operators.register({
      id: 'ui.open',
      label: 'Open Dialog',
      category: 'ui',
      scope: 'global',
      apply: (_ctx, args) => {
        opened.push(args);
      },
    });
    const top = t.app.history.peekUndo();
    expect(pollReason(t, 'imagePlane.import', { camera: 'side' })).toBeNull();
    const result = await t.app.runUntyped('imagePlane.import', { camera: 'side' });
    expect(result.status).toBe('finished');
    expect(opened).toEqual([{ dialog: 'imagePlaneImport' }]);
    expect(pendingImagePlaneCamera(t.app)).toBe('side');
    expect(t.app.store.list('imagePlanes')).toHaveLength(0);
    expect(t.app.history.peekUndo()).toBe(top);
  });
});

describe('imagePlane.set / imagePlane.delete', () => {
  it('patches fields, clamps opacity, and a locked plane takes only lock and visibility', async () => {
    const t = await meshTestApp();
    const { id } = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'front', bytes: PNG_1X1 });
    await runValue(t, 'imagePlane.set', { id, patch: { offset: [0.1, 0.9], size: 1.8, opacity: 1.4, depth: 'front' } });
    expect(t.app.store.get('imagePlanes', id)).toMatchObject({
      offset: [0.1, 0.9],
      size: 1.8,
      opacity: 1,
      depth: 'front',
    });
    expect(pollReason(t, 'imagePlane.set', { id, patch: { size: 0 } })).toBe('size must be above 0 m');
    expect(pollReason(t, 'imagePlane.set', { id, patch: { offset: [1] } })).toMatch(/two numbers/);
    expect(pollReason(t, 'imagePlane.set', { id, patch: { depth: 'middle' } })).toMatch(/behind or front/);
    expect(pollReason(t, 'imagePlane.set', { id, patch: { asset: 'x' } })).toMatch(/no field 'asset'/);
    await runValue(t, 'imagePlane.set', { id, patch: { locked: true } });
    expect(pollReason(t, 'imagePlane.set', { id, patch: { opacity: 0.2 } })).toBe(LOCKED_REASON);
    await runValue(t, 'imagePlane.set', { id, patch: { visible: false } });
    expect(t.app.store.get('imagePlanes', id)?.visible).toBe(false);
    await runValue(t, 'imagePlane.set', { id, patch: { locked: false, opacity: 0.4 } });
    expect(t.app.store.get('imagePlanes', id)).toMatchObject({ locked: false, opacity: 0.4 });
    t.app.history.undo();
    expect(t.app.store.get('imagePlanes', id)).toMatchObject({ locked: true, opacity: 1 });
  });

  it('deletes softly (undo restores the plane)', async () => {
    const t = await meshTestApp();
    const { id } = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'front', bytes: PNG_1X1 });
    await runValue(t, 'imagePlane.delete', { id });
    expect(t.app.store.get('imagePlanes', id)).toBeUndefined();
    expect(t.app.store.getIncludingDeleted('imagePlanes', id)?.deleted).not.toBeNull();
    t.app.history.undo();
    expect(t.app.store.get('imagePlanes', id)?.camera).toBe('front');
    expect(pollReason(t, 'imagePlane.delete', { id: 'img_nope' })).toBe('Unknown image plane img_nope');
  });
});
