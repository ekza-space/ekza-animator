// M6B-SPEC §9.0 C7 (rig shell) in the editor: the lazy rig shell registers the Rig menus (MVP items only, no
// Constrain or Control menu), the `rig.modes` marking menu, the status-line bodies and the pose badge on the first
// entry; the Rig dock layout and viewport presets; the Rig Toolkit frame with the MVP checklist and the Validation
// panel with its rows, profile and Fix buttons.
import type {
  CharacterId,
  DocSnapshot,
  JointId,
  JointRecord,
  MeshId,
  MeshRecord,
  RigId,
  RigRecord,
  SkeletonId,
} from '@ekza-studio/doc';
import { type EditorApp, PANEL, RIG_MENUS, registerBuiltins } from '@ekza-studio/editor-core';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RIG_MARKING_MENUS } from '../src/overlays/menus/rig';
import RigToolkitView from '../src/panels/rigToolkit';
import ValidationView from '../src/panels/validation';
import { gettingStartedSteps, poseBadge } from '../src/panels/viewport/rig/overlays';
import { ALL_SLOTS, slotsOf } from '../src/shell/layout';
import { RIG_MENU_ITEMS } from '../src/shell/menus/rig';
import { topMenus } from '../src/shell/menus';
import { applyRigLayout, RIG_LAYOUT, RIG_LAYOUTS, RIG_SLOTS } from '../src/shell/rig/layouts';
import { useStatusGroup } from '../src/shell/statusGroupRegistry';
import { by, cleanup, mountPlain } from './panels/helpers';
import { createTestShell, ShellFrame, waveFixtures } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  ({ snapshot, skeleton } = await waveFixtures());
});
const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  await cleanup();
});

async function waitUntil(predicate: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > ms) throw new Error('condition not met in time');
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function run(app: EditorApp, op: string, args?: unknown): Promise<void> {
  await act(async () => {
    const result = await app.runUntyped(op, args);
    if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  });
}

/** A shell with the built-ins, in Rig & Skin (the rig chunk and the lazy rig shell loaded). */
async function rigShell(opts?: { readonly empty?: boolean }) {
  const test = createTestShell(opts?.empty === true ? {} : { snapshot, skeleton });
  disposers.push(registerBuiltins(test.app), () => test.shell.dispose());
  await run(test.app, 'workspace.set', { workspace: 'rig' });
  await waitUntil(() => test.app.menus.get('rig.skeleton.quickRig') !== undefined);
  return test;
}

// `@ekza-studio/doc/testing` reads fixtures from disk (node:fs), so the records are spelled out here.
const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

/** A model character (a skeleton with one joint, one unbound mesh); it becomes the active character. */
function addModelCharacter(app: EditorApp): CharacterId {
  const character = 'chr_Model0001' as CharacterId;
  const skeletonId = 'skl_Model0001' as SkeletonId;
  const rig = 'rig_Model0001' as RigId;
  const rigRecord: RigRecord = {
    id: rig,
    character,
    format: 'ekza.rig',
    version: 1,
    generator: { name: 'ekza-autorig-humanoid', version: '0.0.0-test' },
    skeleton: { format: 'vrm1', fingerprint: 'sha256:test', facing: [0, 0, 0, 1] },
    deleted: null,
  };
  const joint: JointRecord = {
    id: 'jnt_Hips0001' as JointId,
    skeleton: skeletonId,
    parent: null,
    order: 'a0',
    name: 'hips',
    humanBone: 'hips',
    restPosition: [0, 1, 0],
    restRotation: [0, 0, 0, 1],
    tail: null,
    side: 'C',
    mirror: null,
    deleted: null,
    role: 'bone',
    key: 'hips',
  };
  const mesh: MeshRecord = {
    id: 'msh_Body0001' as MeshId,
    name: 'body',
    owner: { character },
    parent: null,
    order: 'a0',
    placement: IDENTITY,
    pivot: [0, 0, 0],
    source: null,
    data: null,
    faceted: true,
    generator: null,
    palette: null,
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
  };
  app.store.transact({ label: 'Model character' }, (tx) => {
    tx.put('rigs', rigRecord);
    tx.put('characters', {
      id: character,
      name: 'Cube Lad',
      asset: null,
      source: { kind: 'model', skeleton: skeletonId },
      format: 'vrm1',
      rig,
      placement: IDENTITY,
      order: 'z0',
      deleted: null,
      vrm: null,
    });
    tx.put('skeletons', {
      id: skeletonId,
      character,
      template: 'vrm-humanoid',
      templateVersion: '1',
      preset: 'standard33',
      symmetry: true,
      deleted: null,
    });
    tx.put('joints', joint);
    tx.put('meshes', mesh);
  });
  app.session.setState({ rig: { ...app.session.getState().rig, character } });
  return character;
}

