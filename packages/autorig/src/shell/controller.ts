// The wizard controller (AUTORIG-SPEC §4.1–§4.4, §8.1; D3): one per mounted Auto-Rig shell, over the page's host. It
// owns the session store (mirrored to sessionStorage), the derived progress, step navigation and the §4.2 entry
// order, the arrival (a handoff record's step and start pose, a Studio hand-over, `?step=`, `?sample=`, the session
// mirror of a reload), the mounted-shell slot (`leave`, `handoffState`), the test API's `autorig()` provider, the
// `autorig` key scope, file drops and the Simple navigation override. It never writes the document: every change is
// an operator run.
import type { Disposer } from '@ekza-studio/anim-core';
import type { AutoRigSampleId, AutoRigSubject, EditorApp } from '@ekza-studio/editor-core';
import { type HostShell, provideAutoRigTestState } from '@ekza-studio/editor/host';
import { installSimpleNavigation } from '../nav';
import { autoRigProgress, checklistLoaded, landingStep, loadChecklist } from '../progress';
import {
  type AutoRigSessionStore,
  createAutoRigSessionStore,
  defaultAutoRigSession,
  readSessionMirror,
  type SessionMirror,
  sessionStorageOf,
} from '../session';
import { messages } from '../i18n';
import { withFlow } from '../steps/model/ui';
import { AUTORIG_STEPS, type AutoRigProgress, type AutoRigSession, type AutoRigStep } from '../types';
import type { FooterState, ShellUi, WizardContext } from './context';
import { endSessions, enterStep, entryQueue, quiet } from './entry';
import { bindingFor } from './keys';
import { type SmallStore, smallStore } from './store';

export interface Wizard extends WizardContext {
  readonly footer: SmallStore<FooterState>;
  /** Starts the controller's effects; the disposer ends them (shell unmount). */
  start(): Disposer;
}

const SAMPLES: readonly AutoRigSampleId[] = ['cube-lad', 'polybot-tpose', 'polybot-apose', 'polybot', 'seed-san'];

const isStep = (value: unknown): value is AutoRigStep => (AUTORIG_STEPS as readonly unknown[]).includes(value);

/** The subject a Studio switch implies when it handed none (§3.4): the active or only character, else the scene meshes. */
export function subjectFromDocument(app: EditorApp): AutoRigSubject | null {
  const state = app.session.getState();
  const characters = app.store.list('characters');
  const active = state.rig.character ?? state.activeCharacter;
  const character =
    (active === null ? undefined : app.store.get('characters', active)) ??
    (characters.length === 1 ? characters[0] : undefined);
  if (character !== undefined) return { character: character.id, meshes: [] };
  const meshes = app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
  return meshes.length === 0 ? null : { character: null, meshes: meshes.map((mesh) => mesh.id) };
}

const sameSubject = (a: AutoRigSubject, b: AutoRigSubject): boolean =>
  a.character === b.character && a.meshes.length === b.meshes.length && a.meshes.every((id, i) => b.meshes[i] === id);

/** The document has nothing for the wizard yet (a fresh page, or a reload before Continue). */
export const documentEmpty = (app: EditorApp): boolean =>
  app.store.list('characters').length === 0 && app.store.list('meshes').length === 0;

function readQuery(): { readonly step: AutoRigStep | null; readonly sample: AutoRigSampleId | null } {
  if (typeof window === 'undefined') return { step: null, sample: null };
  const url = new URL(window.location.href);
  const step = url.searchParams.get('step');
  const sample = url.searchParams.get('sample');
  if (step !== null || sample !== null) {
    url.searchParams.delete('step');
    url.searchParams.delete('sample');
    window.history.replaceState(window.history.state, '', url);
  }
  return {
    step: isStep(step) ? step : null,
    sample: (SAMPLES as readonly (string | null)[]).includes(sample) ? (sample as AutoRigSampleId) : null,
  };
}

function restored(mirror: SessionMirror | null): AutoRigSession {
  const base = defaultAutoRigSession();
  if (mirror === null) return base;
  return { ...base, ...mirror, step: 'model' };
}

