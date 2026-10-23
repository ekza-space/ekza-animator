// MCP-SPEC §0.4.4 (B4): the character setup tools, headless, through the tool runtime.
// - MVP-AC-3: project_import {sample: 'polybot_tpose'} → model_inspect → rig_create → library_use {clip: 'walk'} →
//   project_export {kind: 'vrm'} (the reference script of the rig_and_animate prompt): two rig steps (+1 straighten
//   for polybot_apose), every step `AI: …` by the agent and undone one by one, the walk keys the legs, the VRM 1.0
//   reads back with 15+ humanoid bones and no error lint (every vrm.* lint ran).
// - The gates: ① Size (AR-R5-1: outside 0.3–3 m rig_create refuses and names model_fix scale), the arms (AR-D10-3:
//   refused until shoulder, elbow and wrist markers are passed), the start checks; a refused rig leaves no step and
//   closes the Quick Rig it opened. An undo between the inner steps stops the rig as `stale`, the steps made stay.
// - Live: rig_create needs Edit + View and the confirm card; library_use leaves the user's active clip alone.
// - The §0.4.4 policy rows.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { type EditorApp, QUICK_RIG_MARKERS, quickRigOf } from '@ekza-studio/editor-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import {
  type AgentToolError,
  type AgentToolResult,
  agentPolicyOf,
  type ConfirmPrompt,
  manifestToolOf,
  OPERATOR_POLICY,
  PROMPTS,
} from '../src';
import { MARKER_NAMES } from '../src/tools/setup/common';
import { COMPOSITION_INTERRUPTED } from '../src/tools/setup/run';
import { host, LIVE } from './p2-support';
import {
  caller,
  memoryWorkspace,
  ok,
  repoFile,
  rigAndAnimateScript,
  serveLibrary,
  setupApp,
  setupHost,
  setupRuntime,
  setupTools,
} from './setup-support';
import { AGENT } from './support';

let restore: () => void = () => {};
beforeAll(() => {
  restore = serveLibrary();
});
afterAll(() => restore());

/** The error of a failed result (throws on success: test diagnostics). */
function failure(result: AgentToolResult<unknown>): AgentToolError {
  if (result.ok) throw new Error(`tool succeeded: ${JSON.stringify(result.data)}`);
  return result.error;
}

const historyLabels = (app: EditorApp): string[] => app.history.entries().undo.map((step) => step.label);

function characterId(app: EditorApp, name: string): CharacterId {
  const record = app.store.list('characters').find((character) => character.name === name);
  if (record === undefined) throw new Error(`no character ${name}`);
  return record.id;
}

/** The control keys of a clip's curves that carry at least two keys. */
function keyedControls(app: EditorApp, clip: ClipId): string[] {
  const out = new Set<string>();
  for (const curve of app.store.query.curvesOfClip(clip)) {
    if (app.store.query.keysOfCurve(curve.id).length < 2) continue;
    const control = app.store.get('controls', curve.control);
    if (control !== undefined) out.add(control.key);
  }
  return [...out];
}

interface ExportData {
  artifacts: {
    fileName: string;
    path: string | null;
    bytes: number;
    delivered: string;
    lints: { id: string; severity: string }[];
    readBack: { format: string; humanoidBones: number; joints: number; triangles: number };
  }[];
}

