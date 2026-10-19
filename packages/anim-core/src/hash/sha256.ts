// Synchronous, streaming SHA-256 (FIPS 180-4; M6A-SPEC §4.1): the one digest core of the workspace, moved down from
// doc and io so the mesh kernel can hash revision chunks without either. It compresses the 64-byte blocks straight
// from the caller's view and pads only the final partial block in a fixed 128-byte scratch buffer, so hashing never
// copies the input. Not re-entrant across threads (no state escapes a call; JavaScript calls cannot interleave).

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** Message schedule and chaining state, reused by every call (synchronous: no call can interleave). */
const W = new Int32Array(64);
const H = new Int32Array(8);
/** The final one or two blocks: the trailing bytes, 0x80, zero padding and the 64-bit big-endian bit length. */
const SCRATCH = new Uint8Array(128);

/** Compresses the 64-byte blocks of `data[offset … offset + length)` (length a multiple of 64) into `H`. */
function compress(data: Uint8Array, offset: number, length: number): void {
  let h0 = H[0] as number;
  let h1 = H[1] as number;
  let h2 = H[2] as number;
  let h3 = H[3] as number;
  let h4 = H[4] as number;
  let h5 = H[5] as number;
  let h6 = H[6] as number;
  let h7 = H[7] as number;
  const end = offset + length;
  for (let p = offset; p < end; p += 64) {
    for (let i = 0; i < 16; i++) {
      const j = p + i * 4;
      W[i] =
        ((data[j] as number) << 24) |
        ((data[j + 1] as number) << 16) |
        ((data[j + 2] as number) << 8) |
        (data[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15] as number;
      const w2 = W[i - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = ((((W[i - 16] as number) + s0) | 0) + (((W[i - 7] as number) + s1) | 0)) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (((((h + s1) | 0) + ch) | 0) + (((K[i] as number) + (W[i] as number)) | 0)) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  H[0] = h0;
  H[1] = h1;
  H[2] = h2;
  H[3] = h3;
  H[4] = h4;
  H[5] = h5;
  H[6] = h6;
  H[7] = h7;
}

/** SHA-256 digest of `bytes` (32 bytes). Reads `bytes` in place; allocates only the result. */
export function sha256(bytes: Uint8Array): Uint8Array {
  H[0] = 0x6a09e667;
  H[1] = 0xbb67ae85 | 0;
  H[2] = 0x3c6ef372;
  H[3] = 0xa54ff53a | 0;
  H[4] = 0x510e527f;
  H[5] = 0x9b05688c | 0;
  H[6] = 0x1f83d9ab;
  H[7] = 0x5be0cd19;
  const length = bytes.length;
  const full = length - (length % 64);
  if (full > 0) compress(bytes, 0, full);

  const rest = length - full;
  const tail = rest < 56 ? 64 : 128;
  SCRATCH.fill(0, 0, tail);
  for (let i = 0; i < rest; i++) SCRATCH[i] = bytes[full + i] as number;
  SCRATCH[rest] = 0x80;
  // Bit length as a 64-bit big-endian integer (inputs stay far below 2^53 bits).
  const high = Math.floor(length / 0x20000000); // (length × 8) / 2^32
  const low = (length << 3) >>> 0;
  SCRATCH[tail - 8] = high >>> 24;
  SCRATCH[tail - 7] = (high >>> 16) & 0xff;
  SCRATCH[tail - 6] = (high >>> 8) & 0xff;
  SCRATCH[tail - 5] = high & 0xff;
  SCRATCH[tail - 4] = low >>> 24;
  SCRATCH[tail - 3] = (low >>> 16) & 0xff;
  SCRATCH[tail - 2] = (low >>> 8) & 0xff;
  SCRATCH[tail - 1] = low & 0xff;
  compress(SCRATCH, 0, tail);

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const word = H[i] as number;
    out[i * 4] = word >>> 24;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8) & 0xff;
    out[i * 4 + 3] = word & 0xff;
  }
  return out;
}

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Lowercase hex of a byte array. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] as number];
  return out;
}

/** SHA-256 of `bytes` as lowercase hex, synchronously. */
export function sha256Hex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}
