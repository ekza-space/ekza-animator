// Auto-Rig ③ Rig e2e helpers (AUTORIG-SPEC §10 D4, §11; one file per step owner, §10.0): *Auto-rig ▸* with an in-page
// recorder of the progress sheet (the stages `autorig().busy` went through and the stage rows the sheet listed), the
// subject character and its mesh, the Validation rows under the wizard's profile, the bind checks of AS-AR-1 step 5
// (weighted, ≤ 4 influences, sums 1, nothing on `root`) and AS-AR-7's heavy variant — the Cube Lad's boxes as
// subdivided grids (no new binary fixture: built in memory from `cube-lad-truth.json`).
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { type QuickRigView, quickRig, wizard } from './ar-markers';
import { history } from './autorig';
import { call } from './test-api';

export const PROFILE = 'ekza/space-avatar-v1';

/** What the in-page recorder saw while a composition ran. */
export interface StageRecord {
  /** The distinct stages the sheet showed (its `data-stage`), in order. */
  readonly stages: string[];
  /** The distinct lists of stage rows the sheet showed (`data-stage` of its rows), in order. */
  readonly rows: string[][];
  /** `performance.now()` when `busy` last ended, and when the persp pane's badge first said `PREVIEW <clip>`. */
  readonly endedAt: number | null;
  readonly previewAt: number | null;
}

declare global {
  interface Window {
    __AR_STAGES__?: StageRecord & { stop: boolean };
  }
}

/**
 * Starts the in-page recorder: a MutationObserver sees every DOM commit of the sheet (its `data-stage` and its stage
 * rows) and the persp pane's preview badge; `readStages` returns what it saw.
 */
export async function recordStages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record: {
      stages: string[];
      rows: string[][];
      endedAt: number | null;
      previewAt: number | null;
      stop: boolean;
    } = { stages: [], rows: [], endedAt: null, previewAt: null, stop: false };
    window.__AR_STAGES__ = record;
    let open = false;
    const observe = (): void => {
      if (record.stop) return;
      const sheet = document.querySelector('[data-testid="ar-rig-sheet"]');
      const stage = sheet?.getAttribute('data-stage') ?? null;
      if (stage !== null && record.stages.at(-1) !== stage) record.stages.push(stage);
      if (sheet !== null) open = true;
      if (sheet === null && open) {
        open = false;
        record.endedAt = performance.now();
      }
      const rows = [...document.querySelectorAll('[data-testid="ar-rig-stages"] li')].map(
        (li) => li.getAttribute('data-stage') ?? '',
      );
      if (rows.length > 0 && record.rows.at(-1)?.join() !== rows.join()) record.rows.push(rows);
      const badge = document.querySelector('[data-testid="hud-badge-preview-pane-persp"]')?.textContent ?? '';
      if (record.previewAt === null && record.endedAt !== null && badge.startsWith('PREVIEW')) {
        record.previewAt = performance.now();
      }
    };
    new MutationObserver(observe).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

export async function readStages(page: Page): Promise<StageRecord> {
  return page.evaluate(() => {
    const record = window.__AR_STAGES__;
    if (record === undefined) throw new Error('no stage recorder');
    // the recorder keeps running: the preview badge after the sheet may come later
    return { stages: record.stages, rows: record.rows, endedAt: record.endedAt, previewAt: record.previewAt };
  });
}

/** *Auto-rig ▸* on ②, then waits for ③ with the composition ended. */
export async function autoRig(page: Page): Promise<void> {
  await expect(page.getByTestId('ar-primary')).toHaveText(/Auto-rig/);
  await page.getByTestId('ar-primary').click();
  await expect.poll(async () => (await wizard(page)).step, { timeout: 60_000 }).toBe('rig');
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 60_000 }).toBeNull();
  await expect(page.getByTestId('ar-rig-sheet')).toHaveCount(0);
}

/** The wizard's subject character and its (first) mesh. */
export async function subjectCharacter(page: Page): Promise<{ readonly character: string; readonly mesh: string }> {
  const character = (await wizard(page)).subject.character;
  if (character === null) throw new Error('no subject character');
  const row = (await call(page, 'characters')).find((candidate) => candidate.id === character);
  const mesh = row?.meshes[0];
  if (mesh === undefined) throw new Error('no character mesh');
  return { character, mesh };
}

/** The Validation rows of the Rig & Skin character under the wizard's profile. */
export function rows(page: Page) {
  return call(page, 'validation', PROFILE);
}

