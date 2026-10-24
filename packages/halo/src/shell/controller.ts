// The Halo shell's controller (STUDIO-TOUCH-SPEC §16.1, §20.2; ADR 0023): one per mounted shell, over the page's host.
// It owns the arrival (a `?stage=`, Pro's workspace and its finer stage, the session mirror of a reload), the
// mounted-shell slot (`leave` commits the open tool session, `haloState` for a switch), the shell-wide touch policy
// (§4.1, with its disposer, so Pro on the same page zooms and scrolls as before), the stage switch (commit, escape,
// workspace, display overlay, default tool), the `halo` key scope, the dialog watcher, the idle prefetch of the lazy
// chunks (S23, and Halo's UI wrappers, P-T3-4), the input stage (a lazy chunk) and the test API's `halo()` provider.
// It never writes the document: every change is an operator run.
import type { HaloHandoffState, HaloStage, UiDialog } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import { type HostShell, provideHaloTestState } from '@ekza-studio/editor/host';
import { createToastStore, installTouchPolicy, type ToastStore } from '@ekza-studio/ui/touch';
import type { ViewportManager } from '@ekza-studio/viewport';
import { stageOverlay } from '../canvas/overlay';
import { createGrammar, type Grammar } from '../halo/grammar';
import { createVerbRunner } from '../halo/run';
import { createManipScale } from '../input/manipScale';
import { standInVerbs, type Verb, type VerbSource } from '../halo/verbSource';
import { en } from '../i18n/en';
import type { InputHandle } from '../input/install';
import { currentRow } from '../input/situation';
import { activeSession, commitSession } from '../session/sessions';
import { watchDialogs } from '../dialogs/watcher';
import type { ShellContext } from './context';
import { rememberProLayout } from './entry';
import { installHaloKeys, PRO_ONLY_KEY, proOnlyKeyDef } from './keys';
import { mirrorOf, readInput, readMirror, storageOf, writeMirror } from './mirror';
import { prefetchLazyChunks } from './prefetch';
import { arrivalStage, HALO_STAGES, PANE, parseStage, STAGE_BASICS, stageOfWorkspace, workspaceOfStage } from './stage';
import { createHaloStore, type HaloStore, initialUi } from './store';
import { countVisibleTargets } from './targets';
import { coachMarks } from './coach';
import { animateSlice } from '../stages/animate/slice';
import { startAnimate } from '../stages/animate/start';

export interface HaloController {
  readonly ctx: ShellContext;
  readonly grammar: Grammar;
  readonly verbs: VerbSource;
  runVerb(verb: Verb, from: 'petal' | 'ring' | 'more'): void;
  /** Taps a Path stage (§7.1): commit, escape, workspace, overlay, default tool. */
  enterStage(stage: HaloStage): Promise<void>;
  /** ▤ Pro layout (§16.1): from the tap handler; a coarse-only device first shows one line. */
  proLayout(force?: boolean, arrival?: UiDialog): void;
  /** Leaves Home for the canvas (a sample or a model is in). */
  leaveHome(): void;
  /** The shell's root element (the visible-target counter's scope). */
  setRoot(el: HTMLElement | null): void;
  /** The single pane's element (`HaloPane`): its presses, its mouse clicks on empty space, no context menu. */
  attachPane(el: HTMLElement): () => void;
  /** Starts the controller's effects; the disposer ends them (shell unmount). */
  start(): () => void;
}

