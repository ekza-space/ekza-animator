// M6A-SPEC §4.1: the streaming SHA-256 core. FIPS 180-4 / NIST vectors, every block boundary against node:crypto,
// non-copying reads (views at an offset, a frozen-size input), and re-use of the module scratch across calls.
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Hex, toHex } from '../../src';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const nodeHex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('sha256 (anim-core)', () => {
  it('matches the FIPS 180-4 / NIST vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(ascii('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(
      sha256Hex(
        ascii(
          'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
        ),
      ),
    ).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with node:crypto at every length around the 55/56/64-byte padding boundaries', () => {
    for (let length = 0; length <= 300; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 31 + length * 7) & 0xff;
      expect(sha256Hex(bytes), `length ${length}`).toBe(nodeHex(bytes));
    }
  });

  it('agrees with node:crypto on random inputs (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        expect(sha256Hex(bytes)).toBe(nodeHex(bytes));
      }),
      { numRuns: 300 },
    );
  });

  it('reads views at an offset without copying and leaves the input untouched', () => {
    const backing = new Uint8Array(200_000);
    for (let i = 0; i < backing.length; i++) backing[i] = (i * 13) & 0xff;
    const before = backing.slice();
    const view = backing.subarray(17, 65_536 + 17 + 5);
    expect(sha256Hex(view)).toBe(nodeHex(view));
    expect(backing).toEqual(before);
  });

  it('returns a fresh 32-byte digest per call (no shared output buffer)', () => {
    const a = sha256(ascii('a'));
    const b = sha256(ascii('b'));
    expect(a).toHaveLength(32);
    expect(toHex(a)).toBe(nodeHex(ascii('a')));
    expect(toHex(b)).toBe(nodeHex(ascii('b')));
    expect(a).not.toBe(b);
  });

  it('toHex writes lowercase, zero-padded bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });
});
