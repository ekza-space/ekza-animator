// The Scene sheet's model (STUDIO-TOUCH-SPEC §6.5, §15 rows 1.10, 5.16; T6b) over a headless app: the Outliner rows at
// touch density (scene objects in their hierarchy, characters with their meshes and skeleton, references, cameras),
// the operator call of every control, *Parent to…* and the drop targets following `scene.parent`'s rules, hide and
// show, and the parity contract: every operator the Disclosure Manifest places in a Scene section is reachable from
// that section. The lift-and-drop recogniser is driven event by event.
import { readFileSync } from 'node:fs';
import {
  createHeadlessEditorApp,
  type EditorApp,
  loadModelOperators,
  loadUiWrappers,
  type OperatorResult,
} from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { entryFor } from '../../src/manifest/check';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { SHEET_SECTIONS } from '../../src/manifest/sheets';
import { entriesOf, isSurfaceEntry } from '../../src/manifest/types';
import { createLiftRecognizer } from '../../src/sheets/scene/lift';
import {
  canParent,
  dropCall,
  type OperatorCall,
  type SceneModel,
  type SceneRow,
  sceneCalls,
  sceneModel,
} from '../../src/sheets/scene/model';

const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url)));

async function ok<T = unknown>(app: EditorApp, op: string, args?: unknown): Promise<T> {
  const result: OperatorResult<unknown> = await app.runUntyped(op, args);
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** Runs a control's calls in order, as the sheet does. */
async function runCalls(app: EditorApp, calls: readonly OperatorCall[]): Promise<void> {
  for (const call of calls) await ok(app, call.op, call.args);
}

interface Scene {
  readonly app: EditorApp;
  readonly polybot: string;
  readonly lad: string;
  readonly cube: string;
  readonly ball: string;
  readonly group: string;
  readonly plane: string;
}

/** Polybot (an imported character with a rig), a model character with a skeleton, two scene meshes, a group and a
 *  reference image. */
async function scene(): Promise<Scene> {
  const app = createHeadlessEditorApp({ readSample: (sample) => Promise.resolve(fixture(`models/${sample.file}`)) });
  await Promise.all([app.rig.load(), loadModelOperators(), loadUiWrappers(app)]);
  const { character: polybot } = await ok<{ character: string }>(app, 'file.loadSample', { sample: 'polybot' });
  await ok(app, 'workspace.set', { workspace: 'model' });
  const body = (await ok<{ mesh: string }>(app, 'mesh.create.cube', {})).mesh;
  const cube = (await ok<{ mesh: string }>(app, 'mesh.create.cube', {})).mesh;
  const ball = (await ok<{ mesh: string }>(app, 'mesh.create.cube', {})).mesh;
  await ok(app, 'scene.rename', { id: ball, name: 'Ball' });
  const { group } = await ok<{ group: string }>(app, 'scene.group', { ids: [] });
  const { id: plane } = await ok<{ id: string }>(app, 'imagePlane.import', {
    camera: 'front',
    name: 'Front ref',
    bytes: fixture('images/reference-front.png'),
  });
  await ok(app, 'workspace.set', { workspace: 'rig' });
  const { character: lad } = await ok<{ character: string }>(app, 'char.fromModel', { objects: [body], name: 'Lad' });
  await ok(app, 'skel.template.create', { preset: 'lite17' });
  await ok(app, 'workspace.set', { workspace: 'model' });
  return { app, polybot, lad, cube, ball, group, plane };
}

const row = (model: SceneModel, key: string): SceneRow => {
  const found = model.rows.get(key);
  if (found === undefined) throw new Error(`no row ${key}: ${[...model.rows.keys()].join(', ')}`);
  return found;
};

let s: Scene;

beforeAll(async () => {
  s = await scene();
}, 60_000);

describe('Scene sheet rows (§6.5)', () => {
  it('lists the scene objects, then each character with its meshes and skeleton, at touch density', () => {
    const model = sceneModel(s.app);
    const shape = model.objects.map((r) => [r.kind, r.name, r.depth]);
    expect(shape[0]).toEqual(['scene', 'Scene', 0]);
    expect(shape).toContainEqual(['mesh', 'Cube 2', 1]);
    expect(shape).toContainEqual(['mesh', 'Ball', 1]);
    expect(shape).toContainEqual(['group', 'Group', 1]);
    const lad = shape.findIndex(([kind, name]) => kind === 'character' && name === 'Lad');
    expect(lad).toBeGreaterThan(0);
    expect(shape[lad + 1]).toEqual(['mesh', 'Cube', 1]);
    expect(shape).toContainEqual(['skeleton', 'Skeleton', 1]);
    expect(shape).toContainEqual(['character', 'Polybot', 0]);
    // Polybot's glTF meshes are imported, read-only rows
    const assets = model.objects.filter((r) => r.kind === 'asset');
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((r) => r.select === null && r.parentTargets.length === 0 && r.depth === 1)).toBe(true);
  });

  it('selects a mesh or group with select.objects, a character with its root control, a skeleton with its root joint', async () => {
    const model = sceneModel(s.app);
    expect(row(model, `obj:${s.cube}`).select?.calls).toEqual([
      { op: 'select.objects', args: { ids: [s.cube], mode: 'replace' } },
    ]);
    expect(row(model, `obj:${s.group}`).select?.calls).toEqual([
      { op: 'select.objects', args: { ids: [s.group], mode: 'replace' } },
    ]);
    const polybot = row(model, `chr:${s.polybot}`);
    expect(polybot.select?.calls).toEqual([
      {
        op: 'select.controls',
        args: { ids: [`${s.app.store.get('characters', s.polybot as never)?.rig}:root`], mode: 'replace' },
      },
    ]);
    const skeleton = model.objects.find((r) => r.kind === 'skeleton');
    const root = s.app.store.list('joints').find((joint) => joint.parent === null);
    expect(skeleton?.select?.calls).toEqual([{ op: 'select.joints', args: { ids: [root?.id], mode: 'replace' } }]);
    expect(skeleton?.menu.map((a) => a.calls[0]?.op)).toEqual(['select.joints', 'select.joints']);

    // a character row makes it the active character (§6.5)
    await runCalls(s.app, row(model, `chr:${s.lad}`).select?.calls ?? []);
    expect(s.app.session.getState().activeCharacter).toBe(s.lad);
    await runCalls(s.app, polybot.select?.calls ?? []);
    expect(s.app.session.getState().activeCharacter).toBe(s.polybot);
    const after = sceneModel(s.app);
    expect(row(after, `chr:${s.polybot}`)).toMatchObject({
      active: true,
      selected: true,
      detail: 'Character · active',
    });
    expect(row(after, `chr:${s.lad}`).active).toBe(false);

    await runCalls(s.app, row(after, `obj:${s.cube}`).select?.calls ?? []);
    expect(s.app.session.getState().selection.objects).toEqual([s.cube]);
    expect(row(sceneModel(s.app), `obj:${s.cube}`).selected).toBe(true);
  });

  it('collapses and expands rows through the expanded map', () => {
    const closed = sceneModel(s.app, { expanded: new Map([[`chr:${s.lad}`, false]]) });
    const lad = closed.objects.findIndex((r) => r.key === `chr:${s.lad}`);
    expect(closed.objects[lad]?.expanded).toBe(false);
    expect(closed.objects.slice(lad + 1).every((r) => r.kind === 'character')).toBe(true);
    expect(closed.objects.some((r) => r.kind === 'skeleton')).toBe(false);
  });

  it('lists the characters with their bulk selections', () => {
    const model = sceneModel(s.app);
    const lad = model.characters.find((c) => c.id === s.lad);
    const controls = s.app.store
      .list('controls')
      .filter((c) => c.rig === s.app.store.get('characters', s.lad as never)?.rig);
    const all = lad?.allControls.calls[0];
    expect(all).toMatchObject({ op: 'select.controls', args: { mode: 'replace' } });
    expect((all?.args as { readonly ids: readonly string[] } | undefined)?.ids).toHaveLength(controls.length);
    expect(lad?.allJoints?.calls[0]?.op).toBe('select.joints');
    expect(model.characters.find((c) => c.id === s.polybot)?.allJoints).toBeNull();
  });

  it('renames through scene.rename (objects) and imagePlane.set (references)', async () => {
    const model = sceneModel(s.app);
    expect(row(model, `obj:${s.ball}`).rename?.('Sphere')).toEqual({
      op: 'scene.rename',
      args: { id: s.ball, name: 'Sphere' },
    });
    expect(row(model, `plane:${s.plane}`).rename?.('Side ref')).toEqual({
      op: 'imagePlane.set',
      args: { id: s.plane, patch: { name: 'Side ref' } },
    });
    await runCalls(s.app, [row(model, `obj:${s.ball}`).rename?.('Sphere') as OperatorCall]);
    expect(row(sceneModel(s.app), `obj:${s.ball}`).name).toBe('Sphere');
    await runCalls(s.app, [{ op: 'scene.rename', args: { id: s.ball, name: 'Ball' } }]);
  });
});

