// AUTORIG-SPEC §4.3 (D3): the derived wizard progress is a pure function of the document, the Validation rows and the
// session — §4.3's table over document fixtures: ① done with a subject; ② reachable for scene meshes and done with a
// skeleton; ③ done when every subject mesh is bound and no `skel.*` / `skin.*` / `xform.*` error row is left (an
// `xform.scale` error blocks it and names itself; warnings do not; unknown rows — the rig chunk not loaded — keep it
// open); ④ done with a clip or `animations.skipped`; an asset-sourced humanoid skips to ④; the subject resolves
// through Create Skeleton's adoption; `landingStep` picks the furthest reachable step.
import { type CharacterId, derivedId, type DocumentStore, emptySnapshot, type MeshId } from '@ekza-studio/doc';
import { type RigValidationRow, rigChecklist } from '@ekza-studio/editor-core';
import { createFakeEditorApp, createNaiveStore } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { autoRigProgress, defaultAutoRigSession, messages } from '../src';
import {
  checklistLoaded,
  landingStep,
  loadChecklist,
  type ProgressInput,
  progressOf,
  resolveSubject,
} from '../src/progress';

const t = messages().frame;
const CHAR = 'chr_Model0000000001' as CharacterId;
const VRM = 'chr_Asset0000000001' as CharacterId;

function store(): DocumentStore {
  const s = createNaiveStore();
  s.load(emptySnapshot());
  return s;
}

const put = (s: DocumentStore, table: string, record: Record<string, unknown>): void => {
  s.transact({ label: 'fixture' }, (tx) => tx.put(table as never, record as never));
};

const mesh = (id: string, owner: Record<string, unknown>, skin: unknown = null): Record<string, unknown> => ({
  id,
  name: id,
  owner,
  parent: null,
  order: 'a0',
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  pivot: [0, 0, 0],
  source: null,
  data: null,
  faceted: false,
  generator: null,
  palette: null,
  material: { preset: 'lit' },
  colourOutput: 'palette-texture',
  skin,
  budget: null,
  handheld: null,
  deleted: null,
});

const character = (id: CharacterId, kind: 'model' | 'asset', format = 'vrm1'): Record<string, unknown> => ({
  id,
  name: 'Lad',
  asset: kind === 'asset' ? 'ast_x' : null,
  source: kind === 'asset' ? { kind: 'asset', asset: 'ast_x' } : { kind: 'model', skeleton: 'skl_1' },
  format,
  rig: 'rig_1',
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  order: 'a0',
  deleted: null,
  vrm: null,
});

const skeleton = (): Record<string, unknown> => ({
  id: 'skl_1',
  character: CHAR,
  template: 'vrm-humanoid',
  templateVersion: '1.0.0',
  preset: 'standard33',
  symmetry: true,
  deleted: null,
});

const clip = (source: Record<string, unknown>): Record<string, unknown> => ({
  id: 'clp_1',
  character: CHAR,
  name: 'Walk',
  slot: null,
  fps: { num: 30, den: 1 },
  range: { start: 0, end: 30 },
  sceneStart: 0,
  loop: true,
  rootMotion: 'in-place',
  contact: null,
  tags: [],
  provenance: { derivedFrom: [], redistributable: 'yes' },
  source,
  order: 'a0',
  deleted: null,
});

const row = (code: string, severity: RigValidationRow['severity'], message = code): RigValidationRow => ({
  code,
  severity,
  area: 'skeleton',
  message,
  ids: [],
  fix: null,
});

const input = (view: DocumentStore, fields: Partial<ProgressInput> = {}): ProgressInput => ({
  view,
  subject: { character: null, meshes: [] },
  rows: null,
  animationsSkipped: false,
  checklist: rigChecklist,
  ...fields,
});

/** A model character with a skeleton and one mesh, bound or not. */
function riggedLad(bound: boolean): DocumentStore {
  const s = store();
  put(s, 'characters', character(CHAR, 'model'));
  put(s, 'skeletons', skeleton());
  put(s, 'meshes', mesh('msh_body', { character: CHAR }, bound ? { skeleton: 'skl_1', bind: null } : null));
  return s;
}

