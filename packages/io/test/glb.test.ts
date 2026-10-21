import { readFixture } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import { CHUNK_BIN, CHUNK_JSON, parseGlb, readGlbLayout } from '../src/glb/parse';
import { align4, assembleGlb } from '../src/glb/write';
import { sha256HexSync } from '../src/hash/sha256';

function rawGlb(chunks: readonly { type: number; data: Uint8Array }[], declared?: number): Uint8Array {
  const total = 12 + chunks.reduce((sum, c) => sum + 8 + c.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, declared ?? total, true);
  let offset = 12;
  for (const chunk of chunks) {
    dv.setUint32(offset, chunk.data.length, true);
    dv.setUint32(offset + 4, chunk.type, true);
    out.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseGlb', () => {
  it('reads the fixtures: JSON, a zero-copy BIN view and the file hash', async () => {
    const bytes = readFixture('polybot.vrm');
    const c = await parseGlb(bytes);
    expect(c.bytes).toBe(bytes);
    expect(c.json.asset.version).toBe('2.0');
    expect(c.bin?.buffer).toBe(bytes.buffer);
    expect(c.bin?.byteLength).toBe(972_664);
    expect(c.jsonByteLength).toBe(24_356);
    expect(c.sha256).toBe(sha256HexSync(bytes));
    expect(c.sha256).toBe('e255bace0d7de8b5fc90756efc83e167080e6db97692f23623fec5f1c67c423d');
  });

  it('rejects files that are not glTF 2.0 binaries with not-glb', async () => {
    await expect(parseGlb(text('{"asset":{"version":"2.0"}}'))).rejects.toMatchObject({ code: 'not-glb' });
    await expect(parseGlb(new Uint8Array(4))).rejects.toMatchObject({ code: 'not-glb' });
    const v1 = rawGlb([{ type: CHUNK_JSON, data: text('{"asset":{"version":"2.0"}}   ') }]);
    new DataView(v1.buffer).setUint32(4, 1, true);
    await expect(parseGlb(v1)).rejects.toMatchObject({ code: 'not-glb' });
  });

  it('rejects a missing, truncated or invalid JSON chunk with malformed-gltf', async () => {
    await expect(parseGlb(rawGlb([{ type: CHUNK_BIN, data: new Uint8Array(4) }]))).rejects.toMatchObject({
      code: 'malformed-gltf',
    });
    const truncated = rawGlb([{ type: CHUNK_JSON, data: text('{"asset":{"version":"2.0"}}') }]).subarray(0, 30);
    await expect(parseGlb(truncated)).rejects.toMatchObject({ code: 'malformed-gltf' });
    await expect(parseGlb(rawGlb([{ type: CHUNK_JSON, data: text('{"asset":') }]))).rejects.toMatchObject({
      code: 'malformed-gltf',
    });
    await expect(parseGlb(rawGlb([{ type: CHUNK_JSON, data: text('[1, 2, 3]') }]))).rejects.toMatchObject({
      code: 'malformed-gltf',
    });
    await expect(
      parseGlb(rawGlb([{ type: CHUNK_JSON, data: new Uint8Array([0xff, 0xfe, 0x7b]) }])),
    ).rejects.toMatchObject({
      code: 'malformed-gltf',
    });
  });

  it('tolerates NUL padding and a BOM in the JSON chunk and files without BIN', async () => {
    const json = new Uint8Array([0xef, 0xbb, 0xbf, ...text('{"asset":{"version":"2.0"}}'), 0, 0]);
    const c = await parseGlb(rawGlb([{ type: CHUNK_JSON, data: json }]));
    expect(c.json.asset.version).toBe('2.0');
    expect(c.bin).toBeNull();
  });

  it('skips unknown chunks and uses the first BIN chunk', async () => {
    const c = await parseGlb(
      rawGlb([
        { type: CHUNK_JSON, data: text('{"asset":{"version":"2.0"}}  ') },
        { type: 0x12345678, data: new Uint8Array(8).fill(9) },
        { type: CHUNK_BIN, data: new Uint8Array([1, 2, 3, 4]) },
        { type: CHUNK_BIN, data: new Uint8Array([5, 6, 7, 8]) },
      ]),
    );
    expect([...(c.bin ?? [])]).toEqual([1, 2, 3, 4]);
  });
});

describe('assembleGlb', () => {
  it('pads JSON with spaces and BIN with zeros and writes consistent lengths', () => {
    const bytes = assembleGlb('{"asset":{"version":"2.0"}}', [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const layout = readGlbLayout(bytes);
    expect(layout.declaredLength).toBe(bytes.byteLength);
    expect(layout.trailingBytes).toBe(0);
    expect(layout.chunks.map((c) => [c.type, c.length])).toEqual([
      [CHUNK_JSON, 28],
      [CHUNK_BIN, 8],
    ]);
    const json = layout.chunks[0];
    expect(bytes[(json?.offset ?? 0) + 27]).toBe(0x20);
    expect([...bytes.subarray(bytes.byteLength - 8)]).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
    expect(align4(5)).toBe(8);
    expect(align4(8)).toBe(8);
  });

  it('omits the BIN chunk when no parts are given', () => {
    const layout = readGlbLayout(assembleGlb('{"asset":{"version":"2.0"}}', null));
    expect(layout.chunks).toHaveLength(1);
  });
});

describe('parseGlb limits', () => {
  it('refuses JSON chunks above 64 MiB before parsing them', async () => {
    const header = new Uint8Array(20);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    const length = 64 * 1_048_576 + 4;
    const bytes = new Uint8Array(20 + length);
    bytes.set(header);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, length, true);
    view.setUint32(16, CHUNK_JSON, true);
    await expect(parseGlb(bytes)).rejects.toMatchObject({ code: 'budget-exceeded' });
  });
});
