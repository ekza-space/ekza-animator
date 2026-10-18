// M2A-SPEC §1.2 (integration): the M2a-core fallback of the M2a-stretch mesh-pick → IK control mapping. A mesh click
// on a limb in IK (`ikFk > 0.5`) keeps selecting the FK control the bone maps to and says "IK limb: pick the IK
// control"; FK limbs, control and joint picks, and characters without limbs say nothing.
import type { CharacterId, ControlId, RigId } from '@ekza-animator/doc';
import { registerBuiltinOperators } from '@ekza-animator/editor-core';
import {
  createFakeIkEditorApp,
  type FakeEditorApp,
  type FakeServices,
  fixtureControl,
  withLimbIkRecords,
} from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { PickResult } from '../src';
import type { ViewportToolHost } from '../src/tools/host';
import { MESH_PICK_IK_HINT, SelectBehaviour } from '../src/tools/selectTool';
import { createRig, fixtures, type Rig } from './helpers';

const RIG = 'rig_SyntheticWave001' as RigId;
const CHARACTER = 'chr_SyntheticWave001' as CharacterId;
const PANE = 'pane-single';
const c = (key: string): ControlId => fixtureControl(RIG, key);

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

/** The IK fixture (legs IK, arms FK) with a select behaviour whose picks are scripted. */
async function ikPicks(): Promise<{
  readonly r: Rig;
  readonly pick: (hits: readonly PickResult[], mode?: 'replace' | 'toggle') => void;
  readonly hints: () => string[];
}> {
  const { snapshot, skeleton } = await fixtures();
  const app = createFakeIkEditorApp({ snapshot: withLimbIkRecords(snapshot), skeleton });
  registerBuiltinOperators(app);
  rig = await createRig({ app: app as FakeEditorApp });
  rig.layout('single');
  rig.frame();
  const r = rig;
  let next: readonly PickResult[] = [];
  const host: ViewportToolHost = { ...r.vm.toolHost, pickCandidates: () => next };
  const behaviour = new SelectBehaviour(r.app, host);
  let x = 10;
  return {
    r,
    pick(hits, mode = 'replace') {
      next = hits;
      x += 40; // a new spot each time: no click cycling
      behaviour.click(PANE, x, 10, mode);
    },
    hints: () => (r.app.services as FakeServices).toasts.filter((t) => t.text === MESH_PICK_IK_HINT).map((t) => t.kind),
  };
}

const mesh = (control: ControlId | null): PickResult => ({ kind: 'mesh', character: CHARACTER, node: 1, control });
const selected = (r: Rig): readonly ControlId[] => r.app.session.getState().selection.controls;

describe('mesh pick on an IK limb (§1.2 fallback)', () => {
  it('selects the FK control and hints at the IK control while the leg is IK', async () => {
    const { r, pick, hints } = await ikPicks();
    expect(r.app.evaluation.ikFk(CHARACTER, 'leg.L')).toBe(1);
    pick([mesh(c('fk.lowerLeg.L'))]);
    expect(selected(r)).toEqual([c('fk.lowerLeg.L')]);
    expect(hints()).toEqual(['info']);
    // A modifier click says it too.
    pick([mesh(c('fk.upperLeg.R'))], 'toggle');
    expect(hints()).toEqual(['info', 'info']);
  });

  it('says nothing for FK limbs, non-limb controls, control or joint picks and empty hits', async () => {
    const { r, pick, hints } = await ikPicks();
    expect(r.app.evaluation.ikFk(CHARACTER, 'arm.L') ?? 0).toBeLessThanOrEqual(0.5);
    pick([mesh(c('fk.lowerArm.L'))]);
    pick([mesh(c('cog'))]);
    pick([{ kind: 'control', control: c('fk.lowerLeg.L'), distancePx: 1, depth: 1 }]);
    pick([{ kind: 'joint', character: CHARACTER, node: 1 }]);
    pick([mesh(null)]);
    // The IK control itself (a mesh hit cannot name it today, but the rule is about FK controls only).
    pick([mesh(c('ik.leg.L'))]);
    expect(hints()).toEqual([]);
    expect(selected(r)).toEqual([c('ik.leg.L')]);
  });
});