describe('MVP-AC-3: rig a static model, add a walk, export a VRM (headless)', () => {
  for (const [sample, straightened] of [
    ['polybot_tpose', false],
    ['polybot_apose', true],
  ] as const) {
    it(`${sample}: ${straightened ? 3 : 2} rig steps, every step AI, walk keyed, VRM 1.0 with 15+ humanoid bones`, async () => {
      const app = setupApp();
      const workspace = memoryWorkspace();
      const call = caller(setupRuntime(app, setupHost(workspace)));
      const results = await rigAndAnimateScript(call, { sample });
      // every result envelope validates against the tool's advertised outputSchema (§5.3, §5.21)
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      for (const [name, result] of Object.entries(results)) {
        const tool = setupTools().find((entry) => entry.name === name);
        if (tool === undefined) throw new Error(`no tool ${name}`);
        const validate = ajv.compile(manifestToolOf(tool).outputSchema);
        const envelope: unknown = JSON.parse(JSON.stringify(result));
        expect([name, validate(envelope) ? 'valid' : ajv.errorsText(validate.errors)]).toEqual([name, 'valid']);
      }

      const imported = ok<{ model: { readyToRig: boolean; pose: string; meshes: string[] } }>(
        results['project_import'] as never,
      );
      expect(imported.model.pose).toBe(straightened ? 'a_pose' : 't_pose');
      const inspected = ok<{ readyToRig: boolean; heightM: number }>(results['model_inspect'] as never);
      expect(inspected.readyToRig).toBe(true);

      const rig = ok<{
        character: string;
        steps: string[];
        straightened: boolean;
        joints: number;
        validation: { code: string; severity: string }[];
      }>(results['rig_create'] as never);
      expect(rig.straightened).toBe(straightened);
      expect(rig.steps).toEqual([
        'AI: Create Skeleton',
        'AI: Bind Skin',
        ...(straightened ? ['AI: Straighten to T-Pose'] : []),
      ]);
      expect(rig.joints).toBeGreaterThanOrEqual(15);
      expect(rig.validation.filter((row) => row.severity === 'error' && /^(skel|skin|xform)\./.test(row.code))).toEqual(
        [],
      );

      const use = ok<{ clip: string; loop: boolean; activated: boolean }>(results['library_use'] as never);
      expect(use).toMatchObject({ clip: 'Walk', loop: true, activated: true });
      const character = characterId(app, rig.character);
      const walk = app.store.query.clipsOfCharacter(character).find((clip) => clip.name === 'Walk');
      expect(walk).toBeDefined();
      const legs = keyedControls(app, walk?.id as ClipId).filter((key) => /leg|Leg|foot|Foot/.test(key));
      expect(legs.length).toBeGreaterThan(0);

      const exported = ok<ExportData>(results['project_export'] as never);
      const [artifact] = exported.artifacts;
      expect(artifact?.fileName).toMatch(/\.vrm$/);
      expect(artifact?.delivered).toBe('workspace');
      expect(artifact?.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
      expect(artifact?.readBack.format).toBe('vrm1');
      expect(artifact?.readBack.humanoidBones).toBeGreaterThanOrEqual(15);
      const bytes = workspace.files.get(artifact?.path ?? '');
      expect(bytes?.byteLength).toBe(artifact?.bytes);
      const out = process.env['EKZA_B4_VRM_OUT'];
      if (out !== undefined && out !== '' && bytes !== undefined) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${sample}.vrm`, bytes);
      }

      // every step since the import is the agent's, labelled AI: …, and Mod+Z undoes them one by one
      const steps = app.history.entries().undo;
      expect(steps.every((step) => step.actor?.id === AGENT.id && step.label.startsWith('AI: '))).toBe(true);
      expect(historyLabels(app)).toEqual([
        'AI: Import Static Model',
        'AI: Create Skeleton',
        'AI: Bind Skin',
        ...(straightened ? ['AI: Straighten to T-Pose'] : []),
        'AI: Use Clip Walk',
        'AI: VRM Meta',
      ]);
      let undone = 0;
      while (app.history.canUndo()) {
        app.history.undo();
        undone++;
      }
      expect(undone).toBe(steps.length);
      expect(app.store.list('characters')).toEqual([]);
    }, 60_000);
  }

  it('the rig_and_animate prompt names the tools of its reference script, in order', () => {
    const prompt = PROMPTS.find((entry) => entry.name === 'rig_and_animate');
    expect(prompt?.tools).toEqual([
      'model_inspect',
      'history_checkpoint',
      'model_fix',
      'rig_create',
      'library_list',
      'library_use',
      'project_export',
    ]);
    const text = prompt?.plan?.({ clip: 'run', author: 'Ann', license: 'cc0' }) ?? '';
    expect(text).toContain('library_use {character, clip: "run"}');
    expect(text).toContain('meta: {authors: ["Ann"], license: "cc0"}');
    expect(prompt?.plan?.({}) ?? '').toContain('ask the user for the author and the licence');
  });
});

describe('the Auto-Rig gates (headless)', () => {
  it('① Size (AR-R5-1): a 5 m model is refused with model_fix scale, nothing written, Quick Rig closed', async () => {
    const app = setupApp(7);
    const call = caller(setupRuntime(app));
    ok(await call('project_import', { sample: 'cube_lad' }));
    const meshes = app.store.list('meshes').map((mesh) => mesh.id);
    // the user (or a file in centimetres) made it 5 m tall: the tool's own fix stops at 3 m
    const scaled = await app.runUntyped('autorig.fix', { fix: 'scale', meshes, height: 5 });
    expect(scaled.status).toBe('finished');
    const report = ok<{ checks: { scaleOk: boolean }; fixes: { fix: string; hint: string }[]; readyToRig: boolean }>(
      await call('model_inspect', {}),
    );
    expect(report.checks.scaleOk).toBe(false);
    expect(report.readyToRig).toBe(false);
    expect(report.fixes.map((fix) => fix.fix)).toContain('scale');
    const before = historyLabels(app);
    const refused = failure(await call('rig_create', {}));
    expect(refused.code).toBe('poll_failed');
    expect(refused.message).toMatch(/5\.00 m tall: press Set height/);
    expect(refused.hint).toMatch(/model_fix \{fix: 'scale', heightM: 1\.7\}/);
    expect(historyLabels(app)).toEqual(before);
    expect(quickRigOf(app)).toBeNull();
    // the schema keeps the agent's own fix inside the gate
    const tooTall = await call('model_fix', { fix: 'scale', heightM: 5 });
    expect(tooTall.ok ? 'ok' : tooTall.error.code).toBe('invalid_args');
    const fixed = ok<{ heightM: number; readyToRig: boolean }>(await call('model_fix', { fix: 'scale', heightM: 1.7 }));
    expect(fixed.heightM).toBeCloseTo(1.7, 3);
    expect(fixed.readyToRig).toBe(true);
    const rig = ok<{ steps: string[] }>(await call('rig_create', {}));
    expect(rig.steps).toEqual(['AI: Create Skeleton', 'AI: Bind Skin']);
  }, 60_000);

  it('the start checks: an off-centre model names model_fix center', async () => {
    const app = setupApp(8);
    const call = caller(setupRuntime(app));
    ok(await call('project_import', { sample: 'cube_lad' }));
    const mesh = app.store.list('meshes')[0];
    if (mesh === undefined) throw new Error('no mesh');
    const moved = await app.runUntyped('scene.object.transform', {
      ids: [mesh.id],
      placements: [{ ...mesh.placement, t: [0.6, 0.2, 0] }],
    });
    expect(moved.status).toBe('finished');
    const report = ok<{ fixes: { fix: string }[] }>(await call('model_inspect', {}));
    expect(report.fixes.map((fix) => fix.fix)).toEqual(['center']);
    const refused = await call('rig_create', {});
    expect(refused.ok ? null : [refused.error.code, refused.error.hint]).toEqual([
      'poll_failed',
      "model_fix {fix: 'center'} first",
    ]);
    ok(await call('model_fix', { fix: 'center' }));
    expect(ok<{ steps: string[] }>(await call('rig_create', {})).steps).toHaveLength(2);
  }, 60_000);

  it('the arms (AR-D10-3): a failed guess waits for shoulder, elbow and wrist markers', async () => {
    const app = setupApp(9);
    const call = caller(setupRuntime(app));
    ok(await call('project_import', { sample: 'cube_lad' }));
    // an arms-down model: the One-Click guess finds no arm run (as rig.test.ts simulates it)
    const off = app.session.subscribe((state) => {
      const quickRig = state.rig.quickRig;
      if (quickRig === null || quickRig.guess === null || quickRig.guess.failed !== null) return;
      app.session.setState({
        rig: { ...state.rig, quickRig: { ...quickRig, guess: { armAngle: 0, aPose: false, failed: 'No arm run' } } },
      });
    });
    try {
      const refused = failure(await call('rig_create', {}));
      expect(refused.code).toBe('poll_failed');
      expect(refused.message).toMatch(/could not find the arms/);
      expect(refused.hint).toMatch(/shoulder.*elbow.*wrist/);
      expect(quickRigOf(app)).toBeNull();
      expect(historyLabels(app)).toEqual(['AI: Import Static Model']);
      const truth = JSON.parse(new TextDecoder().decode(repoFile('fixtures/models/cube-lad-truth.json'))) as {
        markers: Record<string, [number, number, number]>;
      };
      const markers = (['shoulder', 'elbow', 'wrist'] as const).map((name) => ({
        name,
        positionM: truth.markers[name],
      }));
      const rig = ok<{ steps: string[]; joints: number }>(await call('rig_create', { markers }));
      expect(rig.steps).toEqual(['AI: Create Skeleton', 'AI: Bind Skin']);
    } finally {
      off();
    }
  }, 60_000);

  it('an undo between the inner steps stops the rig as stale; the steps made stay', async () => {
    const app = setupApp(10);
    const call = caller(setupRuntime(app));
    ok(await call('project_import', { sample: 'cube_lad' }));
    // the user presses Mod+Z right after Create Skeleton (between the composition's inner runs)
    let pressed = false;
    const off = app.store.subscribe(() => {
      if (pressed || app.history.peekUndo()?.label !== 'AI: Create Skeleton') return;
      pressed = true;
      queueMicrotask(() => void app.runUntyped('edit.undo'));
    });
    try {
      const result = failure(await call('rig_create', {}));
      expect(result.code).toBe('stale');
      expect(result.message).toContain(COMPOSITION_INTERRUPTED);
      expect(app.history.entries().undo.some((step) => step.label === 'AI: Bind Skin')).toBe(false);
      expect(quickRigOf(app)).toBeNull();
    } finally {
      off();
    }
  }, 60_000);

  it('unknown meshes answer not_found with candidates; an empty scene names project_import', async () => {
    const app = setupApp(11);
    const call = caller(setupRuntime(app));
    ok(await call('project_import', { sample: 'cube_lad' }));
    const missing = await call('model_inspect', { meshes: ['nope'] });
    expect(missing.ok ? null : [missing.error.code, (missing.error.candidates ?? []).length > 0]).toEqual([
      'not_found',
      true,
    ]);
    const empty = caller(setupRuntime(setupApp(12)));
    const none = await empty('rig_create', {});
    expect(none.ok ? null : [none.error.code, none.error.hint]).toEqual([
      'not_found',
      expect.stringContaining('project_import'),
    ]);
  }, 60_000);
});

describe('live host (simulated user)', () => {
  it('rig_create needs Edit and View and the confirm card; library_use keeps the user’s clip', async () => {
    const app = setupApp(13);
    const head = caller(setupRuntime(app));
    ok(await head('project_import', { sample: 'polybot_tpose' }));
    const prompts: ConfirmPrompt[] = [];
    const noView = caller(
      setupRuntime(app, setupHost(null, host({ mode: 'live', capabilities: LIVE, grants: { view: false } }))),
    );
    const refused = await noView('rig_create', {});
    expect(refused.ok ? null : refused.error.code).toBe('not_granted');
    const live = caller(
      setupRuntime(
        app,
        setupHost(null, host({ mode: 'live', capabilities: LIVE, grants: { view: true }, answer: 'allow', prompts })),
      ),
    );
    const selection = app.session.getState().selection;
    const time = app.session.getState().time;
    const rig = ok<{ character: string; steps: string[] }>(await live('rig_create', {}));
    expect(prompts.map((prompt) => prompt.title)).toEqual(['AI wants to rig the model']);
    expect(prompts[0]?.detail).toMatch(/2–3 undo steps/);
    expect(rig.steps).toHaveLength(2);
    // documented (rig_create's description): the new character's mesh is selected, as in the wizard; the playhead stays
    expect(app.session.getState().selection).not.toBe(selection);
    expect(app.session.getState().time).toBe(time);
    const character = characterId(app, rig.character);
    // the character's first clip becomes its active clip (the session keeper: a character always shows a clip)
    ok(await live('library_use', { character: rig.character, clip: 'walk' }));
    const active = app.session.getState().activeClip[character];
    expect(active).toBeDefined();
    const use = ok<{ activated: boolean; clip: string }>(
      await live('library_use', { character: rig.character, clip: 'idle', name: 'Breathe' }),
    );
    expect(use).toMatchObject({ activated: false, clip: 'Breathe' });
    expect(app.session.getState().activeClip[character]).toBe(active);
    expect(historyLabels(app).slice(-2)).toEqual(['AI: Use Clip Idle', 'AI: Rename Clip']);
    // a declined card changes nothing
    const deny = caller(
      setupRuntime(
        app,
        setupHost(null, host({ mode: 'live', capabilities: LIVE, grants: { view: true }, answer: 'deny' })),
      ),
    );
    const before = historyLabels(app);
    const declined = await deny('rig_create', {});
    expect(declined.ok ? null : declined.error.code).toBe('declined');
    expect(historyLabels(app)).toEqual(before);
  }, 60_000);
});

describe('§0.4.4 policy rows and contracts', () => {
  it('classifies the Auto-Rig, Quick Rig, skin and library operators as the spec says', () => {
    const policy = (id: string) => agentPolicyOf(id, undefined);
    expect(policy('autorig.inspect')).toMatchObject({ policy: 'allowed', access: 'view' });
    expect(policy('autorig.fix')).toEqual({ policy: 'allowed', access: 'edit' });
    expect(policy('autorig.clip.add')).toEqual({ policy: 'allowed', access: 'edit' });
    expect(policy('library.useClip')).toEqual({ policy: 'allowed', access: 'edit' });
    for (const id of ['autorig.rig', 'autorig.sample', 'autorig.intake']) {
      expect([id, policy(id).policy, policy(id).access]).toEqual([id, 'confirm', 'view']);
    }
    for (const id of [
      'autorig.export',
      'autorig.cancel',
      'autorig.navigate',
      'autorig.controls',
      'autorig.parts',
      'skel.quickRig.start',
      'skel.quickRig.commit',
      'skin.bind',
      'skin.weights.paint',
      'skin.paint.set',
      'library.preview',
      'library.stop',
      'library.open',
    ]) {
      expect([id, policy(id).policy]).toEqual([id, 'denied']);
    }
    expect(policy('skin.weights.smooth').reason).toBe('weight edits are not available to agents yet');
  });

  it('classifies every operator of the lazy rig-workspace and clip-library chunks with those prefixes', async () => {
    const app = setupApp(14);
    await app.rig.load();
    await app.library.load();
    const ids = app.operators
      .list()
      .map((def) => def.id)
      .filter((id) => /^(autorig\.|skel\.quickRig\.|skin\.|library\.)/.test(id));
    expect(ids.length).toBeGreaterThan(30);
    expect(ids.filter((id) => !Object.hasOwn(OPERATOR_POLICY, id))).toEqual([]);
  });

  it('keeps the marker names equal to Quick Rig’s', () => {
    expect([...MARKER_NAMES]).toEqual([...QUICK_RIG_MARKERS]);
  });
});