describe('Parent to… and lift-and-drop (§6.5)', () => {
  it('offers the targets scene.parent allows: same owner, no cycle, a group only under a group', () => {
    const model = sceneModel(s.app);
    const cube = row(model, `obj:${s.cube}`);
    expect(cube.parentTargets.map((t) => t.key).sort()).toEqual([`obj:${s.ball}`, `obj:${s.group}`].sort());
    expect(dropCall(model, `obj:${s.cube}`, `obj:${s.group}`)).toEqual({
      op: 'scene.parent',
      args: { ids: [s.cube], parent: s.group },
    });
    // a group only under a group; a character's mesh never under a scene object
    expect(row(model, `obj:${s.group}`).parentTargets).toEqual([]);
    const ladMesh = model.objects.find((r) => r.kind === 'mesh' && r.name === 'Cube');
    expect(ladMesh?.parentTargets).toEqual([]);
    expect(dropCall(model, ladMesh?.key ?? '', `obj:${s.group}`)).toBeNull();
    expect(dropCall(model, `obj:${s.cube}`, `obj:${s.cube}`)).toBeNull();
    expect(dropCall(model, `obj:${s.cube}`, `chr:${s.lad}`)).toBeNull();
    expect(canParent(s.app, s.group, s.cube)).toBe(false);
  });

  it('parents on a drop, then offers the top level (scene.unparent) and refuses a cycle', async () => {
    const call = dropCall(sceneModel(s.app), `obj:${s.cube}`, `obj:${s.group}`);
    await runCalls(s.app, [call as OperatorCall]);
    const model = sceneModel(s.app);
    const order = model.objects.map((r) => r.key);
    expect(order.indexOf(`obj:${s.cube}`)).toBe(order.indexOf(`obj:${s.group}`) + 1);
    expect(row(model, `obj:${s.cube}`).depth).toBe(2);
    expect(row(model, `obj:${s.group}`).expandable).toBe(true);
    const cube = row(model, `obj:${s.cube}`);
    expect(cube.parentTargets.map((t) => t.key)).toEqual(['section:scene', `obj:${s.ball}`]);
    expect(dropCall(model, `obj:${s.cube}`, 'section:scene')).toEqual({
      op: 'scene.unparent',
      args: { ids: [s.cube] },
    });
    expect(cube.menu.map((a) => a.id)).toEqual(['select', 'unparent']);
    // the group may not go under its own child
    expect(canParent(s.app, s.group, s.cube)).toBe(false);
    await runCalls(s.app, [dropCall(model, `obj:${s.cube}`, 'section:scene') as OperatorCall]);
    expect(s.app.store.get('meshes', s.cube as never)?.parent).toBeNull();
  });

  it('parents the selection from the Reparent section', async () => {
    await ok(s.app, 'select.objects', { ids: [s.cube, s.ball], mode: 'replace' });
    const { reparent } = sceneModel(s.app);
    expect(reparent.names).toEqual(['Cube 2', 'Ball']);
    expect(reparent.targets.map((t) => t.call)).toEqual([
      { op: 'scene.parent', args: { ids: [s.cube, s.ball], parent: s.group } },
    ]);
    expect(reparent.unparent).toMatchObject({ enabled: false, reason: 'The selection has no parent' });
    await runCalls(s.app, [reparent.targets[0]?.call as OperatorCall]);
    const after = sceneModel(s.app).reparent;
    expect(after.unparent).toMatchObject({
      enabled: true,
      calls: [{ op: 'scene.unparent', args: { ids: [s.cube, s.ball] } }],
    });
    await runCalls(s.app, after.unparent.calls);
    await ok(s.app, 'select.objects', { ids: [], mode: 'replace' });
    expect(sceneModel(s.app).reparent.note).toBe('Select objects first, or hold a row and drop it on another.');
  });
});

