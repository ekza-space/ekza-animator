// STUDIO-TOUCH-SPEC §5.2, §5.3, §6.1, §20.4 (T6a): the grammar over T1's real arbiter state machine (recorded pointer
// streams through a fake port) and a kernel app — a tap selects through the tool and opens the Halo; a tap on empty
// space in Animate clears with a Reselect chip; the Thumb key's Select more updates the Halo in place (C8); a
// long-press opens the ring and a flick runs a slot (not with Reduce gestures); double-tap frames; two fingers undo
// with a named toast (not with Reduce gestures); a quick pinch frames all; drags on what is selected are the tool's.
import type { ControlId } from '@ekza-studio/doc';
import type { OperatorResult } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { createToastStore, type ToastStore } from '@ekza-studio/ui/touch';
import {
  type ArbiterPointer,
  type ArbiterPort,
  type PickResult,
  pointerArbiter,
  type PointerArbiter,
} from '@ekza-studio/viewport';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrammar, type Grammar } from '../src/halo/grammar';
import { haloVerbs, type Verb } from '../src/halo/verbSource';
import { haloArbiterConfig } from '../src/input/arbiter';
import { claimOf } from '../src/input/claims';
import type { ThumbController } from '../src/input/thumb';
import type { ShellContext } from '../src/shell/context';
import { createHaloStore, DEFAULT_INPUT, type HaloStore, initialUi } from '../src/shell/store';

const A = 'rig_1:fk.upperArm.L' as ControlId;
const B = 'rig_1:fk.lowerArm.L' as ControlId;

interface World {
  readonly app: FakeEditorApp;
  readonly store: HaloStore;
  readonly toasts: ToastStore;
  readonly runs: { op: string; args: unknown }[];
  readonly ran: Verb[];
  readonly grammar: Grammar;
  readonly arbiter: PointerArbiter<ArbiterPointer>;
  readonly port: { calls: string[]; hit: PickResult | null };
  readonly dispose: () => void;
}

/** The operators the petals name (T6b's verb table; registered so their polls pass; the context's `run` records runs). */
const PETAL_OPS = [
  'clip.new',
  'library.open',
  'rig.ikFk.switch',
  'key.set',
  'select.all',
  'pose.resetToRest',
  'pose.mirror',
  'pose.copy',
  'pose.paste',
  'select.controls',
  'select.none',
];

function world(input: Partial<typeof DEFAULT_INPUT> = {}): World {
  const app = createFakeEditorApp();
  for (const id of PETAL_OPS) {
    app.operators.register({ id: id as never, label: id, category: 'edit', scope: 'global', apply() {} });
  }
  const store = createHaloStore({ ...initialUi('animate'), input: { ...DEFAULT_INPUT, ...input } });
  const toasts = createToastStore();
  const runs: { op: string; args: unknown }[] = [];
  const finished = (): Promise<OperatorResult<unknown>> => Promise.resolve({ status: 'finished', value: undefined });
  const ctx: ShellContext = {
    host: {} as never,
    app,
    store,
    toasts,
    vm: () => null,
    run(op, args) {
      runs.push({ op, args });
      const s = app.session.getState();
      if (op === 'select.controls') {
        const ids = (args as { ids: ControlId[] }).ids;
        app.session.setState({ selection: { ...s.selection, controls: ids } });
      }
      if (op === 'select.none') app.session.setState({ selection: { ...s.selection, controls: [] } });
      return finished();
    },
  };
  const ran: Verb[] = [];
  let consumed = 0;
  const grammar = createGrammar({
    ctx,
    verbs: haloVerbs,
    runVerb: (verb) => ran.push(verb),
    consumeThumb: () => {
      consumed += 1;
      store.set({ thumb: { ...store.get().thumb, latch: 'off' } });
    },
    lastDown: () => null,
  });
  const thumb: ThumbController = {
    source: {} as never,
    forTap: () => {},
    forDrag: () => {},
    consume: () => void consumed++,
    dispose: () => {},
  };
  const port = { calls: [] as string[], hit: null as PickResult | null };
  const recorded: ArbiterPort<ArbiterPointer> = {
    local: (_pane, e) => ({ x: e.clientX, y: e.clientY }),
    pick: () => port.hit,
    ortho: () => false,
    capture: () => {},
    pointer: () => {},
    down: () => port.calls.push('down'),
    move: () => port.calls.push('move'),
    up: (_p, _e, cancelled) => port.calls.push(cancelled ? 'cancel' : 'up'),
    startNav: (_p, _e, gesture) => {
      port.calls.push(`nav ${gesture}`);
      return true;
    },
    navigate: (_p, gesture) => port.calls.push(`navigate ${gesture}`),
    endNavigate: () => port.calls.push('endNavigate'),
  };
  const config = haloArbiterConfig({ app, store, grammar, thumb, overMesh: () => false, penFound: () => {} });
  const arbiter = pointerArbiter(config, recorded);
  const off = grammar.start();
  return { app, store, toasts, runs, ran, grammar, arbiter, port, dispose: off };
}

