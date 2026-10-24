// STUDIO-TOUCH-SPEC §5.5, §20.3 item 3 (T1): virtual modifiers. A touch shell's source (the Thumb key) adds Shift /
// Mod / Alt and a stand-in button to every tool pointer event, hands its held codes to the active tool's `key()` as
// downs and ups, and lends its holds to the rig runtime's held keys; each marked `virtual`. Without a source
// (Studio Pro) the events are today's. A virtual X reaches the real Model transform runtime as its grid-snap hold.
import type { MeshId, MeshRef } from '@ekza-studio/doc';
import { type EditorApp, loadMeshKernel, registerBuiltinOperators, type ToolKeyEvent } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { primitive, writeRevision } from '@ekza-studio/mesh-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createModifierSource,
  type ModifierSource,
  modelTransformOf,
  NO_MODIFIERS,
  type VirtualHoldCode,
  type VirtualModifiers,
} from '../src';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

interface Seen {
  readonly type: string;
  readonly button: number;
  readonly buttons: number;
  readonly shift: boolean;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly virtual: boolean | undefined;
}

/** A single pane with a probe tool that records its pointer and key events. */
async function probe(): Promise<{ rig: Rig; pane: HTMLElement; seen: Seen[]; keys: ToolKeyEvent[] }> {
  const r = await createRig();
  rig = r;
  r.layout('single');
  r.frame();
  const seen: Seen[] = [];
  const keys: ToolKeyEvent[] = [];
  const record =
    (type: string) =>
    (e: { button: number; buttons: number; shift: boolean; mod: boolean; alt: boolean; virtual?: boolean }) =>
      seen.push({
        type,
        button: e.button,
        buttons: e.buttons,
        shift: e.shift,
        mod: e.mod,
        alt: e.alt,
        virtual: e.virtual,
      }) > 0;
  r.app.tools.register({
    id: 'probe',
    panel: 'viewport',
    label: 'Probe',
    create: () => ({
      pointerDown: record('down'),
      pointerUp: record('up'),
      key: (e) => {
        keys.push(e);
        return false;
      },
    }),
  });
  r.app.session.setState((st) => ({ tools: { ...st.tools, viewport: 'probe' } }));
  return { rig: r, pane: r.panes.get('pane-single') as HTMLElement, seen, keys };
}

function click(pane: HTMLElement, id: number): void {
  for (const type of ['pointerdown', 'pointerup'] as const) {
    pane.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: id,
        pointerType: 'mouse',
        clientX: 600,
        clientY: 300,
        button: 0,
        buttons: type === 'pointerdown' ? 1 : 0,
      }),
    );
  }
}

/** What the rig runtime's held keys read of the viewport's virtual modifiers. */
const heldBy = (r: Rig, code: VirtualHoldCode): boolean => r.vm.modifierSource?.get().held.has(code) === true;

const mods = (patch: Partial<VirtualModifiers>, held: readonly VirtualHoldCode[] = []): VirtualModifiers => ({
  ...NO_MODIFIERS,
  held: new Set(held),
  ...patch,
});

