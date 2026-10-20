// B0b (M6A-SPEC §7, §5.17): every §7 keymap row, the hierarchical scope chain, the Animate shadows, the tap/hold
// contract and auto-repeat of grow/shrink.
import { describe, expect, it } from 'vitest';
import {
  chordInput,
  type KeyBinding,
  keyScopeChain,
  MAYA_KEYMAP,
  MODEL_SCOPE,
  type OperatorId,
  resolveChord,
} from '../src';
import { animateChain, ch, mayaKeymap, modelChain, resolved, sameChord } from './keymap-support';

const mv = MODEL_SCOPE.viewport;
const mvc = MODEL_SCOPE.component;
const mve = MODEL_SCOPE.edge;
const mvf = MODEL_SCOPE.face;
const mo = MODEL_SCOPE.outliner;
const m = MODEL_SCOPE.model;
const V = 'viewport';
const G = 'global';

/** §7, one entry per row: chords, operator, args, scopes, trigger. */
const ROWS: readonly (readonly [string[], string, unknown, string[], ('tap' | undefined)?])[] = [
  [['F8'], 'select.mode', { mode: 'toggle' }, [mv]],
  [['F9', 'Digit1'], 'select.mode', { mode: 'vertex' }, [mv]],
  [['F10', 'Digit2'], 'select.mode', { mode: 'edge' }, [mv]],
  [['Digit3'], 'select.mode', { mode: 'face' }, [mv]],
  [['Mod+F9'], 'select.mesh.convert', { to: 'vertex', mode: 'touching' }, [mvc]],
  [['Mod+F10'], 'select.mesh.convert', { to: 'edge', mode: 'touching' }, [mvc]],
  [['Mod+F11'], 'select.mesh.convert', { to: 'face', mode: 'touching' }, [mvc]],
  [['Digit4'], 'view.shading', { mode: 'wire' }, [V]],
  [['Digit5'], 'view.shading', { mode: 'shaded' }, [V]],
  [['Digit6'], 'view.shading', { mode: 'colours' }, [V]],
  [['Digit7'], 'view.shading', { mode: 'lit' }, [V]],
  [['Mod+KeyE'], 'mesh.extrude', undefined, [m]],
  [['Mod+KeyE'], 'ui.open', { dialog: 'export' }, [G]],
  [['Mod+Shift+KeyE'], 'ui.open', { dialog: 'export' }, [G]],
  [['Mod+KeyB'], 'mesh.bevel', undefined, [mvc]],
  [['KeyK'], 'view.tool', { panel: 'viewport', tool: 'multiCut' }, [mv]],
  [['KeyM'], 'ui.markingMenu', { menu: 'model.merge' }, [mvc]],
  [['KeyG'], 'edit.repeatLast', undefined, [mv]],
  [['KeyT'], 'view.lastOpCard', { expand: true, focusPrimary: true }, [mv]],
  [['KeyY'], 'tool.last', undefined, [mv]],
  [['KeyR'], 'view.tool', { panel: 'viewport', tool: 'scale' }, [V]],
  [['Delete', 'Backspace'], 'mesh.delete', undefined, [mvc]],
  [['Delete', 'Backspace'], 'scene.delete', undefined, [mv]],
  [['Mod+Delete', 'Mod+Backspace'], 'mesh.deleteEdgeVertex', undefined, [mvc]],
  [['Shift+Period'], 'select.mesh.grow', undefined, [mvc]],
  [['Shift+Comma'], 'select.mesh.shrink', undefined, [mvc]],
  [['KeyH'], 'view.hide', { target: 'selected' }, [mv, mo]],
  [['Shift+KeyH'], 'view.showAll', undefined, [mv, mo]],
  [['Alt+KeyH'], 'view.hide', { target: 'unselected' }, [mv, mo]],
  [['Shift+KeyL'], 'view.isolate', undefined, [mv]],
  [['Ctrl+Alt+ArrowRight'], 'mesh.spinEdge', { direction: 'forward' }, [mve]],
  [['Ctrl+Alt+ArrowLeft'], 'mesh.spinEdge', { direction: 'back' }, [mve]],
  [['ArrowUp'], 'select.mesh.pickWalk', { direction: 'up' }, [mvc]],
  [['ArrowDown'], 'select.mesh.pickWalk', { direction: 'down' }, [mvc]],
  [['ArrowLeft'], 'select.mesh.pickWalk', { direction: 'left' }, [mvc]],
  [['ArrowRight'], 'select.mesh.pickWalk', { direction: 'right' }, [mvc]],
  [['Mod+KeyD'], 'scene.duplicate', undefined, [mv, mo]],
  [['Mod+KeyD'], 'mesh.duplicateFaces', undefined, [mvf]],
  [['Mod+KeyG'], 'scene.group', undefined, [mv, mo]],
  [['KeyP'], 'scene.parent', undefined, [mv, mo]],
  [['Shift+KeyP'], 'scene.unparent', undefined, [mv, mo]],
  [['Insert', 'Home'], 'model.pivot.editToggle', undefined, [mv]],
  [['KeyB'], 'model.softSelect.toggle', undefined, [mv], 'tap'],
  [['Backquote'], 'model.selectionStyle.set', { style: 'toggle' }, [mv]],
  [
    [
      'KeyS',
      'Shift+KeyW',
      'Shift+KeyE',
      'Shift+KeyR',
      'Alt+KeyS',
      'Alt+KeyM',
      'Mod+KeyC',
      'Mod+KeyV',
      'Mod+Shift+KeyV',
    ],
    'model.animateOnly',
    undefined,
    [mv],
  ],
  [['Mod+KeyA'], 'select.mesh.all', undefined, [mvc]],
  [['Mod+KeyA'], 'select.objects', { all: 'meshes', mode: 'replace' }, [mv]],
  [['Mod+KeyK'], 'ui.commandPalette', undefined, [G]],
];