describe('show and hide (§15 row 1.10)', () => {
  it('hides a row (select it, hide the selection) and shows everything again from the eye or the chip', async () => {
    const model = sceneModel(s.app);
    const ball = row(model, `obj:${s.ball}`);
    expect(ball.eye).toMatchObject({
      label: 'Hide',
      enabled: true,
      calls: [
        { op: 'select.objects', args: { ids: [s.ball], mode: 'replace' } },
        { op: 'view.hide', args: { target: 'selected' } },
      ],
    });
    expect(model.visibility.showAll).toMatchObject({ enabled: false, label: 'Nothing hidden' });
    await runCalls(s.app, ball.eye?.calls ?? []);
    const hidden = sceneModel(s.app);
    expect(row(hidden, `obj:${s.ball}`)).toMatchObject({ hidden: true, detail: 'Mesh · hidden' });
    expect(row(hidden, `obj:${s.ball}`).eye).toMatchObject({
      label: 'Show all hidden (1)',
      calls: [{ op: 'view.showAll' }],
    });
    expect(hidden.visibility.showAll).toMatchObject({ enabled: true, label: '1 hidden · Show all' });
    await runCalls(s.app, hidden.visibility.showAll.calls);
    expect(row(sceneModel(s.app), `obj:${s.ball}`).hidden).toBe(false);
  });

  it('greys the eye where hide does not act on objects (Animate; component modes)', async () => {
    await ok(s.app, 'workspace.set', { workspace: 'animate' });
    const eye = row(sceneModel(s.app), `obj:${s.ball}`).eye;
    expect(eye?.enabled).toBe(false);
    expect(eye?.reason).toBe('Hide and show objects in Make or Rig');
    await ok(s.app, 'workspace.set', { workspace: 'model' });
  });

  it('shows and hides a reference image and locks it with imagePlane.set', async () => {
    const plane = row(sceneModel(s.app), `plane:${s.plane}`);
    expect(plane).toMatchObject({ kind: 'plane', name: 'Front ref', select: null, hidden: false });
    expect(plane.detail).toBe('Front view · 50 %');
    expect(plane.eye?.calls).toEqual([{ op: 'imagePlane.set', args: { id: s.plane, patch: { visible: false } } }]);
    expect(plane.menu.map((a) => a.id)).toEqual(['hide', 'lock']);
    await runCalls(s.app, plane.eye?.calls ?? []);
    const hidden = row(sceneModel(s.app), `plane:${s.plane}`);
    expect(hidden).toMatchObject({ hidden: true, detail: 'Front view · 50 % · hidden' });
    expect(hidden.eye?.calls).toEqual([{ op: 'imagePlane.set', args: { id: s.plane, patch: { visible: true } } }]);
    await runCalls(s.app, hidden.eye?.calls ?? []);
  });

  it('hides the parts left out of the character with autorig.parts and gives them back', async () => {
    const { visibility } = sceneModel(s.app);
    expect([...visibility.leftOut].sort()).toEqual([s.cube, s.ball].sort());
    expect(visibility.hideParts.calls).toEqual([{ op: 'autorig.parts', args: { hidden: visibility.leftOut } }]);
    expect(visibility.showParts.calls).toEqual([{ op: 'autorig.parts', args: { hidden: [] } }]);
    await runCalls(s.app, visibility.hideParts.calls);
    expect([...s.app.session.getState().model.hiddenObjects].sort()).toEqual([s.cube, s.ball].sort());
    await runCalls(s.app, visibility.showParts.calls);
    expect(s.app.session.getState().model.hiddenObjects.size).toBe(0);
  });

  it('lists the shot cameras: a tap looks through one in the canvas pane, the menu locks it', () => {
    const [camera] = sceneModel(s.app).cameras;
    const record = s.app.store.list('cameras')[0];
    expect(camera?.select?.calls).toEqual([
      { op: 'view.lookThrough', args: { paneId: 'pane-single', camera: { kind: 'shot', cameraId: record?.id } } },
    ]);
    expect(camera?.menu.map((a) => a.calls[0])).toContainEqual({
      op: 'view.toggleCameraLock',
      args: { cameraId: record?.id },
    });
  });
});

