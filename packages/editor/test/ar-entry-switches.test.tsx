// AUTORIG-SPEC §3.3–§3.4 (D2): Studio's switches to Auto-Rig. File › Auto-Rig This Model… and Help › Switch to
// Auto-Rig run `shell.autoRig`, which calls the host's navigation port directly with the subject (the selection —
// selected groups give their descendant meshes —, else the active character, else the visible scene meshes); the
// first-run dialog's third answer switches from its button and remembers Auto-Rig only when ticked; Preferences ›
// Start in reads and writes the landing's remembered choice, and blocked storage reads as Ask.
import type { CharacterId, ControlId, DocSnapshot, GroupId, GroupRecord, MeshId, MeshRecord } from '@ekza-studio/doc';
import {
  type EditorApp,
  type NavigationPort,
  type NavigationRequest,
  provideNavigation,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirstRunDialog } from '../src/dialogs/FirstRunDialog';
import { ENTRY_KEY, readEntryChoice, writeEntryChoice } from '../src/dialogs/entryChoice';
import { PreferencesDialog } from '../src/dialogs/PreferencesDialog';
import { autoRigSubject } from '../src/shell/autoRigSwitch';
import { registerShellMenuItems } from '../src/shell/menuItems';
import { by, cleanup, mountPlain } from './panels/helpers';
import { update } from './render';
import { createTestShell, ShellFrame, waitFor, waveFixtures } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  ({ snapshot, skeleton } = await waveFixtures());
});
afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem(ENTRY_KEY);
});

/** A scene mesh record (the subject rule reads records only; no geometry is needed). */
function putMesh(app: EditorApp, id: string, fields: Partial<MeshRecord> = {}): MeshId {
  app.store.transact({ label: 'Create' }, (tx) =>
    tx.put('meshes', {
      id,
      name: id,
      owner: { scene: true },
      parent: null,
      order: `a${id}`,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      source: null,
      data: { manifest: `man_${id}`, rev: 1, base: null, joints: [] },
      faceted: true,
      generator: null,
      palette: null,
      material: { preset: 'unlit' },
      colourOutput: 'palette-texture',
      skin: null,
      budget: null,
      handheld: null,
      deleted: null,
      ...fields,
    } as MeshRecord),
  );
  return id as MeshId;
}

/** A scene group record (Ctrl+G, or an import's group node). */
function putGroup(app: EditorApp, id: string, parent: string | null = null): GroupId {
  app.store.transact({ label: 'Group' }, (tx) =>
    tx.put('groups', {
      id,
      name: id,
      owner: { scene: true },
      parent,
      order: `a${id}`,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      template: null,
      budget: null,
      handheld: null,
      deleted: null,
    } as unknown as GroupRecord),
  );
  return id as GroupId;
}

const hide = (app: EditorApp, ids: string[]): void =>
  app.session.setState({ model: { ...app.session.getState().model, hiddenObjects: new Set(ids as MeshId[]) } });

function select(app: EditorApp, part: { objects?: string[]; controls?: string[] }): void {
  const selection = app.session.getState().selection;
  app.session.setState({
    selection: {
      ...selection,
      objects: (part.objects ?? []) as MeshId[],
      controls: (part.controls ?? []) as ControlId[],
    },
  });
}

/** A navigation port that records what it was asked. */
function recordingPort(app: EditorApp): { readonly requests: NavigationRequest[]; dispose(): void } {
  const requests: NavigationRequest[] = [];
  const port: NavigationPort = {
    go: async (request) => void requests.push(request),
    takeSubject: () => null,
  };
  return { requests, dispose: provideNavigation(app, port) };
}

/** The subject File › Auto-Rig This Model… hands over (null: the item is disabled), through a recording port. */
async function subjectOf(app: EditorApp): Promise<unknown> {
  const dispose = registerShellMenuItems(app, []);
  const port = recordingPort(app);
  const result = await app.runUntyped('shell.autoRig', { subject: true });
  port.dispose();
  dispose();
  if (result.status !== 'finished') return null;
  expect(port.requests).toHaveLength(1);
  return port.requests[0]?.subject ?? null;
}

