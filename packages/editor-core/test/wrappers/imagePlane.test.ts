// `imagePlane.replace` (STUDIO-TOUCH-SPEC §6.2 Image plane row, §6.4 "Replace image…"; T5a): delete then import in one
// undo step; the new plane keeps the old one's view, name, placement, opacity, depth and visibility; a locked plane,
// a missing plane and a file that is not a PNG or JPEG are refused in plain words.
import type { ImagePlaneId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { LOCKED_REASON, loadUiWrappers } from '../../src';
import { JPEG_HEADER, meshTestApp, PNG_1X1, runValue } from '../m6a/content/support';
import { expectOneStep, refusal } from './support';

describe('imagePlane.replace', () => {
  it('swaps the picture and keeps the placement: one step, exact undo', async () => {
    const t = await meshTestApp();
    await loadUiWrappers(t.app);
    const { id } = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', {
      camera: 'side',
      name: 'Side ref',
      bytes: PNG_1X1,
    });
    await runValue(t, 'imagePlane.set', { id, patch: { size: 1.8, opacity: 0.3, offset: [0.2, 0.9], depth: 'front' } });
    const old = t.app.store.get('imagePlanes', id);
    const jpeg = Uint8Array.from([...JPEG_HEADER, 0xff, 0xd9]);
    const { value } = await expectOneStep(
      t.app,
      'imagePlane.replace',
      { id, bytes: jpeg, name: 'new.jpg' },
      'Replace Image',
    );
    const replaced = t.app.store.get('imagePlanes', (value as { id: ImagePlaneId }).id);
    expect(t.app.store.get('imagePlanes', id)).toBeUndefined();
    expect(replaced).toMatchObject({
      name: 'Side ref',
      camera: 'side',
      offset: [0.2, 0.9],
      size: 1.8,
      opacity: 0.3,
      depth: 'front',
      visible: true,
      locked: false,
    });
    expect(replaced?.asset).not.toBe(old?.asset);
    expect(t.app.store.get('assets', replaced?.asset as never)).toMatchObject({ ext: 'jpg', role: 'reference-image' });
  });

  it('refuses a locked or missing plane and a file that is not an image', async () => {
    const t = await meshTestApp();
    await loadUiWrappers(t.app);
    const { id } = await runValue<{ id: ImagePlaneId }>(t, 'imagePlane.import', { camera: 'front', bytes: PNG_1X1 });
    expect(await refusal(t.app, 'imagePlane.replace', { id, bytes: Uint8Array.from([1, 2, 3]) })).toBe(
      'Reference images must be PNG or JPEG files',
    );
    expect(await refusal(t.app, 'imagePlane.replace', { id })).toBe('Pick the new image (a PNG or JPEG file)');
    expect(await refusal(t.app, 'imagePlane.replace', { bytes: PNG_1X1 })).toBe('Pick the image plane to replace');
    expect(await refusal(t.app, 'imagePlane.replace', { id: 'img_Nope', bytes: PNG_1X1 })).toBe(
      'The image plane does not exist',
    );
    await runValue(t, 'imagePlane.set', { id, patch: { locked: true } });
    expect(await refusal(t.app, 'imagePlane.replace', { id, bytes: PNG_1X1 })).toBe(LOCKED_REASON);
  });
});
