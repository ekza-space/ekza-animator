// ① parts of a multi-mesh model (AUTORIG-SPEC §6.1 "Several meshes"; D3) and the `model` slice reducers. Every mesh is
// "Part of the character" by default, except one whose world bounds lie outside the body's — the tallest mesh — (a
// weapon on the floor: "Looks separate"). Unticked meshes stay in the scene, visible and untouched, and are left out of
// `subject.meshes`, so Quick Rig and Create Skeleton adopt only the ticked ones. Reading mesh data is reading a service.
import { quatRotateVec3 } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';

type Box = readonly [readonly [number, number, number], readonly [number, number, number]];

/** World bounds of a top-level scene mesh from its resident data and placement; null while not resident. */
export function meshBounds(app: EditorApp, id: MeshId): Box | null {
  const record = app.store.get('meshes', id);
  const data = app.meshes.get(id)?.data() ?? null;
  if (record === undefined || data === null || data.position.length === 0) return null;
  const { t, q, s } = record.placement;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = data.position;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const w = quatRotateVec3(q, [(p[i] as number) * s[0], (p[i + 1] as number) * s[1], (p[i + 2] as number) * s[2]]);
    for (let k = 0; k < 3; k++) {
      const v = (w[k] as number) + (t[k] as number);
      if (v < (lo[k] as number)) lo[k] = v;
      if (v > (hi[k] as number)) hi[k] = v;
    }
  }
  return [lo, hi];
}

const overlaps = (a: Box, b: Box): boolean =>
  [0, 1, 2].every((k) => (a[0][k] as number) <= (b[1][k] as number) && (b[0][k] as number) <= (a[1][k] as number));

/** The meshes that look separate from the body (the tallest mesh); [] when the data is not resident. */
export function separateMeshes(app: EditorApp, meshes: readonly MeshId[]): MeshId[] {
  if (meshes.length < 2) return [];
  const boxes = meshes.map((id) => [id, meshBounds(app, id)] as const);
  let body: Box | null = null;
  for (const [, box] of boxes) {
    if (box !== null && (body === null || box[1][1] - box[0][1] > body[1][1] - body[0][1])) body = box;
  }
  if (body === null) return [];
  const main = body;
  return boxes.filter(([, box]) => box !== null && box !== main && !overlaps(box, main)).map(([id]) => id);
}

/** The default ticked parts (§6.1): every mesh but the ones that look separate. */
export function defaultParts(app: EditorApp, meshes: readonly MeshId[]): MeshId[] {
  const separate = new Set(separateMeshes(app, meshes));
  return meshes.filter((id) => !separate.has(id));
}

/** Ticks or unticks a part: the `model` slice and the subject's meshes follow (in the intake's order). */
export function setPart(ctx: WizardContext, mesh: MeshId, ticked: boolean): void {
  const state = ctx.session.getState();
  const all = state.intake?.meshes ?? state.subject.meshes;
  const current = new Set(state.model.parts ?? all);
  if (ticked) current.add(mesh);
  else current.delete(mesh);
  const parts = all.filter((id) => current.has(id));
  ctx.session.patch('model', { parts });
  ctx.session.set({ subject: { ...state.subject, meshes: parts } });
}

/** The heavy-model question is asked once per subject (§6.2). */
export function confirmHeavy(ctx: WizardContext): void {
  ctx.session.patch('model', { heavyConfirmed: true });
}