describe('parity with the Disclosure Manifest (§20.5)', () => {
  it('reaches every operator the manifest places in a Scene section from that section', () => {
    const calls = sceneCalls(sceneModel(s.app));
    const sections = SHEET_SECTIONS.scene ?? [];
    let checked = 0;
    for (const [op, value] of Object.entries(DISCLOSURE)) {
      for (const entry of entriesOf(value)) {
        if (!isSurfaceEntry(entry)) continue;
        for (const surface of entry.surfaces) {
          if (!('sheet' in surface) || surface.sheet !== 'scene' || surface.section === undefined) continue;
          expect([op, sections.includes(surface.section)]).toEqual([op, true]);
          const reached = calls.some(
            (c) =>
              c.section === surface.section &&
              c.call.op === op &&
              entryFor(entriesOf(value), c.call.args)?.entry === entry,
          );
          expect([op, surface.section, reached]).toEqual([op, surface.section, true]);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('runs only operators the manifest discloses, with arguments an entry covers', () => {
    for (const { call } of sceneCalls(sceneModel(s.app))) {
      const value = DISCLOSURE[call.op];
      expect([call.op, value !== undefined]).toEqual([call.op, true]);
      const found = entryFor(entriesOf(value ?? []), call.args);
      expect([call.op, found !== null && isSurfaceEntry(found.entry)]).toEqual([call.op, true]);
    }
  });
});

describe('the lift-and-drop recogniser', () => {
  it('a quick press is a tap', () => {
    const lift = createLiftRecognizer();
    expect(lift.down('a', 10, 10, 0, 'touch')).toEqual([]);
    expect(lift.up(11, 10, 120, 'a')).toEqual([{ kind: 'tap', key: 'a' }]);
    expect(lift.phase).toBe('idle');
  });

  it('a long-press lifts the row; dragging hovers rows and the lift drops it on one', () => {
    const lift = createLiftRecognizer();
    lift.down('a', 10, 10, 0, 'touch');
    expect(lift.deadline).toBe(450);
    expect(lift.tick(449)).toEqual([]);
    expect(lift.tick(450)).toEqual([{ kind: 'lift', key: 'a' }]);
    expect(lift.move(12, 13, 500, 'a')).toEqual([]);
    expect(lift.move(12, 60, 520, 'b')).toEqual([{ kind: 'hover', key: 'a', over: 'b' }]);
    expect(lift.move(12, 62, 530, 'b')).toEqual([]);
    expect(lift.move(12, 110, 540, null)).toEqual([{ kind: 'hover', key: 'a', over: null }]);
    expect(lift.move(12, 160, 560, 'c')).toEqual([{ kind: 'hover', key: 'a', over: 'c' }]);
    expect(lift.up(12, 160, 600, 'c')).toEqual([{ kind: 'drop', key: 'a', over: 'c' }]);
    expect(lift.phase).toBe('idle');
  });

  it('a long-press lifted without dragging opens the row menu; a drop on itself or on nothing cancels', () => {
    const lift = createLiftRecognizer();
    lift.down('a', 10, 10, 0, 'touch');
    lift.tick(500);
    expect(lift.up(10, 10, 700, 'a')).toEqual([{ kind: 'menu', key: 'a' }]);
    lift.down('a', 10, 10, 1000, 'touch');
    lift.tick(1500);
    lift.move(10, 80, 1600, 'a');
    expect(lift.up(10, 80, 1700, 'a')).toEqual([{ kind: 'cancel', key: 'a' }]);
    lift.down('a', 10, 10, 2000, 'touch');
    lift.tick(2500);
    lift.move(10, 80, 2600, null);
    expect(lift.up(10, 80, 2700, null)).toEqual([{ kind: 'cancel', key: 'a' }]);
  });

  it('a press that moves first is a scroll: it never lifts', () => {
    const lift = createLiftRecognizer();
    lift.down('a', 10, 10, 0, 'touch');
    expect(lift.move(10, 40, 50, 'b')).toEqual([]);
    expect(lift.phase).toBe('scrolling');
    expect(lift.deadline).toBeNull();
    expect(lift.tick(600)).toEqual([]);
    expect(lift.up(10, 90, 700, 'c')).toEqual([{ kind: 'cancel', key: 'a' }]);
  });

  it('a held press whose timer never ticked still counts as a long-press (the menu), and cancel ends a lift', () => {
    const lift = createLiftRecognizer();
    lift.down('a', 10, 10, 0, 'touch');
    expect(lift.up(10, 10, 900, 'a')).toEqual([{ kind: 'menu', key: 'a' }]);
    lift.down('a', 10, 10, 1000, 'touch');
    lift.tick(1450);
    expect(lift.cancel()).toEqual([{ kind: 'cancel', key: 'a' }]);
    expect(lift.phase).toBe('idle');
  });
});
