// The Poly Count HUD's numbers (M6A-SPEC §5.24, §8.7; B10), shared by the pane overlay and the test API `hud()`:
// columns Scene (the meshes the pane draws) / Object (the hilited meshes in a component mode, the selected meshes in
// object mode) / Selected (the visible picks of the current kind; in object mode the selected meshes), rows Verts,
// Edges, Faces, Tris (UVs when a mesh has them), the mirrored partners (`40 (+40 sym)`), the mode badge line
// (`FACE · SYM X · SOFT 0.50 m`) and a budget bar on triangles (ok < 90 %, warn 90–100 %, danger > 100 %). Triangle
// counts come from the runtime's triangulation (what export ships, §5.4). Computed on demand, never per frame.
import type { MeshId } from '@ekza-studio/doc';
import {
  componentInternals,
  type EditorApp,
  type MeshRuntime,
  meshBudget,
  objectsDrawnIn,
} from '@ekza-studio/editor-core';
import type { ComponentKind } from '@ekza-studio/mesh-core';

export interface HudCounts {
  vertex: number;
  edge: number;
  face: number;
  tris: number;
  uvs?: number;
}

export type BudgetState = 'ok' | 'warn' | 'danger';

export interface HudData {
  readonly mode: string;
  /** The badge line above the columns, e.g. `FACE · SYM X · SOFT 0.50 m`. */
  readonly badge: string;
  readonly scene: HudCounts;
  readonly object: HudCounts;
  readonly selected: HudCounts;
  readonly selectedSym: HudCounts;
  readonly budget: {
    readonly tris: number;
    readonly limit: number | null;
    readonly state: BudgetState;
    readonly label: string | null;
  };
}

const zero = (): HudCounts => ({ vertex: 0, edge: 0, face: 0, tris: 0 });

/** Budget state of a triangle count (§5.24). */
export function budgetState(tris: number, limit: number | null): BudgetState {
  if (limit === null || limit <= 0) return 'ok';
  const ratio = tris / limit;
  return ratio < 0.9 ? 'ok' : ratio <= 1 ? 'warn' : 'danger';
}

function ready(app: EditorApp, id: MeshId): MeshRuntime | null {
  const runtime = app.meshes.get(id);
  return runtime !== undefined && runtime.state === 'ready' && runtime.data() !== null ? runtime : null;
}

/** Distinct UV points of a mesh (a corner's `uv0` per vertex), or null without UVs. */
function uvCount(runtime: MeshRuntime): number | null {
  const data = runtime.data();
  const uv = data?.layers.get('uv0');
  if (data === null || uv === undefined) return null;
  const seen = new Set<string>();
  for (let c = 0; c < data.counts.corners; c++) {
    seen.add(`${data.cornerVert[c]}:${uv.data[2 * c]}:${uv.data[2 * c + 1]}`);
  }
  return seen.size;
}

function add(into: HudCounts, runtime: MeshRuntime): void {
  const data = runtime.data();
  if (data === null) return;
  into.vertex += data.counts.points;
  into.edge += data.counts.edges;
  into.face += data.counts.faces;
  into.tris += runtime.triangulation().triFace.length;
  const uvs = uvCount(runtime);
  if (uvs !== null) into.uvs = (into.uvs ?? 0) + uvs;
}

/** Triangles of the selected faces (from the triangulation the viewport draws). */
function faceTris(runtime: MeshRuntime, faces: { has(i: number): boolean }): number {
  const triFace = runtime.triangulation().triFace;
  let n = 0;
  for (let t = 0; t < triFace.length; t++) if (faces.has(triFace[t] as number)) n++;
  return n;
}

const AXIS_LABEL = (mode: string): string => mode.replace('object-', '').replace('world-', 'W').toUpperCase();

/** The HUD of a pane, or null outside the Model workspace. */
export function hudData(app: EditorApp, paneId: string): HudData | null {
  const state = app.session.getState();
  if (state.workspace !== 'model') return null;
  const model = state.model;
  const mode = model.componentMode;
  const kind: ComponentKind | null = mode === 'object' ? null : mode;
  const scene = zero();
  const drawn = objectsDrawnIn(app, paneId) as MeshId[];
  for (const id of drawn) {
    const runtime = ready(app, id);
    if (runtime !== null) add(scene, runtime);
  }
  const objects = kind === null ? state.selection.objects.filter((id) => id.startsWith('msh_')) : model.hilite;
  const object = zero();
  for (const id of objects as MeshId[]) {
    const runtime = ready(app, id);
    if (runtime !== null) add(object, runtime);
  }
  let selected = zero();
  const selectedSym = zero();
  const internals = componentInternals(app.components);
  if (kind === null) {
    selected = { ...object };
  } else if (internals !== null) {
    for (const id of model.hilite) {
      const runtime = ready(app, id);
      if (runtime === null) continue;
      const picks = internals.expanded(id, kind) === null ? null : app.components.get(id, kind);
      const mirrored = internals.mirrored(id, kind);
      if (picks !== null) {
        const set = kind === 'vertex' ? picks.verts : kind === 'edge' ? picks.edges : picks.faces;
        selected[kind] += set.count();
        if (kind === 'face') selected.tris += faceTris(runtime, set);
      }
      if (mirrored !== null) {
        const set = kind === 'vertex' ? mirrored.verts : kind === 'edge' ? mirrored.edges : mirrored.faces;
        selectedSym[kind] += set.count();
        if (kind === 'face') selectedSym.tris += faceTris(runtime, set);
      }
    }
  }
  // The budget of the meshes worked on (else the pane's meshes): the first one with a budget sets the limit.
  const targets = (objects.length > 0 ? objects : drawn) as MeshId[];
  let limit: number | null = null;
  let label: string | null = null;
  for (const id of targets) {
    const record = app.store.get('meshes', id);
    const budget = record === undefined ? null : meshBudget(app, record);
    if (budget !== null) {
      limit = budget.tris;
      label = budget.label;
      break;
    }
  }
  const tris = objects.length > 0 ? object.tris : scene.tris;
  const parts = [mode.toUpperCase()];
  const symmetric = new Set<string>();
  for (const id of targets) {
    const settings = model.symmetry.get(id);
    if (settings !== undefined && settings.mode !== 'off') symmetric.add(AXIS_LABEL(settings.mode));
  }
  if (symmetric.size > 0) parts.push(`SYM ${[...symmetric].join('/')}`);
  if (model.softSelect.on) parts.push(`SOFT ${model.softSelect.radius.toFixed(2)} m`);
  return {
    mode,
    badge: parts.join(' · '),
    scene,
    object,
    selected,
    selectedSym,
    budget: { tris, limit, state: budgetState(tris, limit), label },
  };
}
