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
import {
  type EditorApp,
  PANEL,
  RIG_MENUS,
  RIG_VIEW_ONLY_REASON,
  registerBuiltins,
  rigViewOnly,
  type SceneObjectId,
} from '@ekza-studio/editor-core';
import {
  DEFAULT_FLEXION,
  type SkeletonDesc,
  skeletonTemplate,
  templateJointId,
  templateJointRecords,
} from '@ekza-studio/rig';
import { TooltipProvider } from '@ekza-studio/ui';
import { act, type JSX } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RIG_MARKING_MENUS } from '../src/overlays/menus/rig';
import RigToolkitView from '../src/panels/rigToolkit';
import ValidationView from '../src/panels/validation';
import { gettingStartedSteps, poseBadge } from '../src/panels/viewport/rig/overlays';
import { HelpLine } from '../src/shell/HelpLine';
import { ALL_SLOTS, slotsOf } from '../src/shell/layout';
import { RIG_MENU_ITEMS } from '../src/shell/menus/rig';
import { menuContents, topMenus } from '../src/shell/menus';
import { applyRigLayout, RIG_LAYOUT, RIG_LAYOUTS, RIG_SLOTS } from '../src/shell/rig/layouts';
import { followModeTabs, rememberTabs } from '../src/shell/rig/register';
import { RIG_VIEW_ONLY_QUERY, rigNarrow, watchRigViewOnly } from '../src/shell/rig/viewOnly';
import { useStatusGroup } from '../src/shell/statusGroupRegistry';
import { EditorAppProvider } from '../src/hooks';
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
/** The joints of the full Standard template (C2's §5.2 joints: every required VRM bone), the hips as `jnt_Hips0001`. */
function templateJoints(skeleton: SkeletonId): JointRecord[] {
  const hips = templateJointId(skeleton, 'hips');
  const remap = (id: JointId | null): JointId | null => (id === hips ? ('jnt_Hips0001' as JointId) : id);
  return templateJointRecords(
    skeletonTemplate('standard33', { height: 1.8, proportions: 'standard', flexion: DEFAULT_FLEXION }),
    skeleton,
  ).map((joint) => ({
    ...joint,
    id: remap(joint.id) as JointId,
    parent: remap(joint.parent),
    mirror: remap(joint.mirror),
  }));
}