let t = 1000;
const ev = (id: number, x: number, y: number, type = 'touch'): ArbiterPointer => ({
  pointerId: id,
  pointerType: type,
  clientX: x,
  clientY: y,
  button: 0,
  timeStamp: t,
  pressure: 0.5,
});

function tap(w: World, x: number, y: number, id = 1): void {
  w.arbiter.down('pane-single', ev(id, x, y));
  t += 40;
  w.arbiter.up('pane-single', ev(id, x, y), false);
}

/** What the select tool does with the replayed click: the selection the test says. */
function toolSelects(w: World, controls: readonly ControlId[]): void {
  w.app.session.setState({ selection: { ...w.app.session.getState().selection, controls } });
}

beforeEach(() => {
  vi.useFakeTimers();
  t += 5000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a tap (§5.2, §6.1)', () => {
  it('selects through the tool (the click is replayed) and opens the Halo beside it', () => {
    const w = world();
    w.port.hit = { kind: 'control', control: A, distancePx: 2, depth: 1 };
    tap(w, 300, 200);
    expect(w.port.calls).toEqual(['down', 'up']);
    toolSelects(w, [A]);
    vi.advanceTimersByTime(20);
    expect(w.store.get().halo).toEqual({ mode: 'arc', at: { x: 300, y: 200 } });
    expect(w.grammar.noun()).toMatchObject({ kind: 'control', id: A });
    expect(w.grammar.petals().map((p) => p.verb.id)).toEqual([
      'key.set',
      'pose.mirror:{"mode":"flip"}',
      'pose.resetToRest',
      'pose.copy',
      'rig.ikFk.switch',
    ]);
    expect(w.store.get().touches).toBe(1);
    w.dispose();
  });

  it('a tap on a selected thing reopens its Halo', () => {
    const w = world();
    toolSelects(w, [A]);
    tap(w, 300, 200);
    vi.advanceTimersByTime(200); // the tool kept the selection: the tap settles on its own
    expect(w.store.get().halo?.mode).toBe('arc');
    w.dispose();
  });

  it('a tap on empty space in Animate clears the Halo and offers Reselect for 4 s (C9)', () => {
    const w = world();
    toolSelects(w, [A, B]);
    w.grammar.open();
    tap(w, 600, 600);
    toolSelects(w, []);
    vi.advanceTimersByTime(20);
    expect(w.store.get().halo).toBeNull();
    expect(w.store.get().reselect).toEqual([A, B]);
    w.grammar.reselect();
    expect(w.runs.at(-1)).toEqual({ op: 'select.controls', args: { ids: [A, B], mode: 'replace' } });
    expect(w.store.get().reselect).toBeNull();
    toolSelects(w, []);
    tap(w, 600, 600);
    vi.advanceTimersByTime(4100);
    expect(w.store.get().reselect).toBeNull();
    w.dispose();
  });

  it('with the Thumb key’s Select more on, a tap updates the open Halo in place and uses a `once` latch (C8)', async () => {
    const w = world();
    toolSelects(w, [A]);
    w.grammar.open();
    w.store.set({ thumb: { ...w.store.get().thumb, latch: 'once' } });
    tap(w, 340, 260);
    await Promise.resolve(); // used up after the replayed click
    toolSelects(w, [A, B]);
    vi.advanceTimersByTime(20);
    expect(w.store.get().halo?.mode).toBe('arc');
    expect(w.grammar.noun()).toMatchObject({ kind: 'control', count: 2, label: '2 parts' });
    expect(w.store.get().thumb.latch).toBe('off');
    w.dispose();
  });

  it('opens nothing when the Halo opens on right-click or hold only (§4.5)', () => {
    const w = world({ haloOpensOn: 'secondary' });
    tap(w, 300, 200);
    toolSelects(w, [A]);
    vi.advanceTimersByTime(20);
    expect(w.store.get().halo).toBeNull();
    w.dispose();
  });
});

