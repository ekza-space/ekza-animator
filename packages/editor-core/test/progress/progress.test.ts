// Auto-Rig's derived progress in editor-core (AUTORIG-SPEC §4.3; STUDIO-TOUCH-SPEC §20.3 item 10, T5c): §4.3's table
// over document fixtures, string-free — the blocked reasons come back in the caller's words (codes here, Auto-Rig's
// frame strings in `autorig/test/progress.test.ts`). ① done with a subject; ② reachable for scene meshes and done with
// a skeleton; ③ done when every subject mesh is bound and no `skel.*` / `skin.*` / `xform.*` error row is left;
// ④ done with a clip or skipped; an asset-sourced humanoid skips to ④; the subject resolves through Create Skeleton's
// adoption with the flow's rule (one copy, ST-T5B-8); the checklist chunk loads once; the landing step.
import { type CharacterId, derivedId, type DocumentStore, emptySnapshot, type MeshId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  AUTORIG_FLOW_PROFILE,
  autoRigChecklistLoaded,
  autoRigLandingStep,
  type AutoRigProgressInput,
  autoRigProgressNow,
  autoRigProgressOf,
  type AutoRigProgressWords,
  type EditorApp,
  autoRigSubjectRows,
  loadAutoRigChecklist,
  type RigValidationRow,
  rigChecklist,
} from '../../src';
import * as progressModule from '../../src/progress';
import { createFakeEditorApp, createNaiveStore } from '../../src/testing';

type Code = 'noModel' | 'noSkeleton' | 'notBound' | 'checking' | 'alreadyRigged' | `row: ${string}`;

/** The reasons as codes: what a shell that words them itself would pass. */
const CODES: AutoRigProgressWords<Code> = {
  blockedNoModel: 'noModel',
  blockedNoSkeleton: 'noSkeleton',
  blockedNotBound: 'notBound',
  blockedChecking: 'checking',
  alreadyRigged: 'alreadyRigged',
  blockedRow: (message) => `row: ${message}`,
};

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

const input = (view: DocumentStore, fields: Partial<AutoRigProgressInput> = {}): AutoRigProgressInput => ({
  view,
  subject: { character: null, meshes: [] },
  rows: null,
  animationsSkipped: false,
  checklist: rigChecklist,
  ...fields,
});

const progress = (view: DocumentStore, fields: Partial<AutoRigProgressInput> = {}) =>
  autoRigProgressOf(input(view, fields), CODES);

/** A model character with a skeleton and one mesh, bound or not. */
function riggedLad(bound: boolean): DocumentStore {
  const s = store();
  put(s, 'characters', character(CHAR, 'model'));
  put(s, 'skeletons', skeleton());
  put(s, 'meshes', mesh('msh_body', { character: CHAR }, bound ? { skeleton: 'skl_1', bind: null } : null));
  return s;
}

