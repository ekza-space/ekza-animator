// M6A-SPEC §4.6, §5.20: the memory BlobStore (B0a complete): content addressing, dedupe, verified reads, fresh roots,
// mark-and-sweep and the manifest chunk closure.
import { EkzaError, sha256Hex } from '@ekza-animator/anim-core';
import { primitive, writeRevision } from '@ekza-animator/mesh-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../../src';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('memory BlobStore', () => {
  it('puts by sha256, dedupes, keeps a private copy and counts resident bytes', () => {
    const blobs = createMemoryBlobStore();
    const source = bytes(1, 2, 3);
    const id = blobs.put(source);
    expect(id).toBe(sha256Hex(source));
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(blobs.put(bytes(1, 2, 3))).toBe(id);
    expect(blobs.size).toBe(1);
    expect(blobs.residentBytes).toBe(3);
    source[0] = 9; // the store kept its own copy
    expect([...(blobs.peek(id) as Uint8Array)]).toEqual([1, 2, 3]);
    expect(blobs.has(id)).toBe(true);
    expect(blobs.ids()).toEqual([id]);
  });

  it('verifies reads: missing and corrupt blobs reject with their codes', async () => {
    const blobs = createMemoryBlobStore();
    const id = blobs.put(bytes(4, 5));
    await expect(blobs.get(id)).resolves.toEqual(bytes(4, 5));
    await expect(blobs.get('0'.repeat(64))).rejects.toMatchObject({ code: 'blob-missing' });
    (blobs.peek(id) as Uint8Array)[0] = 0; // simulate corruption of the resident bytes
    const error: unknown = await blobs.get(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EkzaError);
    expect((error as EkzaError).code).toBe('blob-corrupt');
  });

  it('sweeps what is neither reachable nor fresh; fresh blobs are roots until the next completed sweep', () => {
    const blobs = createMemoryBlobStore();
    const a = blobs.put(bytes(1));
    const b = blobs.put(bytes(2, 2));
    expect([...blobs.fresh].sort()).toEqual([a, b].sort());
    expect(blobs.sweep(new Set())).toEqual({ freed: 0, bytes: 0 }); // both fresh
    expect(blobs.fresh.size).toBe(0);
    const c = blobs.put(bytes(3, 3, 3));
    expect(blobs.sweep(new Set([a]))).toEqual({ freed: 1, bytes: 2 }); // b goes; a reachable; c fresh
    expect(blobs.has(b)).toBe(false);
    expect(blobs.has(a) && blobs.has(c)).toBe(true);
    expect(blobs.residentBytes).toBe(4);
    expect(blobs.sweep(new Set())).toEqual({ freed: 2, bytes: 4 });
    expect(blobs.size).toBe(0);
    expect(blobs.residentBytes).toBe(0);
  });

  it('expands manifests to their chunk closure from resident manifests', () => {
    const blobs = createMemoryBlobStore();
    const out = writeRevision(primitive('cube', {}));
    for (const [, chunk] of out.newChunks) blobs.put(chunk);
    const manifest = blobs.put(out.manifestBytes);
    expect(manifest).toBe(out.manifestId);
    const closure = blobs.closure([manifest]);
    expect(closure[0]).toBe(manifest);
    expect(new Set(closure)).toEqual(new Set([manifest, ...out.newChunks.keys()]));
    // A non-resident manifest contributes only itself; garbage manifests list no chunks.
    const garbage = blobs.put(new TextEncoder().encode('{"layers":[{"chunks":["nothex",1]}]}'));
    expect(blobs.closure(['f'.repeat(64), garbage])).toEqual(['f'.repeat(64), garbage]);
  });

  it('property: nothing reachable or fresh is ever freed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.uint8Array({ minLength: 1, maxLength: 8 }), fc.boolean(), fc.boolean()), {
          maxLength: 40,
        }),
        (ops) => {
          const blobs = createMemoryBlobStore();
          const reachable = new Set<string>();
          const lost: string[] = [];
          for (const [data, keep, sweep] of ops) {
            const id = blobs.put(data);
            if (keep) reachable.add(id);
            if (!sweep) continue;
            const roots = [...reachable, ...blobs.fresh];
            blobs.sweep(reachable);
            lost.push(...roots.filter((root) => !blobs.has(root)));
          }
          expect(lost).toEqual([]);
          let total = 0;
          for (const id of blobs.ids()) total += (blobs.peek(id) as Uint8Array).byteLength;
          expect(total).toBe(blobs.residentBytes);
        },
      ),
    );
  });
});
