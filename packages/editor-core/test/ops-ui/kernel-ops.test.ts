// M6A-SPEC §5.7, §5.10, §6.1, §9 B11 (READY-gated on the kernel owners, §3 rule 4): the B11 behaviours with the real
// ops — Extrude adjusted through the capture window after `3` (object mode) on the restored face selection,
// bit-identical to a fresh run; Bevel's `30%` fraction and its Segments adjust without a new step; Insert Edge Loop
// repeated by `G` from an edge of another ring; a paramless repeatable op (Triangulate) repeated on the next selection;
// Triangulate, Conform and Average Vertices on whole meshes in object mode (§6.1 Modes "…, object").
import type { MeshId } from '@ekza-animator/doc';
import { editMeshFrom, type MeshData, primitive, selectionOf } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import type { NumericCapture } from '../../src';
import { createMesh, type MeshTestApp, meshTestApp, positionsOf } from '../mesh/support';
import { enterModel } from './model';
import { READY } from './ready';

const counts = (t: MeshTestApp, id: MeshId): string => {
  const c = t.app.meshes.get(id)?.data()?.counts;
  return c === undefined ? 'none' : `${c.points}/${c.edges}/${c.faces}`;
};

/** The face whose centroid is highest (the cube's top, +Y). */
function topFace(data: MeshData): number {
  const m = editMeshFrom(data);
  let best = -1;
  let bestY = -Infinity;
  for (let f = 0; f < m.counts.faces; f++) {
    let y = 0;
    let n = 0;
    const first = m.faceCorner(f);
    let c = first;
    do {
      y += m.position[3 * m.cornerVert(c) + 1] as number;
      n++;
      c = m.cornerNext(c);
    } while (c !== first);
    if (y / n > bestY + 1e-9) {
      bestY = y / n;
      best = f;
    }
  }
  return best;
}

/** A top edge of the mesh along `axis` (both ends at y = 0.5, apart along the axis). */
function topEdgeAlong(data: MeshData, axis: 'x' | 'z'): number {
  const m = editMeshFrom(data);
  const i = axis === 'x' ? 0 : 2;
  for (let e = 0; e < m.counts.edges; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const ya = m.position[3 * a + 1] as number;
    const yb = m.position[3 * b + 1] as number;
    const da = m.position[3 * a + i] as number;
    const db = m.position[3 * b + i] as number;
    if (ya > 0.49 && yb > 0.49 && Math.abs(da - db) > 0.5) return e;
  }
  throw new Error(`no top edge along ${axis}`);
}

const topEdgeAlongX = (data: MeshData): number => topEdgeAlong(data, 'x');

/** The face whose centroid is lowest (the cube's bottom, −Y). */
function bottomFace(data: MeshData): number {
  const m = editMeshFrom(data);
  let best = -1;
  let bestY = Infinity;
  for (let f = 0; f < m.counts.faces; f++) {
    let y = 0;
    let n = 0;
    const first = m.faceCorner(f);
    let c = first;
    do {
      y += m.position[3 * m.cornerVert(c) + 1] as number;
      n++;
      c = m.cornerNext(c);
    } while (c !== first);
    if (y / n < bestY - 1e-9) {
      bestY = y / n;
      best = f;
    }
  }
  return best;
}

/** Each face's vertex cycle, rotated to start at its lowest vertex (winding kept). */
function faceLoops(data: MeshData): number[][] {
  const m = editMeshFrom(data);
  const out: number[][] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const loop: number[] = [];
    const first = m.faceCorner(f);
    let c = first;
    do {
      loop.push(m.cornerVert(c));
      c = m.cornerNext(c);
    } while (c !== first);
    const at = loop.indexOf(Math.min(...loop));
    out.push([...loop.slice(at), ...loop.slice(0, at)]);
  }
  return out;
}

const dataOf = (t: MeshTestApp, id: MeshId): MeshData => {
  const data = t.app.meshes.get(id)?.data();
  if (data === undefined || data === null) throw new Error(`no data for ${id}`);
  return data;
};