function expected(): KeyBinding[] {
  const out: KeyBinding[] = [];
  for (const [chords, op, args, scopes, trigger] of ROWS) {
    for (const chord of chords) {
      for (const scope of scopes) {
        out.push({
          chord: ch(chord),
          op: op as OperatorId,
          scope,
          ...(args === undefined ? {} : { args }),
          ...(trigger === undefined ? {} : { trigger }),
        });
      }
    }
  }
  return out;
}

const NEW_SCOPES = new Set<string>(Object.values(MODEL_SCOPE));
const isM6aRow = (binding: KeyBinding): boolean =>
  NEW_SCOPES.has(binding.scope) ||
  (binding.op === 'view.shading' && binding.scope === V) ||
  (binding.op === 'view.tool' && binding.scope === V && (binding.args as { tool?: string }).tool === 'scale') ||
  binding.op === 'ui.commandPalette' ||
  (binding.op === 'ui.open' && binding.chord.shift === true && binding.chord.code === 'KeyE');

describe('§7 keymap rows (preset maya)', () => {
  it('contains every §7 row exactly once', () => {
    const rows = expected();
    for (const row of rows) {
      const matches = MAYA_KEYMAP.filter(
        (binding) =>
          sameChord(binding.chord, row.chord) &&
          binding.scope === row.scope &&
          (binding.trigger ?? 'press') === (row.trigger ?? 'press'),
      );
      expect([JSON.stringify(row), matches]).toEqual([JSON.stringify(row), [row]]);
    }
  });

  it('adds no row beyond the §7 table', () => {
    const rows = expected().filter((row) => isM6aRow(row));
    const added = MAYA_KEYMAP.filter(isM6aRow);
    expect(added.length).toBe(rows.length);
    expect(new Set(added.map((b) => JSON.stringify(b)))).toEqual(new Set(rows.map((b) => JSON.stringify(b))));
  });

  it('labels the new chords for the cheat sheet and menus on both platforms', () => {
    const mac = mayaKeymap('mac');
    const other = mayaKeymap('other');
    expect([other.label(ch('Mod+KeyE')), mac.label(ch('Mod+KeyE'))]).toEqual(['Ctrl+E', '⌘E']);
    expect([other.label(ch('Mod+Shift+KeyE')), mac.label(ch('Mod+Shift+KeyE'))]).toEqual(['Ctrl+Shift+E', '⇧⌘E']);
    expect([other.label(ch('Ctrl+Alt+ArrowRight')), mac.label(ch('Ctrl+Alt+ArrowRight'))]).toEqual([
      'Ctrl+Alt+→',
      '⌃⌥→',
    ]);
    expect([other.label(ch('Mod+Backspace')), mac.label(ch('Mod+Backspace'))]).toEqual(['Ctrl+Backspace', '⌘⌫']);
    expect([other.label(ch('Shift+Period')), other.label(ch('Backquote')), other.label(ch('F10'))]).toEqual([
      'Shift+.',
      '`',
      'F10',
    ]);
  });
});

