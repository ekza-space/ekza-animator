// M6A-SPEC §5.8, §9 B12b (READY-gated on B3's Extrude, §3 rule 4): the extrude session — opening after an extrude,
// absorbing drags into the `local*` args exactly from any manipulator space (a 30°-tilted face dragged on world Y moves
// along world Y; rotations compose about the cap's pivot; scale in the session frame), the args undo stack (undo steps
// back through absorbed drags without changing the history length; undo at index 0 removes the extrude), every row of
// the end-trigger table with its zero-drop (a mode switch keeps a zero extrude), smart extrude chains, `T`'s reopen.
import { type Quat, quatFromAxisAngle, quatRotateVec3, type Vec3 } from '@ekza-animator/anim-core';
import type { MeshRecord } from '@ekza-animator/doc';
import { primitive } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  absorbArgs,
  beginSmartExtrude,
  EXTRUDE_REMOVED,
  type ExtrudeSessionShim,
  isIdentityExtrude,
  onModelHelp,
  type OperatorDef,
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
      await t.app.run('edit.redo');
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
      const engine = shim(t).engine();
      // B12a's operator (a B0a stub until it lands): the session's runner hook decides by its id.
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