/** Object mode with the cube selected as an object (and hilited, as entering a component mode shows it). */
async function cubeInObjectMode() {
  const t = await meshTestApp();
  await enterModel(t.app);
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  const state = t.app.session.getState();
  t.app.session.setState({
    selection: { ...state.selection, objects: [id] },
    model: { ...state.model, componentMode: 'object', hilite: [id] },
  });
  return { ...t, id };
}

async function cubeIn(mode: 'face' | 'edge', pick: (data: MeshData) => number) {
  const t = await meshTestApp();
  await enterModel(t.app);
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  const data = primitive('cube', {});
  t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: mode, hilite: [id] } });
  t.meshes.select(id, selectionOf(mode, [pick(data)], data.counts));
  return { ...t, id, capture: t.app.capture as NumericCapture };
}

const press = (capture: NumericCapture, text: string): void => {
  for (const ch of text)
    capture.key({ key: ch, code: /\d/.test(ch) ? `Digit${ch}` : 'Period', shift: false, mod: false, alt: false });
  capture.key({ key: 'Enter', code: 'Enter', shift: false, mod: false, alt: false });
};

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const undoLength = (t: MeshTestApp) =>
  (t.app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

describe.skipIf(!READY.b3)('Extrude through the capture window (READY.b3)', () => {
  it('Mod+E, `3`, typed 0.5: re-runs on the restored face selection, one step, bit-identical to a fresh run', async () => {
    const t = await cubeIn('face', topFace);
    await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard', paneId: 'pane-persp' });
    expect(counts(t, t.id)).toBe('12/20/10');
    expect(t.capture.state).toEqual({ armed: 'keyboard-op', field: 'localTranslateZ', text: null });
    const steps = undoLength(t);
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'object' } });
    press(t.capture, '0.5');
    await settle();
    expect(t.app.session.getState().lastRun).toMatchObject({
      id: 'mesh.extrude',
      kind: 'face',
      targets: [t.id],
      closed: null,
      args: { localTranslateZ: 0.5 },
    });
    expect(undoLength(t)).toBe(steps);
    expect(counts(t, t.id)).toBe('12/20/10');
    const f = await cubeIn('face', topFace);
    await f.app.runUntyped('mesh.extrude', { localTranslateZ: 0.5 });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(f, f.id));
    // Divisions 2 through the card: 16/28/14, still one step.
    await t.app.run('edit.adjustLast', { args: { divisions: 2 } });
    expect(counts(t, t.id)).toBe('16/28/14');
    expect(undoLength(t)).toBe(steps);
    t.app.history.undo();
    expect(counts(t, t.id)).toBe('8/12/6');
  });
});

describe.skipIf(!READY.b5)('Bevel and its card (READY.b5)', () => {
  it('Mod+B, typed 30%: fraction 0.3 (10/15/7); Segments 2 without a new step (12/18/8)', async () => {
    const t = await cubeIn('edge', topEdgeAlongX);
    await t.app.runUntyped('mesh.bevel', {}, { source: 'keyboard' });
    expect(t.capture.state.field).toBe('fraction');
    for (const ch of '30%')
      t.capture.key({ key: ch, code: ch === '%' ? 'Digit5' : `Digit${ch}`, shift: ch === '%', mod: false, alt: false });
    t.capture.key({ key: 'Enter', code: 'Enter', shift: false, mod: false, alt: false });
    await settle();
    expect(t.app.session.getState().lastRun?.args['fraction']).toBeCloseTo(0.3, 15);
    expect(counts(t, t.id)).toBe('10/15/7');
    const steps = undoLength(t);
    await t.app.run('edit.adjustLast', { args: { segments: 2 } });
    expect(counts(t, t.id)).toBe('12/18/8');
    expect(undoLength(t)).toBe(steps);
  });
});