describe('scope chain (§5.17)', () => {
  it('builds the Model chain over a pane in each mode, over other panels and outside them', () => {
    expect(modelChain('viewport', 'face')).toEqual([
      'model.viewport.face',
      'model.viewport.component',
      'model.viewport',
      'viewport',
      'model',
      'global',
    ]);
    expect(modelChain('viewport', 'vertex').slice(0, 2)).toEqual(['model.viewport.vertex', 'model.viewport.component']);
    expect(modelChain('viewport')).toEqual(['model.viewport', 'viewport', 'model', 'global']);
    expect(modelChain('outliner', 'face')).toEqual(['model.outliner', 'outliner', 'model', 'global']);
    expect(modelChain(null)).toEqual(['model', 'global']);
    expect(modelChain('global')).toEqual(['model', 'global']);
  });

  it('keeps the shipped `<panel>` → `global` chain in Animate whatever the mode', () => {
    expect(animateChain('graph')).toEqual(['graph', 'global']);
    expect(keyScopeChain({ workspace: null, panel: 'viewport', viewport: true, mode: 'face' })).toEqual([
      'viewport',
      'global',
    ]);
    expect(animateChain(null)).toEqual(['global']);
    expect(animateChain('global')).toEqual(['global']);
  });

  it('resolves Model face mode over a pane: deeper scopes shadow, time and shipped viewport keys pass through', () => {
    const keymap = mayaKeymap();
    const face = modelChain('viewport', 'face');
    expect(resolved(keymap, 'Mod+KeyD', face)).toEqual({ op: 'mesh.duplicateFaces', scope: mvf });
    expect(resolved(keymap, 'Delete', face)).toEqual({ op: 'mesh.delete', scope: mvc });
    expect(resolved(keymap, 'Mod+KeyA', face)).toEqual({ op: 'select.mesh.all', scope: mvc });
    expect(resolved(keymap, 'Mod+KeyE', face)).toEqual({ op: 'mesh.extrude', scope: m });
    expect(resolved(keymap, 'KeyS', face)).toEqual({ op: 'model.animateOnly', scope: mv });
    expect(resolved(keymap, 'Mod+KeyV', face)).toEqual({ op: 'model.animateOnly', scope: mv });
    expect(resolved(keymap, 'Alt+KeyM', face)).toEqual({ op: 'model.animateOnly', scope: mv });
    expect(resolved(keymap, 'KeyW', face)).toEqual({
      op: 'view.tool',
      args: { panel: 'viewport', tool: 'move' },
      scope: V,
    });
    expect(resolved(keymap, 'Comma', face)).toEqual({ op: 'time.prevKey', scope: G });
    expect(resolved(keymap, 'Alt+KeyV', face)).toEqual({ op: 'time.togglePlay', scope: G });
    expect(resolved(keymap, 'End', face)).toEqual({ op: 'time.goToEnd', scope: G });
    expect(resolved(keymap, 'Home', face)).toEqual({ op: 'model.pivot.editToggle', scope: mv });
    expect(resolved(keymap, 'ArrowUp', face)).toEqual({
      op: 'select.mesh.pickWalk',
      args: { direction: 'up' },
      scope: mvc,
    });
    expect(resolved(keymap, 'Ctrl+Alt+ArrowRight', face)).toBeNull();
    expect(resolved(keymap, 'KeyB', face, 'tap')).toEqual({ op: 'model.softSelect.toggle', scope: mv });
    expect(resolved(keymap, 'KeyB', face)).toBeNull();
  });

  it('resolves Model object and edge mode over a pane', () => {
    const keymap = mayaKeymap();
    const object = modelChain('viewport');
    expect(resolved(keymap, 'Delete', object)).toEqual({ op: 'scene.delete', scope: mv });
    expect(resolved(keymap, 'Mod+KeyA', object)).toEqual({
      op: 'select.objects',
      args: { all: 'meshes', mode: 'replace' },
      scope: mv,
    });
    expect(resolved(keymap, 'Mod+KeyB', object)).toBeNull();
    expect(resolved(keymap, 'KeyM', object)).toBeNull();
    expect(resolved(keymap, 'Mod+KeyE', object)).toEqual({ op: 'mesh.extrude', scope: m });
    // Plain arrows keep the shipped control pick-walk in object mode.
    expect(resolved(keymap, 'ArrowUp', object)?.op).toBe('select.pickWalk');
    const edge = modelChain('viewport', 'edge');
    expect(resolved(keymap, 'Ctrl+Alt+ArrowRight', edge)).toEqual({
      op: 'mesh.spinEdge',
      args: { direction: 'forward' },
      scope: mve,
    });
    expect(resolved(keymap, 'Mod+KeyD', edge)).toEqual({ op: 'scene.duplicate', scope: mv });
    expect(resolved(keymap, 'Shift+Period', edge)).toEqual({ op: 'select.mesh.grow', scope: mvc });
  });

  it('resolves Model over the Outliner: its own rows, then the shipped Outliner rows, then Model', () => {
    const keymap = mayaKeymap();
    const outliner = modelChain('outliner', 'face');
    expect(resolved(keymap, 'KeyH', outliner)).toEqual({ op: 'view.hide', args: { target: 'selected' }, scope: mo });
    expect(resolved(keymap, 'Mod+KeyD', outliner)).toEqual({ op: 'scene.duplicate', scope: mo });
    expect(resolved(keymap, 'Mod+KeyE', outliner)).toEqual({ op: 'mesh.extrude', scope: m });
    expect(resolved(keymap, 'Mod+KeyA', outliner)).toEqual({ op: 'select.all', scope: 'outliner' });
    expect(resolved(keymap, 'Delete', outliner)).toBeNull();
    expect(resolved(keymap, 'Mod+Shift+KeyE', outliner)).toEqual({
      op: 'ui.open',
      args: { dialog: 'export' },
      scope: G,
    });
  });

  it('resolves Animate exactly as shipped for the chords Model rebinds', () => {
    const keymap = mayaKeymap();
    const viewport = animateChain('viewport');
    expect(resolved(keymap, 'Mod+KeyE', viewport)).toEqual({ op: 'ui.open', args: { dialog: 'export' }, scope: G });
    expect(resolved(keymap, 'KeyS', viewport)).toEqual({ op: 'key.set', args: { channels: 'all' }, scope: V });
    expect(resolved(keymap, 'Delete', viewport)).toEqual({ op: 'key.deleteAtFrame', scope: V });
    expect(resolved(keymap, 'Home', viewport)).toEqual({ op: 'time.goToStart', scope: G });
    expect(resolved(keymap, 'Digit1', viewport)).toBeNull();
    expect(resolved(keymap, 'KeyK', viewport)).toBeNull();
    expect(resolved(keymap, 'Mod+KeyD', viewport)).toBeNull();
    expect(resolved(keymap, 'KeyB', viewport, 'tap')).toBeNull();
    // The named changes of §3 rule 10 and the global palette.
    expect(resolved(keymap, 'Digit4', viewport)).toEqual({ op: 'view.shading', args: { mode: 'wire' }, scope: V });
    expect(resolved(keymap, 'KeyR', viewport)).toEqual({
      op: 'view.tool',
      args: { panel: 'viewport', tool: 'scale' },
      scope: V,
    });
    expect(resolved(keymap, 'Mod+KeyK', animateChain('graph'))).toEqual({ op: 'ui.commandPalette', scope: G });
    expect(resolved(keymap, 'Digit4', animateChain('graph'))).toEqual({
      op: 'graph.tangent.set',
      args: { type: 'linear' },
      scope: 'graph',
    });
  });

  it('resolves Mod chords on macOS through Cmd and the literal Ctrl rows through Control', () => {
    const mac = mayaKeymap('mac');
    const edge = modelChain('viewport', 'edge');
    expect(resolved(mac, 'Mod+KeyE', edge)?.op).toBe('mesh.extrude');
    expect(mac.resolve(chordInput(ch('Mod+KeyE'), 'other'), edge, 'press')).toBeNull();
    expect(resolved(mac, 'Ctrl+Alt+ArrowLeft', edge)?.args).toEqual({ direction: 'back' });
    // ⌘⌥← is not the spin chord on a Mac.
    expect(mac.resolve(chordInput(ch('Mod+Alt+ArrowLeft'), 'mac'), edge, 'press')).toBeNull();
  });
});

