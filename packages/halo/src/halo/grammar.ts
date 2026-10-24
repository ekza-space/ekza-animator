// The noun-first grammar (STUDIO-TOUCH-SPEC §5.2, §5.3, §6.1; D2): what a tap, a double-tap, a long-press, a
// two-finger tap and a quick pinch mean on the canvas. The arbiter decides the gesture (§20.4); this module decides
// what it does — the first tap on a thing selects it through the active tool (as a click) and opens its Halo; a tap on
// empty space clears the selection (an undo step where the workspace records one, a Reselect chip in Animate); a
// long-press opens the same verbs as a flick ring; a double-tap frames; two fingers undo, with a toast that names the
// step and offers Redo. It never writes the document: every change is an operator run.
import type { ControlId } from '@ekza-studio/doc';
import type { EditorApp, HaloStage } from '@ekza-studio/editor-core';
import { type CompassSlot, type Point, ringSlots, slotToward } from '@ekza-studio/ui/touch';
import type { ArbiterFollow, ArbiterTap, PickResult } from '@ekza-studio/viewport';
import { en } from '../i18n/en';
import type { ShellContext } from '../shell/context';
import { PANE } from '../shell/stage';
import { EMPTY_NOUN, type Noun as KindNoun } from '../verbs/nouns';
import { type Noun, pollVerb, spaceNoun, type Verb, type VerbSource } from './verbSource';

/** How long a tap waits for the tool's selection change before it reads the selection as it is (ms). */
const SETTLE_MS = 90;
/** §5.2: the Reselect chip stays this long after a tap cleared Animate's selection. */
const RESELECT_MS = 4000;
/** §5.4: candidates within this many px of the nearest one collide (the Loupe opens). */
const LOUPE_SPREAD_PX = 6;

export interface GrammarDeps {
  readonly ctx: ShellContext;
  readonly verbs: VerbSource;
  /** Runs a verb (petal, ring slot, More row): forms, Echo chips and stage switches live there (`./run`). */
  readonly runVerb: (verb: Verb, from: 'petal' | 'ring' | 'more') => void;
  /** The Thumb key's tap meaning was used by this tap (a `once` latch turns off). */
  readonly consumeThumb: () => void;
  /** The original pointerdown of the press now held in the pane (a long-press replays it as a click). */
  readonly lastDown: () => PointerEvent | null;
}

export interface Grammar {
  /** The arbiter's tap (finger, Pencil): 'select' replays it to the tool as a click. */
  tap(tap: ArbiterTap): 'select' | 'consumed';
  doubleTap(tap: ArbiterTap): void;
  longPress(tap: ArbiterTap): ArbiterFollow | undefined;
  twoFingerTap(): void;
  quickPinch(): void;
  /** A mouse right-click in the pane: the flick ring at the cursor (pane px); true = taken. */
  secondary(at: Point, pointerId: number): boolean;
  /** A still mouse click on empty space (the mouse orbits on a left drag there, §4.5). */
  emptyClick(): void;
  /** ⋯ Verbs, a Scene row, a search result: the Halo for the current selection (arc). */
  open(): void;
  close(): void;
  /** Frames the selection or everything (§5.2, the View puck). */
  frame(what: 'selection' | 'all'): void;
  /** One undo step with its toast (two-finger tap, ↶). */
  undo(): void;
  /** The petals of the open Halo with their poll (§6.3). */
  petals(): readonly { readonly verb: Verb; readonly reason: string | null }[];
  /** The noun the Halo shows now (null: closed or nothing). */
  noun(): Noun | null;
  /** ⋯ More for the open Halo's noun (§6.3): the More sheet, about that noun even when it is not the selection's. */
  more(): void;
  /** A flick ring's slot of each petal (⋯ More last). */
  slots(): readonly CompassSlot[];
  /** Runs the open ring's petal at a slot (a flick or a right drag released on it); false: nothing ran. */
  runSlot(slot: CompassSlot): boolean;
  /** Restores the selection a tap cleared in Animate (§5.2 Reselect). */
  reselect(): void;
  /** A Loupe chip (§5.4) or Next › on the breadcrumb (§5.2). */
  pick(id: string): void;
  next(): void;
  /** The pane reports each press's pointer type (a mouse click's selection opens the Halo only per §4.5). */
  notePointer(type: string): void;
  /** Starts the selection watcher; the disposer ends it. */
  start(): () => void;
}

/** The selection as one comparable list of ids (any kind). */
function selectionKey(app: EditorApp): string {
  const s = app.session.getState();
  const c = s.model.components;
  return [
    s.selection.controls.join(','),
    s.selection.objects.join(','),
    s.selection.joints.join(','),
    `${s.model.componentMode}:${c.version}:${c.selected.vertex}/${c.selected.edge}/${c.selected.face}`,
  ].join('|');
}