/** A model character with one joint (the hips), or with `template` the full Standard template skeleton. */
function addModelCharacter(app: EditorApp, opts?: { readonly template?: boolean }): CharacterId {
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
    for (const record of opts?.template === true ? templateJoints(skeletonId) : [joint]) tx.put('joints', record);
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
    expect(labels('skeleton')).toEqual([
      'Quick Rig…',
      'Orient Joints…',
      'Mirror Joints…',
      'T-Stance',
      'Apply Pose as Rest',
      'Straighten to T-Pose',
      'Update Control Rig',
      'Snap to Projected Center',
    ]);
    expect(labels('display.joint-size')).toEqual(['Small', 'Medium', 'Large', 'Extra Large']);
    expect(labels('skin')).toContain('Go to Bind Pose');
    expect(labels('file')).toEqual(['Export Character…', 'VRM Meta…', 'Render Thumbnail']);
    expect(labels('windows')).toEqual(['Rig Toolkit', 'Paint Weights', 'Validation']);
  });

  it('the lazy rig shell registers menus, rig.modes and the status bodies on the first entry', async () => {
    const test = await rigShell();
    expect(RIG_MENU_ITEMS.every((item) => test.app.menus.get(item.id) !== undefined)).toBe(true);
    expect(RIG_MARKING_MENUS.map((def) => test.app.markingMenus.get(def.id)?.workspaces)).toEqual([['rig']]);
    function Probe(): JSX.Element {
      const shown = [
        useStatusGroup('rigMode') === null ? '' : 'rigMode',
        useStatusGroup('poseView') === null ? '' : 'poseView',
        useStatusGroup('rigSymmetry') === null ? '' : 'rigSymmetry',
        useStatusGroup('rigSnap') === null ? '' : 'rigSnap',
        useStatusGroup('jointDisplay') === null ? '' : 'jointDisplay',
      ];
      return <span data-testid="probe">{shown.filter((id) => id !== '').join(',')}</span>;
    }
    await mountPlain(<Probe />);
    const bodies = (by('probe').textContent ?? '').split(',');
    expect(bodies).toEqual(['rigMode', 'poseView', 'rigSymmetry', 'rigSnap', 'jointDisplay']);
    // The Component Editor is not built in the MVP (M6B-INT-2): Windows never lists it (Q-MVP-15, acceptance fix).
    expect(test.app.menus.get('shell.windows.panel.componentEditor')).toBeUndefined();
    expect(test.app.menus.get('shell.windows.panel.clipLibrary')).toBeDefined();
    // File › Export Character… replaces the shared Export… in Rig & Skin (same dialog, §0.4.5); Animate keeps Export….
    const fileLabels = () =>
      menuContents(test.app, 'file', {}).sections.flatMap((section) => section.items.map((item) => item.label));
    expect(fileLabels()).toContain('Export Character…');
    expect(fileLabels()).not.toContain('Export…');
    await run(test.app, 'workspace.set', { workspace: 'animate' });
    expect(fileLabels()).toContain('Export…');
    expect(fileLabels()).not.toContain('Export Character…');
    // The shipped Windows layouts are Animate's; Rig & Skin lists its own presets.
    expect(RIG_LAYOUTS.map((entry) => entry.layout)).toEqual(['single', RIG_LAYOUT.side, RIG_LAYOUT.markers]);
  });
});

describe('the status line joint size (T6-INT, P-T6B-3)', () => {
  it('⊖ and ⊕ change the joint size through prefs.set: the poll passes and nothing is refused', async () => {
    const test = await rigShell();
    const { app, shell } = test;
    const refused: string[] = [];
    const runFromStatus = (op: string, args?: unknown): void => {
      void shell.runFromUi(op, args).then((result) => {
        if (result.status !== 'finished') refused.push(`${op}: ${JSON.stringify(result)}`);
      });
    };
    function JointSize(): JSX.Element | null {
      const Body = useStatusGroup('jointDisplay');
      return Body === null ? null : <Body app={app} run={runFromStatus} />;
    }
    await mountPlain(
      <EditorAppProvider app={app}>
        <TooltipProvider>
          <JointSize />
        </TooltipProvider>
      </EditorAppProvider>,
    );
    const before = app.prefs.getState().rigging.jointSize;
    await act(async () => by('status-jointsize-up').click());
    await waitUntil(() => app.prefs.getState().rigging.jointSize === before + 0.25);
    await act(async () => by('status-jointsize-down').click());
    await waitUntil(() => app.prefs.getState().rigging.jointSize === before);
    expect(refused).toEqual([]);
    expect(
      app.operators.poll('prefs.set', { panel: PANEL.viewport }, { patch: { rigging: app.prefs.getState().rigging } }),
    ).toBe(true);
  });
});

