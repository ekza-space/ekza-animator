// DOM input adapter (MVP-SPEC §7 WP-8 tests): scope chain from the hovered panel, tap vs hold, text-input
// suppression and `KeyboardEvent.code` with non-Latin `key`.
import { GLOBAL_SCOPE, type KeyBinding, type KeymapManager } from '@ekza-animator/editor-core';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { type KeyDispatch, KeyboardAdapter, type KeyScopeChain, type TimerApi } from '../src/input/keyboard';
import { hoverTargetOf, scopeChainOf } from '../src/input/pointer';

const BINDINGS: readonly KeyBinding[] = [
  { chord: { code: 'KeyS' }, op: 'key.set', args: { channels: 'all' }, scope: 'viewport' },
  { chord: { code: 'KeyS' }, op: 'graph.keys.keyCurves', scope: 'graph' },
  { chord: { code: 'KeyZ', mod: true }, op: 'edit.undo', scope: GLOBAL_SCOPE },
  { chord: { code: 'KeyS', mod: true }, op: 'file.save', scope: GLOBAL_SCOPE },
  { chord: { code: 'KeyO', mod: true }, op: 'file.open', scope: GLOBAL_SCOPE },
  { chord: { code: 'KeyC', mod: true }, op: 'edit.copy', scope: GLOBAL_SCOPE },
  { chord: { code: 'KeyK', shift: true }, op: 'key.toggleAutoKey', scope: GLOBAL_SCOPE },
  { chord: { code: 'KeyV', alt: true }, op: 'time.togglePlay', scope: GLOBAL_SCOPE },
  { chord: { code: 'Period', alt: true }, op: 'time.step', args: { delta: 1 }, scope: GLOBAL_SCOPE },
  { chord: { code: 'Space' }, op: 'view.toggleMaximize', scope: GLOBAL_SCOPE, trigger: 'tap' },
  { chord: { code: 'Space' }, op: 'view.cameraRadial', scope: 'viewport', trigger: 'hold' },
];

/** Manual timers: `advance(ms)` fires what is due. */
function manualTimers(): TimerApi & { advance(ms: number): void } {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  return {
    set(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of pending) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.fn();
        }
      }
    },
  };
}

interface Setup {
  readonly adapter: KeyboardAdapter;
  readonly dispatched: KeyDispatch[];
  readonly timers: ReturnType<typeof manualTimers>;
  hover(chain: KeyScopeChain): void;
  block(blocked: boolean): void;
  space(behaviour: 'maya' | 'play'): void;
}

function setup(platform: 'mac' | 'other' = 'other', bindings: readonly KeyBinding[] = BINDINGS): Setup {
  const app = createFakeEditorApp({ platform });
  app.contribute({ kind: 'keymap', bindings });
  const keymap: KeymapManager = app.keymap;
  const dispatched: KeyDispatch[] = [];
  const timers = manualTimers();
  let chain: KeyScopeChain = { scopes: [GLOBAL_SCOPE], panel: null, paneId: null };
  let blocked = false;
  let behaviour: 'maya' | 'play' = 'maya';
  const adapter = new KeyboardAdapter({
    keymap,
    scopeChain: () => chain,
    blocked: () => blocked,
    spaceBehaviour: () => behaviour,
    dispatch: (d) => dispatched.push(d),
    timers,
  });
  return {
    adapter,
    dispatched,
    timers,
    hover: (next) => {
      chain = next;
    },
    block: (next) => {
      blocked = next;
    },
    space: (next) => {
      behaviour = next;
    },
  };
}

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
const VIEWPORT: KeyScopeChain = { scopes: ['viewport', GLOBAL_SCOPE], panel: 'viewport', paneId: 'pane-right' };
const GRAPH: KeyScopeChain = { scopes: ['graph', GLOBAL_SCOPE], panel: 'graph', paneId: null };

const cleanup: Element[] = [];
afterEach(() => {
  for (const element of cleanup.splice(0)) element.remove();
});