describe('virtual modifiers (§5.5, §20.3 item 3)', () => {
  it('join the tool’s pointer events, marked virtual; Studio Pro’s events are today’s', async () => {
    const { rig: r, pane, seen } = await probe();
    click(pane, 1);
    expect(seen).toEqual([
      { type: 'down', button: 0, buttons: 1, shift: false, mod: false, alt: false, virtual: undefined },
      { type: 'up', button: 0, buttons: 0, shift: false, mod: false, alt: false, virtual: undefined },
    ]);
    const source = createModifierSource(mods({ shift: true }));
    const off = r.vm.setModifierSource(source);
    seen.length = 0;
    click(pane, 2);
    expect(seen.map((s) => [s.type, s.shift, s.virtual])).toEqual([
      ['down', true, true],
      ['up', true, true],
    ]);
    // a source with nothing on changes nothing (no virtual mark)
    source.set(NO_MODIFIERS);
    seen.length = 0;
    click(pane, 3);
    expect(seen.map((s) => s.virtual)).toEqual([undefined, undefined]);
    off();
  });

  it('a stand-in button replaces the primary one (button and buttons)', async () => {
    const { rig: r, pane, seen } = await probe();
    const off = r.vm.setModifierSource(createModifierSource(mods({ button: 1, mod: true })));
    click(pane, 1);
    expect(seen[0]).toEqual({
      type: 'down',
      button: 1,
      buttons: 4,
      shift: false,
      mod: true,
      alt: false,
      virtual: true,
    });
    off();
  });

  it('held codes reach the active tool’s key() as downs and ups; removing the source releases them', async () => {
    const { rig: r, keys } = await probe();
    const source = createModifierSource();
    const off = r.vm.setModifierSource(source);
    source.set(mods({}, ['KeyX']));
    expect(heldBy(r, 'KeyX')).toBe(true);
    source.set(mods({}, ['KeyX', 'KeyB']));
    source.set(mods({}, ['KeyB']));
    expect(keys.map((k) => `${k.type} ${k.code} ${k.virtual}`)).toEqual([
      'down KeyX true',
      'down KeyB true',
      'up KeyX true',
    ]);
    expect(keys.every((k) => !k.shift && !k.mod && !k.alt && !k.ctrl && !k.repeat)).toBe(true);
    expect(heldBy(r, 'KeyX')).toBe(false);
    off();
    expect(keys.at(-1)).toMatchObject({ type: 'up', code: 'KeyB', virtual: true });
    expect(heldBy(r, 'KeyB')).toBe(false);
    source.set(mods({}, ['KeyV'])); // a removed source is no longer heard
    expect(keys).toHaveLength(4);
  });

  it('a replaced source no longer speaks for the viewport', async () => {
    const { rig: r, keys } = await probe();
    const first: ModifierSource & { set(next: VirtualModifiers): void } = createModifierSource();
    const offFirst = r.vm.setModifierSource(first);
    const second = createModifierSource(mods({}, ['KeyD']));
    const offSecond = r.vm.setModifierSource(second);
    expect(heldBy(r, 'KeyD')).toBe(true);
    first.set(mods({}, ['KeyJ']));
    expect(heldBy(r, 'KeyJ')).toBe(false);
    expect(keys.map((k) => `${k.type} ${k.code}`)).toEqual(['down KeyD']);
    offFirst(); // the replaced source's disposer leaves the current one
    expect(heldBy(r, 'KeyD')).toBe(true);
    offSecond();
    expect(heldBy(r, 'KeyD')).toBe(false);
  });

  it('a virtual X is the Model transform runtime’s grid-snap hold (a real tool)', async () => {
    await loadMeshKernel();
    const app = createFakeEditorApp();
    registerBuiltinOperators(app);
    app.session.setState({ workspace: 'model' });
    const r = await createRig({ app });
    rig = r;
    r.layout('single', { display: { shading: 'shaded' } });
    createCube(app);
    await expect.poll(() => modelTransformOf(app), { timeout: 15_000 }).not.toBeNull();
    const result = await app.runUntyped('view.tool', { panel: 'viewport', tool: 'move' });
    expect(result.status).toBe('finished');
    const runtime = modelTransformOf(app);
    const source = createModifierSource();
    const off = r.vm.setModifierSource(source);
    source.set(mods({}, ['KeyX']));
    expect(runtime?.held.grid).toBe(true);
    source.set(NO_MODIFIERS);
    expect(runtime?.held.grid).toBe(false);
    off();
  });
});

function createCube(app: EditorApp): MeshId {
  const out = writeRevision(primitive('cube', {}));
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  const id = 'msh_Cube' as MeshId;
  app.store.transact({ label: 'Create' }, (tx) =>
    tx.put('meshes', {
      id,
      name: 'Cube',
      owner: { scene: true },
      parent: null,
      order: 'a0',
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      source: null,
      data: ref,
      faceted: true,
      generator: null,
      palette: null,
      material: { preset: 'unlit' },
      colourOutput: 'palette-texture',
      skin: null,
      budget: null,
      handheld: null,
      deleted: null,
    }),
  );
  return id;
}