describe('tap/hold contract (§5.17)', () => {
  const noMods = { mod: false, shift: false, alt: false, ctrl: false };
  const keymap = mayaKeymap();

  it('defers Space everywhere with any modifiers, as shipped', () => {
    for (const scopes of [animateChain('graph'), modelChain('viewport', 'face'), ['global']]) {
      expect(keymap.isTapHoldKey('Space', scopes, noMods)).toBe(true);
      expect(keymap.isTapHoldKey('Space', scopes, { ...noMods, mod: true, shift: true })).toBe(true);
    }
  });

  it('defers KeyB only unmodified and only with the Model viewport in the chain', () => {
    expect(keymap.isTapHoldKey('KeyB', modelChain('viewport'), noMods)).toBe(true);
    expect(keymap.isTapHoldKey('KeyB', modelChain('viewport', 'face'), noMods)).toBe(true);
    expect(keymap.isTapHoldKey('KeyB', modelChain('outliner'), noMods)).toBe(false);
    expect(keymap.isTapHoldKey('KeyB', animateChain('viewport'), noMods)).toBe(false);
    expect(keymap.isTapHoldKey('KeyB', animateChain('graph'), noMods)).toBe(false);
    for (const mod of ['mod', 'shift', 'alt', 'ctrl'] as const) {
      expect(keymap.isTapHoldKey('KeyB', modelChain('viewport', 'edge'), { ...noMods, [mod]: true })).toBe(false);
    }
  });

  it('never defers the tool hold keys or any other key', () => {
    for (const code of ['KeyX', 'KeyV', 'KeyJ', 'KeyD', 'KeyI', 'KeyS', 'KeyM', 'Digit1', 'Enter']) {
      expect(keymap.isTapHoldKey(code, modelChain('viewport', 'face'), noMods)).toBe(false);
      expect(keymap.isTapHoldKey(code, animateChain('viewport'), noMods)).toBe(false);
    }
  });
});

describe('auto-repeat', () => {
  it('keeps growing and shrinking while the key is held; other new rows fire once', () => {
    const keymap = mayaKeymap();
    const face = modelChain('viewport', 'face');
    const repeat = (chord: string) =>
      keymap.resolve({ ...chordInput(ch(chord), 'other'), repeat: true }, face, 'press');
    expect(repeat('Shift+Period')?.op).toBe('select.mesh.grow');
    expect(repeat('Shift+Comma')?.op).toBe('select.mesh.shrink');
    expect(repeat('Mod+KeyE')).toBeNull();
    expect(repeat('Delete')).toBeNull();
    expect(repeat('Digit3')).toBeNull();
  });

  it('answers resolveChord like resolve on the platform input', () => {
    const keymap = mayaKeymap('mac');
    const face = modelChain('viewport', 'face');
    expect(resolveChord(keymap, ch('Mod+KeyD'), face)).toBe(
      keymap.resolve(chordInput(ch('Mod+KeyD'), 'mac'), face, 'press'),
    );
  });
});