describe('the selection-dependent Skeleton items (§0.4.5)', () => {
  it('Symmetry X ✓ and Map Humanoid Bone ▸ follow the active skeleton and the lead joint', async () => {
    const test = await rigShell();
    const app = test.app;
    const symmetry = () => app.menus.get('rig.skeleton.symmetry');
    expect(symmetry()?.args).toBeUndefined(); // no skeleton yet: the item poll-fails
    await act(async () => {
      addModelCharacter(app);
    });
    expect(symmetry()?.args).toEqual({ skeleton: 'skl_Model0001', on: false });
    expect(symmetry()?.checked?.(app)).toBe(true);
    const spine = () => app.menus.get('rig.skeleton.map-humanoid-bone.spine');
    expect(spine()?.menu).toBe('skeleton.map-humanoid-bone');
    expect(spine()?.args).toBeUndefined(); // no joint selected
    await act(async () => {
      app.session.setState({ selection: { ...app.session.getState().selection, joints: ['jnt_Hips0001' as JointId] } });
    });
    expect(spine()?.args).toEqual({ joint: 'jnt_Hips0001', bone: 'spine' });
    expect(app.menus.get('rig.skeleton.map-humanoid-bone.hips')?.checked?.(app)).toBe(true);
    expect(app.menus.get('rig.skeleton.map-humanoid-bone.none')?.args).toEqual({ joint: 'jnt_Hips0001', bone: null });
  });

  it('Snap to Projected Center ✓ and Joint Size ▸ run their shell operators', async () => {
    const test = await rigShell();
    const app = test.app;
    expect(app.session.getState().rig.snap.projectedCenter).toBe(true);
    await run(app, 'rig.snap.projectedCenter');
    expect(app.session.getState().rig.snap.projectedCenter).toBe(false);
    await run(app, 'rig.jointSize.set', { size: 1.5 });
    expect(app.prefs.getState().rigging.jointSize).toBe(1.5);
    expect(app.menus.get('rig.display.joint-size.size1.5')?.checked?.(app)).toBe(true);
    await run(app, 'rig.jointSize.set', { step: -1 });
    expect(app.prefs.getState().rigging.jointSize).toBe(1.25);
  });
});

describe('layouts (§8.2)', () => {
  it('the Rig dock slots: Outliner, Rig Toolkit first on the right, Validation below', () => {
    expect(slotsOf('rig')).toBe(RIG_SLOTS);
    expect(RIG_SLOTS.filter((slot) => slot.slot === 'right').map((slot) => slot.kind)).toEqual([
      PANEL.rigToolkit,
      PANEL.paintWeights,
      PANEL.channels,
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
    // §0.2 step 5: Create Skeleton already opens Skeleton mode, so step ③ names no mode key (1 would leave it).
    expect(steps[1]).toMatch(/Skeleton mode opens/);
    expect(steps[2]).toMatch(/^Hold D and drag a knee/);
    expect(steps[2]).not.toMatch(/\b1\b/);
    expect(steps[3]).toMatch(/Skin mode opens/);
    expect(steps[4]).toMatch(/^Paint fixes \(Skin mode: 2\)/);
  });
});

describe('the help line selection count in Rig & Skin (acceptance fix)', () => {
  it('Skeleton mode counts the selected joints; Object mode the controls and picked meshes', async () => {
    const test = await rigShell();
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <HelpLine />
      </ShellFrame>,
    );
    const text = () => by('helpline-selection').textContent;
    const set = async (patch: Partial<ReturnType<EditorApp['session']['getState']>['selection']>, mode: string) => {
      const s = test.app.session.getState();
      await act(async () => {
        test.app.session.setState({
          rig: { ...s.rig, mode: mode as never },
          selection: { ...s.selection, joints: [], controls: [], objects: [], ...patch },
        });
      });
    };
    await set({}, 'skeleton');
    expect(text()).toBe('Nothing selected');
    await set({ joints: ['skl_a:hips' as JointId] }, 'skeleton');
    expect(text()).toBe('1 joint selected');
    await set({ joints: ['skl_a:hips', 'skl_a:spine'] as JointId[] }, 'skeleton');
    expect(text()).toBe('2 joints selected');
    await set({ objects: ['msh_a' as SceneObjectId] }, 'object');
    expect(text()).toBe('1 selected');
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
      addModelCharacter(test.app, { template: true });
    });
    await waitUntil(() => by('rtk-step-1').getAttribute('data-glyph') === 'done');
    expect(glyphs()).toEqual(['done', 'done', 'attention', 'todo', 'attention', 'attention']);
    const count = templateJoints('skl_Model0001' as SkeletonId).length;
    expect(by('rtk-header').textContent).toMatch(new RegExp(`Cube Lad · standard33 · ${count} joints`));
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
    // [Re-run] re-derives the rows (same document: same rows).
    await act(async () => by('val-rerun').click());
    expect(by('val-row-skin.unbound').getAttribute('data-severity')).toBe('warning');
  });
});