describe('the verb source (P-T6A-1)', () => {
  it('More beyond the petals comes from the manifest, loaded on demand', async () => {
    const w = world();
    toolSelects(w, [A]);
    const noun = haloVerbs.noun(w.app, 'animate');
    expect(noun?.kind).toBe('control');
    const more = noun === null ? [] : await haloVerbs.more(w.app, noun, 'animate');
    expect(more.length).toBeGreaterThan(0);
    const petals = new Set(noun === null ? [] : haloVerbs.petals(w.app, noun, 'animate').map((v) => v.id));
    expect(more.filter((verb) => petals.has(verb.id))).toEqual([]);
    w.dispose();
  });
});

describe('long-press and flicks (§5.2)', () => {
  it('a long-press on empty space opens the ring of empty space’s verbs; a flick runs the slot', () => {
    const w = world();
    w.arbiter.down('pane-single', ev(1, 400, 300));
    vi.advanceTimersByTime(460);
    expect(w.store.get().halo).toMatchObject({ mode: 'ring', at: { x: 400, y: 300 } });
    expect(w.grammar.noun()?.kind).toBe('empty');
    const slots = w.grammar.slots();
    expect(slots[0]).toBe('N'); // New animation keeps its slot
    w.arbiter.move('pane-single', ev(1, 400, 240));
    expect(w.store.get().halo?.hot).toBe('N');
    w.arbiter.up('pane-single', ev(1, 400, 240), false);
    expect(w.ran.map((v) => v.id)).toEqual(['clip.new']);
    expect(w.port.calls).toEqual([]); // the tool never saw the press
    w.dispose();
  });

  it('a long-press on the manipulator opens its own noun (§6.2: Space, Size, Pivot); closing ends the focus', () => {
    const w = world();
    toolSelects(w, [A]);
    w.port.hit = { kind: 'manipulator', handle: 'rx' };
    w.arbiter.down('pane-single', ev(1, 400, 300));
    vi.advanceTimersByTime(460);
    expect(w.store.get().halo).toMatchObject({ mode: 'ring' });
    expect(w.store.get().focus).toEqual({ kind: 'manipulator', id: null });
    expect(w.grammar.noun()?.kind).toBe('manipulator');
    expect(w.port.calls).toEqual([]); // the tool never saw the press
    w.arbiter.up('pane-single', ev(1, 400, 300), false);
    w.grammar.close();
    expect(w.store.get().focus).toBeNull();
    expect(w.grammar.noun()).toBeNull();
    w.dispose();
  });

  it('with Reduce gestures the ring stays open for a tap instead of running the flick (AS-ST-9)', () => {
    const w = world({ reduceGestures: true });
    w.arbiter.down('pane-single', ev(1, 400, 300));
    vi.advanceTimersByTime(460);
    w.arbiter.move('pane-single', ev(1, 400, 240));
    w.arbiter.up('pane-single', ev(1, 400, 240), false);
    expect(w.ran).toEqual([]);
    expect(w.store.get().halo?.mode).toBe('ring');
    w.dispose();
  });

  it('a long-press on an unselected control selects it first', () => {
    const w = world();
    w.port.hit = { kind: 'control', control: B, distancePx: 1, depth: 1 };
    w.arbiter.down('pane-single', ev(1, 400, 300));
    vi.advanceTimersByTime(460);
    expect(w.runs[0]).toEqual({ op: 'select.controls', args: { ids: [B], mode: 'replace' } });
    expect(w.grammar.noun()).toMatchObject({ kind: 'control', id: B });
    w.dispose();
  });
});