/** The undo labels added since `before`. */
export async function stepsSince(page: Page, before: readonly string[]): Promise<string[]> {
  const now = (await history(page)).undo;
  expect(now.slice(0, before.length)).toEqual([...before]);
  return now.slice(before.length);
}

/** AS-AR-1 step 5's bind checks: every point weighted, ≤ 4 influences, sums within 1e-6, none on `root`. */
export async function expectCleanWeights(page: Page, character: string, mesh: string): Promise<void> {
  const skeleton = await call(page, 'skeleton', character);
  const root = skeleton?.joints.find((joint) => joint.parent === null)?.key ?? 'root';
  const weights = await call(page, 'weights', mesh);
  expect(weights.length).toBeGreaterThan(0);
  const bad = weights.flatMap((row, point) => {
    const used = row.weights.map((w, k) => [row.joints[k] ?? '', w] as const).filter(([, w]) => w > 0);
    const sum = used.reduce((total, [, w]) => total + w, 0);
    return used.length === 0 || used.length > 4 || Math.abs(sum - 1) > 1e-6 || used.some(([key]) => key === root)
      ? [point]
      : [];
  });
  expect(bad).toEqual([]);
}

/** The marker of a Quick Rig state, as numbers. */
export const markerOf = (state: QuickRigView | null, name: string): number[] => state?.markers[name] ?? [];

/** Nudges the selected marker with the keyboard (focus off the list, the pointer over `paneId`). */
export async function nudge(page: Page, key: string, times: number): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

export { quickRig };

// ---------------------------------------------------------------------------------------------------------------------
// AS-AR-7's heavy variant: the Cube Lad's sixteen boxes, each face an n × n grid

interface TruthBox {
  readonly name: string;
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** A GLB of one mesh (positions, triangle indices). */
function glbOf(name: string, positions: Float32Array, indices: Uint32Array): Buffer {
  const bin = Buffer.alloc(pad4(positions.byteLength) + indices.byteLength);
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(indices.buffer).copy(bin, pad4(positions.byteLength));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, positions[i + k] as number);
      hi[k] = Math.max(hi[k] as number, positions[i + k] as number);
    }
  }
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pad4(positions.byteLength), byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonLength = pad4(text.length);
  const total = 20 + jsonLength + 8 + bin.length;
  const out = Buffer.alloc(total, 0);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(0x20, 20, 20 + jsonLength);
  text.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonLength);
  out.writeUInt32LE(0x004e4942, 24 + jsonLength);
  bin.copy(out, 28 + jsonLength);
  return out;
}

/** The Cube Lad with every box face an n × n grid of quads: 192 · n² triangles (n = 21: 84,672). */
export function subdividedCubeLad(n: number): Buffer {
  const truth = JSON.parse(
    readFileSync(new URL('../../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'),
  ) as { boxes: TruthBox[] };
  const points: number[] = [];
  const triangles: number[] = [];
  // each face: (origin corner, u axis, v axis) with an outward normal u × v, in unit-box coordinates (−½ … ½)
  const faces: readonly (readonly [number[], number[], number[]])[] = [
    [
      [0.5, -0.5, 0.5],
      [0, 0, -1],
      [0, 1, 0],
    ], // +X
    [
      [-0.5, -0.5, -0.5],
      [0, 0, 1],
      [0, 1, 0],
    ], // −X
    [
      [-0.5, 0.5, 0.5],
      [1, 0, 0],
      [0, 0, -1],
    ], // +Y
    [
      [-0.5, -0.5, -0.5],
      [1, 0, 0],
      [0, 0, 1],
    ], // −Y
    [
      [-0.5, -0.5, 0.5],
      [1, 0, 0],
      [0, 1, 0],
    ], // +Z
    [
      [0.5, -0.5, -0.5],
      [-1, 0, 0],
      [0, 1, 0],
    ], // −Z
  ];
  for (const box of truth.boxes) {
    for (const [origin, u, v] of faces) {
      const base = points.length / 3;
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          for (let k = 0; k < 3; k++) {
            const unit = (origin[k] as number) + ((u[k] as number) * i) / n + ((v[k] as number) * j) / n;
            points.push((box.center[k] as number) + unit * (box.size[k] as number));
          }
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          const b = a + 1;
          const d = a + n + 1;
          const e = d + 1;
          triangles.push(a, b, e, a, e, d);
        }
      }
    }
  }
  return glbOf('Cube Lad (detailed)', new Float32Array(points), new Uint32Array(triangles));
}