describe('the subject Studio hands to Auto-Rig (§3.4)', () => {
  it('is null in an empty document', async () => {
    expect(await subjectOf(createFakeEditorApp())).toBeNull();
  });

  it('is the selected scene meshes, else every visible one', async () => {
    const app = createFakeEditorApp();
    const [a, b, c] = ['msh_a', 'msh_b', 'msh_c'].map((id) => putMesh(app, id));
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [a, b, c] });
    app.session.setState({
      model: { ...app.session.getState().model, hiddenObjects: new Set([b as MeshId]) },
    });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [a, c] });
    select(app, { objects: [c as string] });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [c] });
  });

  it('is the selected scene meshes, else the active character (the only one included)', async () => {
    const app = createFakeEditorApp({ snapshot, skeleton });
    const character = app.store.list('characters')[0]?.id as CharacterId;
    // the session keeps an active character whenever one exists (repairSession): §3.4's "only character"
    expect(app.session.getState().activeCharacter).toBe(character);
    expect(await subjectOf(app)).toEqual({ character, meshes: [] });
    const box = putMesh(app, 'msh_box');
    expect(await subjectOf(app)).toEqual({ character, meshes: [] });
    // a selected scene mesh wins over the active character
    select(app, { objects: [box] });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [box] });
  });

  it('a mesh whose parent is hidden is not visible', async () => {
    const app = createFakeEditorApp();
    const a = putMesh(app, 'msh_a');
    const b = putMesh(app, 'msh_b', { parent: a });
    hide(app, [a]);
    expect(await subjectOf(app)).toBeNull();
    hide(app, []);
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [a, b] });
  });

  it('a mesh under a hidden grandparent group is not visible (the whole ancestor chain)', () => {
    const app = createFakeEditorApp();
    const outer = putGroup(app, 'grp_outer');
    const inner = putGroup(app, 'grp_inner', outer);
    const nested = putMesh(app, 'msh_nested', { parent: inner });
    const free = putMesh(app, 'msh_free');
    hide(app, [outer]);
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [free] });
    hide(app, [outer, free]);
    expect(autoRigSubject(app)).toBeNull();
    hide(app, [free]);
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [nested] });
  });

  it("a selected group gives its descendant scene meshes (Ctrl+G groups, an import's group node)", async () => {
    const app = createFakeEditorApp();
    const group = putGroup(app, 'grp_model');
    const inner = putGroup(app, 'grp_inner', group);
    const body = putMesh(app, 'msh_body', { parent: group });
    const head = putMesh(app, 'msh_head', { parent: inner });
    const other = putMesh(app, 'msh_other');
    // in the hierarchy's (Outliner) order: siblings by `order`, depth first — the inner group sorts before the body
    select(app, { objects: [group] });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [head, body] });
    // a selected mesh inside a selected group counts once
    select(app, { objects: [group, head] });
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [head, body] });
    select(app, { objects: [inner] });
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [head] });
    // nothing selected: every visible scene mesh
    select(app, {});
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [head, body, other] });
  });

  it('two models, one selected: only the selected one is the subject', async () => {
    const app = createFakeEditorApp();
    const first = putGroup(app, 'grp_first');
    const second = putGroup(app, 'grp_second');
    const a = putMesh(app, 'msh_a', { parent: first });
    const b = putMesh(app, 'msh_b', { parent: first });
    const c = putMesh(app, 'msh_c', { parent: second });
    select(app, { objects: [second] });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [c] });
    select(app, { objects: [first] });
    expect(await subjectOf(app)).toEqual({ character: null, meshes: [a, b] });
    // a selected object that holds no scene mesh falls back to the visible meshes
    select(app, { objects: [putGroup(app, 'grp_empty')] });
    expect(autoRigSubject(app)).toEqual({ character: null, meshes: [a, b, c] });
  });

  it('a parent cycle in a damaged document ends the walk', () => {
    const app = createFakeEditorApp();
    const a = putMesh(app, 'msh_a', { parent: 'msh_b' as MeshId });
    const b = putMesh(app, 'msh_b', { parent: a });
    const subject = autoRigSubject(app);
    expect([...(subject?.meshes ?? [])].sort()).toEqual([a, b]);
  });
});

