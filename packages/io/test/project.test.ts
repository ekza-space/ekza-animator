import { EkzaError } from '@ekza-animator/anim-core';
import {
  type AssetId,
  type AssetRecord,
  type DocSnapshot,
  SCHEMA_VERSION,
  serializeSnapshot,
} from '@ekza-animator/doc';
import { readFixture, readSyntheticFixture } from '@ekza-animator/doc/testing';
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/gltf/json';
import { sha256HexSync } from '../src/hash/sha256';
import {
  openProject,
  PROJECT_FORMAT,
  projectJsonText,
  readProjectArchive,
  writeProjectArchive,
  writeProjectJson,
  zipProject,
} from '../src/project/archive';

const waveDoc = (): DocSnapshot => readSyntheticFixture('wave-doc.json') as DocSnapshot;

function polybotAsset(): { readonly id: AssetId; readonly record: AssetRecord; readonly bytes: Uint8Array } {
  const bytes = readFixture('polybot.vrm');
  const id = sha256HexSync(bytes) as AssetId;
  return {
    id,
    bytes,
    record: { id, name: 'polybot.vrm', ext: 'vrm', mime: 'model/gltf-binary', size: bytes.byteLength, role: 'model' },
  };
}

/** WP-2 (doc snapshots: serializeSnapshot, parseSnapshot, migrateSnapshot) has landed. */
function docSnapshotsReady(): boolean {
  try {
    serializeSnapshot(waveDoc());
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

describe('.ekzanim container', () => {
  const projectText = canonicalJson(waveDoc());
  const asset = polybotAsset();
  const assets = new Map([[asset.id, { record: asset.record, bytes: asset.bytes }]]);

  it('is deterministic: fixed entry order, zeroed timestamps, stored models', () => {
    const a = zipProject(projectText, waveDoc(), assets, { version: '0.1.0' });
    const b = zipProject(projectText, waveDoc(), assets, { version: '0.1.0' });
    expect(b).toEqual(a);
    const names: string[] = [];
    const view = new DataView(a.buffer, a.byteOffset, a.byteLength);
    for (let offset = 0; offset + 30 <= a.length && view.getUint32(offset, true) === 0x04034b50; ) {
      const method = view.getUint16(offset + 8, true);
      const time = view.getUint16(offset + 10, true);
      const date = view.getUint16(offset + 12, true);
      const compressed = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(a.subarray(offset + 30, offset + 30 + nameLength));
      names.push(name);
      expect([time, date]).toEqual([0, (0 << 9) | (1 << 5) | 1]);
      expect(method).toBe(name.startsWith('assets/') ? 0 : 8);
      offset += 30 + nameLength + extraLength + compressed;
    }
    expect(names).toEqual(['manifest.json', 'project.json', `assets/${asset.id}.vrm`]);
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(a)['manifest.json'])) as Record<string, unknown>;
    expect(manifest).toEqual({
      format: PROJECT_FORMAT,
      schemaVersion: 1,
      minWriterVersion: 1,
      app: { name: 'Ekza Animator', version: '0.1.0' },
      assets: [
        {
          sha256: asset.id,
          size: asset.bytes.byteLength,
          mime: 'model/gltf-binary',
          ext: 'vrm',
          path: `assets/${asset.id}.vrm`,
        },
      ],
    });
  });

  it('opens its own zip: project text unchanged, assets verified byte-identical', async () => {
    const opened = await openProject(zipProject(projectText, waveDoc(), assets, { version: '0.1.0' }));
    expect(opened.kind).toBe('zip');
    expect(opened.projectText).toBe(projectText);
    expect(opened.assets).toHaveLength(1);
    expect(opened.assets[0]?.bytes).toEqual(asset.bytes);
  });

  it('refuses assets whose bytes do not match, on write and on open', async () => {
    const wrong = new Map([[asset.id, { record: { ...asset.record, size: 3 }, bytes: asset.bytes }]]);
    expect(() => zipProject(projectText, waveDoc(), wrong, { version: '0' })).toThrow(
      expect.objectContaining({ code: 'asset-corrupt' }),
    );
    const zip = zipProject(projectText, waveDoc(), assets, { version: '0' });
    const files = unzipSync(zip);
    const tampered = (files[`assets/${asset.id}.vrm`] as Uint8Array).slice();
    tampered[100] = (tampered[100] ?? 0) ^ 1;
    const corrupt = zipSync({ ...files, [`assets/${asset.id}.vrm`]: tampered });
    await expect(openProject(corrupt)).rejects.toMatchObject({ code: 'asset-corrupt' });
    const { [`assets/${asset.id}.vrm`]: _gone, ...rest } = files;
    await expect(openProject(zipSync(rest))).rejects.toMatchObject({ code: 'asset-missing' });
  });

  it('rejects zip entries that declare more data than the limits before inflating', async () => {
    const zip = zipProject(projectText, waveDoc(), new Map(), { version: '0' }).slice();
    const view = new DataView(zip.buffer);
    // Central directory entry of project.json: declare a 2 GiB uncompressed size.
    for (let offset = 0; offset + 46 <= zip.length; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(zip.subarray(offset + 46, offset + 46 + nameLength));
      if (name === 'project.json') view.setUint32(offset + 24, 0x80000000, true);
    }
    await expect(openProject(zip)).rejects.toMatchObject({ code: 'budget-exceeded' });
  });

  it('rejects files that are not projects', async () => {
    await expect(openProject(new TextEncoder().encode('glTF....'))).rejects.toMatchObject({ code: 'unsupported' });
    await expect(openProject(zipSync({ 'readme.txt': new Uint8Array(1) }))).rejects.toMatchObject({
      code: 'unsupported',
    });
    const badManifest = zipSync({
      'manifest.json': new TextEncoder().encode('{"format":"other"}'),
      'project.json': new Uint8Array(2),
    });
    await expect(openProject(badManifest)).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('writes the JSON debug variant with sorted keys and asset entries without bytes', async () => {
    const text = projectJsonText(waveDoc(), [asset.record]);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(parsed['assets']).toEqual([
      { ext: 'vrm', mime: 'model/gltf-binary', name: 'polybot.vrm', sha256: asset.id, size: asset.bytes.byteLength },
    ]);
    expect(projectJsonText(waveDoc(), [asset.record])).toBe(text);
    const opened = await openProject(new TextEncoder().encode(text));
    expect(opened).toMatchObject({ kind: 'json', manifest: null, assets: [] });
  });
});

describe.skipIf(!docSnapshotsReady())(
  '.ekzanim with doc snapshots [needs WP-2 serializeSnapshot/migrateSnapshot]',
  () => {
    it('round-trips a snapshot and its assets (snapshot → zip → snapshot deep-equal)', async () => {
      const asset = polybotAsset();
      const snapshot = waveDoc();
      const zip = writeProjectArchive(snapshot, new Map([[asset.id, { record: asset.record, bytes: asset.bytes }]]), {
        version: '0.1.0',
      });
      expect(
        writeProjectArchive(snapshot, new Map([[asset.id, { record: asset.record, bytes: asset.bytes }]]), {
          version: '0.1.0',
        }),
      ).toEqual(zip);
      const back = await readProjectArchive(zip);
      expect(back.snapshot).toEqual(snapshot);
      expect(back.readOnly).toBe(false);
      expect(back.migratedFrom).toBe(SCHEMA_VERSION);
      expect(back.assets.get(asset.id)?.bytes).toEqual(asset.bytes);
    });

    it('keeps unknown tables and fields', async () => {
      const snapshot = waveDoc();
      const extended = {
        ...snapshot,
        tableVersions: { ...snapshot.tableVersions, 'acme.notes': 1 },
        tables: { ...snapshot.tables, 'acme.notes': { n1: { id: 'n1', text: 'hello' } } },
      } as DocSnapshot;
      const back = await readProjectArchive(writeProjectArchive(extended, new Map(), { version: '0.1.0' }));
      expect(back.snapshot.tables['acme.notes']).toEqual({ n1: { id: 'n1', text: 'hello' } });
    });

    it('round-trips the JSON debug variant (assets come back empty)', async () => {
      const snapshot = waveDoc();
      const text = writeProjectJson(snapshot, []);
      const back = await readProjectArchive(new TextEncoder().encode(text));
      expect(back.snapshot).toEqual(snapshot);
      expect(back.assets.size).toBe(0);
    });

    it('opens projects from newer writers read-only', async () => {
      const snapshot = { ...waveDoc(), minWriterVersion: SCHEMA_VERSION + 1 };
      const back = await readProjectArchive(writeProjectArchive(snapshot, new Map(), { version: '9.0.0' }));
      expect(back.readOnly).toBe(true);
    });
  },
);
