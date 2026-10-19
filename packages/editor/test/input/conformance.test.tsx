// Keymap conformance through the DOM adapter (M6A-SPEC §7 "Conformance test", §5.17; B0b): real `keydown`/`keyup`
// events on the page, through the shell's window listeners and KeyboardAdapter, not only `resolve()`. The table half
// of the conformance lives in `packages/editor-core/test/keymap.conformance.test.ts`.
import { afterEach, describe, expect, it } from 'vitest';
import { type KeyHarness, mountKeys } from './support';

let current: KeyHarness | null = null;
async function mount(platform: 'mac' | 'other' = 'other'): Promise<KeyHarness> {
  current = await mountKeys({ platform });
  return current;
}
afterEach(async () => {
  current?.shell.ui.setState({ viewport: null });
  current?.shell.keyboard.reset();
  await current?.view.unmount();
  current?.shell.dispose();
  current = null;
});

const MOD = { other: { ctrlKey: true }, mac: { metaKey: true } } as const;

describe.each(['other', 'mac'] as const)('DOM adapter, M2a chords (%s)', (platform) => {
  const mod = MOD[platform];

  it('Animate: Mod+V, Mod+I, Mod+D, Alt+V, Alt+X, Alt+J resolve exactly as on M2a', async () => {
    const h = await mount(platform);
    h.hover('pane');
    h.runs();
    h.press('KeyV', mod);
    const duplicate = h.key('keydown', 'KeyD', mod);
    h.key('keyup', 'KeyD', mod);
    h.press('KeyV', { altKey: true, key: '√' });
    h.press('KeyX', { altKey: true });
    h.press('KeyJ', { altKey: true });
    // Last: the Import dialog it opens owns the keyboard.
    h.press('KeyI', mod);
    expect(h.runs()).toEqual([
      { id: 'pose.paste', args: undefined },
      { id: 'time.togglePlay', args: undefined },
      { id: 'view.display.toggle', args: { flag: 'xray' } },
      { id: 'view.display.toggle', args: { flag: 'skeleton' } },
      { id: 'ui.open', args: { dialog: 'import' } },
    ]);
    h.app.session.setState({ dialog: null });
    // Mod+D runs nothing in Animate (as on M2a); its bookmark default is suppressed (QA matrix, §7).
    expect(duplicate.defaultPrevented).toBe(true);
    h.hover('graph');
    h.press('KeyV', mod);
    expect(h.runs()).toEqual([{ id: 'graph.keys.paste', args: undefined }]);
  });

  it('Animate: the Graph Editor B and I resolve on press, never deferred', async () => {
    const h = await mount(platform);
    h.hover('graph');
    h.runs();
    h.key('keydown', 'KeyB');
    expect(h.runs()).toEqual([{ id: 'graph.tangent.break', args: undefined }]);
    h.key('keyup', 'KeyB');
    h.key('keydown', 'KeyI');
    expect(h.runs()).toEqual([{ id: 'view.tool', args: { panel: 'graph', tool: 'insert' } }]);
    h.key('keyup', 'KeyI');
    expect(h.shell.keyboard.holding).toBe(false);
  });

  it('Model: the same chords keep their M2a meaning where Model does not rebind them', async () => {
    const h = await mount(platform);
    h.enterModel('face');
    h.hover('pane');
    h.runs();
    h.press('KeyV', { altKey: true });
    h.press('KeyX', { altKey: true });
    h.press('KeyJ', { altKey: true });
    // Mod+V is shadowed (controls are not shown in Model); Mod+D duplicates the selected faces.
    h.press('KeyV', mod);
    h.press('KeyD', mod);
    h.press('KeyI', mod);
    expect(h.runs()).toEqual([
      { id: 'time.togglePlay', args: undefined },
      { id: 'view.display.toggle', args: { flag: 'xray' } },
      { id: 'view.display.toggle', args: { flag: 'skeleton' } },
      { id: 'model.animateOnly', args: undefined },
      { id: 'mesh.duplicateFaces', args: undefined },
      { id: 'ui.open', args: { dialog: 'import' } },
    ]);
    h.app.session.setState({ dialog: null });
    h.hover('graph');
    h.key('keydown', 'KeyB');
    h.key('keyup', 'KeyB');
    h.key('keydown', 'KeyI');
    h.key('keyup', 'KeyI');
    expect(h.runs()).toEqual([
      { id: 'graph.tangent.break', args: undefined },
      { id: 'view.tool', args: { panel: 'graph', tool: 'insert' } },
    ]);
  });

  it('Model: Mod+B bevels on press and Mod+E extrudes over the pane and the Outliner', async () => {
    const h = await mount(platform);
    h.enterModel('edge');
    h.hover('pane');
    h.runs();
    const bevel = h.key('keydown', 'KeyB', mod);
    expect(h.runs()).toEqual([{ id: 'mesh.bevel', args: undefined }]);
    expect(bevel.defaultPrevented).toBe(true);
    h.key('keyup', 'KeyB', mod);
    h.press('KeyE', mod);
    h.hover('outliner');
    h.press('KeyE', mod);
    h.press('KeyE', { ...mod, shiftKey: true });
    expect(h.runs()).toEqual([
      { id: 'mesh.extrude', args: undefined },
      { id: 'mesh.extrude', args: undefined },
      { id: 'ui.open', args: { dialog: 'export' } },
    ]);
  });
});

