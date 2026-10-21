// C6's e2e helpers (M6B-SPEC §3 rule 5: content helpers in `helpers/m6b-<package-slug>.ts`): the bound Cube Lad (built
// in Model, Create Skeleton with its truth markers, Bind Skin with the defaults), Skin mode with the Paint Skin Weights
// tool, the joints by human bone, the mirror partner of every point (by position), the posed screen points of the
// visible points (`weightLabels`) and a brush stroke with the mouse.
import { expect, type Page } from '@playwright/test';
import { centreOf, paneRect } from './g1-viewport';
import { buildCubeLad, cubeLadTruth } from './m6b-cube-lad';
import { enterRig, RIG_PERSP_PANE } from './m6b-rig';
import { call, runOk } from './test-api';

const DEG = Math.PI / 180;

export interface BoundLad {
  readonly mesh: string;
  readonly character: string;
  /** JointId by human bone (and by name for joints without one). */
  readonly joint: (bone: string) => string;
  /** The mirror joint of a JointId (left ↔ right by human bone, else itself). */
  readonly mirror: (id: string) => string;
}

/** The Cube Lad as a bound character in Rig & Skin (Object mode). */
export async function boundCubeLad(page: Page): Promise<BoundLad> {
  const mesh = await buildCubeLad(page);
  await enterRig(page);
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  const created = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: cubeLadTruth().markers,
    meshes: [mesh],
    flexion: 2 * DEG,
  });
  await runOk(page, 'skin.bind', {});
  await expect.poll(async () => (await call(page, 'skin', mesh))?.skeleton ?? null).not.toBeNull();
  const skeleton = await call(page, 'skeleton', created.character);
  const byBone = new Map<string, string>();
  const boneOf = new Map<string, string>();
  for (const joint of skeleton?.joints ?? []) {
    byBone.set(joint.humanBone ?? joint.name, joint.id);
    boneOf.set(joint.id, joint.humanBone ?? joint.name);
  }
  const joint = (bone: string): string => {
    const id = byBone.get(bone);
    if (id === undefined) throw new Error(`No joint for ${bone}`);
    return id;
  };
  const mirror = (id: string): string => {
    const bone = boneOf.get(id) ?? '';
    const swapped = bone.startsWith('left')
      ? `right${bone.slice(4)}`
      : bone.startsWith('right')
        ? `left${bone.slice(5)}`
        : bone;
    return byBone.get(swapped) ?? id;
  };
  return { mesh, character: created.character, joint, mirror };
}

/** Hovers the perspective pane (the keymap's scope chain follows the pointer). */
export async function hoverPersp(page: Page): Promise<void> {
  const at = centreOf(await paneRect(page, RIG_PERSP_PANE));
  await page.mouse.move(at.x, at.y);
}

/** Skin mode (`2`) with the Paint Skin Weights tool and the weight display on. */
export async function enterSkin(page: Page): Promise<void> {
  await hoverPersp(page);
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skin');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('paintSkinWeights');
  await expect.poll(async () => (await call(page, 'paint')).display).not.toBe('off');
}

/** Local positions of the mesh's points. */
export async function positionsOf(page: Page, mesh: string): Promise<number[][]> {
  return await call(page, 'meshPositions', mesh, undefined, 'local');
}

/** The mirror partner of every point by position ((−x, y, z) within 1e-5), −1 when none. */
export function partnersOf(positions: readonly (readonly number[])[]): number[] {
  return positions.map((p) => {
    const found = positions.findIndex(
      (q) =>
        Math.abs((q[0] as number) + (p[0] as number)) < 1e-5 &&
        Math.abs((q[1] as number) - (p[1] as number)) < 1e-5 &&
        Math.abs((q[2] as number) - (p[2] as number)) < 1e-5,
    );
    return found;
  });
}

/** The points inside a Cube Lad truth box (by name), from local positions. */
export function boxPoints(positions: readonly (readonly number[])[], name: string): number[] {
  const box = cubeLadTruth().boxes.find((candidate) => candidate.name === name);
  if (box === undefined) throw new Error(`No box ${name}`);
  const out: number[] = [];
  positions.forEach((p, v) => {
    const inside = [0, 1, 2].every(
      (k) => Math.abs((p[k] as number) - (box.center[k] as number)) <= (box.size[k] as number) / 2 + 1e-5,
    );
    if (inside) out.push(v);
  });
  return out;
}

/** The screen centroid (page px) of the visible points of a set in a pane, posed (`weightLabels`). */
export async function screenCentroid(
  page: Page,
  mesh: string,
  points: readonly number[],
  paneId: string = RIG_PERSP_PANE,
): Promise<{ x: number; y: number }> {
  const wanted = new Set(points);
  let at: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      const labels = (await call(page, 'weightLabels', paneId)).filter(
        (label) => label.mesh === mesh && wanted.has(label.point),
      );
      if (labels.length === 0) return false;
      at = {
        x: labels.reduce((sum, label) => sum + label.x, 0) / labels.length,
        y: labels.reduce((sum, label) => sum + label.y, 0) / labels.length,
      };
      return true;
    })
    .toBe(true);
  return at as unknown as { x: number; y: number };
}

/** A brush stroke: press at `from`, move in small steps by (dx, dy), release. */
export async function stroke(page: Page, from: { x: number; y: number }, dx = 12, dy = 0): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 4;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  await page.mouse.up();
}

/** joint key → weight per point. */
export async function weightMaps(page: Page, mesh: string): Promise<Map<string, number>[]> {
  const rows = await call(page, 'weights', mesh);
  return rows.map((row) => new Map(row.joints.map((key, k) => [key, row.weights[k] as number])));
}

/** Points whose vector is not the mirror image of their partner's (`w(p(v)) = M(w(v))`, within 1e-6). */
export function asymmetricPoints(
  maps: readonly Map<string, number>[],
  partners: readonly number[],
  mirror: (id: string) => string,
  points?: readonly number[],
): number[] {
  const out: number[] = [];
  for (const v of points ?? maps.map((_, i) => i)) {
    const p = partners[v] ?? -1;
    if (p < 0) continue;
    const own = maps[v] as Map<string, number>;
    const other = maps[p] as Map<string, number>;
    const image = new Map([...own].map(([key, w]) => [mirror(key), w]));
    const same =
      image.size === other.size && [...image].every(([key, w]) => Math.abs((other.get(key) ?? -1) - w) <= 1e-6);
    if (!same) out.push(v);
  }
  return out;
}
