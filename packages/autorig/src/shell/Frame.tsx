// The wizard frame (AUTORIG-SPEC §5.1, §8.2, §8.3; D3): header (mark, subject name, undo/redo, *Open in Studio ▸*,
// `⋯`), the stepper (`nav` + the step's `h1`), `main` with the step's pane grid (the shipped `PaneView` from
// `@ekza-studio/editor/host`; the shared canvas draws behind it) and the step panel (≤ 320 px; a bottom sheet below
// 1024 px), and the footer (*Back*, one status line, one primary button). Landmarks, a polite status line, an
// assertive error line, focus on the step heading at every step change.
import { useHostUi } from '@ekza-studio/editor/host';
import { buttonClass, cn, Redo2, Undo2 } from '@ekza-studio/ui';
import {
  type ComponentType,
  createElement,
  type JSX,
  lazy,
  type MouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { focusStepHeading, STEP_HEADING_ID } from '../a11y';
import { messages } from '../i18n';
import { ModelStep } from '../steps/model/ModelStep';
import { AUTORIG_STEPS, type AutoRigSession, type AutoRigStep } from '../types';
import { useAppSession, useDocument, useProgress, useSession, type WizardContext } from './context';
import { MoreMenu } from './Menu';
import { WizardPane } from './Pane';
import { type StepViewProps, stepModule, stepPanes, studioWorkspace } from './steps';
import { useSmall, type SmallStore } from './store';
import type { FooterState } from './context';

const f = (): ReturnType<typeof messages>['frame'] => messages().frame;

export const STEP_LABEL: Readonly<Record<AutoRigStep, () => string>> = {
  model: () => f().stepModel,
  markers: () => f().stepMarkers,
  rig: () => f().stepRig,
  animations: () => f().stepAnimations,
  export: () => f().stepExport,
};

const GLYPHS = ['①', '②', '③', '④', '⑤'] as const;
const coarse = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';
const selectStep = (s: AutoRigSession): AutoRigStep => s.step;
const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;
const selectIntake = (s: AutoRigSession): AutoRigSession['intake'] => s.intake;

// ---------------------------------------------------------------------------------------------------------------------
// header

function SubjectName(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const subject = useSession(ctx.session, selectSubject);
  const intake = useSession(ctx.session, selectIntake);
  const [editing, setEditing] = useState(false);
  const name = useDocument(ctx.app, () => {
    const character = subject.character === null ? undefined : ctx.app.store.get('characters', subject.character);
    if (character !== undefined) return character.vrm?.name || character.name;
    const mesh = subject.meshes.map((id) => ctx.app.store.get('meshes', id)).find((record) => record !== undefined);
    return mesh?.name ?? intake?.fileName ?? null;
  });
  // a model character's VRM name (`char.setVrmMeta`), else the first scene mesh's (`scene.rename`); an imported
  // avatar's name is its file's
  const canRename = useDocument(ctx.app, () =>
    subject.character === null
      ? subject.meshes.some((id) => ctx.app.store.get('meshes', id) !== undefined)
      : ctx.app.store.get('characters', subject.character)?.source.kind === 'model',
  );
  const commit = (value: string): void => {
    setEditing(false);
    const text = value.trim();
    if (text === '' || text === name) return;
    const state = ctx.session.getState().subject;
    const character = state.character === null ? undefined : ctx.app.store.get('characters', state.character);
    if (character !== undefined && character.source.kind === 'model') {
      void ctx.run('char.setVrmMeta', { character: character.id, patch: { name: text } });
    } else if (state.meshes[0] !== undefined) {
      void ctx.run('scene.rename', { id: state.meshes[0], name: text });
    }
  };
  if (editing) {
    return (
      <input
        aria-label={f().renameField}
        className="h-7 min-w-0 rounded-field border border-line bg-field px-1 text-fg"
        defaultValue={name ?? ''}
        ref={(field) => field?.focus()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="min-w-0 truncate rounded-field px-1 text-fg hover:bg-hover disabled:hover:bg-transparent pointer-coarse:min-h-11"
      title={canRename ? f().rename : undefined}
      disabled={!canRename}
      data-testid="ar-subject-name"
      onClick={() => setEditing(true)}
    >
      {name ?? f().untitled}
    </button>
  );
}

function UndoRedo(props: { readonly ctx: WizardContext }): JSX.Element {
  const { app, host } = props.ctx;
  const subscribe = useCallback((notify: () => void) => app.history.subscribe(notify), [app]);
  const read = useCallback(
    () => `${app.history.peekUndo()?.label ?? ''}\u0000${app.history.peekRedo()?.label ?? ''}`,
    [app],
  );
  const [undo, redo] = useSyncExternalStore(subscribe, read, read).split('\u0000') as [string, string];
  const icon = cn(buttonClass('ghost', 'sm'), 'w-8 px-0', coarse);
  return (
    <span className="flex items-center">
      <button
        type="button"
        className={icon}
        aria-label={undo === '' ? f().undo : f().undoStep(undo)}
        title={undo === '' ? f().undo : f().undoStep(undo)}
        disabled={undo === ''}
        data-testid="ar-undo"
        onClick={() => void host.runFromUi('edit.undo')}
      >
        <Undo2 size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={icon}
        aria-label={redo === '' ? f().redo : f().redoStep(redo)}
        title={redo === '' ? f().redo : f().redoStep(redo)}
        disabled={redo === ''}
        data-testid="ar-redo"
        onClick={() => void host.runFromUi('edit.redo')}
      >
        <Redo2 size={16} aria-hidden />
      </button>
    </span>
  );
}

/** *Open in Studio ▸* (§3.4, §4.4): a link for semantics; a click switches on this page, a middle or modified click
 *  opens a new tab through the handoff record (the tab opens inside the gesture). */
function OpenInStudio(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const step = useSession(ctx.session, selectStep);
  const workspace = studioWorkspace(step);
  const go = (newTab: boolean): void => {
    void ctx.host.navigation.go({ to: 'studio', workspace, from: 'autorig', ...(newTab ? { newTab: true } : {}) });
  };
  return (
    <a
      href={`/editor?ws=${workspace}`}
      className={cn(buttonClass('default', 'sm'), coarse)}
      title={f().openStudioTitle}
      data-testid="ar-open-studio"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        go(e.metaKey || e.ctrlKey || e.shiftKey);
      }}
      onAuxClick={(e: MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        go(true);
      }}
    >
      {f().openStudio} ▸
    </a>
  );
}

function Header(props: { readonly ctx: WizardContext }): JSX.Element {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-header px-2">
      <span aria-hidden className="text-accent">
        ◆
      </span>
      <span className="shrink-0 font-semibold max-[699px]:sr-only">{f().product}</span>
      <span aria-hidden className="text-fg-3 max-[699px]:hidden">
        ·
      </span>
      <SubjectName ctx={props.ctx} />
      <span className="flex-1" />
      <UndoRedo ctx={props.ctx} />
      <OpenInStudio ctx={props.ctx} />
      <MoreMenu ctx={props.ctx} />
    </header>
  );
}

