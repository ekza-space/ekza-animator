// ① Model (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): over the pane the drop zone (file picker, samples, Continue where you
// left off), shrinking to a strip once a model is loaded; in the side panel the report (file, meshes, triangles,
// height, the check rows with their one-click fixes, the Pose row, the parts of a multi-mesh model, the weight notes)
// and the From Studio card. The footer's primary is *Next: Markers* (an already rigged avatar: *Next: Animations*).
// The first visit loads only the drop zone (AR-D3-4): the ① actions (`./flow`), the report (`./Report`) and the cards
// a fresh profile never shows (Continue, the rigged-other choice, a project's characters: `./Extras`) are lazy chunks.
import type { AutoRigFix } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { formatNumber, messages } from '../../i18n';
import {
  type FooterState,
  type ShellUi,
  useAppSession,
  useDocument,
  useProgress,
  useSession,
  type WizardContext,
} from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import { useSmall } from '../../shell/store';
import type { AutoRigSession } from '../../types';
import { FIX_LABEL, firstFix, transformsUniform } from './checks';
import { modelUi, withFlow } from './ui';

const t = (): ReturnType<typeof messages>['model'] => messages().model;

const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'md'), 'pointer-coarse:min-h-11');

const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;
const selectIntake = (s: AutoRigSession): AutoRigSession['intake'] => s.intake;
const selectModel = (s: AutoRigSession): AutoRigSession['model'] => s.model;
const selectStep = (s: AutoRigSession): AutoRigSession['step'] => s.step;
const selectFromStudio = (u: ShellUi): ShellUi['fromStudio'] => u.fromStudio;

// ---------------------------------------------------------------------------------------------------------------------
// over the pane

function FilePicker(props: { readonly ctx: WizardContext; readonly label: string }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={button('primary')} onClick={() => input.current?.click()}>
        {props.label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".glb,.vrm,.gltf,.ekzanim,.json"
        className="hidden"
        data-testid="ar-model-picker"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length > 0) void withFlow(props.ctx, t().loadFailed, (flow) => flow.loadFiles(props.ctx, files));
        }}
      />
    </>
  );
}

