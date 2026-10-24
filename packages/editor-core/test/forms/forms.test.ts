// The touch shell's pre-run forms (STUDIO-TOUCH-SPEC §5.6, §20.3 item 6; T5a): one form per operator, each naming a
// live operator that cannot be adjusted after the run and declares no ParamDefs of its own; every UI wrapper has one;
// defaults equal the operator's own; `formArgs` nests dotted values over the form's base; `formOf` falls back to the
// ParamDefs of a non-adjustable operator and gives nothing for an adjustable one (after-run chips).
import { DEFAULT_REDUCE } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { createHeadlessEditorApp, loadModelOperators, loadUiWrappers, UI_WRAPPER_IDS } from '../../src';
import { TWEEN_LIMIT, TWEEN_OVERSHOOT_LIMIT } from '../../src/edit/tween';
import {
  FORM_BLEND_FRAMES,
  FORM_CLIP_RANGE,
  FORM_DEFS,
  FORM_TWEEN_LIMITS,
  formArgs,
  formDefaults,
  formOf,
} from '../../src/forms';
import { formProblems } from '../../src/forms/problems';
import { IDENTITY_CLIP_PARAMS } from '../../src/library/params';
import type { EditorApp } from '../../src/types';
import { DEFAULT_BLEND_FRAMES } from '../../src/workflows/loop';
import { DEFAULT_CLIP_RANGE } from '../../src/workflows/records';
import { refusal, runOk, waveApp, WAVE } from '../wrappers/support';

/** A headless app with every lazy operator chunk loaded (rig workspace, clip library, Model, agent, UI wrappers). */
async function everyOperator(): Promise<EditorApp> {
  const app = createHeadlessEditorApp();
  await Promise.all([app.rig.load(), app.library.load(), loadModelOperators(), loadUiWrappers(app)]);
  return app;
}

describe('FORM_DEFS', () => {
  it('names live, non-adjustable operators without ParamDefs, and every form is well formed', async () => {
    const app = await everyOperator();
    expect(FORM_DEFS.size).toBe(20);
    for (const [id, form] of FORM_DEFS) {
      expect([id, form.id]).toEqual([id, id]);
      expect([id, formProblems(form)]).toEqual([id, []]);
      const def = app.operators.get(id);
      expect([id, def !== undefined]).toEqual([id, true]);
      expect([id, def?.flags?.adjustable === true, def?.params]).toEqual([id, false, undefined]);
      expect([id, formOf(id, def)?.source]).toEqual([id, 'form']);
    }
  });

  it('gives every UI wrapper a form', () => {
    for (const id of UI_WRAPPER_IDS) expect([id, FORM_DEFS.has(id)]).toEqual([id, true]);
  });

  it("keeps the operators' own defaults", () => {
    expect(FORM_BLEND_FRAMES).toBe(DEFAULT_BLEND_FRAMES);
    expect(FORM_TWEEN_LIMITS).toEqual({ limit: TWEEN_LIMIT, overshoot: TWEEN_OVERSHOOT_LIMIT });
    expect(FORM_CLIP_RANGE).toEqual(DEFAULT_CLIP_RANGE);
    expect(formArgs(FORM_DEFS.get('graph.curves.simplify') ?? { params: [] }).args).toEqual({
      tolerance: DEFAULT_REDUCE,
    });
    expect(formArgs(FORM_DEFS.get('clip.new') ?? { params: [] }).args).toEqual({
      range: { start: 0, end: 60 },
      loop: false,
    });
    expect(formDefaults(FORM_DEFS.get('rig.ikFk.matchRange') ?? { params: [] })).toEqual({ side: 'ik', step: null });
  });
});

describe('formArgs', () => {
  it('nests dotted values over the base, clamps like an option box and leaves "auto" out', () => {
    const useClip = FORM_DEFS.get('library.useClip');
    if (useClip === undefined) throw new Error('no form');
    const { args, problems } = formArgs(
      useClip,
      { 'params.speed': 9, 'params.inPlace': true },
      { character: 'chr_A', clip: 'walk' },
    );
    expect(args).toEqual({
      character: 'chr_A',
      clip: 'walk',
      params: { ...IDENTITY_CLIP_PARAMS, speed: 3, inPlace: true },
    });
    expect(problems).toEqual(['params.speed clamped to 3']);
    const matchRange = FORM_DEFS.get('rig.ikFk.matchRange') ?? { params: [] };
    expect(formArgs(matchRange, {}, { limb: 'arm.L' }).args).toEqual({ limb: 'arm.L', side: 'ik' });
    expect(formArgs(matchRange, { step: 'frames' }, { limb: 'arm.L' }).args).toEqual({
      limb: 'arm.L',
      side: 'ik',
      step: 'frames',
    });
  });

  it('runs what the form shows: Make Loop and New Clip with their defaults', async () => {
    const app = await waveApp();
    await runOk(app, 'clip.loop', formArgs(FORM_DEFS.get('clip.loop') ?? { params: [] }).args);
    expect(app.history.peekUndo()?.label).toBe('Make Loop "wave"');
    await runOk(app, 'clip.new', formArgs(FORM_DEFS.get('clip.new') ?? { params: [] }).args);
    expect(app.history.peekUndo()?.label).toBe('New Clip');
    const scale = formArgs(FORM_DEFS.get('key.scaleValues') ?? { params: [] }).args;
    expect(scale).toEqual({ factor: 1.25, pivot: 'rest' });
    expect(await refusal(app, 'key.scaleValues', { ...scale, clip: WAVE.clip })).toBe(
      'Select keys, channels or animated controls first',
    );
  });
});

describe('formOf', () => {
  it("uses a non-adjustable operator's ParamDefs, and gives no form to adjustable operators", async () => {
    const app = await everyOperator();
    const adjustable = app.operators.list().filter((def) => def.flags?.adjustable === true);
    expect(adjustable.length).toBeGreaterThan(0);
    for (const def of adjustable) expect([def.id, formOf(def.id, def)]).toEqual([def.id, null]);
    const own = app.operators
      .list()
      .find(
        (def) =>
          def.params !== undefined &&
          def.flags?.adjustable !== true &&
          def.params.some((p) => p.hidden !== true && p.kind !== 'data'),
      );
    expect(own).toBeDefined();
    expect(formOf(own?.id ?? '', own)).toMatchObject({ id: own?.id, source: 'params', params: own?.params });
    expect(formOf('edit.undo', app.operators.get('edit.undo'))).toBeNull();
  });
});