describe('KeyboardAdapter', () => {
  it('matches physical keys: KeyS with a Cyrillic `key` keys the viewport selection (E2E-20)', () => {
    const s = setup();
    s.hover(VIEWPORT);
    const event = key('keydown', { code: 'KeyS', key: 'ы' });
    expect(s.adapter.keyDown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(s.dispatched).toEqual([
      expect.objectContaining({
        op: 'key.set',
        args: { channels: 'all' },
        ctx: { panel: 'viewport', paneId: 'pane-right' },
      }),
    ]);
  });

  it('resolves through the scope chain of the panel under the pointer, most specific first', () => {
    const s = setup();
    s.hover(GRAPH);
    s.adapter.keyDown(key('keydown', { code: 'KeyS', key: 's' }));
    s.hover(VIEWPORT);
    s.adapter.keyDown(key('keydown', { code: 'KeyS', key: 's' }));
    s.hover({ scopes: [GLOBAL_SCOPE], panel: null, paneId: null });
    const unbound = key('keydown', { code: 'KeyS', key: 's' });
    expect(s.adapter.keyDown(unbound)).toBe(false);
    expect(unbound.defaultPrevented).toBe(false);
    expect(s.dispatched.map((d) => d.op)).toEqual(['graph.keys.keyCurves', 'key.set']);
  });

  it('falls back to global bindings from any panel scope', () => {
    const s = setup();
    s.hover(GRAPH);
    s.adapter.keyDown(key('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true }));
    expect(s.dispatched.map((d) => d.op)).toEqual(['edit.undo']);
  });

  it('uses Cmd as mod on macOS and Option chords by code (Alt+V with key "√")', () => {
    const s = setup('mac');
    s.adapter.keyDown(key('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true }));
    s.adapter.keyDown(key('keydown', { code: 'KeyZ', key: 'z', metaKey: true }));
    s.adapter.keyDown(key('keydown', { code: 'KeyV', key: '√', altKey: true }));
    expect(s.dispatched.map((d) => d.op)).toEqual(['edit.undo', 'time.togglePlay']);
  });

  it('leaves typing in text fields alone, except Mod+S', () => {
    const s = setup();
    s.hover(VIEWPORT);
    const input = document.createElement('input');
    document.body.append(input);
    cleanup.push(input);
    const results: boolean[] = [];
    input.addEventListener('keydown', (event) => results.push(s.adapter.keyDown(event)));
    input.dispatchEvent(key('keydown', { code: 'KeyS', key: 's' }));
    input.dispatchEvent(key('keydown', { code: 'Space', key: ' ' }));
    input.dispatchEvent(key('keydown', { code: 'KeyZ', key: 'z', ctrlKey: true }));
    input.dispatchEvent(key('keydown', { code: 'KeyS', key: 's', ctrlKey: true }));
    expect(results).toEqual([false, false, false, true]);
    expect(s.dispatched.map((d) => d.op)).toEqual(['file.save']);
  });

  it('keeps hotkeys on non-text controls (a focused checkbox or button)', () => {
    const s = setup();
    s.hover(VIEWPORT);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    cleanup.push(checkbox);
    checkbox.addEventListener('keydown', (event) => s.adapter.keyDown(event));
    checkbox.dispatchEvent(key('keydown', { code: 'KeyS', key: 's' }));
    expect(s.dispatched.map((d) => d.op)).toEqual(['key.set']);
  });

  it('ignores keys while a dialog is open, composition and bare modifiers', () => {
    const s = setup();
    s.hover(VIEWPORT);
    s.block(true);
    expect(s.adapter.keyDown(key('keydown', { code: 'KeyS', key: 's' }))).toBe(false);
    s.block(false);
    expect(s.adapter.keyDown(key('keydown', { code: 'KeyS', key: 'Process' }))).toBe(false);
    expect(s.adapter.keyDown(key('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true }))).toBe(false);
    expect(s.dispatched).toEqual([]);
  });

  it("keeps the editor's chords from reaching the browser while a dialog is open, without running them", () => {
    const s = setup();
    s.block(true);
    const save = key('keydown', { code: 'KeyS', key: 's', ctrlKey: true });
    const open = key('keydown', { code: 'KeyO', key: 'o', ctrlKey: true });
    const copy = key('keydown', { code: 'KeyC', key: 'c', ctrlKey: true });
    const unbound = key('keydown', { code: 'KeyL', key: 'l', ctrlKey: true });
    const plain = key('keydown', { code: 'KeyS', key: 's' });
    for (const event of [save, open, copy, unbound, plain]) expect(s.adapter.keyDown(event)).toBe(false);
    expect([save, open].map((event) => event.defaultPrevented)).toEqual([true, true]);
    // Copy (licence text), unbound chords and plain keys (the dialog's own typing and buttons) keep their defaults.
    expect([copy, unbound, plain].map((event) => event.defaultPrevented)).toEqual([false, false, false]);

    // In a dialog's text field only the save chord is held back, as outside dialogs.
    const field = document.createElement('input');
    document.body.append(field);
    cleanup.push(field);
    const fieldSave = key('keydown', { code: 'KeyS', key: 's', ctrlKey: true });
    const fieldOpen = key('keydown', { code: 'KeyO', key: 'o', ctrlKey: true });
    field.dispatchEvent(fieldSave);
    field.dispatchEvent(fieldOpen);
    s.adapter.keyDown(fieldSave);
    s.adapter.keyDown(fieldOpen);
    expect([fieldSave.defaultPrevented, fieldOpen.defaultPrevented]).toEqual([true, false]);
    expect(s.dispatched).toEqual([]);
  });

  it('keeps suppressing the browser default of a held chord whose repeats the keymap refuses (Mod+S)', () => {
    const app = createFakeEditorApp();
    app.contribute({ kind: 'keymap', bindings: BINDINGS });
    // The production keymap (WP-7a) resolves an auto-repeated keydown only for repeatable operators.
    const keymap: KeymapManager = {
      ...app.keymap,
      resolve: (input, scopes, trigger) => {
        const binding = app.keymap.resolve(input, scopes, trigger);
        return input.repeat && binding !== null && binding.op !== 'time.step' ? null : binding;
      },
    };
    const dispatched: KeyDispatch[] = [];
    const adapter = new KeyboardAdapter({
      keymap,
      scopeChain: () => ({ scopes: [GLOBAL_SCOPE], panel: null, paneId: null }),
      blocked: () => false,
      spaceBehaviour: () => 'maya',
      dispatch: (d) => dispatched.push(d),
    });
    const first = key('keydown', { code: 'KeyS', key: 's', ctrlKey: true });
    const held = key('keydown', { code: 'KeyS', key: 's', ctrlKey: true, repeat: true });
    expect(adapter.keyDown(first)).toBe(true);
    expect(adapter.keyDown(held)).toBe(true);
    expect(held.defaultPrevented).toBe(true);
    adapter.keyDown(key('keydown', { code: 'Period', key: '.', altKey: true, repeat: true }));
    expect(dispatched.map((d) => d.op)).toEqual(['file.save', 'time.step']);
  });

  it('fires auto-repeat only for stepping commands', () => {
    const s = setup();
    s.adapter.keyDown(key('keydown', { code: 'KeyK', key: 'K', shiftKey: true }));
    s.adapter.keyDown(key('keydown', { code: 'KeyK', key: 'K', shiftKey: true, repeat: true }));
    s.adapter.keyDown(key('keydown', { code: 'Period', key: '≥', altKey: true }));
    s.adapter.keyDown(key('keydown', { code: 'Period', key: '≥', altKey: true, repeat: true }));
    expect(s.dispatched.map((d) => d.op)).toEqual(['key.toggleAutoKey', 'time.step', 'time.step']);
  });

  describe('Space tap and hold (200 ms)', () => {
    it('a tap under 200 ms toggles maximize for the pane under the pointer', () => {
      const s = setup();
      s.hover(VIEWPORT);
      const down = key('keydown', { code: 'Space', key: ' ' });
      expect(s.adapter.keyDown(down)).toBe(true);
      expect(down.defaultPrevented).toBe(true); // no page scroll
      s.timers.advance(150);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched).toEqual([
        expect.objectContaining({
          op: 'view.toggleMaximize',
          trigger: 'tap',
          ctx: { panel: 'viewport', paneId: 'pane-right' },
        }),
      ]);
    });

    it('holding past 200 ms runs the hold binding and no tap on release', () => {
      const s = setup();
      s.hover(VIEWPORT);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ', repeat: true }));
      s.timers.advance(250);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched.map((d) => [d.op, d.trigger])).toEqual([['view.cameraRadial', 'hold']]);
    });

    it('a hold without a hold binding in scope does nothing', () => {
      const s = setup();
      s.hover(GRAPH);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.timers.advance(400);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched).toEqual([]);
    });

    it('pressing the pointer during the hold makes it a hold; another key cancels the tap', () => {
      const s = setup();
      s.hover(VIEWPORT);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.adapter.pointerActivity();
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched.map((d) => d.op)).toEqual(['view.cameraRadial']);

      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.adapter.keyDown(key('keydown', { code: 'KeyS', key: 's' }));
      s.timers.advance(300);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched.map((d) => d.op)).toEqual(['view.cameraRadial', 'key.set']);
    });

    it('with spaceBehaviour "play" a tap toggles playback instead', () => {
      const s = setup();
      s.space('play');
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched.map((d) => d.op)).toEqual(['time.togglePlay']);
    });

    it('a dialog opened while Space is down swallows the tap and the hold', () => {
      const s = setup();
      s.hover(VIEWPORT);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.block(true);
      const up = key('keyup', { code: 'Space', key: ' ' });
      expect(s.adapter.keyUp(up)).toBe(true);
      expect(up.defaultPrevented).toBe(true);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' })); // ignored: the dialog owns Space
      s.block(false);
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      s.block(true);
      s.timers.advance(300);
      s.block(false);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched).toEqual([]);
      expect(s.adapter.holding).toBe(false);
    });

    it('reset() on blur forgets a held key', () => {
      const s = setup();
      s.adapter.keyDown(key('keydown', { code: 'Space', key: ' ' }));
      expect(s.adapter.holding).toBe(true);
      s.adapter.reset();
      expect(s.adapter.holding).toBe(false);
      s.timers.advance(300);
      s.adapter.keyUp(key('keyup', { code: 'Space', key: ' ' }));
      expect(s.dispatched).toEqual([]);
    });
  });

  it('prevents the default of a bare Alt release (Firefox menu bar)', () => {
    const s = setup();
    const up = key('keyup', { code: 'AltLeft', key: 'Alt' });
    expect(s.adapter.keyUp(up)).toBe(true);
    expect(up.defaultPrevented).toBe(true);
  });
});

describe('hover target and scope chain', () => {
  it('finds the panel frame, its scope and the viewport pane under the pointer', () => {
    const frame = document.createElement('div');
    frame.setAttribute('data-ekza-panel', 'viewport');
    frame.setAttribute('data-ekza-scope', 'viewport');
    frame.setAttribute('data-ekza-panel-instance', 'viewport');
    const pane = document.createElement('div');
    pane.setAttribute('data-pane-id', 'pane-left');
    const inner = document.createElement('span');
    pane.append(inner);
    frame.append(pane);
    document.body.append(frame);
    cleanup.push(frame);

    expect(hoverTargetOf(inner, 10, 10, null)).toEqual({
      kind: 'viewport',
      scope: 'viewport',
      instanceId: 'viewport',
      paneId: 'pane-left',
    });
    expect(hoverTargetOf(inner, 10, 10, () => 'pane-right')?.paneId).toBe('pane-right');
    expect(hoverTargetOf(document.body, 0, 0, null)).toBeNull();
    expect(scopeChainOf(hoverTargetOf(inner, 0, 0, null))).toEqual(['viewport', GLOBAL_SCOPE]);
    expect(scopeChainOf(null)).toEqual([GLOBAL_SCOPE]);
  });

  it("reads WP-5's pane surfaces (data-ekza-panel + data-ekza-pane) inside the shell's panel frame", () => {
    const frame = document.createElement('div');
    frame.setAttribute('data-ekza-panel', 'viewport');
    frame.setAttribute('data-ekza-scope', 'viewport');
    frame.setAttribute('data-ekza-panel-instance', 'viewport');
    const surface = document.createElement('div');
    surface.setAttribute('data-ekza-panel', 'viewport');
    surface.setAttribute('data-ekza-pane', 'pane-right');
    const inner = document.createElement('span');
    surface.append(inner);
    frame.append(surface);
    document.body.append(frame);
    cleanup.push(frame);

    expect(hoverTargetOf(inner, 10, 10, null)).toEqual({
      kind: 'viewport',
      scope: 'viewport',
      instanceId: 'viewport',
      paneId: 'pane-right',
    });
    // A manager that cannot answer (e.g. a not-implemented stub) falls back to the DOM.
    const throwing = (): string | null => {
      throw new Error('not implemented');
    };
    expect(hoverTargetOf(inner, 10, 10, throwing)?.paneId).toBe('pane-right');
  });
});
