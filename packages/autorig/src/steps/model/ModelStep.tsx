// ① Model (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): over the pane the drop zone (file picker, samples, Continue where you
// left off), shrinking to a strip once a model is loaded; in the side panel the report (file, meshes, triangles,
// height, the check rows with their one-click fixes, the Pose row, the parts of a multi-mesh model, the weight notes)
// and the From Studio card. The footer's primary is *Next: Markers* (an already rigged avatar: *Next: Animations*).
import type { MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, IntakeReport } from '@ekza-studio/editor-core';
import { buttonClass, Check, cn, TriangleAlert } from '@ekza-studio/ui';
import { type JSX, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
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
import {
  applyFix,
  chooseCharacter,
  continueSlot,
  discardSlot,
  loadFiles,
  loadSample,
  modelUi,
  openRiggedInStudio,
  reinspect,
  reRig,
  subjectMeshes,
  takeFromStudio,
} from './flow';
import { confirmHeavy, separateMeshes, setPart } from './parts';

const t = (): ReturnType<typeof messages>['model'] => messages().model;

const DEG = 180 / Math.PI;
const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'md'), 'pointer-coarse:min-h-11');

/** The first failing check's fix, in the order the fixes should run (§5.2; AS-AR-5: stand up, size, centre, face). */
export function firstFix(report: IntakeReport, transformsOk: boolean): AutoRigFix | null {
  const c = report.checks;
  if (!c.upright) return 'standUp';
  if (c.scale !== 'ok') return 'scale';
  if (!transformsOk) return 'freeze';
  if (!c.centred || !c.grounded) return 'center';
  if (!c.facing) return 'face';
  return null;
}

const FIX_LABEL: Readonly<Record<AutoRigFix, () => string>> = {
  center: () => t().fixCenter,
  face: () => t().fixFace,
  standUp: () => t().fixStandUp,
  scale: () => t().fixScale,
  freeze: () => t().fixFreeze,
};

/** The subject's scene meshes all have a positive uniform scale (C1 refuses others: "Freeze Transformations first"). */
function transformsUniform(ctx: WizardContext, meshes: readonly MeshId[]): boolean {
  return meshes.every((id) => {
    const s = ctx.app.store.get('meshes', id)?.placement.s;
    if (s === undefined) return true;
    const max = Math.max(...s.map(Math.abs));
    return s.every((v) => v > 0) && max - Math.min(...s) <= 1e-6 * max;
  });
}

const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;
const selectIntake = (s: AutoRigSession): AutoRigSession['intake'] => s.intake;
const selectModel = (s: AutoRigSession): AutoRigSession['model'] => s.model;
const selectStep = (s: AutoRigSession): AutoRigSession['step'] => s.step;
const selectFromStudio = (u: ShellUi): ShellUi['fromStudio'] => u.fromStudio;

function ago(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60_000);
  if (minutes < 1) return t().agoNow;
  return minutes < 60 ? t().agoMinutes(minutes) : t().agoHours(Math.floor(minutes / 60));
}

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
        data-testid="ar-file-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length > 0) void loadFiles(props.ctx, files);
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
          onClick={() => void loadSample(props.ctx, id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

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
    <div
      className="flex flex-col items-center gap-2 rounded-field border border-line bg-panel p-3"
      data-testid="ar-continue"
    >
      <p className="text-center">{t().continueTitle(slot.projectName, ago(slot.savedAt))}</p>
      <div className="flex gap-2">
        <button type="button" className={button('primary')} onClick={() => void continueSlot(ctx, slot.id)}>
          {t().continue}
        </button>
        <button type="button" className={button('ghost')} onClick={() => void discardSlot(ctx, slot.id)}>
          {t().startOver}
        </button>
      </div>
    </div>
  );
}