/** §6.3: WebGL unavailable or lost (the host's GL status). */
function GlNotice(): JSX.Element | null {
  const status = useHostUi((s) => s.gl.status);
  if (status !== 'unavailable' && status !== 'lost') return null;
  return (
    <p role="alert" className="shrink-0 bg-danger/20 px-3 py-1 text-fg" data-testid="ar-no-webgl">
      {f().noWebGl}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// stepper

function Stepper(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const step = useSession(ctx.session, selectStep);
  const progress = useProgress(ctx);
  return (
    <nav aria-label={f().stepsLabel} className="shrink-0 border-b border-line bg-panel px-2" data-testid="ar-stepper">
      <ol className="flex items-center gap-1 overflow-x-auto py-1">
        {AUTORIG_STEPS.map((id, i) => {
          const label = STEP_LABEL[id]();
          const done = progress.done[id];
          const glyph = <span aria-hidden>{done ? '✓' : GLYPHS[i]}</span>;
          const separator =
            i === 0 ? null : (
              <span aria-hidden className="text-fg-3">
                ─
              </span>
            );
          if (id === step) {
            return (
              <li key={id} className="flex items-center gap-1" data-step={id} data-done={done}>
                {separator}
                <h1
                  id={STEP_HEADING_ID}
                  tabIndex={-1}
                  aria-current="step"
                  className="flex items-center gap-1 rounded-field bg-selected px-2 py-1 font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {glyph}
                  {label}
                </h1>
              </li>
            );
          }
          const blocked = progress.reachable[id] ? undefined : progress.blocked[id];
          return (
            <li key={id} className="flex items-center gap-1" data-step={id} data-done={done}>
              {separator}
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 rounded-field px-2 py-1 text-fg-2 hover:enabled:bg-hover hover:enabled:text-fg disabled:opacity-50',
                  coarse,
                )}
                disabled={!progress.reachable[id]}
                title={blocked}
                aria-label={
                  blocked === undefined ? (done ? f().stepDone(label) : label) : f().stepBlocked(label, blocked)
                }
                onClick={() => ctx.go(id)}
              >
                {glyph}
                <span className="max-[699px]:sr-only">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// panes and the step's slots

function Panes(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const session = useSession(
    ctx.session,
    useCallback((s: AutoRigSession) => s, []),
  );
  const vm = useHostUi((s) => s.viewport);
  const panes = stepPanes(session.step, session);
  return (
    <div className="absolute inset-0 flex" data-testid="ar-panes" data-panes={panes.length}>
      {panes.map((pane) => (
        <div key={pane.id} className="flex min-w-0" style={{ flex: `${pane.size ?? 1} 1 0` }}>
          <WizardPane vm={vm} paneId={pane.id} />
        </div>
      ))}
    </div>
  );
}

function StepPlaceholder(props: StepViewProps): JSX.Element | null {
  const { ctx, slot } = props;
  const step = useSession(ctx.session, selectStep);
  const progress = useProgress(ctx);
  const label = STEP_LABEL[step]();
  const index = AUTORIG_STEPS.indexOf(step);
  const next = AUTORIG_STEPS[index + 1];
  useEffect(() => {
    if (slot !== 'panel') return;
    ctx.setFooter({
      status: f().stubBody,
      primary:
        next === undefined
          ? null
          : {
              label: f().next(STEP_LABEL[next]()),
              disabled: !progress.reachable[next],
              run: () => ctx.go(next),
            },
    });
  }, [ctx, slot, next, progress]);
  if (slot === 'overlay') return null;
  return (
    <section className="flex flex-col gap-2" data-testid="ar-step-placeholder">
      <h2 className="font-semibold">{f().stubTitle(label)}</h2>
      <p className="text-fg-2">{f().stubBody}</p>
    </section>
  );
}

const lazyViews = new Map<AutoRigStep, ComponentType<StepViewProps>>();

/** The view of a step: ①'s own, a step package's lazy `stepView`, else the placeholder. */
function viewOf(step: AutoRigStep): ComponentType<StepViewProps> {
  if (step === 'model') return ModelStep;
  const loader = stepModule(step).stepView;
  if (loader === undefined) return StepPlaceholder;
  let view = lazyViews.get(step);
  if (view === undefined) {
    view = lazy(loader);
    lazyViews.set(step, view);
  }
  return view;
}

function StepSlot(props: StepViewProps): JSX.Element {
  const step = useSession(props.ctx.session, selectStep);
  return (
    <Suspense fallback={null}>{createElement(viewOf(step), { key: step, ctx: props.ctx, slot: props.slot })}</Suspense>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// footer

function Footer(props: { readonly ctx: WizardContext; readonly footer: SmallStore<FooterState> }): JSX.Element {
  const { ctx } = props;
  const footer = useSmall(props.footer);
  const step = useSession(ctx.session, selectStep);
  const progress = useProgress(ctx);
  const busy = useAppSession(
    ctx.app,
    useCallback((s) => s.busy, []),
  );
  const index = AUTORIG_STEPS.indexOf(step);
  const back = AUTORIG_STEPS.slice(0, index)
    .reverse()
    .find((id) => progress.reachable[id]);
  const status = busy === null ? footer.status : f().busy(busy.label);
  const error = busy === null && footer.tone === 'error';
  const primary = footer.primary ?? null;
  return (
    <footer
      className="flex shrink-0 items-center gap-2 border-t border-line bg-header px-2 py-1.5"
      data-testid="ar-footer"
    >
      <button
        type="button"
        className={cn(buttonClass('ghost', 'md'), coarse)}
        disabled={back === undefined}
        onClick={() => back !== undefined && ctx.go(back)}
      >
        ◂ {f().back}
      </button>
      <p
        className={cn(
          'min-w-0 flex-1 truncate',
          error ? 'text-danger' : footer.tone === 'warning' ? 'text-warn' : 'text-fg-2',
        )}
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
        data-testid="ar-status"
      >
        {status}
      </p>
      {primary === null ? null : (
        <button
          type="button"
          className={cn(buttonClass('primary', 'md'), coarse)}
          disabled={primary.disabled === true || busy !== null}
          data-testid="ar-primary"
          onClick={() => void primary.run()}
        >
          {primary.label} ▸
        </button>
      )}
    </footer>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function Frame(props: {
  readonly ctx: WizardContext;
  readonly footer: SmallStore<FooterState>;
  readonly marker: string;
}): JSX.Element {
  const { ctx } = props;
  const step = useSession(ctx.session, selectStep);
  const first = useRef(true);
  useEffect(() => {
    // §8.2: a step change moves the focus to the new step's heading (not the first render)
    if (first.current) {
      first.current = false;
      return;
    }
    focusStepHeading();
  }, [step]);
  return (
    <div
      className="relative z-(--z-chrome) flex h-full w-full flex-col text-ui text-fg"
      data-shell={props.marker}
      data-testid="autorig-shell"
      data-step={step}
    >
      <Header ctx={ctx} />
      <GlNotice />
      <Stepper ctx={ctx} />
      <main
        className="flex min-h-0 flex-1 max-[1023px]:flex-col"
        aria-labelledby={STEP_HEADING_ID}
        data-testid="ar-main"
      >
        <div className="relative min-h-0 min-w-0 flex-1">
          <Panes ctx={ctx} />
          <StepSlot ctx={ctx} slot="overlay" />
        </div>
        <aside
          className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-3 max-[1023px]:max-h-[45%] max-[1023px]:w-auto max-[1023px]:border-t max-[1023px]:border-l-0"
          aria-label={STEP_LABEL[step]()}
          data-testid="ar-step-panel"
        >
          <StepSlot ctx={ctx} slot="panel" />
        </aside>
      </main>
      <Footer ctx={ctx} footer={props.footer} />
    </div>
  );
}