describe.skipIf(!READY.b3)('Repeat Last with the real ops (READY.b3)', () => {
  it('a menu-run Insert Edge Loop repeats from the newly selected edge of another ring with the same values', async () => {
    const t = await cubeIn('edge', topEdgeAlongX);
    await t.app.runUntyped('mesh.insertLoop', { weight: 0.3 }, { source: 'menu' });
    expect(counts(t, t.id)).toBe('12/20/10');
    expect(t.app.session.getState().lastRun).toMatchObject({ source: 'menu', args: { weight: 0.3 } });
    // A top edge along Z: its ring crosses the new loop (six quads: top halves, bottom halves, the ±X sides).
    const data = dataOf(t, t.id);
    const seed = topEdgeAlong(data, 'z');
    t.meshes.select(t.id, selectionOf('edge', [seed], data.counts));
    expect((await t.app.run('edit.repeatLast')).status).toBe('finished');
    expect(t.app.session.getState().lastRun).toMatchObject({ args: { weight: 0.3, seedEdge: seed } });
    expect(counts(t, t.id)).toBe('18/32/16');
  });
});

describe.skipIf(!READY.b4)('paramless repeatable ops (READY.b4)', () => {
  it('Triangulate records a LastRun without card fields and repeats by G on the next selection', async () => {
    const t = await cubeIn('face', topFace);
    await t.app.runUntyped('mesh.triangulate', {}, { source: 'menu' });
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.triangulate', params: [], repeatable: true });
    expect(counts(t, t.id)).toBe('8/13/7');
    const data = dataOf(t, t.id);
    t.meshes.select(t.id, selectionOf('face', [bottomFace(data)], data.counts));
    const steps = undoLength(t);
    expect((await t.app.run('edit.repeatLast')).status).toBe('finished');
    expect(counts(t, t.id)).toBe('8/14/8');
    expect(undoLength(t)).toBe(steps + 1);
    expect(t.app.history.peekUndo()?.label).toBe('Triangulate');
  });
});

describe.skipIf(!READY.b4)('whole meshes in object mode (§6.1 Modes "…, object"; READY.b4)', () => {
  it('Triangulate from the Mesh menu in object mode splits every quad of the selected cube', async () => {
    const t = await cubeInObjectMode();
    expect(t.app.operators.poll('mesh.triangulate')).toBe(true);
    expect((await t.app.runUntyped('mesh.triangulate', {}, { source: 'menu' })).status).toBe('finished');
    expect(counts(t, t.id)).toBe('8/18/12');
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.triangulate', kind: null, targets: [t.id] });
  });

  it('Conform in object mode restores a reversed face; positions are untouched', async () => {
    const t = await cubeInObjectMode();
    const original = faceLoops(primitive('cube', {}));
    const model = t.app.session.getState().model;
    t.app.session.setState({ model: { ...model, componentMode: 'face' } });
    t.meshes.select(t.id, selectionOf('face', [0], primitive('cube', {}).counts));
    expect((await t.app.runUntyped('mesh.reverse', {})).status).toBe('finished');
    expect(faceLoops(dataOf(t, t.id))).not.toEqual(original);
    const before = positionsOf(t, t.id);
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'object' } });
    expect((await t.app.runUntyped('mesh.conform', {}, { source: 'menu' })).status).toBe('finished');
    expect(faceLoops(dataOf(t, t.id))).toEqual(original);
    expect(positionsOf(t, t.id)).toEqual(before);
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.conform', kind: null, targets: [t.id] });
  });

  it('Average Vertices in object mode moves every vertex of the mesh, as a whole-mesh script run does', async () => {
    const t = await cubeInObjectMode();
    const before = positionsOf(t, t.id);
    expect((await t.app.runUntyped('mesh.averageVertices', { iterations: 1 }, { source: 'menu' })).status).toBe(
      'finished',
    );
    const after = positionsOf(t, t.id);
    for (let v = 0; v < 8; v++) expect(after.slice(3 * v, 3 * v + 3)).not.toEqual(before.slice(3 * v, 3 * v + 3));
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.averageVertices', kind: null });
    const f = await cubeInObjectMode();
    expect((await f.app.runUntyped('mesh.averageVertices', { iterations: 1, kind: null, meshes: [f.id] })).status).toBe(
      'finished',
    );
    expect(positionsOf(f, f.id)).toEqual(after);
  });
});
