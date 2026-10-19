#!/usr/bin/env node
// Generates the reference image fixtures of M6A-SPEC §5.26 / E2E-MOD-29 (B13): `fixtures/images/reference-front.png`
// and `reference-side.png`, flat silhouettes of a 1.6 m T-posed figure (front) and its profile (side) on a light grid,
// 256 × 512 px, 8-bit RGB. Plain shapes drawn here, CC0 1.0 (fixtures/LICENSES.md). Deterministic for a given Node
// zlib: no timestamps, no ancillary chunks.
//
// Usage: node tooling/make-reference-images.mjs [repoRoot]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const W = 256;
const H = 512;
const BACKGROUND = [236, 238, 242];
const GRID = [214, 218, 226];
const FIGURE = [70, 78, 96];
const GROUND = [150, 60, 60];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An RGB8 PNG of `pixel(x, y)`. */
export function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + 3 * x] = r;
      raw[row + 2 + 3 * x] = g;
      raw[row + 3 + 3 * x] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The figure in metres (1.6 m tall, grounded 16 px above the bottom edge): 256 px per metre, the image centred on
// x = 0.
const M = H / 2; // px per metre
const toPx = (x, y) => [W / 2 + x * M, H - 16 - y * M];

const inBox = (px, py, x0, y0, x1, y1) => {
  const [a, b] = toPx(x0, y1);
  const [c, d] = toPx(x1, y0);
  return px >= a && px <= c && py >= b && py <= d;
};
const inCircle = (px, py, cx, cy, r) => {
  const [x, y] = toPx(cx, cy);
  return (px - x) ** 2 + (py - y) ** 2 <= (r * M) ** 2;
};

function front(px, py) {
  if (inCircle(px, py, 0, 1.51, 0.1)) return FIGURE; // head
  if (inBox(px, py, -0.05, 1.36, 0.05, 1.44)) return FIGURE; // neck
  if (inBox(px, py, -0.18, 0.8, 0.18, 1.38)) return FIGURE; // torso
  if (inBox(px, py, -0.48, 1.2, 0.48, 1.3)) return FIGURE; // arms (T-pose)
  if (inBox(px, py, -0.16, 0, -0.03, 0.82) || inBox(px, py, 0.03, 0, 0.16, 0.82)) return FIGURE; // legs
  return background(px, py);
}

function side(px, py) {
  if (inCircle(px, py, 0, 1.51, 0.1)) return FIGURE; // head
  if (inBox(px, py, 0.08, 1.48, 0.13, 1.52)) return FIGURE; // nose (+Z to the right)
  if (inBox(px, py, -0.04, 1.36, 0.04, 1.44)) return FIGURE; // neck
  if (inBox(px, py, -0.1, 0.8, 0.1, 1.38)) return FIGURE; // torso
  if (inBox(px, py, -0.06, 0, 0.06, 0.82)) return FIGURE; // legs
  if (inBox(px, py, -0.06, 0, 0.16, 0.06)) return FIGURE; // feet towards +Z
  return background(px, py);
}

function background(px, py) {
  const [, groundY] = toPx(0, 0);
  if (Math.abs(py - groundY) < 1) return GROUND;
  return px % 32 === 0 || (H - 16 - py) % 32 === 0 ? GRID : BACKGROUND;
}

export function main(root = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const dir = join(root, 'fixtures', 'images');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'reference-front.png'), png(W, H, front));
  writeFileSync(join(dir, 'reference-side.png'), png(W, H, side));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] === undefined ? undefined : resolve(process.argv[2]));
}