describe('the dock tabs per mode (§5.24, §8.2)', () => {
  it('follow the mode and remember the tabs the user left showing in a mode', async () => {
    const test = await rigShell();
    addModelCharacter(test.app);
    const shown: string[] = [];
    let visible: string[] = [];
    const dockview = {
      get panels() {
        return visible.map((kind) => ({ params: { kind }, api: { isVisible: true } }));
      },
    };
    disposers.push(
      followModeTabs(test.app, {
        showPanel: (kind) => {
          shown.push(kind);
          return true;
        },
        dockview: () => dockview as never,
      }),
    );
    await run(test.app, 'rig.mode', { mode: 'skeleton' });
    expect(shown.slice(-2)).toEqual([PANEL.validation, PANEL.rigToolkit]);
    // The user picks Attributes in Skeleton mode, then leaves it.
    visible = [PANEL.viewport, PANEL.attributes, PANEL.validation];
    await run(test.app, 'rig.mode', { mode: 'object' });
    expect(shown.slice(-2)).toEqual([PANEL.validation, PANEL.channels]);
    expect(test.app.session.getState().rig.tabMemory.skeleton).toEqual({
      right: PANEL.attributes,
      bottom: PANEL.validation,
    });
    visible = [PANEL.channels, PANEL.validation];
    await run(test.app, 'rig.mode', { mode: 'skeleton' });
    expect(shown.slice(-2)).toEqual([PANEL.validation, PANEL.attributes]);
    // Object mode kept its default (the user did not change it).
    expect(test.app.session.getState().rig.tabMemory.object).toEqual({
      right: PANEL.channels,
      bottom: PANEL.validation,
    });
  });

  it('a dock with no Rig tab showing keeps its remembered tab', async () => {
    const test = await rigShell();
    const before = test.app.session.getState().rig.tabMemory;
    rememberTabs(test.app, 'skin', [PANEL.viewport]);
    expect(test.app.session.getState().rig.tabMemory).toBe(before);
    rememberTabs(test.app, 'skin', [PANEL.channels]);
    expect(test.app.session.getState().rig.tabMemory.skin).toEqual({
      right: PANEL.channels,
      // C6: Skin mode keeps Validation below while the Component Editor is deferred (literal update, §3 rule 9).
      bottom: PANEL.validation,
    });
  });
});

describe('view-only below 1024 px (§5.24)', () => {
  it('the window width drives editor-core view-only and the banner flag', async () => {
    const test = await rigShell();
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    const original = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => {
      expect(query).toBe(RIG_VIEW_ONLY_QUERY);
      return media;
    }) as never;
    try {
      const stop = watchRigViewOnly(test.app);
      expect([rigNarrow(), rigViewOnly(test.app)]).toEqual([true, true]);
      const refused = await test.app.runUntyped('channel.toggleLock', {
        refs: [{ control: test.app.store.list('controls')[0]?.id, channel: 'rz' }],
      });
      expect(refused).toEqual({ status: 'cancelled', reason: RIG_VIEW_ONLY_REASON });
      media.matches = false;
      for (const listener of Array.from(listeners)) listener();
      expect([rigNarrow(), rigViewOnly(test.app)]).toEqual([false, false]);
      media.matches = true;
      for (const listener of Array.from(listeners)) listener();
      stop();
      expect([rigNarrow(), rigViewOnly(test.app), listeners.size]).toEqual([false, false, 0]);
    } finally {
      globalThis.matchMedia = original;
    }
  });
});
