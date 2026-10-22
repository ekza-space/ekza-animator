// M6B-SPEC §0.2, §0.4.2, §8.6 (C3) in the editor: the Quick Rig panel body — the marker list (state, the selected
// marker, a click selects), the start-check notice with its fixes and Create Skeleton disabled with the reason, the
// A-pose notice, the click-to-place prompt after Clear, the template select locked on a re-run, the rebind confirm on
// a bound re-run; the Rig Toolkit's Skeleton section (the Quick Rig body while it runs, the skeleton line, the
// selected joint's fields, Orient/Mirror option boxes); the FK FOR TEST badge; the C3 test API.
import type { CharacterId, JointId, RigId, SkeletonId } from '@ekza-studio/doc';
import {
  A_POSE_NOTICE,
  CHECK_REASONS,
  type EditorApp,
  type OperatorDef,
  PRESET_LOCKED,
  type QuickRigState,
  registerBuiltins,
} from '@ekza-studio/editor-core';
import { DEFAULT_FLEXION, skeletonTemplate, templateJointRecords } from '@ekza-studio/rig';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { optionBoxStore } from '../src/overlays/menus/optionBox';
import { QuickRigPanelBody } from '../src/panels/quickRig/body';
import RigToolkitView from '../src/panels/rigToolkit';
import { RigCards, RigEmptyState, setRigGettingStartedDismissed } from '../src/panels/viewport/rig/overlays';
import { SkeletonSection } from '../src/panels/rigToolkit/sections/skeleton';
import { fkForTest, fkTestBadge } from '../src/panels/rigToolkit/sections/skeleton/register';
import { skeletonUiTestApi } from '../src/test-api/m6b/skeleton-ui';
import { by, cleanup, mountPlain } from './panels/helpers';
import { createTestShell, ShellFrame } from './shell-helpers';

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  await cleanup();
});

const CHARACTER = 'chr_CubeLad00000001' as CharacterId;
const SKELETON = 'skl_CubeLad00000001' as SkeletonId;
const RIG = 'rig_CubeLad00000001' as RigId;

function state(patch: Partial<QuickRigState> = {}): QuickRigState {
  return {
    meshes: [],
    preset: 'standard33',
    markers: { headTop: [0, 1.7, 0], chin: [0, 1.48, 0.01], elbow: [-0.45, 1.36, 0] },
    moved: new Set(['elbow']),
    selected: 'elbow',
    guess: { armAngle: 0, aPose: false, failed: null },
    preview: [],
    checks: { centred: true, grounded: true, facing: true },
    refit: null,
    ...patch,
  };
}

async function shell(quickRig: QuickRigState | null, before?: (app: EditorApp) => void) {
  const test = createTestShell({});
  disposers.push(registerBuiltins(test.app), () => test.shell.dispose());
  before?.(test.app);
  await act(async () => {
    await test.app.rig.load();
  });
  const s = test.app.session.getState();
  test.app.session.setState({ workspace: 'rig', rig: { ...s.rig, quickRig } });
  return test;
}

/** Registers a recorder under an operator id before the rig chunk loads (which then keeps it). */
function record(
  app: EditorApp,
  id: string,
  keys: readonly string[],
  prepare?: (args: Record<string, unknown>) => void,
): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  const def: OperatorDef<unknown, unknown, unknown> = {
    id: id as never,
    label: id,
    category: 'skel',
    scope: 'rig',
    extraArgs: keys,
    poll: () => true,
    prepare: (_ctx, args) => {
      calls.push(args as Record<string, unknown>);
      prepare?.(args as Record<string, unknown>);
    },
    apply: () => undefined,
  };
  disposers.push(app.contribute({ kind: 'operator', def }));
  return calls;
}