describe("Studio's menu switches (§3.4)", () => {
  it('File › Auto-Rig This Model… and Help › Switch to Auto-Rig run shell.autoRig', () => {
    const { app, shell } = createTestShell();
    expect(app.menus.get('shell.file.autoRig')).toMatchObject({
      menu: 'file',
      op: 'shell.autoRig',
      args: { subject: true },
      label: 'Auto-Rig This Model…',
    });
    expect(app.menus.get('shell.help.autoRig')).toMatchObject({ menu: 'help', op: 'shell.autoRig' });
    // the Help item shows the operator's label
    expect(app.operators.get('shell.autoRig')?.label).toBe('Switch to Auto-Rig');
    // the palette lists autorig.navigate; this one is the menus' (internal)
    expect(app.operators.get('shell.autoRig')?.flags?.internal).toBe(true);
    shell.dispose();
    expect(app.operators.get('shell.autoRig')).toBeUndefined();
  });

  it('File › Auto-Rig This Model… needs meshes or a character; Help › Switch to Auto-Rig does not', () => {
    const { app, shell } = createTestShell();
    expect(app.operators.poll('shell.autoRig', {}, { subject: true })).toEqual({
      ok: false,
      reason: 'Nothing to auto-rig',
    });
    expect(app.operators.poll('shell.autoRig', {}, undefined)).toBe(true);
    const a = putMesh(app, 'msh_a');
    expect(app.operators.poll('shell.autoRig', {}, { subject: true })).toBe(true);
    // §3.4: "enabled when the scene has meshes" — hidden ones too (then nothing is handed over)
    hide(app, [a]);
    expect(app.operators.poll('shell.autoRig', {}, { subject: true })).toBe(true);
    shell.dispose();
  });

  it('File › Auto-Rig This Model… with every scene mesh hidden switches without a subject', async () => {
    const app = createFakeEditorApp();
    hide(app, [putMesh(app, 'msh_a')]);
    const dispose = registerShellMenuItems(app, []);
    const port = recordingPort(app);
    await expect(app.runUntyped('shell.autoRig', { subject: true })).resolves.toMatchObject({ status: 'finished' });
    expect(port.requests).toEqual([{ to: 'autorig', from: 'studio' }]);
    port.dispose();
    dispose();
  });

  it('File › Auto-Rig This Model… is enabled with a character only', () => {
    const { app, shell } = createTestShell({ snapshot, skeleton });
    expect(app.operators.poll('shell.autoRig', {}, { subject: true })).toBe(true);
    shell.dispose();
  });

  it('calls the navigation port with the subject from File and Help alike, adding no undo step', async () => {
    const { app, shell } = createTestShell({ snapshot, skeleton });
    const port = recordingPort(app);
    const box = putMesh(app, 'msh_box');
    select(app, { objects: [box] });
    const top = app.history.peekUndo();
    await shell.runFromUi('shell.autoRig', { subject: true });
    await shell.runFromUi('shell.autoRig');
    // §3.4: both controls' effect hands the selection over as the subject
    expect(port.requests).toEqual([
      { to: 'autorig', from: 'studio', subject: { character: null, meshes: [box] } },
      { to: 'autorig', from: 'studio', subject: { character: null, meshes: [box] } },
    ]);
    expect(app.history.peekUndo()).toBe(top);
    port.dispose();
    shell.dispose();
  });

  it('does nothing without a navigation port (a harness)', async () => {
    const { app, shell } = createTestShell();
    const port = recordingPort(app);
    // the host's own port was replaced by the recording one; with it gone there is none
    port.dispose();
    await expect(app.runUntyped('shell.autoRig')).resolves.toMatchObject({ status: 'finished' });
    expect(port.requests).toEqual([]);
    shell.dispose();
  });
});