/** The control a pick result stands for (a control, or the mesh part a control drives). */
export function controlOf(hit: PickResult | null): ControlId | null {
  if (hit === null) return null;
  if (hit.kind === 'control') return hit.control;
  if (hit.kind === 'mesh') return hit.control;
  return null;
}

export function createGrammar(deps: GrammarDeps): Grammar {
  const { ctx, verbs } = deps;
  const { app, store } = ctx;
  let pending: { readonly at: Point; readonly before: string; readonly controls: readonly ControlId[] } | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let reselectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTap: { readonly at: Point; readonly candidates: readonly string[]; index: number } | null = null;
  /** The open ring is empty space's (a long-press or right-click on nothing). */
  let spaceRing = false;
  let lastPointer = 'touch';

  const stage = (): HaloStage => store.get().stage;
  const currentNoun = (): Noun | null => verbs.noun(app, stage(), store.get().focus);
  /** The noun More is about when it is not the live selection's (empty space's ring, a focused character). */
  const sheetNounOf = (noun: Noun | null): KindNoun | null =>
    noun === null || noun.kind === 'empty' ? EMPTY_NOUN : store.get().focus !== null ? noun.source : null;

  const showReselect = (controls: readonly ControlId[]): void => {
    if (reselectTimer !== null) clearTimeout(reselectTimer);
    store.set({ reselect: controls });
    reselectTimer = setTimeout(() => {
      reselectTimer = null;
      store.set({ reselect: null });
    }, RESELECT_MS);
  };

  const openArc = (at: Point | null): void => {
    const noun = currentNoun();
    if (noun === null) {
      store.set({ halo: null });
      return;
    }
    store.set({ halo: { mode: 'arc', at }, ...(at === null ? {} : { anchor: at }) });
  };

  /** A tap has settled: open (or update) the Halo for what is selected now, or close it (§6.1, C8, C9). */
  const resolveTap = (): void => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
    const tap = pending;
    pending = null;
    if (tap === null) return;
    // §6.4 verb → target: the tapped object is the target; the subject gets its selection back
    const target = store.get().target;
    if (target !== null) {
      store.set({ target: null });
      const lead = app.session.getState().selection.objects.at(-1);
      if (lead === undefined || target.subject.includes(lead)) return;
      void ctx
        .run(target.op, { ids: target.subject, parent: lead })
        .then(() => ctx.run('select.objects', { ids: target.subject, mode: 'replace' }))
        .then(() => openArc(tap.at));
      return;
    }
    const noun = currentNoun();
    if (noun === null) {
      store.set({ halo: null });
      // §5.2 / C9: Animate records no selection step, so a cleared selection can come back for 4 s.
      if (stage() === 'animate' && tap.controls.length > 0) showReselect(tap.controls);
      return;
    }
    const thumb = store.get().thumb.latch;
    // C8: while a selection meaning of the Thumb key is on, taps update the Halo in place.
    if (store.get().halo !== null && thumb !== 'off') {
      store.set({ anchor: tap.at });
      return;
    }
    if (store.get().input.haloOpensOn === 'secondary') {
      store.set({ halo: null, anchor: tap.at });
      return;
    }
    openArc(tap.at);
  };

  const candidatesAt = (x: number, y: number): readonly PickResult[] => {
    const vm = ctx.vm();
    return vm === null ? [] : vm.pickCandidates(PANE, x, y);
  };

  /** §5.4: named candidates that collide under the finger (controls and joints within a few px of each other). */
  const loupeCandidates = (x: number, y: number): readonly { id: string; label: string }[] => {
    const list = candidatesAt(x, y).filter((c): c is Extract<PickResult, { kind: 'control' }> => c.kind === 'control');
    if (list.length < 2) return [];
    const nearest = Math.min(...list.map((c) => c.distancePx));
    const close = list.filter((c) => c.distancePx - nearest <= LOUPE_SPREAD_PX);
    if (close.length < 2) return [];
    return close.map((c) => ({ id: c.control, label: app.store.get('controls', c.control)?.name ?? c.control }));
  };

  const selectControl = (id: string, add = false): void => {
    void ctx.run('select.controls', { ids: [id], mode: add ? 'add' : 'replace' });
  };

  /** Replays the press as a click to the tool (a long-press on an unselected thing selects it first, §6.1). */
  const replayClick = (): boolean => {
    const vm = ctx.vm();
    const down = deps.lastDown();
    if (vm === null || down === null) return false;
    vm.pipe(PANE, down, 'down');
    vm.pipe(PANE, down, 'up');
    return true;
  };

  const ringFollow = (center: Point): ArbiterFollow => {
    const hotAt = (x: number, y: number): CompassSlot | null => {
      const slots = grammar.slots();
      return slotToward(x - center.x, y - center.y, slots);
    };
    return {
      move(x, y) {
        const halo = store.get().halo;
        if (halo === null || halo.mode !== 'ring') return;
        const hot = hotAt(x, y);
        if (hot !== (halo.hot ?? null)) store.set({ halo: { ...halo, hot } });
      },
      up(x, y) {
        const halo = store.get().halo;
        if (halo === null || halo.mode !== 'ring') return;
        const hot = hotAt(x, y);
        // §5.2 flick: release on a slot runs it; *Reduce gestures* keeps the ring open for a tap instead (AS-ST-9).
        if (hot === null || store.get().input.reduceGestures) {
          store.set({ halo: { ...halo, hot: null } });
          return;
        }
        if (!grammar.runSlot(hot)) store.set({ halo: { ...halo, hot: null } });
      },
      cancel() {
        const halo = store.get().halo;
        if (halo?.mode === 'ring') store.set({ halo: null });
      },
    };
  };

  const openRing = (at: Point): void => {
    store.set({ halo: { mode: 'ring', at, hot: null }, anchor: at, loupe: null });
  };

  const grammar: Grammar = {
    tap(tap) {
      store.set((s) => ({ touches: s.touches + 1, loupe: null, form: null }));
      if (store.get().confirm !== null) store.set({ confirm: null });
      const at = { x: tap.x, y: tap.y };
      // §5.4 Loupe: colliding candidates open named chips above the finger; the tap selects nothing yet.
      const collide = loupeCandidates(tap.x, tap.y);
      lastTap = { at, candidates: collide.map((c) => c.id), index: 0 };
      if (collide.length > 1) {
        store.set({ loupe: { at, candidates: collide }, halo: null, candidates: collide.map((c) => c.id) });
        return 'consumed';
      }
      store.set({ candidates: [] });
      const s = app.session.getState();
      pending = { at, before: selectionKey(app), controls: s.selection.controls };
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(resolveTap, SETTLE_MS);
      // after the replayed click (the tool read the meaning's modifiers): a `once` latch is used up
      if (store.get().thumb.latch !== 'off') void Promise.resolve().then(deps.consumeThumb);
      return 'select';
    },
    doubleTap(tap) {
      store.set((s) => ({ touches: s.touches + 1 }));
      grammar.frame(tap.hit === null && !(ctx.vm()?.isOverMesh(PANE, tap.x, tap.y) ?? false) ? 'all' : 'selection');
    },
    longPress(tap) {
      store.set((s) => ({ touches: s.touches + 1, loupe: null }));
      const at = { x: tap.x, y: tap.y };
      const control = controlOf(tap.hit);
      const selected = app.session.getState().selection;
      const onThing = tap.hit !== null || (ctx.vm()?.isOverMesh(PANE, tap.x, tap.y) ?? false);
      if (!onThing) {
        // empty space: its verbs as a ring (§6.2 first row)
        spaceRing = true;
        openRing(at);
        return ringFollow(at);
      }
      spaceRing = false;
      if (tap.hit?.kind === 'manipulator') {
        // §6.2: the manipulator is a noun of its own (Space, Size, Pivot), reached by a long-press on it
        store.set({ focus: { kind: 'manipulator', id: null } });
      } else if (control !== null && !selected.controls.includes(control)) selectControl(control);
      else if (control === null) replayClick();
      openRing(at);
      return ringFollow(at);
    },
    twoFingerTap() {
      if (store.get().input.reduceGestures) return;
      store.set((s) => ({ touches: s.touches + 1 }));
      grammar.undo();
    },
    quickPinch() {
      if (store.get().input.reduceGestures) return;
      grammar.frame('all');
    },
    secondary(at) {
      spaceRing = currentNoun() === null;
      openRing(at);
      return true;
    },
    notePointer(type) {
      lastPointer = type;
    },
    emptyClick() {
      const s = app.session.getState();
      const controls = s.selection.controls;
      if (currentNoun() === null) {
        store.set({ halo: null });
        return;
      }
      store.set({ halo: null });
      void clearSelection(ctx, stage()).then(() => {
        if (stage() === 'animate' && controls.length > 0 && app.session.getState().selection.controls.length === 0) {
          showReselect(controls);
        }
      });
    },
    open() {
      spaceRing = false;
      openArc(store.get().anchor);
    },
    close() {
      store.set({ halo: null, focus: null });
    },
    frame(what) {
      void ctx.run('view.frame', { what, paneId: PANE });
    },
    undo() {
      const label = app.history.peekUndo()?.label ?? null;
      if (label === null) {
        ctx.toasts.push({ text: en.toast.nothingToUndo, key: 'undo' });
        return;
      }
      void ctx.run('edit.undo').then((result) => {
        if (result.status !== 'finished') return;
        ctx.toasts.push({
          key: 'undo',
          text: en.toast.undid(label),
          action: {
            label: en.toast.redo,
            run: () => {
              void ctx.run('edit.redo').then((redone) => {
                if (redone.status === 'finished') ctx.toasts.push({ key: 'undo', text: en.toast.redid(label) });
              });
            },
          },
        });
      });
    },
    petals() {
      const noun = grammar.noun();
      if (noun === null) return [];
      return verbs.petals(app, noun, stage()).map((verb) => {
        const poll = pollVerb(app, verb);
        return { verb, reason: poll === true ? null : poll.reason };
      });
    },
    noun() {
      const halo = store.get().halo;
      if (halo === null) return null;
      if (halo.mode === 'ring' && spaceRing) return spaceNoun();
      return currentNoun();
    },
    more() {
      const noun = grammar.noun();
      store.set({ halo: null, focus: null, sheet: 'more', sheetArgs: null, sheetNoun: sheetNounOf(noun) });
    },
    slots() {
      const petals = grammar.petals().map((p) => p.verb);
      return ringSlots([...petals, {}]);
    },
    runSlot(slot) {
      const index = grammar.slots().indexOf(slot);
      const petals = grammar.petals();
      if (index === petals.length) {
        grammar.more();
        return true;
      }
      const petal = petals[index];
      if (petal === undefined || petal.reason !== null) return false;
      deps.runVerb(petal.verb, 'ring');
      return true;
    },
    reselect() {
      const controls = store.get().reselect;
      if (controls === null) return;
      if (reselectTimer !== null) clearTimeout(reselectTimer);
      reselectTimer = null;
      store.set({ reselect: null });
      void ctx.run('select.controls', { ids: controls, mode: 'replace' }).then(() => openArc(store.get().anchor));
    },
    pick(id) {
      store.set({ loupe: null });
      if (lastTap !== null) lastTap.index = Math.max(0, lastTap.candidates.indexOf(id));
      void ctx.run('select.controls', { ids: [id], mode: 'replace' }).then(() => openArc(store.get().anchor));
    },
    next() {
      if (lastTap === null || lastTap.candidates.length < 2) return;
      lastTap.index = (lastTap.index + 1) % lastTap.candidates.length;
      const id = lastTap.candidates[lastTap.index];
      if (id !== undefined) grammar.pick(id);
    },
    start() {
      let key = selectionKey(app);
      const off = app.session.subscribe(() => {
        const next = selectionKey(app);
        if (next === key) return;
        key = next;
        // a focused noun (the character, the manipulator) and a sheet's own noun give way to the new selection
        if (store.get().focus !== null || store.get().sheetNoun !== null) store.set({ focus: null, sheetNoun: null });
        if (pending !== null) {
          // the tool's click changed the selection: settle on the next task (several runs may follow)
          if (settle !== null) clearTimeout(settle);
          settle = setTimeout(resolveTap, 0);
          return;
        }
        const halo = store.get().halo;
        const noun = currentNoun();
        if (noun === null) {
          if (halo !== null && !(halo.mode === 'ring' && spaceRing)) store.set({ halo: null });
          return;
        }
        // a selection made elsewhere (a mouse click, Scene, search, the breadcrumb): update an open Halo in place;
        // a mouse click opens one only when the Halo opens on every click (§4.5)
        if (halo !== null && halo.mode === 'arc') return;
        if (store.get().input.haloOpensOn === 'tap' && lastPointer === 'mouse') openArc(store.get().anchor);
      });
      return () => {
        off();
        if (settle !== null) clearTimeout(settle);
        if (reselectTimer !== null) clearTimeout(reselectTimer);
        settle = null;
        reselectTimer = null;
        pending = null;
      };
    },
  };
  return grammar;
}

/** Clears the selection of a stage with the operator Pro's Esc / click on empty space runs (§5.2). */
export async function clearSelection(ctx: Pick<ShellContext, 'app' | 'run'>, stage: HaloStage): Promise<void> {
  const s = ctx.app.session.getState();
  if ((stage === 'make' || stage === 'paint') && s.model.componentMode !== 'object') {
    await ctx.run('select.mesh.none');
    return;
  }
  if (s.selection.objects.length > 0) await ctx.run('select.objects', { ids: [], mode: 'replace' });
  if (s.selection.joints.length > 0) await ctx.run('select.joints', { ids: [], mode: 'replace' });
  if (s.selection.controls.length > 0) await ctx.run('select.none');
}
