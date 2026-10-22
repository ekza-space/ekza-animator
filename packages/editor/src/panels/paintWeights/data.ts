// What the Paint Weights panel and the Toolkit's Skin section read (M6B-SPEC §8.7, §8.6; C6; lazy with the panels):
// the target meshes (hilited bound meshes of the active character, else all of them), the union of their influences
// with the number of points each weights, holds, and the weight display mode of the panes.
import type { MeshId } from '@ekza-studio/doc';
import {
  type EditorApp,
  heldKeysOf,
  influencesOf,
  jointName,
  meshKernel,
  paneDisplayPort,
  skinCharacter,
  skinTargets,
} from '@ekza-studio/editor-core';

export interface InfluenceRow {
  readonly key: string;
  readonly name: string;
  /** VRM human bone, or null. */
  readonly humanBone: string | null;
  readonly depth: number;
  /** Points with weight > 0 over the target meshes. */
  readonly count: number;
  readonly held: boolean;
  readonly role: 'bone' | 'helper' | 'prop';
}

/** Points per palette key with weight > 0 on a mesh. */
function counts(app: EditorApp, mesh: MeshId, out: Map<string, number>): void {
  const kernel = meshKernel();
  const data = app.meshes.get(mesh)?.data() ?? null;
  const skin = kernel === null || data === null ? null : kernel.readSkin(data);
  if (skin === null) return;
  for (let v = 0; v < skin.points; v++) {
    for (let k = 0; k < 4; k++) {
      if (!((skin.weights[4 * v + k] as number) > 0)) continue;
      const key = skin.palette[skin.joints[4 * v + k] as number]?.key;
      if (key !== undefined) out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
}

/** The influences of the target meshes, in skeleton order with depth (sort 'hierarchy'), or by name ('alpha'). */
export function influenceRows(app: EditorApp, sort: 'alpha' | 'hierarchy' | 'flat'): InfluenceRow[] {
  const meshes = skinTargets(app);
  const character = skinCharacter(app);
  const held = new Set(heldKeysOf(app, character));
  const byKey = new Map<string, number>();
  for (const mesh of meshes) counts(app, mesh, byKey);
  const keys = influencesOf(app, meshes);
  const depthOf = (key: string): number => {
    let depth = 0;
    let at = app.store.get('joints', key as never);
    while (at?.parent !== null && at?.parent !== undefined && depth < 64) {
      depth++;
      at = app.store.get('joints', at.parent);
    }
    return depth;
  };
  const rows = keys.map((key): InfluenceRow => {
    const record = app.store.get('joints', key as never);
    return {
      key,
      name: jointName(app, key),
      humanBone: record?.humanBone ?? null,
      depth: sort === 'hierarchy' ? depthOf(key) : 0,
      count: byKey.get(key) ?? 0,
      held: held.has(key),
      role: record?.role ?? 'bone',
    };
  });
  if (sort === 'alpha') rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

/** The weight display mode the panes show (the first pane's that is not off), or 'off'. */
export function displayMode(app: EditorApp): 'off' | 'greyscale' | 'ramp' | 'influences' {
  const port = paneDisplayPort(app);
  for (const pane of port?.panes() ?? []) {
    const mode = port?.display(pane)?.weights;
    if (mode !== undefined && mode !== 'off') return mode;
  }
  return 'off';
}

/** Sets the weight display mode of every pane. */
export function setDisplayMode(app: EditorApp, mode: 'off' | 'greyscale' | 'ramp' | 'influences'): void {
  const port = paneDisplayPort(app);
  for (const pane of port?.panes() ?? []) {
    const display = port?.display(pane);
    if (display !== null && display !== undefined && display.weights !== mode)
      port?.setDisplay(pane, { ...display, weights: mode });
  }
}
