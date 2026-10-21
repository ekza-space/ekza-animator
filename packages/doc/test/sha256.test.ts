// M6A-SPEC §4.1: doc keeps `sha256(bytes)`, `sha256Hex(text)` and `digestBase62` as wrappers over the anim-core
// digest core; their results are unchanged (the derived IDs of shipped documents must not move).
import { createHash } from 'node:crypto';
import { sha256 as coreSha256, sha256Hex as coreSha256Hex } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import { digestBase62, sha256, sha256Hex } from '../src/migrations/sha256';

const nodeHex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('doc sha256 wrappers', () => {
  it('sha256Hex(text) hashes the UTF-8 bytes like anim-core and node:crypto', () => {
    for (const text of ['', 'abc', 'rig_a1:fk.hips', 'ü€𝄞 — ekza', 'x'.repeat(1000)]) {
      const bytes = new TextEncoder().encode(text);
      expect(sha256Hex(text)).toBe(coreSha256Hex(bytes));
      expect(sha256Hex(text)).toBe(nodeHex(bytes));
    }
  });

  it('sha256(bytes) is the anim-core digest', () => {
    const bytes = new TextEncoder().encode('ekza-mesh');
    expect(sha256(bytes)).toEqual(coreSha256(bytes));
  });

  it('digestBase62 keeps its derivation (golden)', () => {
    expect(digestBase62(sha256(new TextEncoder().encode('rig_a1:solver.leg.L')), 16)).toMatchInlineSnapshot(
      `"jgd9tMt3pZNzR2nf"`,
    );
  });
});