function Samples(props: { readonly ctx: WizardContext }): JSX.Element {
  const m = t();
  const samples = [
    ['cube-lad', m.sampleCubeLad],
    ['polybot-tpose', m.samplePolybot],
    ['polybot-apose', m.samplePolybotA],
  ] as const;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-fg-2">{m.samples}</span>
      {samples.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={button()}
          data-sample={id}
          onClick={() => void withFlow(props.ctx, t().loadFailed, (flow) => flow.loadSample(props.ctx, id))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const Extras = lazy(() => import('./Extras'));

/** §4.4 Continue where you left off: shown when an autosave slot exists, the document is empty and no handoff came. */
function ContinueCard(props: { readonly ctx: WizardContext }): JSX.Element | null {
  const { ctx } = props;
  const recovery = useAppSession(
    ctx.app,
    useCallback((s) => s.recovery, []),
  );
  const empty = useDocument(
    ctx.app,
    () => ctx.app.store.list('characters').length + ctx.app.store.list('meshes').length === 0,
  );
  const slot = [...recovery].sort((a, b) => b.savedAt - a.savedAt)[0];
  if (slot === undefined || !empty || ctx.host.params.handoff !== null) return null;
  return (
    <Suspense fallback={null}>
      <Extras ctx={ctx} show="continue" slot={slot} />
    </Suspense>
  );
}

function Overlay(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const m = t();
  const ui = useSmall(modelUi(ctx));
  const intake = useSession(ctx.session, selectIntake);
  const handed = useSmall(ctx.ui, selectFromStudio);
  // the document's subject, not the session's ids (an undone import, or a reload before Continue)
  const loaded = useProgress(ctx).done.model;
  if (ui.loading !== null) {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <output className="rounded-field bg-panel px-4 py-2 text-fg" data-testid="ar-loading">
          {m.loading(ui.loading)}
        </output>
      </div>
    );
  }
  // a model loaded, or a Studio hand-over waiting on the From Studio card (its character is in view): the strip only
  if (loaded || handed !== null) {
    return (
      <div
        className="pointer-events-auto absolute bottom-2 left-2 flex flex-wrap items-center gap-2 rounded-field bg-panel/90 px-2 py-1"
        data-testid="ar-drop-strip"
      >
        <span className="text-fg-2">{m.dropTitle}</span>
        <FilePicker ctx={ctx} label={m.choose} />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-auto p-4">
      <section
        className="pointer-events-auto flex max-w-xl flex-col items-center gap-3 rounded-dialog border-2 border-dashed border-line-strong bg-panel/90 p-6 text-center"
        aria-label={m.dropTitle}
        data-testid="ar-drop-zone"
      >
        <p className="text-dialog-title font-semibold">{m.dropTitle}</p>
        <div className="flex items-center gap-2">
          <span className="text-fg-2">{m.dropOr}</span>
          <FilePicker ctx={ctx} label={m.choose} />
        </div>
        <Samples ctx={ctx} />
        {ui.rerig !== null && intake?.kind === 'rigged-other' ? (
          <Suspense fallback={null}>
            <Extras ctx={ctx} show="rigged-other" />
          </Suspense>
        ) : null}
        {ui.choose !== null ? (
          <Suspense fallback={null}>
            <Extras ctx={ctx} show="choose" characters={ui.choose} />
          </Suspense>
        ) : null}
        <ContinueCard ctx={ctx} />
        <p className="text-fg-3">{m.formats}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the side panel

const ModelReport = lazy(() => import('./Report'));

function Panel(props: { readonly ctx: WizardContext }): JSX.Element | null {
  const { ctx } = props;
  const intake = useSession(ctx.session, selectIntake);
  const subject = useSession(ctx.session, selectSubject);
  const handed = useSmall(ctx.ui, selectFromStudio);
  const loaded = useProgress(ctx).done.model;
  const name = useDocument(ctx.app, () =>
    subject.character === null ? null : (ctx.app.store.get('characters', subject.character)?.name ?? null),
  );
  const report = loaded && intake !== null && intake.kind !== 'rigged-other' ? intake : null;
  return (
    <div className="flex flex-col gap-3">
      {!loaded && handed === null ? <p className="text-fg-2">{t().panelEmpty}</p> : null}
      {report === null && name !== null ? <p data-testid="ar-subject-character">{name}</p> : null}
      {report === null && handed === null ? null : (
        <Suspense fallback={null}>
          <ModelReport ctx={ctx} report={report} />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the footer and the report's freshness

function useModelFooter(ctx: WizardContext): void {
  const intake = useSession(ctx.session, selectIntake);
  const model = useSession(ctx.session, selectModel);
  const subject = useSession(ctx.session, selectSubject);
  const step = useSession(ctx.session, selectStep);
  const ui = useSmall(modelUi(ctx));
  const handed = useSmall(ctx.ui, selectFromStudio);
  const progress = useProgress(ctx);
  const uniform = useDocument(ctx.app, () => transformsUniform(ctx, subject.meshes));
  useEffect(() => {
    if (step !== 'model') return;
    // A Studio hand-over waits on the From Studio card: "Use these" is the step's primary (AR-D8-7).
    if (handed !== null && !progress.done.model && ui.loading === null) {
      ctx.setFooter({
        status: t().hintFromStudio,
        tone: 'info',
        primary: {
          label: t().useThese,
          run: async () => (await import('./fixes')).acceptFromStudio(ctx, handed),
        },
      });
      return;
    }
    const m = t();
    const f = messages().frame;
    const asset =
      intake?.kind === 'vrm' ||
      intake?.kind === 'rigged-humanoid' ||
      (subject.character !== null && !progress.reachable.markers && progress.reachable.animations);
    const target = asset ? 'animations' : 'markers';
    const footer: FooterState = {
      status:
        ui.loading !== null
          ? m.loading(ui.loading)
          : ui.error !== null
            ? ui.error
            : !progress.done.model
              ? m.hintLoad
              : asset
                ? m.hintVrm
                : intake !== null && firstFix(intake, uniform) !== null
                  ? m.hintFix(FIX_LABEL[firstFix(intake, uniform) as AutoRigFix]())
                  : m.hintReady,
      tone:
        ui.loading === null && ui.error !== null
          ? 'error'
          : intake !== null && !asset && firstFix(intake, uniform) !== null
            ? 'warning'
            : 'info',
      primary: {
        label: f.next(asset ? f.stepAnimations : f.stepMarkers),
        disabled: ui.loading !== null || !progress.reachable[target],
        run: async () => {
          if (intake?.weight === 'heavy' && !model.heavyConfirmed) {
            const ok = await ctx.host.confirm({
              title: m.panelTitle,
              text: m.heavyConfirm(formatNumber(intake.triangles, { maximumFractionDigits: 0 })),
              confirmLabel: f.next(f.stepMarkers),
            });
            if (!ok) return;
            (await import('./parts')).confirmHeavy(ctx);
          }
          ctx.go(target);
        },
      },
    };
    ctx.setFooter(footer);
  }, [ctx, step, intake, model.heavyConfirmed, subject, ui.loading, ui.error, progress, uniform, handed]);
}

/** Re-reads the report when the document changes under ① (an undo of a fix, an edit in Studio's palette). */
function useFreshReport(ctx: WizardContext): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = ctx.app.store.subscribe(() => {
      if (timer !== null || modelUi(ctx).get().loading !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const state = ctx.session.getState();
        if (state.step !== 'model' || state.intake === null) return;
        void withFlow(ctx, t().loadFailed, (flow) => (flow.subjectMeshes(ctx).length > 0 ? flow.reinspect(ctx) : null));
      }, 0);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [ctx]);
}

export function ModelStep(props: StepViewProps): JSX.Element {
  const { ctx, slot } = props;
  if (slot === 'overlay') return <Overlay ctx={ctx} />;
  return <ModelPanelWithFooter ctx={ctx} />;
}

function ModelPanelWithFooter(props: { readonly ctx: WizardContext }): JSX.Element {
  useModelFooter(props.ctx);
  useFreshReport(props.ctx);
  return <Panel ctx={props.ctx} />;
}
