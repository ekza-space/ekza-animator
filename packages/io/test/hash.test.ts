import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync, toHex } from '../src/hash/sha256';

const nodeSha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    const text = (s: string): Uint8Array => new TextEncoder().encode(s);
    expect(sha256HexSync(text(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256HexSync(text('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexSync(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto at every padding boundary and on random data', () => {
    for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096 + 7]) {
      const bytes = new Uint8Array(randomBytes(size));
      expect(sha256HexSync(bytes)).toBe(nodeSha(bytes));
    }
  });

  it('hashes views by their own bytes, not the underlying buffer', async () => {
    const backing = new Uint8Array(randomBytes(300));
    const view = backing.subarray(17, 211);
    expect(sha256HexSync(view)).toBe(nodeSha(view));
    expect(await sha256Hex(view)).toBe(nodeSha(view));
  });

  it('uses WebCrypto asynchronously with the same result', async () => {
    const bytes = new Uint8Array(randomBytes(100_000));
    expect(await sha256Hex(bytes)).toBe(sha256HexSync(bytes));
  });

  it('formats lowercase hex', () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
  });
});