describe('the Quick Rig panel body (§0.2, §0.4.2)', () => {
  it('lists the nine markers with their state; the selected one highlighted; a click selects', async () => {
    const test = await shell(state());
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <QuickRigPanelBody app={test.app} />
      </ShellFrame>,
    );
    expect(by('quickrig-marker-headTop').getAttribute('data-status')).toBe('guessed');
    expect(by('quickrig-marker-elbow').getAttribute('data-status')).toBe('moved');
    expect(by('quickrig-marker-knee').getAttribute('data-status')).toBe('missing');
    expect(by('quickrig-marker-elbow').getAttribute('aria-pressed')).toBe('true');
    // After Clear the panel asks for the missing markers in list order.
    expect(by('quickrig-next').getAttribute('data-marker')).toBe('pelvis');
    await act(async () => by('quickrig-marker-knee').click());
    expect(test.app.session.getState().rig.quickRig?.selected).toBe('knee');
    expect((by('quickrig-commit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a failed start check: the notice with its fix, Create Skeleton disabled with the reason', async () => {
    let center: Record<string, unknown>[] = [];
    const test = await shell(state({ checks: { centred: false, grounded: true, facing: false } }), (app) => {
      center = record(app, 'skel.quickRig.center', ['meshes']);
    });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <QuickRigPanelBody app={test.app} />
      </ShellFrame>,
    );
    expect(by('quickrig-notice').textContent).toContain(CHECK_REASONS.centred);
    expect(by('quickrig-notice').textContent).toContain(CHECK_REASONS.facing);
    const commit = by('quickrig-commit') as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    expect(commit.title).toBe(CHECK_REASONS.centred);
    expect((by('quickrig-guess') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => by('quickrig-fix-center').click());
    expect(center).toHaveLength(1);
    expect(by('quickrig-fix-face').textContent).toBe('Rotate to face +Z');
  });

  it('the A-pose notice; the template select locked on a re-run', async () => {
    const test = await shell(
      state({ guess: { armAngle: 0.6, aPose: true, failed: null }, refit: SKELETON, moved: new Set() }),
    );
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <QuickRigPanelBody app={test.app} />
      </ShellFrame>,
    );
    expect(by('quickrig-apose').textContent).toBe(A_POSE_NOTICE);
    const preset = by('quickrig-preset') as HTMLSelectElement;
    expect(preset.disabled).toBe(true);
    expect(preset.title).toBe(PRESET_LOCKED);
    expect(by('quickrig-refit').textContent).toContain('in place');
  });

  it('a bound re-run asks "Rebind replaces painted weights" first; Rebind commits confirmed', async () => {
    const { EkzaError } = await import('@ekza-studio/anim-core');
    let calls: Record<string, unknown>[] = [];
    const test = await shell(state({ refit: SKELETON }), (app) => {
      calls = record(app, 'skel.quickRig.commit', ['preset', 'markers', 'meshes', 'flexion', 'confirm'], (args) => {
        if (args['confirm'] !== true) throw new EkzaError('confirm-required', 'Rebind replaces painted weights');
      });
    });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <QuickRigPanelBody app={test.app} />
      </ShellFrame>,
    );
    await act(async () => by('quickrig-commit').click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(by('quickrig-rebind-confirm').textContent).toContain('Rebind replaces painted weights');
    await act(async () => by('quickrig-rebind-yes').click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(calls.map((args) => args['confirm'] ?? false)).toEqual([false, true]);
    expect(calls[0]).toMatchObject({ preset: 'standard33', flexion: DEFAULT_FLEXION });
  });
});

describe('the Rig Toolkit Skeleton section (§8.6)', () => {
  async function withCharacter(before?: (app: EditorApp) => void) {
    const test = await shell(null, before);
    const joints = templateJointRecords(
      skeletonTemplate('standard33', { height: 1.7, proportions: 'standard', flexion: DEFAULT_FLEXION }),
      SKELETON,
    );
    test.app.store.transact({ label: 'Character', undoable: false }, (tx) => {
      tx.put('characters', {
        id: CHARACTER,
        name: 'Cube Lad',
        asset: null,
        source: { kind: 'model', skeleton: SKELETON },
        format: 'vrm1',
        rig: RIG,
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        order: 'a0',
        deleted: null,
        vrm: null,
      });
      tx.put('skeletons', {
        id: SKELETON,
        character: CHARACTER,
        template: 'vrm-humanoid',
        templateVersion: '1',
        preset: 'standard33',
        symmetry: true,
        deleted: null,
      });
      for (const joint of joints) tx.put('joints', joint);
    });
    const s = test.app.session.getState();
    test.app.session.setState({
      rig: { ...s.rig, character: CHARACTER, mode: 'skeleton' },
      selection: { ...s.selection, joints: [`${SKELETON}:rightLowerLeg` as JointId] },
    });
    return test;
  }

  it('the skeleton line, the selected joint fields and the option boxes', async () => {
    let setRest: Record<string, unknown>[] = [];
    const test = await withCharacter((app) => {
      setRest = record(app, 'skel.joint.setRest', ['joint', 'position']);
    });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <SkeletonSection app={test.app} />
      </ShellFrame>,
    );
    expect(by('rtk-skeleton-count').textContent).toBe('Standard 33 · 34 joints · 15/15 required');
    expect((by('attr-joint-name') as HTMLInputElement).value).toBe('rightLowerLeg');
    expect((by('attr-joint-humanBone') as HTMLSelectElement).value).toBe('rightLowerLeg');
    const z = by('attr-joint-restZ') as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(z);
      await userEvent.type(z, '0.05{Enter}');
    });
    expect(setRest).toHaveLength(1);
    expect(setRest[0]?.['position']).toEqual([expect.any(Number), expect.any(Number), 0.05]);
    await act(async () => by('rtk-opt-skel.joint.orient').click());
    expect(optionBoxStore(test.app).getState().op).toBe('skel.joint.orient');
    await act(async () => by('rtk-opt-skel.joint.mirror').click());
    expect(optionBoxStore(test.app).getState().op).toBe('skel.joint.mirror');
    expect((by('rtk-skel-symmetry') as HTMLInputElement).checked).toBe(true);
  });

  it('shows the Quick Rig body while Quick Rig runs', async () => {
    const test = await withCharacter();
    const s = test.app.session.getState();
    test.app.session.setState({ rig: { ...s.rig, quickRig: state() } });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <SkeletonSection app={test.app} />
      </ShellFrame>,
    );
    expect(by('quickrig-panel').getAttribute('data-open')).toBe('true');
  });
});

