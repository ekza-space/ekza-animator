// ① report panel (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): the file, meshes, triangles and height, the check rows with
// their one-click fixes, the Pose row, the transforms row, the parts of a multi-mesh model, the weight notes, and the
// From Studio card. A lazy chunk: it shows once a model is loaded (or a Studio hand-over waits), so the first visit
// loads only the frame and the drop zone (§7.2).
import type { AutoRigFix, IntakeReport } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, type ReactNode, useId, useState } from 'react';
import { formatNumber, messages } from '../../i18n';
import { type ShellUi, useDocument, useSession, type WizardContext } from '../../shell/context';
import { useSmall } from '../../shell/store';
import type { AutoRigSession } from '../../types';
import { FIX_LABEL, transformsUniform } from './checks';
import { applyFix, takeFromStudio } from './fixes';
import { reinspect, subjectMeshes } from './flow';
import { separateMeshes, setPart } from './parts';

const t = (): ReturnType<typeof messages>['model'] => messages().model;
const DEG = 180 / Math.PI;
const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'md'), 'pointer-coarse:min-h-11');
const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;
const selectModel = (s: AutoRigSession): AutoRigSession['model'] => s.model;
const selectFromStudio = (u: ShellUi): ShellUi['fromStudio'] => u.fromStudio;

function Row(props: {
  readonly ok: boolean;
  readonly label: string;
  readonly detail?: string;
  readonly fix?: ReactNode;
  readonly id: string;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5" data-check={props.id} data-ok={props.ok}>
      <span aria-hidden className={cn('w-3.5 text-center', props.ok ? 'text-ok' : 'text-warn')}>
        {props.ok ? '✓' : '!'}
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

export function Report(props: { readonly ctx: WizardContext; readonly report: IntakeReport }): JSX.Element {
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
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={(e) => {
                    setPart(ctx, id, e.currentTarget.checked);
                    void reinspect(ctx);
                  }}
                />
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

export function FromStudio(props: { readonly ctx: WizardContext }): JSX.Element | null {
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
          // A character from Studio is an already rigged input: like an imported VRM it continues on ④ once that is
          // reachable (AS-AR-3; the frame's pending step, D7 AR-D7-4); scene meshes stay on ① for their report.
          ctx.ui.set((u) => ({
            ...u,
            fromStudio: null,
            pendingStep: handed.character === null ? u.pendingStep : 'animations',
          }));
          void takeFromStudio(ctx, handed);
        }}
      >
        {m.useThese}
      </button>
    </section>
  );
}

/** The panel's lazy part: the report of the loaded model, then the From Studio card. */
export default function ModelReport(props: {
  readonly ctx: WizardContext;
  readonly report: IntakeReport | null;
}): JSX.Element {
  return (
    <>
      {props.report === null ? null : <Report ctx={props.ctx} report={props.report} />}
      <FromStudio ctx={props.ctx} />
    </>
  );
}
