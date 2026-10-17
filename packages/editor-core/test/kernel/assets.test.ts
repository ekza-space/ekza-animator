import type { AssetId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { createMemoryAssetStore } from '../../src';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('createMemoryAssetStore', () => {
  it('stores bytes by SHA-256 and returns the asset record', async () => {
    const assets = createMemoryAssetStore();
    const bytes = new TextEncoder().encode('abc');
    const record = await assets.put(bytes, { name: 'a.vrm', ext: 'vrm', role: 'model' });
    expect(record).toEqual({
      id: ABC_SHA,
      name: 'a.vrm',
      ext: 'vrm',
      mime: 'model/gltf-binary',
      size: 3,
      role: 'model',
    });
    expect(await assets.has(record.id)).toBe(true);
    expect(Array.from(await assets.get(record.id))).toEqual([97, 98, 99]);
    expect(Array.from(assets.peek(record.id) ?? [])).toEqual([97, 98, 99]);
    expect(assets.peek(EMPTY_SHA as AssetId)).toBeUndefined();
  });

  it('copies the input and keeps one blob per content', async () => {
    const assets = createMemoryAssetStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const first = await assets.put(bytes, { name: 'one.glb', ext: 'glb', role: 'model' });
    bytes[0] = 9; // the caller reuses its buffer
    expect(Array.from(await assets.get(first.id))).toEqual([1, 2, 3]);
    const again = await assets.put(new Uint8Array([1, 2, 3]), {
      name: 'two.vrma',
      ext: 'vrma',
      role: 'animation-source',
    });
    expect(again).toMatchObject({ id: first.id, name: 'two.vrma', ext: 'vrma', role: 'animation-source' });
    await assets.put(new Uint8Array(0), { name: 'e.glb', ext: 'glb', role: 'model' });
    expect(assets.ids()).toEqual([first.id, EMPTY_SHA].sort());
  });

  it('rejects missing assets and detects in-place corruption', async () => {
    const assets = createMemoryAssetStore();
    await expect(assets.get('0'.repeat(64) as AssetId)).rejects.toMatchObject({ code: 'asset-missing' });
    expect(await assets.has('0'.repeat(64) as AssetId)).toBe(false);
    const record = await assets.put(new Uint8Array([5, 6, 7]), { name: 'x.glb', ext: 'glb', role: 'model' });
    const resident = assets.peek(record.id);
    if (resident === undefined) throw new Error('not resident');
    resident[1] = 0; // a consumer mutated the shared bytes
    await expect(assets.get(record.id)).rejects.toMatchObject({ code: 'asset-corrupt' });
  });
});
