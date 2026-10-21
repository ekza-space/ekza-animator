// M6A-SPEC §5.8, §9 B12b (READY-gated on B3's Extrude, §3 rule 4): the extrude session — opening after an extrude,
// absorbing drags into the `local*` args exactly from any manipulator space (a 30°-tilted face dragged on world Y moves
// along world Y; rotations compose about the cap's pivot; scale in the session frame), the args undo stack (undo steps
// back through absorbed drags without changing the history length; undo at index 0 removes the extrude), every row of
// the end-trigger table with its zero-drop (a mode switch keeps a zero extrude), smart extrude chains, `T`'s reopen.
import { type Quat, quatFromAxisAngle, quatRotateVec3, type ReadonlyXf, type Vec3 } from '@ekza-studio/anim-core';
import type { MeshRecord } from '@ekza-studio/doc';
import { borderChainFrame, editMeshFrom, type MeshData, primitive } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  absorbArgs,
  beginSmartExtrude,
  EXTRUDE_REMOVED,
  type ExtrudeSessionShim,
  extrudeManipulatorFrame,
  isIdentityExtrude,
  manipulatorFrame,
  type OperatorDef,
  onModelHelp,
  worldPlacement,
} from '../../src';
import { READY } from '../ops-ui/ready';
import {
  counts,
  dataOf,
  faceCentroid,
  faceVerts,
  type ModelTest,
  modelWith,
  position,
  settle,
  tiltedCube,
  topFace,
  undoLabels,
} from './support';

const shim = (t: ModelTest): ExtrudeSessionShim => t.app.extrude as ExtrudeSessionShim;

/** World position of a vertex of the mesh (through its placement). */
function worldOf(t: ModelTest, v: number): Vec3 {
  const record = t.app.store.get('meshes', t.id) as MeshRecord;
  const xf = worldPlacement(t.app.store, record);
  const p = position(dataOf(t, t.id), v);
  const scaled: Vec3 = [p[0] * xf.s[0], p[1] * xf.s[1], p[2] * xf.s[2]];
  const r = quatRotateVec3(xf.q, scaled);
  return [r[0] + xf.t[0], r[1] + xf.t[1], r[2] + xf.t[2]];
}

const expectVec = (actual: readonly number[], expected: readonly number[], digits = 6): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i] as number, digits));
};

/** A cube in face mode with its top face selected, extruded from the keyboard (`Mod+E`). */
async function extruded(args: Record<string, unknown> = {}): Promise<ModelTest & { readonly cap: number }> {
  const t = await modelWith('face', topFace);
  const cap = topFace(dataOf(t, t.id))[0] as number;
  const result = await t.app.runUntyped('mesh.extrude', args, { source: 'keyboard', paneId: 'pane-persp' });
  expect(result.status).toBe('finished');
  await settle();
  return { ...t, cap };
}

/** Absorbs one drag and waits for its `edit.adjustLast`. */
async function drag(
  t: ModelTest,
  delta: Parameters<NonNullable<ReturnType<ExtrudeSessionShim['beginAbsorb']>>['update']>[0],
  tool: 'move' | 'rotate' | 'scale' = 'move',
): Promise<void> {
  const gesture = t.app.extrude.beginAbsorb(tool, 'world');
  expect(gesture).not.toBeNull();
  gesture?.update(delta);
  gesture?.commit();
  await settle();
}

const argsNow = (t: ModelTest): Record<string, unknown> => ({ ...t.app.session.getState().lastRun?.args });