function Overlay(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const m = t();
  const ui = useSmall(modelUi(ctx));
  const subject = useSession(ctx.session, selectSubject);
  const intake = useSession(ctx.session, selectIntake);
  const loaded = subject.character !== null || subject.meshes.length > 0;
  if (ui.loading !== null) {
    return (
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <output className="rounded-field bg-panel px-4 py-2 text-fg" data-testid="ar-loading">
          {m.loading(ui.loading)}
        </output>
      </div>
    );
  }
  if (loaded) {
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
          <div className="flex flex-col items-center gap-2" data-testid="ar-rigged-other" role="alert">
            <p>{m.kindRiggedOther}</p>
            <div className="flex gap-2">
              <button type="button" className={button('primary')} onClick={() => void reRig(ctx)}>
                {m.reRig}
              </button>
              <button type="button" className={button()} onClick={() => void openRiggedInStudio(ctx)}>
                {m.openInStudio}
              </button>
            </div>
          </div>
        ) : null}
        {ui.choose !== null ? (
          <div className="flex flex-col items-center gap-2" data-testid="ar-choose-character">
            <p>{m.severalCharacters}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {ui.choose.map((id) => (
                <button key={id} type="button" className={button()} onClick={() => chooseCharacter(ctx, id)}>
                  {ctx.app.store.get('characters', id)?.name ?? id}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ContinueCard ctx={ctx} />
        <p className="text-fg-3">{m.formats}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the side panel

function Row(props: {
  readonly ok: boolean;
  readonly label: string;
  readonly detail?: string;
  readonly fix?: ReactNode;
  readonly id: string;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5" data-check={props.id} data-ok={props.ok}>
      <span aria-hidden className={props.ok ? 'text-ok' : 'text-warn'}>
        {props.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
      </span>
      <span className="flex-1">
        {props.label}
        <span className="sr-only">{props.ok ? ': passed' : ': needs a fix'}</span>
        {props.detail === undefined ? null : <span className="block text-fg-3">{props.detail}</span>}
      </span>
      {props.ok ? null : props.fix}
    </li>
  );
}

function FixButton(props: {
  readonly ctx: WizardContext;
  readonly fix: AutoRigFix;
  readonly height?: number;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(buttonClass('default', 'sm'), 'pointer-coarse:min-h-11')}
      data-fix={props.fix}
      onClick={() => void applyFix(props.ctx, props.fix, props.height)}
    >
      {FIX_LABEL[props.fix]()}
    </button>
  );
}

function SizeFix(props: { readonly ctx: WizardContext }): JSX.Element {
  const [height, setHeight] = useState('1.70');
  const id = useId();
  const value = Number.parseFloat(height);
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="sr-only">
        {t().heightField}
      </label>
      <input
        id={id}
        className="h-[var(--size-field)] w-16 rounded-field border border-line bg-field px-1 text-fg"
        type="number"
        min={0.1}
        step={0.01}
        value={height}
        onChange={(e) => setHeight(e.currentTarget.value)}
      />
      <FixButton ctx={props.ctx} fix="scale" {...(Number.isFinite(value) && value > 0 ? { height: value } : {})} />
    </span>
  );
}

function Report(props: { readonly ctx: WizardContext; readonly report: IntakeReport }): JSX.Element {
  const { ctx, report } = props;
  const m = t();
  const model = useSession(ctx.session, selectModel);
  const subject = useSession(ctx.session, selectSubject);
  const meshes = useDocument(ctx.app, () => subjectMeshes(ctx));
  const uniform = useDocument(ctx.app, () => transformsUniform(ctx, meshes));
  const separate = useDocument(ctx.app, () => new Set(separateMeshes(ctx.app, report.meshes)));
  const staticKind = report.kind === 'static' || (report.kind === 'project' && subject.meshes.length > 0);
  const c = report.checks;
  const tris = formatNumber(report.triangles, { maximumFractionDigits: 0 });
  return (
    <section aria-labelledby="ar-model-report" className="flex flex-col gap-2" data-testid="ar-model-report">
      <h2 id="ar-model-report" className="text-ui-strong font-semibold uppercase tracking-wide text-fg-2">
        {m.panelTitle}
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-fg-2">
        {report.fileName === null ? null : (
          <>
            <dt className="sr-only">File</dt>
            <dd className="col-span-2 truncate text-fg" data-testid="ar-file-name">
              {report.fileName}
            </dd>
          </>
        )}
        <dd className="col-span-2">
          {staticKind ? `${m.meshes(report.meshes.length)} · ` : ''}
          {m.triangles(tris)} · {m.tall(formatNumber(report.height, { maximumFractionDigits: 2 }))}
          {report.textured ? ` · ${m.textured}` : ''}
        </dd>
      </dl>
      {report.kind === 'vrm' || report.kind === 'rigged-humanoid' ? (
        <p data-testid="ar-kind-note">{report.kind === 'vrm' ? m.kindVrm : m.kindRiggedHumanoid}</p>
      ) : null}
      {staticKind ? (
        <ul className="flex flex-col" aria-label="Checks">
          <Row id="centred" ok={c.centred} label={m.checkCentred} fix={<FixButton ctx={ctx} fix="center" />} />
          <Row id="grounded" ok={c.grounded} label={m.checkGrounded} fix={<FixButton ctx={ctx} fix="center" />} />
          <Row id="facing" ok={c.facing} label={m.checkFacing} fix={<FixButton ctx={ctx} fix="face" />} />
          <Row id="upright" ok={c.upright} label={m.checkUpright} fix={<FixButton ctx={ctx} fix="standUp" />} />
          <Row
            id="size"
            ok={c.scale === 'ok'}
            label={m.checkSize}
            {...(c.scale === 'ok'
              ? {}
              : {
                  detail: (c.scale === 'tiny' ? m.sizeTiny : m.sizeHuge)(
                    formatNumber(report.height, { maximumFractionDigits: 2 }),
                  ),
                })}
            fix={<SizeFix ctx={ctx} />}
          />
          {uniform ? null : (
            <Row
              id="transforms"
              ok={false}
              label={m.checkTransforms}
              detail={m.transformsBad}
              fix={<FixButton ctx={ctx} fix="freeze" />}
            />
          )}
          <li className="flex items-start gap-2 py-0.5" data-check="pose" data-pose={report.pose?.kind ?? 'unknown'}>
            <span aria-hidden className="text-info">
              ·
            </span>
            <span>
              {m.pose}:{' '}
              {report.pose === null
                ? m.poseUnknown
                : report.pose.kind === 't'
                  ? m.poseT
                  : m.poseA(Math.round(report.pose.armAngle * DEG))}
            </span>
          </li>
        </ul>
      ) : null}
      {report.weight === 'medium' ? <p className="text-fg-2">{m.medium}</p> : null}
      {report.weight === 'heavy' ? (
        <p className="text-warn" role="note" data-testid="ar-heavy">
          {m.heavy(tris)}
        </p>
      ) : null}
      {staticKind && report.meshes.length > 1 ? (
        <fieldset className="flex flex-col gap-1" data-testid="ar-parts">
          <legend className="text-fg-2">{m.parts}</legend>
          {report.meshes.map((id) => {
            const ticked = (model.parts ?? report.meshes).includes(id);
            return (
              <label key={id} className="flex items-center gap-2 pointer-coarse:min-h-11" data-part={id}>
                <input type="checkbox" checked={ticked} onChange={(e) => setPart(ctx, id, e.currentTarget.checked)} />
                <span className="flex-1 truncate">{ctx.app.store.get('meshes', id)?.name ?? id}</span>
                {separate.has(id) ? <span className="text-fg-3">{m.looksSeparate}</span> : null}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </section>
  );
}

function FromStudio(props: { readonly ctx: WizardContext }): JSX.Element | null {
  const { ctx } = props;
  const m = t();
  const handed = useSmall(ctx.ui, selectFromStudio);
  const subject = useSession(ctx.session, selectSubject);
  if (handed === null) return null;
  const same =
    handed.character === subject.character &&
    handed.meshes.length === subject.meshes.length &&
    handed.meshes.every((id, i) => subject.meshes[i] === id);
  if (same) return null;
  const name = handed.character === null ? null : (ctx.app.store.get('characters', handed.character)?.name ?? null);
  return (
    <section
      aria-labelledby="ar-from-studio"
      className="flex flex-col gap-2 border-t border-line pt-2"
      data-testid="ar-from-studio"
    >
      <h2 id="ar-from-studio" className="text-ui-strong font-semibold uppercase tracking-wide text-fg-2">
        {m.fromStudioTitle}
      </h2>
      <p>{name === null ? m.fromStudioBody(handed.meshes.length) : m.fromStudioCharacter(name)}</p>
      <button
        type="button"
        className={button('primary')}
        onClick={() => {
          ctx.ui.set((u) => ({ ...u, fromStudio: null }));
          void takeFromStudio(ctx, handed);
        }}
      >
        {m.useThese}
      </button>
    </section>
  );
}

function Panel(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const intake = useSession(ctx.session, selectIntake);
  const subject = useSession(ctx.session, selectSubject);
  const name = useDocument(ctx.app, () =>
    subject.character === null ? null : (ctx.app.store.get('characters', subject.character)?.name ?? null),
  );
  return (
    <div className="flex flex-col gap-3">
      {intake !== null && intake.kind !== 'rigged-other' ? <Report ctx={ctx} report={intake} /> : null}
      {intake === null && name !== null ? <p data-testid="ar-subject-character">{name}</p> : null}
      <FromStudio ctx={ctx} />
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
  const progress = useProgress(ctx);
  const uniform = useDocument(ctx.app, () => transformsUniform(ctx, subject.meshes));
  useEffect(() => {
    if (step !== 'model') return;
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
          : !progress.done.model
            ? m.hintLoad
            : asset
              ? m.hintVrm
              : intake !== null && firstFix(intake, uniform) !== null
                ? m.hintFix(FIX_LABEL[firstFix(intake, uniform) as AutoRigFix]())
                : m.hintReady,
      tone: intake !== null && !asset && firstFix(intake, uniform) !== null ? 'warning' : 'info',
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
            confirmHeavy(ctx);
          }
          ctx.go(target);
        },
      },
    };
    ctx.setFooter(footer);
  }, [ctx, step, intake, model.heavyConfirmed, subject, ui.loading, progress, uniform]);
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
        if (state.step === 'model' && state.intake !== null && subjectMeshes(ctx).length > 0) void reinspect(ctx);
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