export function createWizard(host: HostShell): Wizard {
  const { app } = host;
  const storage = host.params.storageBlocked ? null : sessionStorageOf();
  const session: AutoRigSessionStore = createAutoRigSessionStore(defaultAutoRigSession(), storage);
  const ui = smallStore<ShellUi>({ fromStudio: null, pendingStep: null });
  const footer = smallStore<FooterState>({});
  let arrived = false;
  let sample: AutoRigSampleId | null = null;

  /** The arrival (§3.1, §4.3, §4.4), once per controller, at its first start (StrictMode's replay skips it). */
  const arrive = (): void => {
    const query = readQuery();
    sample = query.sample;
    const handed = host.navigation.takeSubject();
    let mirror = readSessionMirror(storage);
    // A Studio hand-over of another subject starts fresh at ① with the From Studio card (the mirror is another's).
    if (handed !== null && mirror !== null && !sameSubject(handed, mirror.subject)) mirror = null;
    if (mirror !== null) session.load(restored(mirror));
    // `from=studio` of this arrival (a client navigation: the host's params are the first page load's)
    const fromParam = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('from');
    const fromStudio =
      handed ?? (fromParam === 'studio' && mirror === null && !documentEmpty(app) ? subjectFromDocument(app) : null);
    ui.set({ fromStudio, pendingStep: query.step ?? mirror?.step ?? null });
  };

  // ---- progress (derived; cached by an input counter the subscriptions bump) ----
  let inputs = 0;
  let cache: { readonly at: number; readonly value: AutoRigProgress } | null = null;
  let live = false;
  const progressListeners = new Set<() => void>();
  const bump = (): void => {
    inputs += 1;
    for (const listener of Array.from(progressListeners)) listener();
  };
  const progress = (): AutoRigProgress => {
    if (live && cache?.at === inputs) return cache.value;
    const value = autoRigProgress(app, session.getState());
    cache = { at: inputs, value };
    return value;
  };

  const go = (step: AutoRigStep): void => {
    if (!progress().reachable[step]) return;
    ui.set((current) => (current.pendingStep === null ? current : { ...current, pendingStep: null }));
    // the arriving step's view sets its own footer; the leaving step's is not shown meanwhile
    if (session.getState().step !== step) footer.set({});
    session.set({ step });
  };

  const run: WizardContext['run'] = async (op, args) => {
    const result = await host.runFromUi(op, args);
    if (result.status === 'failed') {
      footer.set((current) => ({ ...current, status: result.error.message, tone: 'error' }));
    }
    return result;
  };

  const wizard: Wizard = {
    host,
    app,
    session,
    ui,
    footer,
    go,
    run,
    progress,
    setFooter: (next) => footer.set(next),
    progressStore: {
      subscribe(listener) {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      },
      get: progress,
    },
    files: {
      handle(files) {
        const list = [...files];
        if (list.length === 0) return;
        if (session.getState().step !== 'model') session.set({ step: 'model' });
        void withFlow(wizard, messages().model.loadFailed, (flow) => flow.loadFiles(wizard, list));
      },
    },
    start() {
      const disposers: Disposer[] = [];
      const first = !arrived;
      if (first) {
        arrived = true;
        arrive();
      }
      live = true;
      cache = null;
      disposers.push(() => {
        live = false;
      });

      // inputs of the progress: the document, the session, the rig-workspace chunk and the checklist chunk (loaded
      // with the first model; a failed load is retried at the next document change)
      let alive = true;
      disposers.push(() => {
        alive = false;
      });
      const wantChecklist = (): void => {
        if (checklistLoaded() || documentEmpty(app)) return;
        void loadChecklist().then(
          () => alive && bump(),
          () => {},
        );
      };
      wantChecklist();
      disposers.push(
        app.store.subscribe(() => {
          bump();
          wantChecklist();
        }),
      );
      disposers.push(session.subscribe(() => bump()));
      if (!app.rig.loaded) {
        const waitRig = (): void => {
          void app.rig
            .load()
            .then(() => alive && bump())
            .catch(() => {});
        };
        // The chunk loads with Rig & Skin (workspace.set); bump once it is there.
        disposers.push(
          app.session.subscribe((state, previous) => {
            if (state.workspace !== previous.workspace && state.workspace === 'rig') waitRig();
          }),
        );
        if (app.session.getState().workspace === 'rig') waitRig();
      }

      // a handoff record's step and start pose (the record may arrive after the shell mounted)
      let handoffTaken = host.params.handoff === null;
      const takeHandoff = (): void => {
        if (handoffTaken) return;
        const info = host.navigation.takeHandoffInfo();
        if (info === null) return;
        handoffTaken = true;
        host.navigation.takeSubject();
        if (info.autorig !== null) {
          session.set({
            subject: info.subject ?? { character: null, meshes: [] },
            startPose: info.autorig.startPose,
          });
          ui.set((current) => ({ ...current, pendingStep: info.autorig?.step ?? null }));
        } else if (info.subject !== null) {
          ui.set((current) => ({ ...current, fromStudio: info.subject }));
        }
      };
      takeHandoff();

      // the pending step: taken once reachable. At the arrival a document that cannot reach it lands on the furthest
      // reachable step; an empty one (a reload before Continue, a sample still loading) lets it wait.
      const settle = (): void => {
        takeHandoff();
        const pending = ui.get().pendingStep;
        if (pending !== null && progress().reachable[pending]) go(pending);
      };
      const initial = ui.get().pendingStep;
      if (first && initial !== null && !progress().reachable[initial] && !documentEmpty(app)) {
        go(landingStep(progress(), initial));
      }
      disposers.push(this.progressStore.subscribe(settle));
      settle();

      // §4.2 entry order on every step change, and again on ① when the first model arrives; entries run one after
      // another, and a quick second change (Alt+2 then Alt+3) supersedes the first before its next stage
      let entered: { step: AutoRigStep; model: boolean } | null = null;
      const queue = entryQueue();
      const enter = (): void => {
        const step = session.getState().step;
        const model = progress().done.model;
        if (entered !== null && entered.step === step && (entered.model || !model)) return;
        entered = { step, model };
        void queue((current) => enterStep(wizard, step, model, current));
      };
      disposers.push(session.subscribe(enter));
      disposers.push(this.progressStore.subscribe(enter));
      enter();

      // the mounted shell: leave() stops previews and ends tool sessions; a handoff record carries the step
      disposers.push(
        host.mount({
          kind: 'autorig',
          leave: () => void endSessions(app, true),
          handoffState: () => ({ step: session.getState().step, startPose: session.getState().startPose }),
        }),
      );

      // the test API's autorig() (e2e builds; marker-free registration)
      disposers.push(
        provideAutoRigTestState(app, () => {
          const s = session.getState();
          const p = progress();
          return {
            step: s.step,
            reachable: { ...p.reachable },
            done: { ...p.done },
            subject: { character: s.subject.character, meshes: [...s.subject.meshes] },
            intake: s.intake,
            startPose: s.startPose,
            busy: s.busy,
            slices: { model: s.model, markers: s.markers, rig: s.rig, animations: s.animations, export: s.export },
          };
        }),
      );

      // the `autorig` key scope (capture phase, before the host's adapter)
      const mac = app.keymap.platform === 'mac';
      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.defaultPrevented) return;
        if (app.session.getState().dialog !== null || host.ui.getState().confirm !== null) return;
        const binding = bindingFor(e, session.getState().step, mac);
        if (binding === null) {
          if (e.code === 'Escape' && app.library.loaded && app.library.service.preview !== null) {
            void quiet(app, 'library.stop');
          }
          return;
        }
        e.preventDefault();
        if ('op' in binding.run) {
          const undo = binding.run.op === 'edit.undo' || binding.run.op === 'edit.redo';
          // §4.5: while a composition runs, the global undo/redo keys are off
          if (undo && (session.getState().busy !== null || app.session.getState().busy !== null)) return;
          void host.runFromUi(binding.run.op, binding.run.args);
          return;
        }
        if (binding.run.action === 'primary') {
          const primary = footer.get().primary;
          if (primary !== undefined && primary !== null && primary.disabled !== true) void primary.run();
        } else if (binding.run.action === 'goto' && typeof binding.run.args === 'number') {
          const step = AUTORIG_STEPS[binding.run.args];
          if (step !== undefined) go(step);
        }
      };
      window.addEventListener('keydown', onKeyDown, { capture: true });
      disposers.push(() => window.removeEventListener('keydown', onKeyDown, { capture: true }));

      // files dropped anywhere go to the wizard (① takes them), not to Studio's import dialog
      const onDrop = (e: DragEvent): void => {
        if (e.dataTransfer?.types.includes('Files') !== true) return;
        e.preventDefault();
        e.stopPropagation();
        host.ui.setState({ dragOver: false });
        wizard.files.handle([...e.dataTransfer.files]);
      };
      window.addEventListener('drop', onDrop, { capture: true });
      disposers.push(() => window.removeEventListener('drop', onDrop, { capture: true }));

      // Simple navigation while mounted (§8.1): installed on the page's viewport, removed on unmount
      let offNav: Disposer | null = null;
      const installNav = (): void => {
        offNav?.();
        offNav = null;
        const vm = host.ui.getState().viewport;
        if (vm !== null) offNav = installSimpleNavigation(app, vm);
      };
      installNav();
      disposers.push(
        host.ui.subscribe((state, previous) => {
          if (state.viewport !== previous.viewport) installNav();
        }),
      );
      session.set({ nav: 'simple' });
      disposers.push(() => {
        offNav?.();
        offNav = null;
        session.set({ nav: null });
      });

      // `?sample=` loads once at ①
      if (first && sample !== null) {
        const id = sample;
        void withFlow(wizard, messages().model.loadFailed, (flow) => flow.loadSample(wizard, id));
      }

      return () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      };
    },
  };
  return wizard;
}