describe('the zero-drop identity (§5.8)', () => {
  it('every local*, offset and thickness at identity; Divisions and the flags do not count', () => {
    expect(isIdentityExtrude({ localTranslateZ: 0, localScaleX: 1, divisions: 3, keepFacesTogether: false })).toBe(
      true,
    );
    expect(isIdentityExtrude({ localTranslateZ: 0.1 })).toBe(false);
    expect(isIdentityExtrude({ localScaleY: 0.5 })).toBe(false);
    expect(isIdentityExtrude({ offset: 0.01 })).toBe(false);
    expect(isIdentityExtrude({ thickness: -0.2 })).toBe(false);
  });

  it('absorbArgs: a world move of a mesh-local frame converts through the placement and the frame', () => {
    const frame = {
      pivot: [0, 0.5, 0] as Vec3,
      axes: [
        [1, 0, 0],
        [0, 0, -1],
        [0, 1, 0],
      ] as [Vec3, Vec3, Vec3],
    };
    const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const args = absorbArgs({}, { translate: [0, 2, 0] }, frame, { t: [5, 0, 0], q, s: [2, 2, 2] });
    // World +Y is mesh-local +X (the placement turns local +X to world +Y) at half the length (scale 2).
    expect(args['localTranslateX']).toBeCloseTo(1, 12);
    expect(args['localTranslateY']).toBeCloseTo(0, 12);
    expect(args['localTranslateZ']).toBeCloseTo(0, 12);
    const world = absorbArgs({ space: 'world' }, { translate: [0, 2, 0] }, frame, { t: [5, 0, 0], q, s: [2, 2, 2] });
    expect(world).toMatchObject({ localTranslateX: 0, localTranslateY: 2, localTranslateZ: 0 });
  });
  it('absorbArgs and manipulatorFrame of a mirrored partner: the source frame with the reflected delta (§5.14)', () => {
    // The +X face's frame carried by the −X cap (Object X): the kernel moves the −X cap with S ∘ T ∘ S.
    const frame = {
      pivot: [0.5, 0, 0] as Vec3,
      axes: [
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 0],
      ] as [Vec3, Vec3, Vec3],
      mirror: { m: [-1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] as [number, number, number] },
    };
    const xf = { t: [0, 0, 0] as Vec3, q: [0, 0, 0, 1] as Quat, s: [1, 1, 1] as Vec3 };
    // World +Z on the −X cap is the frame's +Y; world +X (out of the +X cap's mirror) is its −Z.
    expect(absorbArgs({}, { translate: [0, 0, 0.3] }, frame, xf)['localTranslateY']).toBeCloseTo(0.3, 12);
    expect(absorbArgs({}, { translate: [0.3, 0, 0] }, frame, xf)['localTranslateZ']).toBeCloseTo(-0.3, 12);
    // A rotation about the mirror's normal (world X) reflects to itself: about the source frame's Z, localRotateZ +θ.
    const rotated = absorbArgs({}, { rotate: quatFromAxisAngle([1, 0, 0], 0.2) }, frame, xf);
    expect(rotated['localRotateZ']).toBeCloseTo(0.2, 12);
    expect(rotated['localRotateX']).toBeCloseTo(0, 12);
    // The manipulator sits on the −X cap in the reflected frame (left-handed: Z is the −X cap's normal).
    const at = manipulatorFrame({ localTranslateZ: 0.25 }, frame, xf, 'local');
    expectVec(at.pivot, [-0.75, 0, 0]);
    expectVec(at.axes[0], [0, 1, 0]);
    expectVec(at.axes[1], [0, 0, 1]);
    expectVec(at.axes[2], [-1, 0, 0]);
    expect(manipulatorFrame({}, frame, xf, 'world').axes).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
  it('absorbArgs: R handles drawn along world axes scale the cap along those axes, not the same-named arg (M6A-INT-48)', () => {
    const xf = { t: [0, 0, 0] as Vec3, q: [0, 0, 0, 1] as Quat, s: [1, 1, 1] as Vec3 };
    const world: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    // A top cap: frame X is world Z, Y world X, Z (the normal) world Y.
    const top = {
      pivot: [0, 0.5, 0] as Vec3,
      axes: [
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ] as [Vec3, Vec3, Vec3],
    };
    const wide = absorbArgs({}, { scale: [1.5, 1, 1], scaleAxes: world }, top, xf);
    expect(wide['localScaleY']).toBeCloseTo(1.5, 12);
    expect(wide['localScaleX']).toBeCloseTo(1, 12);
    expect(wide['localScaleZ']).toBeCloseTo(1, 12);
    // Without the axes the factors are the cap's own (the extrude manipulator's scale handles).
    expect(absorbArgs({}, { scale: [1.5, 1, 1] }, top, xf)['localScaleX']).toBeCloseTo(1.5, 12);
    // A +X cap: the world Z handle flattens the cap along Z, never its normal.
    const side = {
      pivot: [0.5, 0, 0] as Vec3,
      axes: [
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 0],
      ] as [Vec3, Vec3, Vec3],
    };
    const flat = absorbArgs({}, { scale: [1, 1, 0] }, side, xf);
    expect(flat['localScaleZ']).toBe(0);
    const flatWorld = absorbArgs({}, { scale: [1, 1, 0], scaleAxes: world }, side, xf);
    expect(flatWorld['localScaleY']).toBeCloseTo(0, 12);
    expect(flatWorld['localScaleZ']).toBeCloseTo(1, 12);
    // The mirrored partner (left-handed frame on the −X cap): world Y still scales the frame's X.
    const mirrored = { ...side, mirror: { m: [-1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] as [number, number, number] } };
    const up = absorbArgs({}, { scale: [1, 2, 1], scaleAxes: world }, mirrored, xf);
    expect(up['localScaleX']).toBeCloseTo(2, 12);
    expect(up['localScaleZ']).toBeCloseTo(1, 12);
  });
});