describe("the first-run dialog's third answer (§3.4)", () => {
  async function open() {
    const test = createTestShell({ snapshot, skeleton });
    const port = recordingPort(test.app);
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <FirstRunDialog />
      </ShellFrame>,
    );
    return { ...test, port };
  }

  const click = (element: HTMLElement): Promise<void> => update(() => element.click());

  it('switches to Auto-Rig from its button and remembers it only when ticked', async () => {
    const { app, port, shell } = await open();
    const workspace = app.session.getState().workspace;
    await click(by('firstrun-start-autorig'));
    expect(by('firstrun-done').textContent).toBe('Start Auto-Rig');
    await click(by('firstrun-done'));
    await waitFor(() => port.requests.length === 1);
    // the subject rule of the switch: here the document's active character
    const character = app.session.getState().activeCharacter;
    expect(character).not.toBeNull();
    expect(port.requests).toEqual([{ to: 'autorig', from: 'studio', subject: { character, meshes: [] } }]);
    expect(app.prefs.getState().firstRunDone).toBe(true);
    // Studio's start workspace is not touched by the Auto-Rig answer
    expect(app.session.getState().workspace).toBe(workspace);
    expect(localStorage.getItem(ENTRY_KEY)).toBeNull();
    port.dispose();
    shell.dispose();
  });

  it('"Open this mode next time" remembers Auto-Rig for the landing page', async () => {
    const { port, shell } = await open();
    await click(by('firstrun-start-autorig'));
    await click(by('firstrun-remember-autorig'));
    await click(by('firstrun-done'));
    await waitFor(() => port.requests.length === 1 && localStorage.getItem(ENTRY_KEY) !== null);
    expect(JSON.parse(localStorage.getItem(ENTRY_KEY) ?? 'null')).toMatchObject({ choice: 'autorig' });
    expect(readEntryChoice()).toBe('autorig');
    port.dispose();
    shell.dispose();
  });

  it('closing the dialog with the Auto-Rig answer keeps Studio', async () => {
    const { app, port, shell } = await open();
    await click(by('firstrun-start-autorig'));
    await click(by('firstrun-remember-autorig'));
    await update(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => app.prefs.getState().firstRunDone);
    expect(port.requests).toEqual([]);
    expect(localStorage.getItem(ENTRY_KEY)).toBeNull();
    port.dispose();
    shell.dispose();
  });

  it('the Animate and Model answers are unchanged', async () => {
    const { app, port, shell } = await open();
    await click(by('firstrun-start-model'));
    expect(document.querySelector('[data-testid="firstrun-remember-autorig"]')).toBeNull();
    await click(by('firstrun-done'));
    // (the workspace switch itself is covered by m6a-model-content.test.tsx with the built-in workspaces)
    await waitFor(() => app.prefs.getState().firstRunDone);
    expect(app.prefs.getState()).toMatchObject({ lastWorkspace: 'model', firstRunDone: true });
    expect(port.requests).toEqual([]);
    port.dispose();
    shell.dispose();
  });
});

describe('Preferences › Start in (§3.3)', () => {
  async function open() {
    const test = createTestShell();
    await mountPlain(
      <ShellFrame shell={test.shell}>
        <PreferencesDialog />
      </ShellFrame>,
    );
    return test;
  }

  const choose = (value: string): Promise<void> =>
    update(() => {
      const select = by('prefs-start-in') as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

  it('shows the remembered choice and writes Auto-Rig, Studio or Ask', async () => {
    writeEntryChoice('studio');
    const { shell } = await open();
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('studio');
    await choose('autorig');
    expect(readEntryChoice()).toBe('autorig');
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('autorig');
    await choose('ask');
    expect(localStorage.getItem(ENTRY_KEY)).toBeNull();
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('ask');
    shell.dispose();
  });

  it('blocked storage reads as Ask and writes nothing, without an error', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { shell } = await open();
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('ask');
    await choose('studio');
    expect(setItem).toHaveBeenCalled();
    // nothing was stored, so the select shows what is: Ask
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('ask');
    vi.restoreAllMocks();
    expect(localStorage.getItem(ENTRY_KEY)).toBeNull();
    shell.dispose();
  });

  it('a write that fails keeps showing the stored choice', async () => {
    writeEntryChoice('studio');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { shell } = await open();
    await choose('autorig');
    expect((by('prefs-start-in') as HTMLSelectElement).value).toBe('studio');
    vi.restoreAllMocks();
    expect(readEntryChoice()).toBe('studio');
    shell.dispose();
  });

  it('a malformed record reads as Ask', () => {
    localStorage.setItem(ENTRY_KEY, '{"choice":"toString"}');
    expect(readEntryChoice()).toBeNull();
    localStorage.setItem(ENTRY_KEY, 'not json');
    expect(readEntryChoice()).toBeNull();
  });
});
