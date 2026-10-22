// AUTORIG-SPEC §4.3, §5.4 (D4): ③ Rig's pure parts — the `rig` slice reducers, `paintedSinceBind` (a finished
// `skin.weights.*` run with a history step sets it, a `skin.bind` or Create Skeleton clears it, a run without a step
// changes nothing; fed by the registry's `onBeforeDocumentRun` hook, so a composition's inner runs count), the pane
// grid (Adjust joints in front │ side │ persp, a phone in 3D), the sheet's stage order and the straighten decision.
import { emptySnapshot } from '@ekza-studio/doc';
import type { OperatorDef } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { createAutoRigSessionStore, defaultAutoRigSession } from '../../../src/session';
import { RIG_SLICE, rigPanes } from '../../../src/steps/rig/index';
import {
  MOTION_CLIPS,
  paintedAfterRun,
  paintTracked,
  SUB_MODE,
  withMotionClip,
  withSub,
} from '../../../src/steps/rig/slice';
import { watchPaintedSinceBind } from '../../../src/steps/rig/painted';
import { rebindUnasked, stageAfter } from '../../../src/steps/rig/run';

describe('the rig slice (§4.3, §5.4)', () => {
  it('starts in review with the Walk motion test on', () => {
    expect(RIG_SLICE).toEqual({
      sub: 'review',
      motionTest: true,
      motionClip: 'walk',
      paintedSinceBind: false,
      rigidParts: null,
      torn: null,
    });
    expect(MOTION_CLIPS).toEqual(['walk', 'sword-attack', 'dance']);
    expect(SUB_MODE).toEqual({ review: 'object', adjust: 'skeleton', paint: 'skin' });
  });

  it('switches sub-tools and motion clips', () => {
    expect(withSub(RIG_SLICE, 'review')).toEqual({});
    expect(withSub(RIG_SLICE, 'adjust')).toEqual({ sub: 'adjust' });
    expect(withMotionClip(RIG_SLICE, 'walk')).toEqual({});
    expect(withMotionClip(RIG_SLICE, 'dance')).toEqual({ motionClip: 'dance', motionTest: true });
    expect(withMotionClip({ ...RIG_SLICE, motionTest: false }, 'walk')).toEqual({
      motionClip: 'walk',
      motionTest: true,
    });
  });

  it('paintedSinceBind: weight edits set it, a bind or Create Skeleton clears it, other runs leave it', () => {
    expect(paintedAfterRun('skin.weights.paint', false)).toBe(true);
    expect(paintedAfterRun('skin.weights.flood', false)).toBe(true);
    expect(paintedAfterRun('skin.weights.mirror', false)).toBe(true);
    expect(paintedAfterRun('skin.bind', true)).toBe(false);
    expect(paintedAfterRun('skel.quickRig.commit', true)).toBe(false);
    expect(paintedAfterRun('skel.joint.move', true)).toBe(true);
    expect(paintedAfterRun('skel.joint.move', false)).toBe(false);
    expect(['skin.weights.paint', 'skin.bind', 'skel.quickRig.commit', 'skel.joint.move'].map(paintTracked)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('the re-rig asks the rebind question only when weights could be lost (AR-D8-8)', () => {
  it('skips it while the bound meshes are the revisions the wizard bound and nothing was painted', () => {
    const refit = { bind: false };
    expect(rebindUnasked(refit, false, 'msh_a:111', 'msh_a:111')).toBe(true);
    // painted here, a revision written since (painted in Studio, an import), or never bound by the wizard: ask
    expect(rebindUnasked(refit, true, 'msh_a:111', 'msh_a:111')).toBe(false);
    expect(rebindUnasked(refit, false, 'msh_a:111', 'msh_a:222')).toBe(false);
    expect(rebindUnasked(refit, false, null, 'msh_a:111')).toBe(false);
    expect(rebindUnasked(refit, false, null, null)).toBe(false);
    // a first run binds (no refit question at all)
    expect(rebindUnasked({ bind: true }, false, 'msh_a:111', 'msh_a:111')).toBe(false);
  });
});

describe('the ③ pane grid (§4.2, §8.3)', () => {
  const session = defaultAutoRigSession();
  it('review and paint in one persp pane; Adjust joints in front │ side │ persp; a phone keeps the 3D pane', () => {
    expect(rigPanes(session, 1440)).toEqual([{ id: 'pane-persp' }]);
    const adjust = { ...session, rig: { ...session.rig, sub: 'adjust' as const } };
    expect(rigPanes(adjust, 1440).map((pane) => [pane.id, pane.size])).toEqual([
      ['pane-front', 40],
      ['pane-side', 30],
      ['pane-persp', 30],
    ]);
    expect(rigPanes(adjust, 800).map((pane) => pane.id)).toEqual(['pane-front', 'pane-side']);
    expect(rigPanes(adjust, 390)).toEqual([{ id: 'pane-persp' }]);
    expect(rigPanes({ ...session, rig: { ...session.rig, sub: 'paint' } }, 1440)).toEqual([{ id: 'pane-persp' }]);
  });
});

describe("the progress sheet's stages (§5.4)", () => {
  it('follow the inner steps: skeleton → skin → (straighten) → check', () => {
    const plain = { bind: true, straighten: false };
    const aPose = { bind: true, straighten: true };
    const refit = { bind: false, straighten: false };
    expect(stageAfter('Create Skeleton', plain)).toBe('skin');
    expect(stageAfter('Bind Skin', plain)).toBe('check');
    expect(stageAfter('Bind Skin', aPose)).toBe('straighten');
    expect(stageAfter('Straighten to T-Pose', aPose)).toBe('check');
    expect(stageAfter('Refit Skeleton', refit)).toBe('check');
    expect(stageAfter('Import Static Model', plain)).toBeNull();
    expect(stageAfter(undefined, plain)).toBeNull();
  });
});

describe('the paintedSinceBind listener (§4.3)', () => {
  /** An undoable operator that adds one scene mesh (any document write records a step). */
  const writer = (id: string): OperatorDef<unknown, unknown, unknown> => {
    let n = 0;
    return {
      id,
      label: id,
      description: id,
      category: 'skin',
      scope: 'global',
      flags: { undo: true },
      apply({ tx }: { readonly tx: { put(table: 'meshes', record: never): void } | null }) {
        n += 1;
        tx?.put('meshes', {
          id: `msh_${id.replace(/\W/g, '')}${n}`.slice(0, 20).padEnd(20, '0'),
          name: 'm',
          owner: { scene: true },
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
          skin: null,
          budget: null,
          handheld: null,
          deleted: null,
        } as never);
      },
    } as unknown as OperatorDef<unknown, unknown, unknown>;
  };
  const refuser = (id: string): OperatorDef<unknown, unknown, unknown> =>
    ({
      id,
      label: id,
      description: id,
      category: 'skin',
      scope: 'global',
      flags: { undo: true },
      apply() {
        throw new Error('refused');
      },
    }) as unknown as OperatorDef<unknown, unknown, unknown>;

  it('sets on a weight edit with a step, clears on a bind, ignores runs without a step; reference-counted', async () => {
    const app = createFakeEditorApp({ snapshot: emptySnapshot() });
    for (const def of [
      writer('skin.weights.paint'),
      writer('skin.bind'),
      writer('scene.other'),
      refuser('skin.weights.flood'),
    ]) {
      app.contribute({ kind: 'operator', def });
    }
    const session = createAutoRigSessionStore();
    const painted = () => session.getState().rig.paintedSinceBind;
    const off = watchPaintedSinceBind(app, session);
    const second = watchPaintedSinceBind(app, session);
    expect((await app.runUntyped('skin.weights.paint')).status).toBe('finished');
    expect(painted()).toBe(true);
    expect((await app.runUntyped('scene.other')).status).toBe('finished');
    expect(painted()).toBe(true);
    expect((await app.runUntyped('skin.bind')).status).toBe('finished');
    expect(painted()).toBe(false);
    // a weight edit that records no step changes nothing
    expect((await app.runUntyped('skin.weights.flood')).status).toBe('failed');
    expect(painted()).toBe(false);
    // conservative: an undone stroke still counts
    await app.runUntyped('skin.weights.paint');
    app.history.undo();
    expect(painted()).toBe(true);
    // one disposer of two keeps it; the second stops it
    off();
    await app.runUntyped('skin.bind');
    expect(painted()).toBe(false);
    second();
    await app.runUntyped('skin.weights.paint');
    expect(painted()).toBe(false);
  });
});