describe('the Rig menus (§0.4.5)', () => {
  it('lists only Rig & Skin items, in the MVP menus, with no Constrain or Control menu', () => {
    expect(RIG_MENU_ITEMS.every((item) => item.workspaces?.join() === 'rig')).toBe(true);
    const tops = new Set(RIG_MENU_ITEMS.map((item) => item.menu.split('.')[0]));
    expect([...tops].every((menu) => RIG_MENUS.includes(menu as string))).toBe(true);
    expect(tops.has('constrain') || tops.has('control')).toBe(false);
    expect(topMenus(RIG_MENU_ITEMS, { id: 'rig', menus: RIG_MENUS }).map((menu) => menu.label)).toEqual([
      'File',
      'Create',
      'Select',
      'Modify',
      'Display',
      'Skeleton',
      'Skin',
      'Windows',
    ]);
    const labels = (menu: string) => RIG_MENU_ITEMS.filter((item) => item.menu === menu).map((item) => item.label);
    expect(labels('skeleton')).toEqual(['Quick Rig…', 'Orient Joints…', 'Mirror Joints…', 'Update Control Rig']);
    expect(labels('skin')).toContain('Go to Bind Pose');
    expect(labels('file')).toEqual(['Export Character…', 'VRM Meta…', 'Render Thumbnail']);
    expect(labels('windows')).toEqual(['Rig Toolkit', 'Paint Weights', 'Validation']);
  });

  it('the lazy rig shell registers menus, rig.modes and the status bodies on the first entry', async () => {
    const test = await rigShell();
    expect(RIG_MENU_ITEMS.every((item) => test.app.menus.get(item.id) !== undefined)).toBe(true);
    expect(RIG_MARKING_MENUS.map((def) => test.app.markingMenus.get(def.id)?.workspaces)).toEqual([['rig']]);
    let bodies: (string | null)[] = [];
    function Probe(): null {
      bodies = ['rigMode', 'poseView', 'rigSymmetry', 'rigSnap', 'jointDisplay'].map((id) =>
        useStatusGroup(id) === null ? null : id,
      );
      return null;
    }
    await mountPlain(<Probe />);
    expect(bodies).toEqual(['rigMode', 'poseView', 'rigSymmetry', 'rigSnap', 'jointDisplay']);
    // The shipped Windows layouts are Animate's; Rig & Skin lists its own presets.
    expect(RIG_LAYOUTS.map((entry) => entry.layout)).toEqual(['single', RIG_LAYOUT.side, RIG_LAYOUT.markers]);
  });
});

describe('layouts (§8.2)', () => {
  it('the Rig dock slots: Outliner, Rig Toolkit first on the right, Validation below', () => {
    expect(slotsOf('rig')).toBe(RIG_SLOTS);
    expect(RIG_SLOTS.filter((slot) => slot.slot === 'right').map((slot) => slot.kind)).toEqual([
      PANEL.rigToolkit,
      PANEL.paintWeights,
      PANEL.channelBox,
      PANEL.attributes,
    ]);
    expect(RIG_SLOTS.filter((slot) => slot.slot === 'bottom').map((slot) => slot.kind)).toEqual([PANEL.validation]);
    expect(ALL_SLOTS.filter((slot) => slot.kind === PANEL.rigToolkit)).toHaveLength(1);
  });

  it('entering Rig & Skin shows R-Side; R-Markers is a viewport layout', async () => {
    const test = await rigShell();
    expect(test.app.session.getState().viewportLayout).toBe('rig-side');
    // C3's Quick Rig switches to R-Markers (`applyRigLayout`; `view.layout` is the viewport manager's).
    await act(async () => applyRigLayout(test.app, RIG_LAYOUT.markers));
    expect(test.app.session.getState().viewportLayout).toBe('rig-markers');
    expect(test.app.session.getState().maximizedPane).toBeNull();
  });
});

describe('the pose badge and the Getting started card (§5.17, §8.12)', () => {
  it('BIND POSE / TEST POSE in Rig & Skin only', async () => {
    const test = await rigShell();
    const badge = poseBadge(test.app);
    expect(badge.label(test.app)).toBe('BIND POSE');
    test.app.session.setState({ rig: { ...test.app.session.getState().rig, poseView: 'test' } });
    expect(badge.label(test.app)).toBe('TEST POSE');
    await run(test.app, 'workspace.set', { workspace: 'animate' });
    expect(badge.label(test.app)).toBeNull();
  });

  it('the Getting started steps name the keys of the keymap', async () => {
    const test = await rigShell();
    const steps = gettingStartedSteps(test.app, 'pane-persp');
    expect(steps).toHaveLength(7);
    expect(steps[2]).toMatch(/^1, hold D/);
    expect(steps[4]).toMatch(/^2 and paint/);
  });
});

describe('the Rig Toolkit and the Validation panel (§8.6, §8.12)', () => {
  it('the Toolkit shows the six MVP steps; without a character ① asks for markers', async () => {
    const test = await rigShell({ empty: true });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <RigToolkitView app={test.app} instanceId="rtk" />
      </ShellFrame>,
    );
    const glyphs = () => [1, 2, 3, 4, 5, 6].map((n) => by(`rtk-step-${n}`).getAttribute('data-glyph'));
    expect(glyphs()).toEqual(['attention', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(by('rtk-empty').textContent).toMatch(/Select a mesh/);
    await act(async () => {
      addModelCharacter(test.app);
    });
    await waitUntil(() => by('rtk-step-1').getAttribute('data-glyph') === 'done');
    expect(glyphs()).toEqual(['done', 'done', 'attention', 'todo', 'attention', 'attention']);
    expect(by('rtk-header').textContent).toMatch(/Cube Lad · standard33 · 1 joints/);
    expect(by('rtk-validation-summary').textContent).toMatch(/3 errors/);
  });

  it('Validation lists the rows with Fix buttons and follows the profile', async () => {
    const test = await rigShell();
    await act(async () => {
      addModelCharacter(test.app);
    });
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <ValidationView app={test.app} instanceId="val" />
      </ShellFrame>,
    );
    expect(by('val-row-skin.unbound').getAttribute('data-severity')).toBe('error');
    expect(by('val-fix-skin.unbound').textContent).toBe('Fix: Bind Skin');
    expect(by('val-row-vrm.licence-unset')).toBeTruthy();
    await run(test.app, 'rig.validation.profile', { profile: 'local/generic' });
    await waitUntil(() => by('val-row-skin.unbound').getAttribute('data-severity') === 'warning');
    expect(document.querySelector('[data-testid="val-row-vrm.licence-unset"]')).toBeNull();
    expect(by('val-ready').textContent).toMatch(/Local \/ generic ✓/);
  });
});