/** Only a coarse pointer (a touch-only iPad or phone): Pro's layout needs a mouse and keyboard (§16.1). */
function coarseOnly(): boolean {
  if (typeof window === 'undefined' || window.matchMedia === undefined) return false;
  return window.matchMedia('(any-pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}

function readStageParam(): HaloStage | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const stage = parseStage(url.searchParams.get('stage'));
  if (url.searchParams.has('stage')) {
    url.searchParams.delete('stage');
    window.history.replaceState(window.history.state, '', url);
  }
  return stage;
}

const documentEmpty = (host: HostShell): boolean =>
  host.app.store.list('characters').length === 0 && host.app.store.list('meshes').length === 0;

export function createHaloController(host: HostShell): HaloController {
  const { app } = host;
  const sessionStorage = host.params.storageBlocked ? null : storageOf('session');
  const localStorage = host.params.storageBlocked ? null : storageOf('local');
  const store: HaloStore = createHaloStore({ ...initialUi(), input: readInput(localStorage) });
  const toasts: ToastStore = createToastStore();
  const ctx: ShellContext = {
    host,
    app,
    store,
    toasts,
    vm: () => host.ui.getState().viewport,
    // a refusal says why in Halo's own toast (the host writes it to Pro's help line, which Halo does not show)
    run: (op, args) =>
      host.runFromUi(op, args, { panel: PANEL.viewport, paneId: PANE }).then((result) => {
        if (result.status === 'cancelled' && result.reason !== '') toasts.push({ key: 'reason', text: result.reason });
        return result;
      }),
  };
  let root: HTMLElement | null = null;
  let input: InputHandle | null = null;
  let lastDown: PointerEvent | null = null;
  let arrived = false;
  const manipScale = createManipScale(
    typeof window !== 'undefined' && window.matchMedia?.('(any-pointer: coarse)').matches === true ? 'touch' : 'mouse',
  );

  const verbs = standInVerbs;
  const runVerb = createVerbRunner(ctx, {
    enterStage: (stage) => controller.enterStage(stage),
    openSheet: (sheet) => store.set({ sheet, halo: null }),
  });
  const grammar = createGrammar({
    ctx,
    verbs,
    runVerb,
    consumeThumb: () => input?.thumb.consume(),
    lastDown: () => lastDown,
  });

  /** The arrival (§16.1), once per controller: `?stage=`, Pro's workspace, the mirror, the session's workspace. */
  const arrive = (): void => {
    const s = app.session.getState();
    const mirror = readMirror(sessionStorage);
    const param = readStageParam();
    const fromPro = host.navigation.takeWorkspace();
    host.navigation.takeHalo();
    const stage =
      param ??
      (fromPro !== null ? arrivalStage(fromPro, s.tools.viewport) : null) ??
      mirror?.stage ??
      arrivalStage(s.workspace, s.tools.viewport);
    store.set({
      stage,
      sheet: mirror?.sheet ?? null,
      // P-T3-4: selected keys open the Thread at Curves
      threadLayer: fromPro !== null && s.selection.keys.size > 0 ? 2 : (mirror?.threadLayer ?? 0),
      destination: mirror?.destination ?? 'exploring',
      rec: mirror?.rec ?? true,
      home: documentEmpty(host) && param === null && fromPro === null,
      ...(mirror?.thumbLocked === true ? { thumb: { ...store.get().thumb, latch: 'locked', before: 'locked' } } : {}),
    });
    // P-T3-4: a selected joint (or any selection) arriving from Pro opens its Halo
    if (fromPro !== null && s.selection.joints.length > 0) grammar.open();
  };

  const enterStage = async (stage: HaloStage): Promise<void> => {
    if (!HALO_STAGES.includes(stage)) return;
    await commitSession(ctx);
    store.set((ui) => ({
      halo: null,
      form: null,
      confirm: null,
      loupe: null,
      reselect: null,
      home: false,
      sheet: ui.sheet === 'more' ? null : ui.sheet,
    }));
    await ctx.run('edit.escape');
    const workspace = workspaceOfStage(stage);
    if (app.session.getState().workspace !== workspace) await ctx.run('workspace.set', { workspace });
    store.set({ stage });
    const tool = STAGE_BASICS[stage].tool;
    if (app.session.getState().tools.viewport !== tool) await ctx.run('view.tool', { panel: PANEL.viewport, tool });
  };

  const toPro = (arrival?: UiDialog): void => {
    rememberProLayout();
    // leave() commits the open session and closes Halo's surfaces before the host switches
    void host.navigation.go({
      to: 'studio',
      from: 'halo',
      workspace: app.session.getState().workspace,
      ...(arrival === undefined ? {} : { arrival: { kind: 'dialog', dialog: arrival } }),
    });
  };

  const controller: HaloController = {
    ctx,
    grammar,
    verbs,
    runVerb,
    enterStage,
    proLayout(force = false, arrival) {
      const ui = store.get();
      if (!force && !ui.proLineShown && coarseOnly()) {
        store.set({ proLine: true, proLineShown: true });
        return;
      }
      store.set({ proLine: false });
      toPro(arrival ?? (ui.sheet === 'share' ? 'export' : undefined));
    },
    leaveHome() {
      store.set({ home: false });
    },
    setRoot(el) {
      root = el;
    },
    attachPane(el) {
      // the pane's last press (a long-press replays it as the tool's click) and its pointer type
      // §4.7 breathing chrome: a press that travels (a stroke, a drag, an orbit) fades the clusters until it lifts
      let press: { readonly id: number; readonly x: number; readonly y: number } | null = null;
      const onDown = (e: PointerEvent): void => {
        lastDown = e;
        grammar.notePointer(e.pointerType);
        // ST-T1-5: the manipulator grows for a finger (two presses in a row of the other kind switch it)
        ctx.vm()?.setManipulatorScale(manipScale.press(e.pointerType));
        press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      };
      const onMove = (e: PointerEvent): void => {
        if (press === null || e.pointerId !== press.id || store.get().breathing) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) store.set({ breathing: true });
      };
      const onEnd = (e: PointerEvent): void => {
        if (press === null || e.pointerId !== press.id) return;
        const dragged = store.get().breathing;
        press = null;
        if (dragged) {
          store.set({ breathing: false });
          // a drag used the Thumb key's drag meaning (a `once` latch turns off, §5.5)
          if (store.get().thumb.latch === 'once') input?.thumb.consume();
        }
      };
      // a still mouse click on empty space clears the selection (the mouse orbits on a drag there, §4.5)
      const onUp = (e: PointerEvent): void => {
        const empty = input?.mouseEmpty() ?? null;
        if (empty === null || e.pointerId !== empty.pointerId) return;
        input?.clearMouseEmpty();
        if (Math.hypot(e.clientX - empty.clientX, e.clientY - empty.clientY) <= 3) grammar.emptyClick();
      };
      const onContextMenu = (e: Event): void => e.preventDefault();
      // C15 / S21: WebKit's GestureEvents (a trackpad pinch dollies; a touchscreen pinch is the arbiter's)
      const onGesture = (e: Event): void => {
        e.preventDefault();
        input?.gesture(e);
      };
      const listeners: [string, (e: never) => void, AddEventListenerOptions?][] = [
        ['pointerdown', onDown, { capture: true }],
        ['pointermove', onMove],
        ['pointerup', onEnd],
        ['pointercancel', onEnd],
        ['pointerup', onUp],
        ['contextmenu', onContextMenu],
        ['gesturestart', onGesture],
        ['gesturechange', onGesture],
        ['gestureend', onGesture],
      ];
      for (const [type, listener, options] of listeners) el.addEventListener(type, listener as EventListener, options);
      return () => {
        for (const [type, listener, options] of listeners) {
          el.removeEventListener(type, listener as EventListener, options);
        }
        lastDown = null;
      };
    },
    start() {
      const disposers: (() => void)[] = [];
      if (!arrived) {
        arrived = true;
        arrive();
      }

      // the workspace the stage runs in (no escape at arrival: nothing is open yet)
      const wanted = workspaceOfStage(store.get().stage);
      if (app.session.getState().workspace !== wanted) void ctx.run('workspace.set', { workspace: wanted });

      // the mounted shell: leave() commits the open tool session (P15) and stops a library preview
      disposers.push(
        host.mount({
          kind: 'halo',
          leave: () => {
            void commitSession(ctx);
            store.set({ halo: null, form: null, confirm: null, palette: false, projectMenu: false, proLine: false });
            if (app.library.loaded && app.library.service.preview !== null) void ctx.run('library.stop');
          },
          haloState: (): HaloHandoffState => {
            const ui = store.get();
            return {
              stage: ui.stage,
              ...(ui.sheet === null ? {} : { sheet: ui.sheet }),
              threadLayer: ui.threadLayer,
              destination: ui.destination,
            };
          },
        }),
      );

      // §4.1: the page never pinch-zooms, scrolls or pulls to refresh while Halo is mounted
      disposers.push(installTouchPolicy());

      // the session mirror and the input settings
      disposers.push(
        store.subscribe((next, previous) => {
          if (
            next.stage !== previous.stage ||
            next.sheet !== previous.sheet ||
            next.threadLayer !== previous.threadLayer ||
            next.destination !== previous.destination ||
            next.rec !== previous.rec ||
            next.thumb.latch !== previous.thumb.latch
          ) {
            writeMirror(sessionStorage, mirrorOf(next));
          }
        }),
      );
      writeMirror(sessionStorage, mirrorOf(store.get()));

      // a workspace changed elsewhere (search, a verb in another stage, the agent): the stage follows (§8)
      disposers.push(
        app.session.subscribe((state, previous) => {
          if (state.workspace === previous.workspace) return;
          const stage = store.get().stage;
          if (workspaceOfStage(stage) === state.workspace) return;
          store.set({ stage: stageOfWorkspace(state.workspace), halo: null });
        }),
      );
      // a document arriving (an import, a sample, a project) leaves Home
      disposers.push(
        app.store.subscribe(() => {
          if (store.get().home && !documentEmpty(host)) store.set({ home: false });
        }),
      );

      // §4.7 stage lighting on the single pane, and the input stage, on the page's viewport
      let offOverlay: (() => void) | null = null;
      let installing = 0;
      const bindViewport = (vm: ViewportManager | null): void => {
        offOverlay?.();
        offOverlay = null;
        input?.dispose();
        input = null;
        if (vm === null) return;
        offOverlay = stageOverlay(vm, store.get().stage);
        vm.setManipulatorScale(manipScale.scale);
        const ticket = ++installing;
        void import('../input/install').then(
          ({ installInput }) => {
            if (ticket !== installing || host.ui.getState().viewport !== vm) return;
            input = installInput(ctx, grammar, vm);
          },
          () => toasts.push({ key: 'chunk', text: en.toast.chunkFailed, tone: 'warning' }),
        );
      };
      bindViewport(ctx.vm());
      disposers.push(
        host.ui.subscribe((state, previous) => {
          if (state.viewport !== previous.viewport) bindViewport(state.viewport);
        }),
      );
      disposers.push(
        store.subscribe((next, previous) => {
          if (next.stage === previous.stage) return;
          const vm = ctx.vm();
          offOverlay?.();
          offOverlay = vm === null ? null : stageOverlay(vm, next.stage);
        }),
      );
      disposers.push(() => {
        installing += 1;
        ctx.vm()?.setManipulatorScale(1);
        offOverlay?.();
        offOverlay = null;
        input?.dispose();
        input = null;
      });

      // the grammar's selection watcher
      disposers.push(grammar.start());

      // T7: the Animate stage (Rec as the shell override, the fitting manipulator, Reach, the Library, the band source)
      disposers.push(startAnimate(controller));

      // the Halo's own operator: Pro's window chords say why they do nothing here (§5.8)
      if (app.operators.get(PRO_ONLY_KEY) === undefined) disposers.push(app.operators.register(proOnlyKeyDef));

      // the `halo` key scope
      disposers.push(
        installHaloKeys(
          app,
          {
            play: () => void ctx.run('time.togglePlay'),
            search: () => store.set({ palette: true }),
            stage: (index) => {
              const stage = HALO_STAGES[index];
              if (stage !== undefined) void enterStage(stage);
            },
            sessionDone: () => {
              const session = activeSession(app);
              if (session === null) return false;
              void session.done(ctx);
              return true;
            },
            sessionCancel: () => {
              const session = activeSession(app);
              if (session === null) return false;
              void session.cancel(ctx);
              return true;
            },
            dismiss: () => {
              const ui = store.get();
              if (ui.palette) store.set({ palette: false });
              else if (ui.form !== null) store.set({ form: null });
              else if (ui.confirm !== null) store.set({ confirm: null });
              else if (ui.halo !== null) store.set({ halo: null });
              else if (ui.loupe !== null) store.set({ loupe: null });
              else return false;
              return true;
            },
            focusChip: () => root?.querySelector<HTMLElement>('[data-halo-echo] [role="slider"]')?.focus(),
            again: () => void ctx.run('edit.repeatLast'),
            proOnly: () =>
              void ctx.run(PRO_ONLY_KEY).then(() =>
                toasts.push({
                  key: 'pro-chord',
                  text: en.toast.proChord,
                  action: { label: en.toast.proLayoutAction, run: () => controller.proLayout(true) },
                }),
              ),
            hardwareModifier: () => {
              if (!store.get().hardwareModifier) store.set({ hardwareModifier: true });
            },
          },
          () => app.session.getState().dialog !== null || host.ui.getState().confirm !== null,
        ),
      );

      // §6.7: kernel questions become Halo surfaces
      disposers.push(
        watchDialogs(ctx, {
          openSheet: (sheet) => store.set({ sheet, halo: null }),
          openPicker: () => store.set({ projectMenu: true }),
          showHome: () => store.set({ home: true, halo: null }),
          toPro: (dialog) => toPro(dialog),
        }),
      );

      // §17 coach marks, once per surface on this device, in context: the first Halo, the first Thumb key
      if (!host.params.e2e || host.params.firstRun) disposers.push(coachMarks(ctx, localStorage));

      // S23: every small lazy chunk at idle after boot and again when the network comes back
      disposers.push(prefetchLazyChunks(app));

      // the test API's halo() (e2e builds; marker-free registration)
      disposers.push(
        provideHaloTestState(app, () => {
          const ui = store.get();
          const noun = grammar.noun();
          const row = currentRow(app, store);
          const thumbMode = row === null ? 'hidden' : ui.thumb.latch;
          return {
            stage: ui.stage,
            sheet: ui.sheet,
            noun: noun === null ? null : { kind: noun.kind, id: noun.id },
            petals: ui.halo === null ? [] : grammar.petals().map((p) => p.verb.id),
            threadLayer: ui.threadLayer,
            thumb: {
              mode: thumbMode,
              tap: row?.tap?.id ?? null,
              drag: row?.drag?.id ?? null,
            },
            visibleTargets: countVisibleTargets(root),
            touches: ui.touches,
            slices: {
              grammar: {
                halo: ui.halo === null ? null : { mode: ui.halo.mode, reduced: ui.halo.reduced === true },
                home: ui.home,
                reselect: ui.reselect?.length ?? 0,
                loupe: ui.loupe?.candidates.map((c) => c.id) ?? [],
                form: ui.form?.op ?? null,
                confirm: ui.confirm?.dialog ?? null,
                session: activeSession(app)?.id ?? null,
                palette: ui.palette,
                routing: ui.input.routing,
                reduceGestures: ui.input.reduceGestures,
                haloOpensOn: ui.input.haloOpensOn,
                hideUi: ui.hideUi,
              },
              animate: animateSlice(controller),
            },
          };
        }),
      );

      return () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      };
    },
  };
  return controller;
}

export type { HaloStore };
