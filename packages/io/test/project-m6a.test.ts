// M6A-SPEC §5.20 (B7): `.ekzanim` under schemaVersion 3 — mesh manifests and chunks as `blobs/<sha256>` (deflated,
// verified on open, a corrupt one left out), reference images as `images/<sha256>.<ext>` under the manifest key
// `images` (never `assets`), the new per-entry limits, deterministic archives that round-trip byte-identically, and
// an M2a reader (the shipped one, as a double) opening such a project read-only without inflating the new entries.
import { sha256Hex } from '@ekza-studio/anim-core';
import {
  type AssetId,
  type AssetRecord,
  createMemoryStore,
  type DocSnapshot,
  type MeshId,
  SCHEMA_VERSION,
} from '@ekza-studio/doc';
import {
  makeTestImageAsset,
  makeTestImagePlane,
  makeTestMesh,
  readSyntheticFixture,
  withSchemaV3,
} from '@ekza-studio/doc/testing';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PROJECT_LIMITS, readProjectArchive, writeProjectArchive } from '../src/project/archive';
import { readProjectArchiveM2a } from './helpers/m2a-project-reader';

const encoder = new TextEncoder();

/** Two "chunks" and a "manifest" listing them (the archive never parses them; ids are their SHA-256). */
function meshBlobs(): { readonly manifest: string; readonly blobs: Map<string, Uint8Array> } {
  const chunkA = encoder.encode('chunk-a'.repeat(100));
  const chunkB = encoder.encode('chunk-b'.repeat(50));
  const ids = [sha256Hex(chunkA), sha256Hex(chunkB)];
  const manifestBytes = encoder.encode(JSON.stringify({ format: 'ekza-mesh', version: 1, layers: [{ chunks: ids }] }));
  const manifest = sha256Hex(manifestBytes);
  return {
    manifest,
    blobs: new Map([
      [ids[0] as string, chunkA],
      [ids[1] as string, chunkB],
      [manifest, manifestBytes],
    ]),
  };
}

/** A PNG-ish image asset (the archive treats the bytes as opaque). */
function image(): { readonly record: AssetRecord; readonly bytes: Uint8Array } {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
  const id = sha256Hex(bytes) as AssetId;
  return { bytes, record: { ...makeTestImageAsset('front.png'), id, size: bytes.byteLength } };
}

/** A schema-3 document with a mesh (data ref) and an image plane over the image asset. */
function modelingSnapshot(manifest: string, imageRecord: AssetRecord): DocSnapshot {
  const store = createMemoryStore();
  store.load(withSchemaV3(readSyntheticFixture('wave-doc.json') as DocSnapshot));
  store.transact({ label: 'Model' }, (tx) => {
    tx.put('assets', imageRecord);
    tx.put('meshes', makeTestMesh('msh_Cube', { name: 'Cube', data: { manifest, rev: 1, base: null, joints: [] } }));
    tx.put('imagePlanes', makeTestImagePlane('img_Front', imageRecord.id, { camera: 'front' }));
  });
  return store.snapshot();
}

function entryNames(zip: Uint8Array): { name: string; method: number }[] {
  const out: { name: string; method: number }[] = [];
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let offset = 0; offset + 30 <= zip.length && view.getUint32(offset, true) === 0x04034b50; ) {
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    out.push({ name: new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength)), method });
    offset += 30 + nameLength + extraLength + compressed;
  }
  return out;
}