describe('the empty state and Getting started give way to a running Quick Rig (acceptance fix)', () => {
  it('no empty-state card or Getting started card over the host pane; the Toolkit header names the Quick Rig session', async () => {
    setRigGettingStartedDismissed(false);
    const test = await shell(null);
    const host = 'pane-persp';
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <RigEmptyState app={test.app} paneId={host} state={null} />
        <RigCards app={test.app} paneId={host} state={null} />
        <RigToolkitView app={test.app} instanceId="rtk" />
      </ShellFrame>,
    );
    const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null;
    test.app.session.setState({ viewportLayout: 'rig-markers' });
    await act(async () => {});
    expect(present('rig-empty')).toBe(true);
    expect(present('rig-getting-started')).toBe(true);
    expect(by('rtk-header').textContent).toMatch(/No character/);
    const s = test.app.session.getState();
    await act(async () => {
      test.app.session.setState({ rig: { ...s.rig, quickRig: state() } });
    });
    expect(present('rig-empty')).toBe(false);
    expect(present('rig-getting-started')).toBe(false);
    expect(by('rtk-header').textContent).toMatch(/Quick Rig/);
    expect(by('rtk-quickrig').textContent).toMatch(/front and side views/);
    expect(present('rtk-empty')).toBe(false);
  });
});

describe('FK FOR TEST and the test API (§5.17, §0.5)', () => {
  it('the badge shows while the test pose holds an IK limb in FK', async () => {
    const test = await shell(null);
    const badge = fkTestBadge(test.app);
    expect(badge.label(test.app)).toBeNull();
    expect(fkForTest(test.app)).toBe(false);
  });

  it('quickRig() mirrors the session state; screen queries are null before the viewport', async () => {
    const test = await shell(state({ preview: [{ key: 'hips', parent: 'root', position: [0, 0.9, 0], tail: null }] }));
    const api = skeletonUiTestApi({ shell: test.shell, sync: () => {} });
    expect(api.quickRig()).toEqual({
      markers: { headTop: [0, 1.7, 0], chin: [0, 1.48, 0.01], elbow: [-0.45, 1.36, 0] },
      moved: ['elbow'],
      selected: 'elbow',
      preset: 'standard33',
      preview: [{ key: 'hips', position: [0, 0.9, 0] }],
      aPose: false,
    });
    expect(api.screenOfMarker('elbow', 'R', 'pane-front')).toBeNull();
    expect(api.screenOfJoint('nope', 'pane-front')).toBeNull();
  });
});