describe('DOM adapter, tool keys and tap/hold (§5.17)', () => {
  it('a tool placing a cut consumes Backspace: mesh.delete never runs; idle, Backspace deletes', async () => {
    const h = await mount();
    h.enterModel('face');
    const tool = h.fakeTool({ consumes: (e) => e.code === 'Backspace' });
    tool.phase = 'placing';
    h.hover('pane');
    h.runs();
    const event = h.press('Backspace');
    expect(h.runs()).toEqual([]);
    expect(tool.events.map((e) => `${e.type} ${e.code}`)).toEqual(['down Backspace', 'up Backspace']);
    expect(event.defaultPrevented).toBe(true);
    tool.phase = 'idle';
    h.press('Backspace');
    expect(h.runs()).toEqual([{ id: 'mesh.delete', args: undefined }]);
    // The idle tool was not offered the key (not in its `keys`).
    expect(tool.events).toHaveLength(2);
  });

  // §5.10 (B12b's note for INT, M6A-INT-12): the gesture in progress owns the reserved keys wherever the pointer is.
  it('a placing tool takes Backspace with the pointer over another panel; its own keys stay pane-only', async () => {
    const h = await mount();
    h.enterModel('face');
    const tool = h.fakeTool({ keys: ['KeyX'], consumes: (e) => e.code === 'Backspace' || e.code === 'KeyX' });
    tool.phase = 'placing';
    h.hover('outliner');
    h.runs();
    const event = h.press('Backspace');
    expect(h.runs()).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(tool.events.map((e) => `${e.type} ${e.code}`)).toEqual(['down Backspace', 'up Backspace']);
    // `ToolDef.keys` still reach the tool only over a pane: over the Outliner X goes to the keymap.
    h.press('KeyX');
    expect(tool.events).toHaveLength(2);
    // Idle, Backspace over the Outliner is not offered to the tool (the keymap's again: it binds nothing there).
    tool.phase = 'idle';
    h.press('Backspace');
    expect(tool.events).toHaveLength(2);
  });

  it('a dragging tool gets the reserved modal keys first; Esc it does not take still escapes', async () => {
    const h = await mount();
    h.enterModel('vertex');
    const tool = h.fakeTool({});
    tool.phase = 'dragging';
    h.hover('pane');
    h.runs();
    for (const code of ['Enter', 'NumpadEnter', 'PageUp', 'PageDown', 'Escape']) h.press(code);
    expect(tool.events.filter((e) => e.type === 'down').map((e) => e.code)).toEqual([
      'Enter',
      'NumpadEnter',
      'PageUp',
      'PageDown',
      'Escape',
    ]);
    expect(h.runs()).toEqual([{ id: 'edit.escape', args: undefined }]);
  });

  it('X held reaches the tool as down (with repeats) and up, and runs no binding', async () => {
    const h = await mount();
    h.enterModel('vertex');
    const tool = h.fakeTool({ keys: ['KeyX', 'KeyV', 'KeyB'] });
    h.hover('pane');
    h.runs();
    const down = h.key('keydown', 'KeyX');
    h.key('keydown', 'KeyX', { repeat: true });
    // The pointer leaves the pane while X is held: the release still reaches the tool.
    h.hover('outliner');
    h.key('keyup', 'KeyX', { shiftKey: true });
    expect(tool.events).toEqual([
      { type: 'down', code: 'KeyX', shift: false, alt: false, mod: false, ctrl: false, repeat: false },
      { type: 'down', code: 'KeyX', shift: false, alt: false, mod: false, ctrl: false, repeat: true },
      { type: 'up', code: 'KeyX', shift: true, alt: false, mod: false, ctrl: false, repeat: false },
    ]);
    expect(down.defaultPrevented).toBe(false);
    expect(h.runs()).toEqual([]);
  });

  it('reports literal Ctrl and Mod separately to tools (macOS)', async () => {
    const h = await mount('mac');
    h.enterModel('edge');
    const tool = h.fakeTool({ keys: ['KeyX'] });
    h.hover('pane');
    h.key('keydown', 'KeyX', { ctrlKey: true });
    h.key('keydown', 'KeyX', { metaKey: true });
    expect(tool.events.map((e) => [e.ctrl, e.mod])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('a window blur releases the keys a tool holds', async () => {
    const h = await mount();
    h.enterModel('face');
    const tool = h.fakeTool({ keys: ['KeyV'] });
    h.hover('pane');
    h.key('keydown', 'KeyV');
    window.dispatchEvent(new FocusEvent('blur'));
    expect(tool.events.map((e) => `${e.type} ${e.code}`)).toEqual(['down KeyV', 'up KeyV']);
  });

  it('a B tap toggles soft select; B with a pointer-down in between is the radius drag, no tap', async () => {
    const h = await mount();
    h.enterModel('vertex');
    const tool = h.fakeTool({ keys: ['KeyB'] });
    h.hover('pane');
    h.runs();
    const down = h.key('keydown', 'KeyB');
    expect(down.defaultPrevented).toBe(true);
    expect(h.runs()).toEqual([]);
    h.key('keyup', 'KeyB');
    expect(h.runs()).toEqual([{ id: 'model.softSelect.toggle', args: undefined }]);
    h.key('keydown', 'KeyB');
    h.pointerDown();
    h.key('keyup', 'KeyB');
    expect(h.runs()).toEqual([]);
    // The tool observed both holds.
    expect(tool.events.map((e) => `${e.type} ${e.code}`)).toEqual(['down KeyB', 'up KeyB', 'down KeyB', 'up KeyB']);
  });

  it('B is a plain key outside the Model viewport and with modifiers', async () => {
    const h = await mount();
    h.enterModel('face');
    h.hover('outliner');
    h.runs();
    const outliner = h.key('keydown', 'KeyB');
    h.key('keyup', 'KeyB');
    expect([outliner.defaultPrevented, h.runs()]).toEqual([false, []]);
    h.hover('pane');
    h.key('keydown', 'KeyB', { shiftKey: true });
    expect(h.shell.keyboard.holding).toBe(false);
  });

  it('the capture window consumes a key before tools and the keymap, keyup included', async () => {
    const h = await mount();
    h.enterModel('face');
    const tool = h.fakeTool({ keys: ['Digit4'] });
    let armed = true;
    const seen: string[] = [];
    Object.defineProperty(h.app.capture, 'state', {
      get: () => ({ armed: armed ? 'keyboard-op' : null, field: null, text: null }),
      configurable: true,
    });
    Object.defineProperty(h.app.capture, 'key', {
      value: (e: { code: string }) => {
        seen.push(e.code);
        return e.code === 'Digit4';
      },
      configurable: true,
    });
    h.hover('pane');
    h.runs();
    const down = h.key('keydown', 'Digit4');
    const up = h.key('keyup', 'Digit4');
    expect([down.defaultPrevented, up.defaultPrevented]).toEqual([true, true]);
    expect([seen, tool.events, h.runs()]).toEqual([['Digit4'], [], []]);
    // Disarmed, `4` reaches the tool, then the keymap (shading).
    armed = false;
    h.press('Digit4');
    expect(seen).toEqual(['Digit4']);
    expect(tool.events.map((e) => e.type)).toEqual(['down', 'up']);
    expect(h.runs()).toEqual([{ id: 'view.shading', args: { mode: 'wire' } }]);
  });

  it('suppresses the browser default of the QA-matrix chords where nothing is bound', async () => {
    const h = await mount();
    h.hover('graph');
    for (const [code, init] of [
      ['F10', {}],
      ['KeyB', { ctrlKey: true }],
      ['KeyD', { ctrlKey: true }],
      ['KeyG', { ctrlKey: true }],
    ] as const) {
      expect([code, h.key('keydown', code, init).defaultPrevented]).toEqual([code, true]);
      h.key('keyup', code, init);
    }
    expect(h.key('keydown', 'KeyL', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(h.runs().map((run) => run.id)).toEqual([]);
  });
});