describe('.ekzanim with mesh blobs and reference images (§5.20)', () => {
  const { manifest, blobs } = meshBlobs();
  const img = image();
  const snapshot = modelingSnapshot(manifest, img.record);
  const assets = new Map([[img.record.id, img]]);

  it('stores blobs/ (deflated) and images/ (stored) after the models, listed under the manifest key images', () => {
    const zip = writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs);
    const names = entryNames(zip);
    const sortedBlobs = [...blobs.keys()].sort();
    expect(names).toEqual([
      { name: 'manifest.json', method: 8 },
      { name: 'project.json', method: 8 },
      ...sortedBlobs.map((id) => ({ name: `blobs/${id}`, method: 8 })),
      { name: `images/${img.record.id}.png`, method: 0 },
    ]);
    const json = JSON.parse(new TextDecoder().decode(unzipSync(zip)['manifest.json'])) as Record<string, unknown>;
    expect(json).toMatchObject({ schemaVersion: SCHEMA_VERSION, minWriterVersion: 3, assets: [] });
    expect(json['images']).toEqual([
      {
        sha256: img.record.id,
        size: img.bytes.byteLength,
        mime: 'image/png',
        ext: 'png',
        path: `images/${img.record.id}.png`,
      },
    ]);
    expect(SCHEMA_VERSION).toBe(3);
  });

  it('round-trips: verified blobs, the image as a reference-image asset, byte-identical archives twice', async () => {
    const first = writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs);
    expect(writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs)).toEqual(first);
    const opened = await readProjectArchive(first);
    expect(opened.readOnly).toBe(false);
    expect([...opened.blobs.keys()].sort()).toEqual([...blobs.keys()].sort());
    for (const [id, bytes] of blobs) expect(opened.blobs.get(id)).toEqual(bytes);
    expect(opened.assets.get(img.record.id)).toEqual({ record: img.record, bytes: img.bytes });
    expect(opened.snapshot.tables.meshes?.['msh_Cube' as MeshId]?.data?.manifest).toBe(manifest);
    // Open → save → open → save: the same bytes both times.
    const second = writeProjectArchive(opened.snapshot, opened.assets, { version: '0.3.0' }, opened.blobs);
    expect(second).toEqual(first);
    const reopened = await readProjectArchive(second);
    expect(writeProjectArchive(reopened.snapshot, reopened.assets, { version: '0.3.0' }, reopened.blobs)).toEqual(
      first,
    );
  });

  it('describes an image the snapshot does not know as a reference image with the mime of its ext', async () => {
    const files = unzipSync(writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs));
    const project = JSON.parse(new TextDecoder().decode(files['project.json'])) as {
      tables: { assets: Record<string, unknown> };
    };
    project.tables.assets = {};
    const zip = zipSync({ ...files, 'project.json': encoder.encode(JSON.stringify(project)) });
    const opened = await readProjectArchive(zip);
    expect(opened.assets.get(img.record.id)?.record).toEqual({
      id: img.record.id,
      name: `${img.record.id}.png`,
      ext: 'png',
      mime: 'image/png',
      size: img.bytes.byteLength,
      role: 'reference-image',
      provenance: null,
    });
  });

  it('leaves a corrupt or missing blob out (its mesh goes error), the project still opens', async () => {
    const files = unzipSync(writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs));
    const ids = [...blobs.keys()].sort();
    const tampered = (files[`blobs/${ids[0]}`] as Uint8Array).slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    const { [`blobs/${ids[1]}`]: _gone, ...rest } = files;
    const opened = await readProjectArchive(zipSync({ ...rest, [`blobs/${ids[0]}`]: tampered }));
    expect(opened.blobs.has(ids[0] as string)).toBe(false);
    expect(opened.blobs.has(ids[1] as string)).toBe(false);
    expect(opened.blobs.size).toBe(blobs.size - 2);
    expect(opened.snapshot.tables.meshes?.['msh_Cube' as MeshId]).toBeDefined();
  });

  it('checks the new per-entry limits before inflating', async () => {
    expect(PROJECT_LIMITS).toMatchObject({ maxBlobBytes: 4 * 1024 * 1024, maxImageBytes: 32 * 1024 * 1024 });
    const declare = (zip: Uint8Array, entry: string, size: number): Uint8Array => {
      const copy = zip.slice();
      const view = new DataView(copy.buffer);
      for (let offset = 0; offset + 46 <= copy.length; offset++) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const nameLength = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(copy.subarray(offset + 46, offset + 46 + nameLength));
        if (name === entry) view.setUint32(offset + 24, size, true);
      }
      return copy;
    };
    const zip = writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs);
    const blob = `blobs/${[...blobs.keys()].sort()[0]}`;
    await expect(readProjectArchive(declare(zip, blob, PROJECT_LIMITS.maxBlobBytes + 1))).rejects.toMatchObject({
      code: 'budget-exceeded',
    });
    await expect(
      readProjectArchive(declare(zip, `images/${img.record.id}.png`, PROJECT_LIMITS.maxImageBytes + 1)),
    ).rejects.toMatchObject({ code: 'budget-exceeded' });
  });

  it('an M2a reader (the shipped one) opens it read-only and never inflates images/ or blobs/', async () => {
    const zip = writeProjectArchive(snapshot, assets, { version: '0.3.0' }, blobs);
    const opened = await readProjectArchiveM2a(zip);
    expect(opened.readOnly).toBe(true);
    expect(opened.assets.size).toBe(0);
    expect(opened.inflated).toEqual(['manifest.json', 'project.json']);
    // A project without meshes or images keeps the M2a shape: no images key, no blobs.
    const plain = withSchemaV3(readSyntheticFixture('wave-doc.json') as DocSnapshot);
    const m2a = await readProjectArchiveM2a(writeProjectArchive(plain, new Map(), { version: '0.3.0' }));
    expect(m2a.readOnly).toBe(false);
  });
});