describe('editor-core progress (AUTORIG-SPEC §4.3, T5c)', () => {
  it('an empty document: only ① is reachable, nothing is done, the reasons come back in the caller’s words', () => {
    const p = progress(store());
    expect(p.done).toEqual({ model: false, markers: false, rig: false, animations: false, export: false });
    expect(p.reachable).toEqual({ model: true, markers: false, rig: false, animations: false, export: false });
    expect(p.blocked).toEqual({ markers: 'noModel', rig: 'noModel', animations: 'noModel', export: 'noModel' });
  });

  it('scene meshes: ① done, ② reachable; ③ waits for the skeleton; a subject whose meshes are gone has nothing', () => {
    const s = store();
    put(s, 'meshes', mesh('msh_a', { scene: true }));
    const p = progress(s, { subject: { character: null, meshes: ['msh_a' as MeshId] } });
    expect(p.done.model).toBe(true);
    expect(p.reachable).toMatchObject({ markers: true, rig: false, animations: false });
    expect(p.blocked.rig).toBe('noSkeleton');
    expect(progress(store(), { subject: { character: null, meshes: ['msh_a' as MeshId] } }).done.model).toBe(false);
  });

  it('a skeleton: ② done, ③ reachable; unbound meshes keep ④ blocked', () => {
    const p = progress(riggedLad(false), { subject: { character: CHAR, meshes: [] }, rows: [] });
    expect(p.done).toMatchObject({ model: true, markers: true, rig: false });
    expect(p.reachable).toMatchObject({ rig: true, animations: false, export: false });
    expect(p.blocked.animations).toBe('notBound');
  });

  it('bound without error rows: ③ done, ④ and ⑤ reachable; warnings and info rows are allowed', () => {
    const subject = { character: CHAR, meshes: [] };
    const p = progress(riggedLad(true), { subject, rows: [row('skin.review', 'warning'), row('xform.note', 'info')] });
    expect(p.done).toEqual({ model: true, markers: true, rig: true, animations: false, export: false });
    expect(p.reachable).toEqual({ model: true, markers: true, rig: true, animations: true, export: true });
    expect(p.blocked).toEqual({});
  });

  it('skel.* / skin.* / xform.* error rows block ③ and name themselves; other families do not', () => {
    const view = riggedLad(true);
    const subject = { character: CHAR, meshes: [] };
    const p = progress(view, { subject, rows: [row('xform.scale', 'error', 'Scaled unevenly')] });
    expect(p.done.rig).toBe(false);
    expect(p.blocked.animations).toBe('row: Scaled unevenly');
    expect(p.blocked.export).toBe('row: Scaled unevenly');
    expect(progress(view, { subject, rows: [row('skel.tpose', 'error')] }).done.rig).toBe(false);
    expect(progress(view, { subject, rows: [row('skin.unweighted-vertex', 'error')] }).done.rig).toBe(false);
    expect(progress(view, { subject, rows: [row('vrm.meta', 'error')] }).done.rig).toBe(true);
  });

  it('unknown rows (the rig chunk not loaded) keep ③ open: checking', () => {
    const p = progress(riggedLad(true), { subject: { character: CHAR, meshes: [] }, rows: null });
    expect(p.done.rig).toBe(false);
    expect(p.blocked.animations).toBe('checking');
  });

  it('④ is done with a clip brought in, or skipped; an empty new clip does not count; ⑤ never', () => {
    const view = riggedLad(true);
    const subject = { character: CHAR, meshes: [] };
    expect(progress(view, { subject, rows: [] }).done.animations).toBe(false);
    expect(progress(view, { subject, rows: [], animationsSkipped: true }).done.animations).toBe(true);
    put(view, 'clips', clip({ kind: 'new' }));
    expect(progress(view, { subject, rows: [] }).done.animations).toBe(false);
    view.transact({ label: 'fixture' }, (tx) =>
      tx.patch('clips', 'clp_1' as never, { source: { kind: 'imported', fileName: 'walk.vrma', asset: null } }),
    );
    expect(progress(view, { subject, rows: [] }).done.animations).toBe(true);
    expect(progress(view, { subject, rows: [] }).done.export).toBe(false);
  });

  it('an asset-sourced humanoid (VRM) skips to ④; a plain glTF asset does not', () => {
    const s = store();
    put(s, 'characters', character(VRM, 'asset', 'vrm1'));
    const p = progress(s, { subject: { character: VRM, meshes: [] } });
    expect(p.done.model).toBe(true);
    expect(p.reachable).toEqual({ model: true, markers: false, rig: false, animations: true, export: true });
    expect(p.blocked).toEqual({ markers: 'alreadyRigged', rig: 'alreadyRigged' });
    const g = store();
    put(g, 'characters', character(VRM, 'asset', 'gltf'));
    const q = progress(g, { subject: { character: VRM, meshes: [] } });
    expect(q.reachable.animations).toBe(false);
    expect(q.blocked.animations).toBe('alreadyRigged');
  });

  it('resolves the subject with the flow’s rule: Create Skeleton’s adoption leads to the model character', () => {
    const s = store();
    put(s, 'characters', character(CHAR, 'model'));
    put(s, 'skeletons', skeleton());
    put(s, 'meshes', mesh(derivedId('mesh', 'char.adopt', [CHAR, 'msh_scene'], '', 0), { character: CHAR }, null));
    const p = progress(s, { subject: { character: null, meshes: ['msh_scene' as MeshId] }, rows: [] });
    expect(p.done).toMatchObject({ model: true, markers: true });
    // one copy of the rule: the module imports it from `autorigFlow/subject` and defines none of its own
    expect(Object.keys(progressModule)).not.toContain('resolveSubject');
    expect(Object.keys(progressModule)).not.toContain('resolveAutoRigSubject');
  });

  it('the checklist not loaded: a character’s skeleton and binding are unknown (checking); scene meshes are not', () => {
    const subject = { character: CHAR, meshes: [] };
    const p = progress(riggedLad(true), { subject, rows: [], checklist: null });
    expect(p.done).toEqual({ model: true, markers: false, rig: false, animations: false, export: false });
    expect(p.reachable.markers).toBe(true);
    expect(p.blocked).toMatchObject({ rig: 'checking', animations: 'checking' });
    const s = store();
    put(s, 'meshes', mesh('msh_a', { scene: true }));
    const q = progress(s, { subject: { character: null, meshes: ['msh_a' as MeshId] }, checklist: null });
    expect(q.done.model).toBe(true);
    expect(q.blocked.rig).toBe('noSkeleton');
  });

  it('is pure: equal inputs give equal progress and the document is not touched', () => {
    const view = riggedLad(true);
    const version = view.version;
    const a = progress(view, { subject: { character: CHAR, meshes: [] }, rows: [] });
    expect(progress(view, { subject: { character: CHAR, meshes: [] }, rows: [] })).toEqual(a);
    expect(view.version).toBe(version);
  });

  it('subject rows: null without the rig chunk, an asset or a character; the flow’s profile otherwise', () => {
    const app = createFakeEditorApp();
    expect(app.rig.loaded).toBe(false);
    expect(AUTORIG_FLOW_PROFILE).toBe('ekza/space-avatar-v1');
    expect(autoRigSubjectRows(app, null)).toBeNull();
    const view = riggedLad(true);
    const record = view.get('characters', CHAR) ?? null;
    expect(autoRigSubjectRows(app, record)).toBeNull();
    const asked: (string | null)[] = [];
    const withRows = (rows: (profile: string | null) => readonly RigValidationRow[]): EditorApp =>
      ({
        store: app.store,
        rig: { loaded: true, validation: { rows: (_: CharacterId, p: string | null) => rows(p) } },
      }) as unknown as EditorApp;
    const loaded = withRows((profile) => {
      asked.push(profile);
      return [row('skin.review', 'warning')];
    });
    expect(autoRigSubjectRows(loaded, record)).toEqual([row('skin.review', 'warning')]);
    expect(asked).toEqual([AUTORIG_FLOW_PROFILE]);
    const throwing = withRows(() => {
      throw new Error('not ready');
    });
    expect(autoRigSubjectRows(throwing, record)).toBeNull();
  });

  it('progress now reads the app: before the checklist chunk a character is unknown, after it is known', async () => {
    const app = createFakeEditorApp();
    expect(autoRigProgressNow(app, { character: null, meshes: [] }, false, CODES).reachable.model).toBe(true);
    const view = riggedLad(false);
    for (const record of view.list('characters')) put(app.store, 'characters', record as never);
    for (const record of view.list('skeletons')) put(app.store, 'skeletons', record as never);
    for (const record of view.list('meshes')) put(app.store, 'meshes', record as never);
    const subject = { character: CHAR, meshes: [] };
    // the first load of this file (vitest isolates modules per file)
    expect(autoRigChecklistLoaded()).toBe(false);
    expect(autoRigProgressNow(app, subject, false, CODES).blocked.rig).toBe('checking');
    const first = loadAutoRigChecklist();
    expect(loadAutoRigChecklist()).toBe(first);
    await first;
    expect(autoRigChecklistLoaded()).toBe(true);
    const p = autoRigProgressNow(app, subject, false, CODES);
    expect(p.done).toMatchObject({ markers: true, rig: false });
    expect(p.reachable.rig).toBe(true);
    expect(p.blocked.animations).toBe('notBound');
    expect(autoRigProgressNow(app, subject, true, CODES).done.animations).toBe(true);
  });

  it('landing step: the step when reachable, else the furthest reachable one', () => {
    const p = progress(riggedLad(false), { subject: { character: CHAR, meshes: [] }, rows: [] });
    expect(autoRigLandingStep(p, 'markers')).toBe('markers');
    expect(autoRigLandingStep(p, 'export')).toBe('rig');
    expect(autoRigLandingStep(progress(store()), 'animations')).toBe('model');
  });
});