describe('double-tap, two fingers, quick pinch (§5.2, §5.3)', () => {
  it('a double-tap frames (all on empty space); the tool never sees the second tap', () => {
    const w = world();
    tap(w, 500, 500);
    t += 120;
    tap(w, 505, 503);
    expect(w.runs.filter((r) => r.op === 'view.frame')).toEqual([
      { op: 'view.frame', args: { what: 'all', paneId: 'pane-single' } },
    ]);
    expect(w.port.calls).toEqual(['down', 'up']);
    w.dispose();
  });

  it('a two-finger tap undoes one step with a toast that names it and offers Redo', async () => {
    const w = world();
    vi.spyOn(w.app.history, 'peekUndo').mockReturnValue({
      id: 1,
      label: 'Set Key',
      docTxId: null,
      overrides: null,
      at: 0,
    });
    w.arbiter.down('pane-single', ev(1, 400, 400));
    w.arbiter.down('pane-single', ev(2, 480, 400));
    t += 60;
    w.arbiter.up('pane-single', ev(1, 400, 400), false);
    w.arbiter.up('pane-single', ev(2, 480, 400), false);
    expect(w.runs.map((r) => r.op)).toEqual(['edit.undo']);
    await vi.waitFor(() => expect(w.toasts.getSnapshot()[0]?.text).toBe('Undid: Set Key'));
    expect(w.toasts.getSnapshot()[0]?.action?.label).toBe('Redo');
    w.toasts.getSnapshot()[0]?.action?.run();
    expect(w.runs.at(-1)?.op).toBe('edit.redo');
    w.dispose();
  });

  it('with Reduce gestures two fingers never undo and a quick pinch is a dolly', () => {
    const w = world({ reduceGestures: true });
    vi.spyOn(w.app.history, 'peekUndo').mockReturnValue({
      id: 1,
      label: 'Set Key',
      docTxId: null,
      overrides: null,
      at: 0,
    });
    w.arbiter.down('pane-single', ev(1, 400, 400));
    w.arbiter.down('pane-single', ev(2, 480, 400));
    t += 60;
    w.arbiter.up('pane-single', ev(1, 400, 400), false);
    w.arbiter.up('pane-single', ev(2, 480, 400), false);
    expect(w.runs).toEqual([]);
    w.dispose();
  });

  it('a quick pinch frames everything (C5)', () => {
    const w = world();
    w.arbiter.down('pane-single', ev(1, 300, 400));
    w.arbiter.down('pane-single', ev(2, 600, 400));
    t += 40;
    w.arbiter.move('pane-single', ev(1, 400, 400));
    w.arbiter.move('pane-single', ev(2, 500, 400));
    t += 60;
    w.arbiter.up('pane-single', ev(1, 400, 400), false);
    w.arbiter.up('pane-single', ev(2, 500, 400), false);
    expect(w.runs).toEqual([{ op: 'view.frame', args: { what: 'all', paneId: 'pane-single' } }]);
    w.dispose();
  });
});

describe('whose a drag is (§5.1, ST-5)', () => {
  const app = createFakeEditorApp();
  const base = {
    paneId: 'pane-single',
    x: 0,
    y: 0,
    tool: 'select',
    selectedControls: [A],
    jointsSelected: false,
    overMesh: () => false,
    marquee: false,
  };
  it('a selected control, a handle or a stage claim is the tool’s; anything else orbits', () => {
    expect(claimOf(app, { ...base, hit: { kind: 'control', control: A, distancePx: 1, depth: 1 } })).toBe('tool');
    expect(claimOf(app, { ...base, hit: { kind: 'control', control: B, distancePx: 1, depth: 1 } })).toBe('navigate');
    expect(claimOf(app, { ...base, hit: { kind: 'manipulator', handle: 'rx' } })).toBe('tool');
    expect(claimOf(app, { ...base, hit: null })).toBe('navigate');
    expect(claimOf(app, { ...base, hit: null, marquee: true })).toBe('tool');
  });

  it('a brush tool claims the mesh as a stroke; the Quick Rig markers as the tool', () => {
    expect(claimOf(app, { ...base, hit: null, tool: 'paintSkinWeights', overMesh: () => true })).toBe('brush');
    expect(claimOf(app, { ...base, hit: null, tool: 'paint', overMesh: () => true })).toBe('brush');
    expect(claimOf(app, { ...base, hit: null, tool: 'quickRigMarker', overMesh: () => true })).toBe('tool');
  });

  it('a drag on a selected control replays to the tool after the slop; an unselected one orbits', () => {
    const w = world();
    toolSelects(w, [A]);
    w.port.hit = { kind: 'control', control: A, distancePx: 1, depth: 1 };
    w.arbiter.down('pane-single', ev(1, 300, 300));
    w.arbiter.move('pane-single', ev(1, 330, 300));
    expect(w.port.calls.slice(0, 2)).toEqual(['down', 'move']);
    w.arbiter.up('pane-single', ev(1, 330, 300), false);
    w.port.calls.length = 0;
    w.port.hit = { kind: 'control', control: B, distancePx: 1, depth: 1 };
    w.arbiter.down('pane-single', ev(2, 300, 300));
    w.arbiter.move('pane-single', ev(2, 330, 300));
    expect(w.port.calls[0]).toBe('nav tumble');
    w.dispose();
  });
});