describe.skipIf(!READY.b3)('the extrude session (§5.8; READY.b3)', () => {
  it('opens after Mod+E on the frame of the faces, with the args stack, mirrored in session.model', async () => {
    const t = await extruded();
    expect(counts(t, t.id)).toBe('12/20/10');
    const state = t.app.extrude.state;
    expect(state).not.toBeNull();
    expect(state?.meshes).toEqual([t.id]);
    expect(state?.index).toBe(0);
    expect(state?.stack).toHaveLength(1);
    expect(state?.manipSpace).toBe('local');
    expectVec(state?.frame.pivot ?? [], [0, 0.5, 0]);
    expectVec(state?.frame.axes[2] ?? [], [0, 1, 0]);
    expect(state?.stepId).toBe(t.app.history.peekUndo()?.id);
    expect(t.app.session.getState().model.extrudeSession).toBe(state);
  });

  it('a menu run, the Toolkit and G open one too; the card and an adjusted re-run do not open a new one', async () => {
    const t = await modelWith('face', topFace);
    await t.app.runUntyped('mesh.extrude', { localTranslateZ: 0.2 }, { source: 'menu' });
    const first = t.app.extrude.state;
    expect(first).not.toBeNull();
    await t.app.run('edit.adjustLast', { args: { localTranslateZ: 0.3 } });
    await settle();
    // The same session, one more entry on its stack, its step id following the re-run.
    expect(t.app.extrude.state?.stack.map((a) => a['localTranslateZ'])).toEqual([0.2, 0.3]);
    expect(t.app.extrude.state?.stepId).toBe(t.app.history.peekUndo()?.id);
    // G: another extrude ends this session (it moved: no drop) and opens a new one.
    await t.app.run('edit.repeatLast', undefined, { source: 'keyboard' });
    await settle();
    expect(counts(t, t.id)).toBe('16/28/14');
    expect(t.app.extrude.state?.stack).toHaveLength(1);
    expect(undoLabels(t)).toEqual(['Extrude (adjusted)', 'Extrude']);
  });

  it('W in World on a 30°-tilted face: a world-Y drag moves the cap exactly along world Y (1e-6)', async () => {
    const data = tiltedCube(Math.PI / 6);
    const t = await modelWith('face', topFace, data);
    const cap = topFace(data)[0] as number;
    await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' });
    await settle();
    // The cap keeps the face index; its corners are the new vertices.
    const verts = faceVerts(dataOf(t, t.id), cap);
    const before = verts.map((v) => worldOf(t, v));
    await drag(t, { translate: [0, 0.4, 0] });
    expect(t.app.extrude.state).not.toBeNull();
    const after = verts.map((v) => worldOf(t, v));
    after.forEach((p, i) => expectVec(p, [before[i]?.[0] ?? 0, (before[i]?.[1] ?? 0) + 0.4, before[i]?.[2] ?? 0]));
    // The args hold the move in the face's frame: mostly along its normal, some along its Y (the tilt).
    const args = argsNow(t);
    expect(args['localTranslateZ']).toBeCloseTo(0.4 * Math.cos(Math.PI / 6), 9);
  });

  it('the same through a rotated, scaled placement (the conversion goes through the placement)', async () => {
    const q = quatFromAxisAngle([0, 0, 1], -0.4);
    const t = await modelWith('face', topFace, primitive('cube', {}), {
      placement: { t: [1, 2, 3], q, s: [2, 2, 2] },
    });
    const cap = topFace(primitive('cube', {}))[0] as number;
    await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' });
    await settle();
    const verts = faceVerts(dataOf(t, t.id), cap);
    const before = verts.map((v) => worldOf(t, v));
    await drag(t, { translate: [0, 0.5, 0] });
    const after = verts.map((v) => worldOf(t, v));
    expect(after).toHaveLength(4);
    after.forEach((p, i) => expectVec(p, [before[i]?.[0] ?? 0, (before[i]?.[1] ?? 0) + 0.5, before[i]?.[2] ?? 0]));
  });

  it('rotation composition: two world rotations rotate the cap about its pivot, in order', async () => {
    const t = await extruded({ localTranslateZ: 0.5 });
    const verts = faceVerts(dataOf(t, t.id), t.cap);
    const pivot: Vec3 = [0, 1, 0];
    const start = verts.map((v) => worldOf(t, v));
    const q1 = quatFromAxisAngle([1, 0, 0], 0.3);
    const q2 = quatFromAxisAngle([0, 0, 1], -0.5);
    await drag(t, { rotate: q1 }, 'rotate');
    await drag(t, { rotate: q2 }, 'rotate');
    const rotate = (q: Quat, p: Vec3): Vec3 => {
      const r = quatRotateVec3(q, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
      return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
    };
    const after = verts.map((v) => worldOf(t, v));
    after.forEach((p, i) => expectVec(p, rotate(q2, rotate(q1, start[i] as Vec3))));
    expect(t.app.extrude.state?.stack).toHaveLength(3);
  });

  it('scale uses the session frame: cap edges take localScaleX/Y', async () => {
    const t = await extruded();
    await drag(t, { scale: [0.5, 0.5, 1] }, 'scale');
    const args = argsNow(t);
    expect(args['localScaleX']).toBeCloseTo(0.5, 12);
    expect(args['localScaleY']).toBeCloseTo(0.5, 12);
    const verts = faceVerts(dataOf(t, t.id), t.cap);
    const a = position(dataOf(t, t.id), verts[0] as number);
    const b = position(dataOf(t, t.id), verts[1] as number);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(0.5, 6);
  });

  it('the args stack (E2E-MOD-17 flow): undo steps back through the drag and Divisions, then removes the extrude', async () => {
    const t = await extruded();
    await drag(t, { scale: [0.5, 0.5, 1] }, 'scale');
    await t.app.run('edit.adjustLast', { args: { divisions: 2 } });
    await settle();
    expect(counts(t, t.id)).toBe('16/28/14');
    const steps = undoLabels(t).length;
    expect(t.app.extrude.state?.stack).toHaveLength(3);
    // First undo: Divisions back to 1 with the drag's scale kept; the session stays open, history length unchanged.
    await t.app.run('edit.undo');
    await settle();
    expect(counts(t, t.id)).toBe('12/20/10');
    expect(argsNow(t)['localScaleX']).toBeCloseTo(0.5, 12);
    expect(t.app.extrude.state?.index).toBe(1);
    expect(undoLabels(t).length).toBe(steps);
    // Second: the scale back to 1.
    await t.app.run('edit.undo');
    await settle();
    expect(argsNow(t)['localScaleX']).toBe(1);
    expect(counts(t, t.id)).toBe('12/20/10');
    expect(t.app.extrude.state?.index).toBe(0);
    expect(undoLabels(t).length).toBe(steps);
    // Redo steps forward again (scale 0.5), and back.
    await t.app.run('edit.redo');
    await settle();
    expect(argsNow(t)['localScaleX']).toBeCloseTo(0.5, 12);
    await t.app.run('edit.undo');
    await settle();
    // Third (at index 0): the extrude itself is undone and the session ends.
    await t.app.run('edit.undo');
    await settle();
    expect(counts(t, t.id)).toBe('8/12/6');
    expect(t.app.extrude.state).toBeNull();
    expect(undoLabels(t).length).toBe(steps - 1);
  });

  it('a new entry above the index drops the entries above it (like redo)', async () => {
    const t = await extruded();
    await drag(t, { translate: [0, 0.1, 0] });
    await drag(t, { translate: [0, 0.1, 0] });
    await t.app.run('edit.undo');
    await settle();
    expect(t.app.extrude.state?.index).toBe(1);
    await t.app.run('edit.adjustLast', { args: { divisions: 3 } });
    await settle();
    expect(t.app.extrude.state?.stack).toHaveLength(3);
    expect(t.app.extrude.state?.stack[2]?.['divisions']).toBe(3);
    expect(t.app.extrude.state?.stack[2]?.['localTranslateZ']).toBeCloseTo(0.1, 9);
  });

  describe('what ends the session (§5.8 table)', () => {
    it('Esc with no drag: ends with the zero-drop, a toast with Undo (edit.redo) and the help line', async () => {
      const t = await extruded();
      const help: string[] = [];
      onModelHelp(t.app, (m) => help.push(m.text));
      await t.app.run('edit.escape');
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('8/12/6');
      expect(t.services.toasts.at(-1)).toMatchObject({
        text: EXTRUDE_REMOVED,
        action: { label: 'Undo', op: 'edit.redo' },
      });
      expect(help).toContain(EXTRUDE_REMOVED);
      // The toast's Undo brings it back while the redo entry exists.
      const action = t.services.toasts.at(-1)?.action;
      expect((await t.app.runUntyped(action?.op ?? 'edit.redo', action?.args)).status).toBe('finished');
      expect(counts(t, t.id)).toBe('12/20/10');
    });

    it("the toast's Undo restores the dropped extrude only while its redo entry is the top one", async () => {
      const t = await modelWith('face', topFace);
      const top = topFace(dataOf(t, t.id));
      // The user's earlier selection steps.
      await t.app.runUntyped('select.components', { mesh: t.id, kind: 'face', indices: [0], mode: 'replace' });
      await t.app.runUntyped('select.components', { mesh: t.id, kind: 'face', indices: top, mode: 'replace' });
      await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' });
      await settle();
      await t.app.run('edit.escape');
      expect(counts(t, t.id)).toBe('8/12/6');
      const action = t.services.toasts.at(-1)?.action;
      expect(action).toMatchObject({ label: 'Undo', op: 'edit.redo' });
      if (action === undefined) throw new Error('no toast action');
      expect(typeof (action.args as { readonly step?: unknown } | undefined)?.step).toBe('number');
      // An undo of the earlier "Select": the top redo entry is that selection now, not the extrude.
      await t.app.run('edit.undo');
      const selection = Array.from(t.app.components.get(t.id, 'face').faces.toArray());
      expect(selection).toEqual([0]);
      expect(await t.app.runUntyped(action.op, action.args)).toEqual({
        status: 'cancelled',
        reason: 'Nothing to restore',
      });
      expect(counts(t, t.id)).toBe('8/12/6');
      expect(Array.from(t.app.components.get(t.id, 'face').faces.toArray())).toEqual(selection);
      // Redo the selection by hand: the extrude's entry is the top one again and the toast's Undo restores it.
      await t.app.run('edit.redo');
      expect((await t.app.runUntyped(action.op, action.args)).status).toBe('finished');
      expect(counts(t, t.id)).toBe('12/20/10');
    });

    it('Esc after a drag ends without dropping', async () => {
      const t = await extruded();
      await drag(t, { translate: [0, 0.2, 0] });
      await t.app.run('edit.escape');
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('12/20/10');
    });

    it('a selection change in the same mode drops it before the click reads the mesh', async () => {
      const t = await extruded();
      const side = faceVerts(dataOf(t, t.id), 0).length > 0 ? 0 : 1;
      await t.app.runUntyped('select.components', { mesh: t.id, kind: 'face', indices: [side], mode: 'replace' });
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('8/12/6');
    });

    it('another undoable operator drops it first: Inset then runs on the same faces', async () => {
      const t = await extruded();
      expect((await t.app.runUntyped('mesh.inset', {}, { source: 'menu' })).status).toBe('finished');
      expect(t.app.extrude.state).toBeNull();
      expect(undoLabels(t)).toEqual(['Inset']);
      expect(counts(t, t.id)).toBe('12/20/10');
    });

    it('a workspace switch drops it', async () => {
      const t = await extruded();
      await t.app.run('workspace.set', { workspace: 'animate' });
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('8/12/6');
    });

    it('a remote change to a target mesh drops it (after the store has emitted)', async () => {
      const t = await extruded();
      const record = t.app.store.get('meshes', t.id) as MeshRecord;
      t.app.store.applyChanges(
        [{ table: 'meshes', id: t.id, before: record, after: { ...record, name: 'Peer' }, fields: ['name'] }],
        { origin: 'remote', label: 'Peer rename' },
      );
      expect(t.app.extrude.state).toBeNull();
      await settle();
      expect(counts(t, t.id)).toBe('8/12/6');
    });

    it('a component-mode switch ends it without the zero-drop (Maya users press 1 to pull cap vertices)', async () => {
      const t = await extruded();
      await t.app.run('select.mode', { mode: 'vertex' });
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('12/20/10');
      expect(t.services.toasts.some((toast) => toast.text === EXTRUDE_REMOVED)).toBe(false);
    });

    it('a pivot edit ends it without the zero-drop', async () => {
      const t = await extruded();
      // Through the runner first: B12a's Edit Pivot is registered, but while it is B0a's stub its poll fails ("not
      // available yet") and the runner's hook runs only after a passing poll (a refused operator starts no gesture),
      // so the session stays open; once B12a's operator lands, this run itself ends the session (no drop either way).
      expect(t.app.operators.get('model.pivot.editToggle')).toBeDefined();
      const ran = await t.app.runUntyped('model.pivot.editToggle', undefined, { source: 'keyboard' });
      expect(t.app.extrude.state === null).toBe(ran.status === 'finished');
      expect(counts(t, t.id)).toBe('12/20/10');
      // The hook by the operator's id (what the landed operator reaches through the runner): ends it, no drop.
      const engine = shim(t).engine();
      const pivot: OperatorDef<unknown, unknown, unknown> = {
        id: 'model.pivot.editToggle',
        label: 'Edit Pivot',
        category: 'model',
        scope: 'model',
        apply: () => {},
      };
      engine?.beforeRun(pivot, {}, undefined);
      expect(t.app.extrude.state).toBeNull();
      expect(counts(t, t.id)).toBe('12/20/10');
    });

    it('view.*, ui.*, tool switches, T, typed values and card edits keep it open', async () => {
      const t = await extruded();
      await t.app.run('view.tool', { panel: 'viewport', tool: 'move' });
      await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true });
      await t.app.runUntyped('view.shading', { mode: 'wire', paneId: 'pane-persp' });
      await t.app.run('edit.adjustLast', { args: { localTranslateZ: 0.25 } });
      await settle();
      expect(t.app.extrude.state).not.toBeNull();
      expect(t.app.extrude.state?.stack).toHaveLength(2);
    });

    it('a zero extrude is not dropped while the session is open (Divisions may still change)', async () => {
      const t = await extruded();
      await t.app.run('edit.adjustLast', { args: { divisions: 2 } });
      await settle();
      expect(counts(t, t.id)).toBe('16/28/14');
      expect(t.app.extrude.state).not.toBeNull();
    });
  });

  it('T reopens a live extrude whose result is still the selection (the memo keeps its frame)', async () => {
    const t = await extruded({ localTranslateZ: 0.3 });
    const frame = t.app.extrude.state?.frame;
    t.app.extrude.end('test', { drop: false });
    expect(t.app.extrude.state).toBeNull();
    await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true });
    expect(t.app.extrude.state).not.toBeNull();
    expect(t.app.extrude.state?.frame).toEqual(frame);
  });

  describe('border-edge chains (§5.8 step 7: the session frame is the kernel chain frame)', () => {
    /** A 2 × 2 plane (3 × 3 vertices in XZ, facing +Y). */
    const grid = (): MeshData =>
      primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 });

    /** The edge joining the vertices at `a` and `b`. */
    function edgeBetween(data: MeshData, a: Vec3, b: Vec3): number {
      const at = (v: number, p: Vec3): boolean => {
        const q = position(data, v);
        return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-9;
      };
      for (let e = 0; e < data.counts.edges; e++) {
        const u = data.edgeVerts[2 * e] as number;
        const w = data.edgeVerts[2 * e + 1] as number;
        if ((at(u, a) && at(w, b)) || (at(u, b) && at(w, a))) return e;
      }
      throw new Error(`no edge ${a.join(',')} – ${b.join(',')}`);
    }

    const chains: readonly { readonly name: string; readonly ends: readonly [Vec3, Vec3][]; readonly pivot: Vec3 }[] = [
      {
        name: 'an L-shaped chain round a corner',
        ends: [
          [
            [-1, 0, -1],
            [0, 0, -1],
          ],
          [
            [-1, 0, -1],
            [-1, 0, 0],
          ],
        ],
        pivot: [-0.75, 0, -0.75],
      },
      {
        name: 'a straight two-edge chain',
        ends: [
          [
            [-1, 0, -1],
            [0, 0, -1],
          ],
          [
            [0, 0, -1],
            [1, 0, -1],
          ],
        ],
        pivot: [0, 0, -1],
      },
    ];

    for (const chain of chains) {
      it(`${chain.name}: the pivot is the kernel's, world drags move the outer edges exactly by their delta`, async () => {
        const data = grid();
        const edges = chain.ends.map(([a, b]) => edgeBetween(data, a, b));
        const t = await modelWith('edge', () => edges, data);
        const kernel = borderChainFrame(editMeshFrom(data), edges);
        expectVec(kernel?.pivot ?? [], chain.pivot);
        // Interior edges are not border edges (an extrude with one refuses): no chain, no frame.
        expect(borderChainFrame(editMeshFrom(data), [edgeBetween(data, [0, 0, -1], [0, 0, 0])])).toBeNull();
        expect((await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' })).status).toBe('finished');
        await settle();
        expect(counts(t, t.id)).toBe('12/17/6');
        expectVec(extrudeManipulatorFrame(t.app)?.pivot ?? [], chain.pivot);
        expectVec(t.app.extrude.state?.frame.pivot ?? [], chain.pivot);
        kernel?.axes.forEach((axis, i) => expectVec(t.app.extrude.state?.frame.axes[i] ?? [], axis));
        // The new (outer) vertices: one per chain vertex, at the chain's vertices with identity args.
        const outer = [9, 10, 11];
        const start = outer.map((v) => worldOf(t, v));
        const moved: Vec3 = [0, 0, 0];
        for (const delta of [
          [0.3, 0, 0],
          [0, 0.25, 0],
          [0, 0, -0.2],
        ] as Vec3[]) {
          await drag(t, { translate: delta });
          moved[0] += delta[0];
          moved[1] += delta[1];
          moved[2] += delta[2];
          outer.forEach((v, i) => {
            const p = start[i] as Vec3;
            expectVec(worldOf(t, v), [p[0] + moved[0], p[1] + moved[1], p[2] + moved[2]]);
          });
        }
        expect(t.app.extrude.state?.stack).toHaveLength(4);
      });
    }
  });

  describe('under symmetry, a picked mirrored partner (§5.8 step 4, §5.14: the session follows the reflected frame)', () => {
    const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

    /** Object X symmetry on the test mesh (the runs and the session read it from the session state). */
    function objectX(t: ModelTest): void {
      const model = t.app.session.getState().model;
      t.app.session.setState({
        model: {
          ...model,
          symmetry: new Map([[t.id, { mode: 'object-x' as const, tolerance: 0.001, preserveSeam: true }]]),
        },
      });
    }

    /** The world mirror of a world point: placement ∘ (local x ↦ −x) ∘ placement⁻¹ (scale uniform in these tests). */
    function mirrorWorld(xf: ReadonlyXf, p: Vec3): Vec3 {
      const s = xf.s[0];
      const inv: Quat = [-xf.q[0], -xf.q[1], -xf.q[2], xf.q[3]];
      const l = quatRotateVec3(inv, [(p[0] - xf.t[0]) / s, (p[1] - xf.t[1]) / s, (p[2] - xf.t[2]) / s]);
      const w = quatRotateVec3(xf.q, [-l[0] * s, l[1] * s, l[2] * s]);
      return [w[0] + xf.t[0], w[1] + xf.t[1], w[2] + xf.t[2]];
    }

    /** Every point of `actual` matches one point of `expected` (1e-6), and back. */
    function expectSameSet(actual: readonly Vec3[], expected: readonly Vec3[]): void {
      expect(actual).toHaveLength(expected.length);
      const near = (a: Vec3, b: Vec3): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
      for (const p of expected)
        expect(
          actual.some((q) => near(p, q)),
          `missing ${p.join(', ')}`,
        ).toBe(true);
      for (const q of actual)
        expect(
          expected.some((p) => near(p, q)),
          `unexpected ${q.join(', ')}`,
        ).toBe(true);
    }

    const rotateAbout = (q: Quat, pivot: Vec3, p: Vec3): Vec3 => {
      const r = quatRotateVec3(q, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]);
      return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
    };

    /**
     * World drags on X, Y and Z, then a world rotation about the moved pivot: the picked group's new vertices move by
     * exactly each delta, its source group's by the delta's mirror.
     */
    async function dragsFollowTheMirror(
      t: ModelTest,
      picked: readonly number[],
      source: readonly number[],
      xf: ReadonlyXf,
    ): Promise<void> {
      const start = picked.map((v) => worldOf(t, v));
      const pivot0 = extrudeManipulatorFrame(t.app)?.pivot ?? [0, 0, 0];
      const moved: Vec3 = [0, 0, 0];
      for (const delta of [
        [0.3, 0, 0],
        [0, 0.25, 0],
        [0, 0, 0.3],
      ] as Vec3[]) {
        await drag(t, { translate: delta });
        moved[0] += delta[0];
        moved[1] += delta[1];
        moved[2] += delta[2];
        const now = picked.map((v) => worldOf(t, v));
        now.forEach((p, i) => {
          const s = start[i] as Vec3;
          expectVec(p, [s[0] + moved[0], s[1] + moved[1], s[2] + moved[2]]);
        });
        expectSameSet(
          source.map((v) => worldOf(t, v)),
          now.map((p) => mirrorWorld(xf, p)),
        );
        // The manipulator sits on the picked group and moves with it.
        expectVec(extrudeManipulatorFrame(t.app)?.pivot ?? [], [
          pivot0[0] + moved[0],
          pivot0[1] + moved[1],
          pivot0[2] + moved[2],
        ]);
      }
      const pivot = extrudeManipulatorFrame(t.app)?.pivot ?? [0, 0, 0];
      const before = picked.map((v) => worldOf(t, v));
      const q = quatFromAxisAngle(
        [0.3 / Math.hypot(0.3, 0.5, 0.8), 0.5 / Math.hypot(0.3, 0.5, 0.8), 0.8 / Math.hypot(0.3, 0.5, 0.8)],
        0.4,
      );
      await drag(t, { rotate: q }, 'rotate');
      const after = picked.map((v) => worldOf(t, v));
      after.forEach((p, i) => expectVec(p, rotateAbout(q, pivot, before[i] as Vec3)));
      expectSameSet(
        source.map((v) => worldOf(t, v)),
        after.map((p) => mirrorWorld(xf, p)),
      );
    }

    /** The face whose centroid is lowest along `axis` (the cube's −X face for 0). */
    function lowestFace(data: MeshData, axis: 0 | 1 | 2): number {
      let best = -1;
      for (let f = 0; f < data.counts.faces; f++) {
        if (best === -1 || faceCentroid(data, f)[axis] < faceCentroid(data, best)[axis] - 1e-9) best = f;
      }
      return best;
    }
    const highestFace = (data: MeshData, axis: 0 | 1 | 2): number => {
      let best = -1;
      for (let f = 0; f < data.counts.faces; f++) {
        if (best === -1 || faceCentroid(data, f)[axis] > faceCentroid(data, best)[axis] + 1e-9) best = f;
      }
      return best;
    };

    const placements: readonly { readonly name: string; readonly xf: ReadonlyXf }[] = [
      { name: 'at the origin', xf: IDENTITY },
      {
        name: 'rotated, moved and scaled',
        xf: { t: [1, -2, 0.5], q: quatFromAxisAngle([0, 1, 0], 0.7), s: [2, 2, 2] },
      },
    ];

    for (const { name, xf } of placements) {
      it(`a cube's −X face (${name}): the reflected frame, X/Y/Z drags and a rotation exact on both caps`, async () => {
        const data = primitive('cube', {});
        const minusX = lowestFace(data, 0);
        const plusX = highestFace(data, 0);
        const t = await modelWith('face', () => [minusX], data, { placement: xf });
        objectX(t);
        expect((await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' })).status).toBe('finished');
        await settle();
        // Both caps extruded (8 + 2 × 4 vertices).
        expect(counts(t, t.id)).toBe('16/28/14');
        // The session frame is the reflected frame of the +X face's: X and Y as the source's, Z its own normal.
        const plus = [0, 1, 0] as Vec3;
        const state = t.app.extrude.state;
        const toWorldDir = (d: Vec3): Vec3 => quatRotateVec3(xf.q, d);
        const toWorldPoint = (p: Vec3): Vec3 => {
          const r = quatRotateVec3(xf.q, [p[0] * xf.s[0], p[1] * xf.s[1], p[2] * xf.s[2]]);
          return [r[0] + xf.t[0], r[1] + xf.t[1], r[2] + xf.t[2]];
        };
        expectVec(state?.frame.pivot ?? [], toWorldPoint([-0.5, 0, 0]));
        expectVec(state?.frame.axes[0] ?? [], toWorldDir(plus));
        expectVec(state?.frame.axes[1] ?? [], toWorldDir([0, 0, 1]));
        expectVec(state?.frame.axes[2] ?? [], toWorldDir([-1, 0, 0]));
        expect(extrudeManipulatorFrame(t.app)?.scaleAxes).toEqual(extrudeManipulatorFrame(t.app)?.axes);
        await dragsFollowTheMirror(t, faceVerts(dataOf(t, t.id), minusX), faceVerts(dataOf(t, t.id), plusX), xf);
        // Identical numbers on both sides (§5.14): mesh-local +Z on the −X cap is its reflected frame's +Y (and the
        // source's), so the translate args hold the drags' local Z as localTranslateY (the bug stored −Z).
        expect(t.app.extrude.state?.stack).toHaveLength(5);
        const inverse: Quat = [-xf.q[0], -xf.q[1], -xf.q[2], xf.q[3]];
        const local = quatRotateVec3(inverse, [0.3, 0.25, 0.3]);
        expect(t.app.extrude.state?.stack[3]?.['localTranslateY']).toBeCloseTo(local[2] / xf.s[0], 9);
        expect(t.app.extrude.state?.stack[3]?.['localTranslateX']).toBeCloseTo(local[1] / xf.s[0], 9);
        expect(t.app.extrude.state?.stack[3]?.['localTranslateZ']).toBeCloseTo(-local[0] / xf.s[0], 9);
      });
    }

    it('the +X face (the source) keeps its own frame: the same drags, the partner mirrored', async () => {
      const data = primitive('cube', {});
      const t = await modelWith('face', () => [highestFace(data, 0)], data);
      objectX(t);
      await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' });
      await settle();
      expect(counts(t, t.id)).toBe('16/28/14');
      expectVec(t.app.extrude.state?.frame.axes[2] ?? [], [1, 0, 0]);
      const d = dataOf(t, t.id);
      await dragsFollowTheMirror(t, faceVerts(d, highestFace(data, 0)), faceVerts(d, lowestFace(data, 0)), IDENTITY);
    });

    it('a border edge on −X (2 × 1 plane): X/Y/Z drags and a rotation exact on both new edges', async () => {
      const data = primitive('plane', { width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
      const m = editMeshFrom(data);
      let edge = -1;
      for (let e = 0; e < data.counts.edges; e++) {
        const a = position(data, data.edgeVerts[2 * e] as number);
        const b = position(data, data.edgeVerts[2 * e + 1] as number);
        if (Math.abs(a[0] + 1) < 1e-9 && Math.abs(b[0] + 1) < 1e-9 && m.edgeFaceCount(e) === 1) edge = e;
      }
      expect(edge).toBeGreaterThanOrEqual(0);
      const t = await modelWith('edge', () => [edge], data);
      objectX(t);
      expect((await t.app.runUntyped('mesh.extrude', {}, { source: 'keyboard' })).status).toBe('finished');
      await settle();
      // Two new vertices per edge, both border edges extruded.
      const before = data.counts.points;
      expect(dataOf(t, t.id).counts.points).toBe(before + 4);
      const added = [0, 1, 2, 3].map((i) => before + i);
      const picked = added.filter((v) => worldOf(t, v)[0] < 0);
      const source = added.filter((v) => worldOf(t, v)[0] > 0);
      expect(picked).toHaveLength(2);
      expect(source).toHaveLength(2);
      // The session frame is the reflected frame of the +X chain's: its pivot on the −X edge.
      expectVec(t.app.extrude.state?.frame.pivot ?? [], [-1, 0, 0]);
      await dragsFollowTheMirror(t, picked, source, IDENTITY);
    });

    it('smart extrude on the −X face: the drag moves the picked cap by its delta, the partner by its mirror', async () => {
      const data = primitive('cube', {});
      const minusX = lowestFace(data, 0);
      const plusX = highestFace(data, 0);
      const t = await modelWith('face', () => [minusX], data);
      objectX(t);
      const start = faceVerts(data, minusX).map((v) => position(data, v));
      const gesture = beginSmartExtrude(t.app, { paneId: 'pane-persp' });
      expect(gesture).not.toBeNull();
      gesture?.update({ translate: [0, 0.1, 0.3] });
      gesture?.commit();
      await settle();
      expect(counts(t, t.id)).toBe('16/28/14');
      expect(undoLabels(t)).toEqual(['Extrude']);
      const cap = faceVerts(dataOf(t, t.id), minusX).map((v) => worldOf(t, v));
      expectSameSet(
        cap,
        start.map((p) => [p[0], p[1] + 0.1, p[2] + 0.3] as Vec3),
      );
      expectSameSet(
        faceVerts(dataOf(t, t.id), plusX).map((v) => worldOf(t, v)),
        cap.map((p) => [-p[0], p[1], p[2]] as Vec3),
      );
      // The new session opens on the same (reflected) frame: a further drag stays exact.
      await drag(t, { translate: [0, 0, -0.1] });
      expectSameSet(
        faceVerts(dataOf(t, t.id), minusX).map((v) => worldOf(t, v)),
        start.map((p) => [p[0], p[1] + 0.1, p[2] + 0.2] as Vec3),
      );
    });
  });

  it('setManipSpace toggles the manipulator space of the open session', async () => {
    const t = await extruded();
    t.app.extrude.setManipSpace('world');
    expect(t.app.extrude.state?.manipSpace).toBe('world');
    expect(t.app.session.getState().model.extrudeSession?.manipSpace).toBe('world');
  });

  it('smart extrude: three Shift+drags build three "Extrude" steps (20/36/18)', async () => {
    const t = await modelWith('face', topFace);
    for (let i = 0; i < 3; i++) {
      const gesture = beginSmartExtrude(t.app, { paneId: 'pane-persp' });
      expect(gesture).not.toBeNull();
      gesture?.update({ translate: [0, 0.15, 0] });
      gesture?.update({ translate: [0, 0.3, 0] });
      gesture?.commit();
      await settle();
      expect(t.app.extrude.state).not.toBeNull();
    }
    expect(counts(t, t.id)).toBe('20/36/18');
    expect(undoLabels(t)).toEqual(['Extrude', 'Extrude', 'Extrude']);
    expect(t.app.session.getState().lastRun).toMatchObject({ label: 'Extrude', source: 'tool' });
    expect(argsNow(t)['localTranslateZ']).toBeCloseTo(0.3, 9);
    const top = faceCentroid(dataOf(t, t.id), topFace(primitive('cube', {}))[0] as number);
    expect(top[1]).toBeCloseTo(1.4, 6);
    // Divisions stay editable on the last one: 3 → two more rings.
    await t.app.run('edit.adjustLast', { args: { divisions: 3 } });
    expect(counts(t, t.id)).toBe('28/52/26');
  });

  it('smart extrude ends an open zero session with its drop first; a Shift click without movement does nothing', async () => {
    const t = await extruded();
    const gesture = beginSmartExtrude(t.app);
    expect(t.app.extrude.state).toBeNull();
    expect(undoLabels(t)).toEqual([]);
    gesture?.commit();
    await settle();
    expect(counts(t, t.id)).toBe('8/12/6');
    expect(undoLabels(t)).toEqual([]);
  });

  it('smart extrude is not offered in object mode (Shift+drag moves normally there)', async () => {
    const t = await modelWith('face', topFace);
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'object' } });
    expect(beginSmartExtrude(t.app)).toBeNull();
  });
});
