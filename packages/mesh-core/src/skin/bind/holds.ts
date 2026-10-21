// C4 (auto-skin; M6B-SPEC §5.10 applied to a masked §5.9 run): held joints never change. A masked Bind Skin (Bind
// Unweighted Points, "Only selected points", the Quick Rig re-run) solves its points freely; this pass then restores the
// held entries of every masked point bit-equal from the previous weights and fits the solved not-held entries into
// what the holds leave (`avail = 1 − Σ held`), as §5.10's normalization does. Pure and deterministic.
import type { SkinWeights } from '../types';

const MAX = 4;

interface Entry {
  index: number;
  w: number;
}

/**
 * `next` is a masked bind's result over `previous` (its palette starts with `previous.palette`). For every point of
 * `points` that held weight on a `held` joint before, or that the solve gave weight on a held joint:
 * - the held entries keep their previous f32 values bit-equal (a held joint the point lacked stays at 0);
 * - the solved not-held entries are rescaled to `avail = 1 − Σ held`; more than 4 entries drop the smallest not-held
 *   ones (ties: larger palette index) and rescale again; the f32 residual goes into the largest not-held weight;
 * - nothing to fit (`avail ≤ 0`, no free slot, or the solve put everything on held joints) keeps the previous row.
 * Points outside `points` and points with no held weight before or after keep `next`'s rows. Unweighted rows stay as
 * `next` wrote them.
 */
export function applyHolds(
  next: SkinWeights,
  previous: SkinWeights,
  points: ArrayLike<number>,
  held: readonly string[],
): SkinWeights {
  if (held.length === 0 || previous.points !== next.points) return next;
  const heldKeys = new Set(held);
  const isHeld = next.palette.map((entry) => heldKeys.has(entry.key));
  if (!isHeld.includes(true)) return next;
  const nextIndex = new Map<string, number>();
  next.palette.forEach((entry, i) => {
    if (!nextIndex.has(entry.key)) nextIndex.set(entry.key, i);
  });
  const prevToNext = previous.palette.map((entry) => nextIndex.get(entry.key) ?? -1);
  const joints = next.joints.slice();
  const weights = next.weights.slice();
  const seen = new Uint8Array(next.points);
  const row = (skin: { joints: Uint16Array; weights: Float32Array }, v: number, map: (i: number) => number) => {
    const out: Entry[] = [];
    for (let k = 0; k < MAX; k++) {
      const w = skin.weights[4 * v + k] as number;
      if (!(w > 0)) continue;
      const index = map(skin.joints[4 * v + k] as number);
      if (index >= 0) out.push({ index, w });
    }
    return out;
  };
  const write = (v: number, entries: readonly Entry[]): void => {
    const sorted = [...entries].sort((a, b) => b.w - a.w || a.index - b.index);
    for (let k = 0; k < MAX; k++) {
      const entry = sorted[k];
      joints[4 * v + k] = entry === undefined ? 0 : entry.index;
      weights[4 * v + k] = entry === undefined ? 0 : entry.w;
    }
  };
  for (let i = 0; i < points.length; i++) {
    const v = points[i] as number;
    if (!Number.isInteger(v) || v < 0 || v >= next.points || seen[v] === 1) continue;
    seen[v] = 1;
    const before = row(previous, v, (j) => prevToNext[j] ?? -1);
    const after = row(next, v, (j) => j);
    const keptHeld = before.filter((entry) => isHeld[entry.index] === true);
    const solvedHeld = after.some((entry) => isHeld[entry.index] === true);
    if (keptHeld.length === 0 && !solvedHeld) continue;
    let heldSum = 0;
    for (const entry of keptHeld) heldSum += entry.w;
    const avail = 1 - heldSum;
    let free = after.filter((entry) => isHeld[entry.index] !== true);
    const slots = MAX - keptHeld.length;
    let rest = 0;
    for (const entry of free) rest += entry.w;
    if (!(avail > 1e-6) || slots <= 0 || !(rest > 0)) {
      write(v, before);
      continue;
    }
    if (free.length > slots) {
      free = [...free].sort((a, b) => b.w - a.w || a.index - b.index).slice(0, slots);
      rest = 0;
      for (const entry of free) rest += entry.w;
    }
    const scaled = free.map((entry) => ({ index: entry.index, w: Math.fround((entry.w * avail) / rest) }));
    scaled.sort((a, b) => b.w - a.w || a.index - b.index);
    // The f32 residual (summed in descending order, held included) into the largest not-held weight.
    const all = [...keptHeld, ...scaled].sort((a, b) => b.w - a.w || a.index - b.index);
    let sum = 0;
    for (const entry of all) sum += entry.w;
    const top = scaled[0] as Entry;
    top.w = Math.fround(top.w + (1 - sum));
    write(
      v,
      [...keptHeld, ...scaled].filter((entry) => entry.w > 0),
    );
  }
  return { points: next.points, palette: next.palette, joints, weights };
}
