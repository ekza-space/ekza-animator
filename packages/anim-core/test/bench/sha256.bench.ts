// M6A-SPEC §4.1 bench (report): SHA-256 throughput ≥ 300 MB/s in Node 25 on the reference machine, a 64 KiB chunk
// in ≤ 0.25 ms. Run: pnpm --filter @ekza-animator/anim-core exec vitest bench --run test/bench/sha256.bench.ts
import { bench, describe } from 'vitest';
import { sha256 } from '../../src';

const chunk = new Uint8Array(64 * 1024);
for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 2654435761) >>> 24;
const big = new Uint8Array(8 * 1024 * 1024);
for (let i = 0; i < big.length; i++) big[i] = (i * 40503) >>> 8;
const small = new Uint8Array(32 * 1024);
let sink = 0;

describe('sha256', () => {
  bench('64 KiB chunk (budget ≤ 0.25 ms)', () => {
    sink ^= sha256(chunk)[0] as number;
  });
  bench('32 KiB revision chunk', () => {
    sink ^= sha256(small)[0] as number;
  });
  bench('8 MiB buffer (MB/s = 8.39 / mean s)', () => {
    sink ^= sha256(big)[0] as number;
  });
});

export const keep = (): number => sink;