describe('autoRigProgress (§4.3)', () => {
  it('an empty document: only ① is reachable, nothing is done, the reasons say why', () => {
    const p = progressOf(input(store()));
    expect(p.done).toEqual({ model: false, markers: false, rig: false, animations: false, export: false });
    expect(p.reachable).toEqual({ model: true, markers: false, rig: false, animations: false, export: false });
    expect(p.blocked).toEqual({
      markers: t.blockedNoModel,
      rig: t.blockedNoModel,
      animations: t.blockedNoModel,
      export: t.blockedNoModel,
    });
  });

  it('scene meshes: ① done, ② reachable; ③ waits for the skeleton', () => {
    const s = store();
    put(s, 'meshes', mesh('msh_a', { scene: true }));
    const p = progressOf(input(s, { subject: { character: null, meshes: ['msh_a' as MeshId] } }));
    expect(p.done.model).toBe(true);
    expect(p.reachable).toMatchObject({ markers: true, rig: false, animations: false });
    expect(p.blocked.rig).toBe(t.blockedNoSkeleton);
    // a subject whose meshes are gone (an undone import) has nothing
    const gone = progressOf(input(store(), { subject: { character: null, meshes: ['msh_a' as MeshId] } }));
    expect(gone.done.model).toBe(false);
  });

  it('a skeleton: ② done, ③ reachable; unbound meshes keep ④ blocked', () => {
    const p = progressOf(input(riggedLad(false), { subject: { character: CHAR, meshes: [] }, rows: [] }));
    expect(p.done).toMatchObject({ model: true, markers: true, rig: false });
    expect(p.reachable).toMatchObject({ rig: true, animations: false, export: false });
    expect(p.blocked.animations).toBe(t.blockedNotBound);
  });

  it('bound without error rows: ③ done, ④ and ⑤ reachable; warnings and info rows are allowed', () => {
    const view = riggedLad(true);
    const subject = { character: CHAR, meshes: [] };
    const p = progressOf(input(view, { subject, rows: [row('skin.review', 'warning'), row('xform.note', 'info')] }));
    expect(p.done).toMatchObject({ markers: true, rig: true, animations: false, export: false });
    expect(p.reachable).toMatchObject({ animations: true, export: true });
    expect(p.blocked).toEqual({});
  });

  it('an xform.scale error blocks ③ and names itself (as do skel.* and skin.* errors; others do not)', () => {
    const view = riggedLad(true);
    const subject = { character: CHAR, meshes: [] };
    const scale = row('xform.scale', 'error', 'Scaled unevenly: Freeze Transformations');
    const p = progressOf(input(view, { subject, rows: [scale] }));
    expect(p.done.rig).toBe(false);
    expect(p.reachable.animations).toBe(false);
    expect(p.blocked.animations).toBe(t.blockedRow('Scaled unevenly: Freeze Transformations'));
    expect(p.blocked.export).toBe(p.blocked.animations);
    expect(progressOf(input(view, { subject, rows: [row('skel.tpose', 'error')] })).done.rig).toBe(false);
    expect(progressOf(input(view, { subject, rows: [row('skin.unweighted-vertex', 'error')] })).done.rig).toBe(false);
    expect(progressOf(input(view, { subject, rows: [row('vrm.meta', 'error')] })).done.rig).toBe(true);
  });

  it('unknown rows (the rig chunk not loaded) keep ③ open: "Checking the rig…"', () => {
    const p = progressOf(input(riggedLad(true), { subject: { character: CHAR, meshes: [] }, rows: null }));
    expect(p.done.rig).toBe(false);
    expect(p.blocked.animations).toBe(t.blockedChecking);
  });

  it('④ is done with a clip brought in, or skipped; an empty new clip does not count', () => {
    const view = riggedLad(true);
    const subject = { character: CHAR, meshes: [] };
    expect(progressOf(input(view, { subject, rows: [] })).done.animations).toBe(false);
    expect(progressOf(input(view, { subject, rows: [], animationsSkipped: true })).done.animations).toBe(true);
    put(view, 'clips', clip({ kind: 'new' }));
    expect(progressOf(input(view, { subject, rows: [] })).done.animations).toBe(false);
    view.transact({ label: 'fixture' }, (tx) =>
      tx.patch('clips', 'clp_1' as never, { source: { kind: 'imported', fileName: 'walk.vrma', asset: null } }),
    );
    expect(progressOf(input(view, { subject, rows: [] })).done.animations).toBe(true);
    // ⑤ is never done
    expect(progressOf(input(view, { subject, rows: [] })).done.export).toBe(false);
  });

  it('an asset-sourced humanoid (VRM) skips to ④; ② and ③ say it is already rigged; a plain glTF asset does not', () => {
    const s = store();
    put(s, 'characters', character(VRM, 'asset', 'vrm1'));
    const p = progressOf(input(s, { subject: { character: VRM, meshes: [] } }));
    expect(p.done.model).toBe(true);
    expect(p.reachable).toEqual({ model: true, markers: false, rig: false, animations: true, export: true });
    expect(p.blocked).toEqual({ markers: t.alreadyRigged, rig: t.alreadyRigged });
    const g = store();
    put(g, 'characters', character(VRM, 'asset', 'gltf'));
    const q = progressOf(input(g, { subject: { character: VRM, meshes: [] } }));
    expect(q.reachable.animations).toBe(false);
    expect(q.blocked.animations).toBe(t.alreadyRigged);
  });

  it('resolves a subject through Create Skeleton’s adoption (scene meshes soft-deleted, adopted ids derived)', () => {
    const s = store();
    put(s, 'characters', character(CHAR, 'model'));
    put(s, 'skeletons', skeleton());
    const adopted = derivedId('mesh', 'char.adopt', [CHAR, 'msh_scene'], '', 0);
    put(s, 'meshes', mesh(adopted, { character: CHAR }, null));
    const subject = { character: null, meshes: ['msh_scene' as MeshId] };
    expect(resolveSubject(s, subject).character?.id).toBe(CHAR);
    expect(progressOf(input(s, { subject, rows: [] })).done.markers).toBe(true);
    // an undone Create Skeleton: the character is gone and the scene mesh is back
    const back = store();
    put(back, 'meshes', mesh('msh_scene', { scene: true }));
    expect(resolveSubject(back, { character: CHAR, meshes: ['msh_scene' as MeshId] })).toEqual({
      character: null,
      meshes: ['msh_scene'],
    });
  });

  it('is pure: the same inputs give equal progress and the document is not touched', () => {
    const view = riggedLad(true);
    const version = view.version;
    const a = progressOf(input(view, { subject: { character: CHAR, meshes: [] }, rows: [] }));
    const b = progressOf(input(view, { subject: { character: CHAR, meshes: [] }, rows: [] }));
    expect(a).toEqual(b);
    expect(view.version).toBe(version);
  });

  it('autoRigProgress reads the app (rows unknown before the rig chunk) and the session', () => {
    const app = createFakeEditorApp();
    const session = defaultAutoRigSession();
    expect(app.rig.loaded).toBe(false);
    const p = autoRigProgress(app, session);
    expect(p.reachable.model).toBe(true);
    expect(p.done.model).toBe(false);
  });

  it("the checklist chunk not loaded yet: a character's skeleton and binding are unknown (Checking…), meshes are not", () => {
    const subject = { character: CHAR, meshes: [] };
    const p = progressOf(input(riggedLad(true), { subject, rows: [], checklist: null }));
    expect(p.done).toEqual({ model: true, markers: false, rig: false, animations: false, export: false });
    expect(p.reachable.markers).toBe(true);
    expect(p.blocked.rig).toBe(t.blockedChecking);
    expect(p.blocked.animations).toBe(t.blockedChecking);
    // the same document once the chunk is there
    expect(progressOf(input(riggedLad(true), { subject, rows: [] })).done.rig).toBe(true);
    // scene meshes need no checklist: ① done, ② reachable, ③ waits for the skeleton as before
    const s = store();
    put(s, 'meshes', mesh('msh_a', { scene: true }));
    const q = progressOf(input(s, { subject: { character: null, meshes: ['msh_a' as MeshId] }, checklist: null }));
    expect(q.done.model).toBe(true);
    expect(q.reachable.markers).toBe(true);
    expect(q.blocked.rig).toBe(t.blockedNoSkeleton);
  });

  it('autoRigProgress uses the checklist chunk once loadChecklist() resolved', async () => {
    const app = createFakeEditorApp();
    const view = riggedLad(false);
    for (const record of view.list('characters')) put(app.store, 'characters', record as never);
    for (const record of view.list('skeletons')) put(app.store, 'skeletons', record as never);
    for (const record of view.list('meshes')) put(app.store, 'meshes', record as never);
    const session = { ...defaultAutoRigSession(), subject: { character: CHAR, meshes: [] } };
    await loadChecklist();
    expect(checklistLoaded()).toBe(true);
    const p = autoRigProgress(app, session);
    expect(p.done.markers).toBe(true);
    expect(p.reachable.rig).toBe(true);
    expect(p.done.rig).toBe(false);
  });

  it('landingStep: the step when reachable, else the furthest reachable one', () => {
    const p = progressOf(input(riggedLad(false), { subject: { character: CHAR, meshes: [] }, rows: [] }));
    expect(landingStep(p, 'markers')).toBe('markers');
    expect(landingStep(p, 'export')).toBe('rig');
    expect(landingStep(progressOf(input(store())), 'animations')).toBe('model');
  });
});
