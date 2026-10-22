// ③ Rig (AUTORIG-SPEC §5.4, §6.1, §8.1–§8.3; D4; the step's lazy view). The side panel has three sub-tools:
//
// - **Review** (default after rigging): CHECK IT — the motion test (Walk, Sword, Dance through C12's library preview,
//   restarted after every committed change while it is on; with reduced motion only on *Play*), FIX — *Adjust joints*,
//   *Paint weights* and *Show weights* (C6's greyscale display: review then works in Skin mode with the Select tool), and the C7 Validation summary of the
//   `skel.*` / `skin.*` / `xform.*` rows with their Fix buttons (an error blocks *Animations ▸*; warnings are listed).
//   A `skel.tpose` row on a T-posed input (not straightened, §4.5) offers *Adjust joints* first and *Straighten to
//   T-Pose* as the secondary Fix.
// - **Adjust joints**: front │ side │ persp, Skeleton mode with the M6b joint tools (`W`, `D`+`W`, `E`), *Go to Bind
//   Pose*, the selected joint's position in centimetres; *Done* turns each hand with its forearm when an elbow or a
//   wrist moved (`hands.ts`, AR-D7-16) and reruns Bind Skin when the joints changed — with the
//   stored arguments and no question (`confirm: true`) unless a weight edit ran since the last bind
//   (`rig.paintedSinceBind`), then plain `skin.bind`, whose "Rebind replaces painted weights" question the host's dialog
//   asks.
// - **Paint weights**: Skin mode with C6's Paint Skin Weights tool and its reduced controls (`PaintWeightsControls`
//   compact); a phone shows "Painting needs a larger screen" (§8.3).
//
// A character whose meshes are not bound yet (the bind was cancelled from the sheet) shows "Skeleton created; skinning
// cancelled — [Bind again]". *Back* (the frame's) goes to ② and starts M6b's re-run.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { autoRigBindMeshes, type RigValidationRow } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { prefersReducedMotion } from '../../a11y';
import { formatNumber, messages } from '../../i18n';
import { AUTORIG_PROFILE, resolveSubject } from '../../progress';
import {
  type FooterState,
  useAppSession,
  useDocument,
  useProgress,
  useSession,
  type WizardContext,
} from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import { useSmall } from '../../shell/store';
import type { AutoRigSession } from '../../types';
import { PaneLabels, useScreenClass } from '../markers/panes';
import { rigPanes } from './index';
import { armSnapshot, characterJoints, handsFollowForearms } from './hands';
import { applySubMode, setWeightDisplay } from './mode';
import { MOTION_CLIPS, type RigSub, withMotionClip, withSub } from './slice';
import { installRigKeys } from './keys';
import { useMotionTest, usePreview } from './motion';
import { watchPaintedSinceBind } from './painted';
import { ProgressSheet } from './ProgressSheet';
import { rebind, wantsStraighten } from './run';
import { useHiddenControls } from '../markers/controls';
import { useHiddenParts } from '../model/hiddenParts';
import { rigUi } from './ui';
import './strings';

const t = (): ReturnType<typeof messages>['rig'] => messages().rig;
const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'sm'), 'pointer-coarse:min-h-11');
const heading = 'text-[11px] font-semibold tracking-wide text-fg-2 uppercase';

const PaintWeightsControls = lazy(() =>
  import('@ekza-studio/editor/bodies').then((module) => ({ default: module.PaintWeightsControls })),
);

const selectRig = (s: AutoRigSession): AutoRigSession['rig'] => s.rig;
const selectSubject = (s: AutoRigSession): AutoRigSession['subject'] => s.subject;
const selectBusy = (s: AutoRigSession): boolean => s.busy !== null;
const selectMarkersSlice = (s: AutoRigSession): AutoRigSession['markers'] => s.markers;
const selectStartPose = (s: AutoRigSession): AutoRigSession['startPose'] => s.startPose;
const selectPanes = (s: AutoRigSession): string => `${s.rig.sub}|${s.markers.pane}|${s.markers.lastOrtho}`;

/** The live subject character of the wizard (a model character), and whether every one of its meshes is bound. */
function useCharacter(ctx: WizardContext): { readonly id: CharacterId | null; readonly bound: boolean } {
  const subject = useSession(ctx.session, selectSubject);
  const id = useDocument(ctx.app, () => {
    const character = resolveSubject(ctx.app.store, subject).character;
    return character?.source.kind === 'model' ? character.id : null;
  });
  const bound = useDocument(ctx.app, () => {
    if (id === null) return false;
    const meshes = ctx.app.store.query.meshesOfOwner(id).filter((mesh) => mesh.deleted === null);
    return meshes.length > 0 && meshes.every((mesh) => mesh.skin !== null && 'skeleton' in mesh.skin);
  });
  return { id, bound };
}

/** Switches the sub-tool: the slice, then the rig mode it works in (U state). */
async function setSub(ctx: WizardContext, sub: RigSub): Promise<void> {
  const { app } = ctx;
  if (sub === 'adjust') {
    const character = resolveSubject(app.store, ctx.session.getState().subject).character;
    const adjustArms = character === null ? null : armSnapshot(characterJoints(app, character.id));
    rigUi(ctx).set((current) => ({ ...current, adjustFrom: app.history.peekUndo()?.id ?? null, adjustArms }));
  }
  const patch = withSub(ctx.session.getState().rig, sub);
  if (Object.keys(patch).length > 0) ctx.session.patch('rig', patch);
  await applySubMode(ctx);
}

// ---------------------------------------------------------------------------------------------------------------------
// over the panes

function Overlay(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  useSession(ctx.session, selectPanes);
  const screen = useScreenClass();
  const sub = useSession(ctx.session, selectRig).sub;
  const panes = rigPanes(ctx.session.getState(), typeof window === 'undefined' ? 1440 : window.innerWidth);
  return (
    <>
      {sub === 'adjust' && screen !== 'phone' ? <PaneLabels panes={panes} /> : null}
      <ProgressSheet ctx={ctx} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// review

const CLIP_LABEL: Readonly<Record<(typeof MOTION_CLIPS)[number], () => string>> = {
  walk: () => t().clipWalk,
  'sword-attack': () => t().clipSword,
  dance: () => t().clipDance,
};

function MotionTest(props: {
  readonly ctx: WizardContext;
  readonly character: CharacterId | null;
  readonly ready: boolean;
}): JSX.Element {
  const { ctx, character, ready } = props;
  const rig = useSession(ctx.session, selectRig);
  const busy = useSession(ctx.session, selectBusy);
  const [reduced] = useState(prefersReducedMotion);
  const [played, setPlayed] = useState(false);
  const active = ready && !busy && rig.sub === 'review' && rig.motionTest && (!reduced || played);
  const error = useMotionTest(ctx.app, active, rig.motionClip, character);
  const preview = usePreview(ctx.app);
  const playing = preview !== null && preview.character === character;
  const r = t();
  const toggle = useCallback(() => {
    const current = ctx.session.getState().rig;
    if (reduced && !played) {
      setPlayed(true);
      if (!current.motionTest) ctx.session.patch('rig', { motionTest: true });
      return;
    }
    ctx.session.patch('rig', { motionTest: !current.motionTest });
  }, [ctx, reduced, played]);
  useEffect(() => installRigKeys(ctx, toggle), [ctx, toggle]);
  const on = rig.motionTest && (!reduced || played);
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="ar-rig-check" data-testid="ar-rig-motion">
      <h3 id="ar-rig-check" className={heading}>
        {r.checkIt}
      </h3>
      <div className="flex items-center gap-2">
        <span>{r.motionTest}</span>
        <button
          type="button"
          className={button(on ? 'primary' : 'default')}
          aria-pressed={on}
          disabled={!ready}
          data-testid="ar-rig-motion-toggle"
          data-playing={playing}
          onClick={toggle}
        >
          {reduced && !played ? r.playMotion : on ? `▶ ${r.motionOn}` : `■ ${r.motionOff}`}
        </button>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-label={r.motionTest}>
        {MOTION_CLIPS.map((clip) => (
          <button
            key={clip}
            type="button"
            className={button(rig.motionClip === clip && on ? 'primary' : 'default')}
            aria-pressed={rig.motionClip === clip && on}
            disabled={!ready}
            data-clip={clip}
            onClick={() => {
              if (reduced) setPlayed(true);
              const patch = withMotionClip(ctx.session.getState().rig, clip);
              if (Object.keys(patch).length > 0) ctx.session.patch('rig', patch);
            }}
          >
            {CLIP_LABEL[clip]()}
          </button>
        ))}
      </fieldset>
      {error === null ? null : (
        <output className="text-warn" data-testid="ar-rig-motion-error">
          {error}
        </output>
      )}
    </section>
  );
}

/** *Show weights* (§5.4): C6's greyscale display in review too (Skin mode with the Select tool while on). */
function ShowWeights(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const on = useSmall(rigUi(ctx), (ui) => ui.showWeights);
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={on}
        data-testid="ar-rig-show-weights"
        onChange={() => {
          rigUi(ctx).set((current) => ({ ...current, showWeights: !on }));
          if (on) setWeightDisplay(ctx, false);
          void applySubMode(ctx);
        }}
      />
      {t().showWeights}
    </label>
  );
}

function Fix(props: { readonly ctx: WizardContext; readonly ready: boolean }): JSX.Element {
  const { ctx, ready } = props;
  const r = t();
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="ar-rig-fix">
      <h3 id="ar-rig-fix" className={heading}>
        {r.fix}
      </h3>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={button()}
          disabled={!ready}
          data-testid="ar-rig-adjust"
          onClick={() => void setSub(ctx, 'adjust')}
        >
          {r.adjust}
        </button>
        <button
          type="button"
          className={button()}
          disabled={!ready}
          data-testid="ar-rig-paint"
          onClick={() => void setSub(ctx, 'paint')}
        >
          {r.paint}
        </button>
      </div>
      <ShowWeights ctx={ctx} />
    </section>
  );
}

const FAMILIES = /^(skel|skin|xform)\./;

/** The C7 Validation summary of the subject (§5.4's last row): errors block *Animations ▸*, warnings are listed. */
function Validation(props: { readonly ctx: WizardContext; readonly character: CharacterId | null }): JSX.Element {
  const { ctx, character } = props;
  const startPose = useSession(ctx.session, selectStartPose);
  const r = t();
  const rows = useDocument(ctx.app, () => {
    if (character === null || !ctx.app.rig.loaded) return null;
    try {
      return ctx.app.rig.validation.rows(character, AUTORIG_PROFILE);
    } catch {
      return null;
    }
  });
  if (rows === null) {
    return (
      <p className="text-fg-3" data-testid="ar-rig-validation" data-state="checking">
        {r.checking}
      </p>
    );
  }
  const relevant = rows.filter((row) => FAMILIES.test(row.code));
  const errors = relevant.filter((row) => row.severity === 'error');
  const warnings = relevant.filter((row) => row.severity === 'warning');
  const runFix = (row: RigValidationRow): void => {
    if (row.fix !== null) void ctx.run(row.fix.op, row.fix.args);
  };
  const offLine = (row: RigValidationRow): boolean => row.code === 'skel.tpose' && startPose?.kind !== 'a';
  return (
    <section
      className="flex flex-col gap-1.5 border-t border-line pt-2"
      aria-label="Validation"
      data-testid="ar-rig-validation"
      data-state={errors.length === 0 ? 'ok' : 'errors'}
    >
      {errors.length === 0 ? (
        <p className="text-fg" data-testid="ar-rig-all-good">
          <span aria-hidden>✓ </span>
          {r.allGood}
        </p>
      ) : null}
      {errors.map((row) => (
        <div key={`${row.code}:${row.ids.join(',')}`} className="flex flex-col gap-1" data-row={row.code} role="alert">
          <p className="text-danger">{offLine(row) ? r.offLine : row.message}</p>
          <div className="flex flex-wrap gap-1">
            {offLine(row) ? (
              <button
                type="button"
                className={button('primary')}
                data-testid="ar-rig-row-adjust"
                onClick={() => void setSub(ctx, 'adjust')}
              >
                {r.adjust}
              </button>
            ) : null}
            {row.code === 'skin.limb-unweighted' ? (
              <button
                type="button"
                className={button('primary')}
                data-testid="ar-rig-row-markers"
                onClick={() => ctx.go('markers')}
              >
                {r.markersAgain}
              </button>
            ) : null}
            {row.fix === null ? null : (
              <button
                type="button"
                className={button(offLine(row) ? 'default' : 'primary')}
                data-testid={`ar-rig-row-fix-${row.code}`}
                onClick={() => runFix(row)}
              >
                {row.fix.label}
              </button>
            )}
          </div>
        </div>
      ))}
      {warnings.length === 0 ? null : (
        <details data-testid="ar-rig-warnings">
          <summary className="cursor-pointer text-warn">
            {r.warnings} ({warnings.length})
          </summary>
          <ul className="flex flex-col gap-0.5 text-fg-2">
            {warnings.map((row) => (
              <li key={`${row.code}:${row.ids.join(',')}`} data-row={row.code}>
                {row.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// adjust and paint

const cm = (metres: number): string => formatNumber(metres * 100, { maximumFractionDigits: 1 });

function Adjust(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const { app } = ctx;
  const r = t();
  const startPose = useSession(ctx.session, selectStartPose);
  const ui = useSmall(rigUi(ctx));
  const lead = useAppSession(
    app,
    useCallback((s) => s.selection.joints.at(-1) ?? null, []),
  );
  const joint = useDocument(app, () => (lead === null ? null : (app.store.get('joints', lead) ?? null)));
  const done = async (): Promise<void> => {
    const { adjustFrom: from, adjustArms: arms } = rigUi(ctx).get();
    const changed = (app.history.peekUndo()?.id ?? null) !== from;
    if (changed) {
      const painted = ctx.session.getState().rig.paintedSinceBind;
      // the hands follow their forearms (AR-D7-16), then the rebind; painted weights keep the hands where they are
      const character = resolveSubject(app.store, ctx.session.getState().subject).character;
      if (!painted && arms !== null && character !== null) {
        rigUi(ctx).set((current) => ({ ...current, rebinding: true }));
        try {
          await handsFollowForearms(app, character.id, arms);
        } finally {
          rigUi(ctx).set((current) => ({ ...current, rebinding: false }));
        }
      }
      await rebind(ctx, { confirm: !painted });
    }
    rigUi(ctx).set((current) => ({ ...current, adjustFrom: null, adjustArms: null }));
    await setSub(ctx, 'review');
  };
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ar-rig-adjust-title" data-testid="ar-rig-adjust-panel">
      <h3 id="ar-rig-adjust-title" className="font-semibold">
        {r.adjustTitle}
      </h3>
      <p className="text-fg-2">{r.adjustHelp}</p>
      <button
        type="button"
        className={button()}
        data-testid="ar-rig-bind-pose"
        onClick={() => void ctx.run('rig.pose.view', { view: 'bind' })}
      >
        {r.bindPose}
      </button>
      <p className="text-fg-2 tabular-nums" data-testid="ar-rig-joint">
        {joint === null
          ? r.noJoint
          : r.jointAt(joint.name, cm(joint.restPosition[0]), cm(joint.restPosition[1]), cm(joint.restPosition[2]))}
      </p>
      {startPose?.kind === 'a' ? <p className="text-fg-3">{r.straightened}</p> : null}
      <button
        type="button"
        className={button('primary')}
        disabled={ui.rebinding}
        data-testid="ar-rig-done"
        onClick={() => void done()}
      >
        {ui.rebinding ? r.rebinding : r.done}
      </button>
    </section>
  );
}

function Paint(props: { readonly ctx: WizardContext; readonly meshes: readonly MeshId[] }): JSX.Element {
  const { ctx } = props;
  const r = t();
  const screen = useScreenClass();
  const back = (
    <button
      type="button"
      className={button('primary')}
      data-testid="ar-rig-done"
      onClick={() => void setSub(ctx, 'review')}
    >
      {r.done}
    </button>
  );
  if (screen === 'phone') {
    return (
      <section className="flex flex-col gap-2" data-testid="ar-rig-paint-panel" data-phone="true">
        <p className="text-fg-2" role="note" data-testid="ar-rig-paint-phone">
          {r.paintPhone}
        </p>
        {back}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ar-rig-paint-title" data-testid="ar-rig-paint-panel">
      <h3 id="ar-rig-paint-title" className="font-semibold">
        {r.paintTitle}
      </h3>
      <p className="text-fg-2">{r.paintHelp}</p>
      <Suspense fallback={null}>
        <PaintWeightsControls app={ctx.app} meshes={props.meshes} compact />
      </Suspense>
      {back}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the panel and the footer

function Unbound(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const ui = useSmall(rigUi(ctx));
  const r = t();
  return (
    <section className="flex flex-col gap-2" data-testid="ar-rig-unbound">
      <output className="text-warn" data-testid="ar-rig-unbound-text">
        {ui.notice === 'cancelled' ? r.cancelled : r.notBound}
      </output>
      <button
        type="button"
        className={button('primary')}
        disabled={ui.rebinding}
        data-testid="ar-rig-bind-again"
        onClick={() =>
          void rebind(ctx, { confirm: false, straighten: wantsStraighten(ctx.app, ctx.session.getState()) })
        }
      >
        {r.bindAgain}
      </button>
    </section>
  );
}

function Panel(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const rig = useSession(ctx.session, selectRig);
  const busy = useSession(ctx.session, selectBusy);
  const { id, bound } = useCharacter(ctx);
  const meshes = useDocument(ctx.app, () => (id === null ? [] : autoRigBindMeshes(ctx.app, id)));
  const r = t();
  if (busy) {
    return (
      <p className="text-fg-2" data-testid="ar-rig-panel" data-sub="busy">
        {r.hintRigging}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="ar-rig-panel" data-sub={rig.sub}>
      {id !== null && !bound ? <Unbound ctx={ctx} /> : null}
      {rig.sub === 'review' ? (
        <>
          <MotionTest ctx={ctx} character={id} ready={bound} />
          <Fix ctx={ctx} ready={bound} />
        </>
      ) : rig.sub === 'adjust' ? (
        <Adjust ctx={ctx} />
      ) : (
        <Paint ctx={ctx} meshes={meshes} />
      )}
      <Validation ctx={ctx} character={id} />
    </div>
  );
}

function useRigFooter(ctx: WizardContext): void {
  const rig = useSession(ctx.session, selectRig);
  const busy = useSession(ctx.session, selectBusy);
  const ui = useSmall(rigUi(ctx));
  const progress = useProgress(ctx);
  useEffect(() => {
    const r = t();
    const f = messages().frame;
    const blocked = progress.reachable.animations ? null : (progress.blocked.animations ?? null);
    const hint = rig.sub === 'adjust' ? r.hintAdjust : rig.sub === 'paint' ? r.hintPaint : r.hint;
    const footer: FooterState = {
      status: busy ? r.hintRigging : (ui.error ?? blocked ?? hint),
      tone: ui.error !== null ? 'error' : blocked !== null ? 'warning' : 'info',
      primary: {
        label: f.next(f.stepAnimations),
        disabled: busy || !progress.reachable.animations,
        run: () => ctx.go('animations'),
      },
    };
    ctx.setFooter(footer);
  }, [ctx, rig.sub, busy, ui.error, progress]);
}

/**
 * Frames ③'s review pane on the character once per character (AR-D8-9): the persp pane keeps the camera it had as
 * ②'s narrow third, so the character stood small in the wide review pane. After the layout settled (two frames).
 */
function useFrameOnce(ctx: WizardContext): void {
  const rig = useSession(ctx.session, selectRig);
  const busy = useSession(ctx.session, selectBusy);
  const character = useDocument(
    ctx.app,
    () => resolveSubject(ctx.app.store, ctx.session.getState().subject).character?.id ?? null,
  );
  useEffect(() => {
    if (rig.sub !== 'review' || busy || character === null || rigUi(ctx).get().framedFor === character) return;
    let handle = requestAnimationFrame(() => {
      handle = requestAnimationFrame(() => {
        rigUi(ctx).set((current) => ({ ...current, framedFor: character }));
        void ctx.app.runUntyped('view.frame', { what: 'all', paneId: 'pane-persp' });
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [ctx, rig.sub, busy, character]);
}

function PanelWithFooter(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  useRigFooter(ctx);
  useFrameOnce(ctx);
  const rig = useSession(ctx.session, selectRig);
  const markers = useSession(ctx.session, selectMarkersSlice);
  // A clean character while the deformation is judged (AR-D9-8): no IK rings, root arrows or pole targets on any of
  // ③'s sub-steps (AR-D8-4 hid them in *Adjust joints* only); Studio keeps its own pane flags.
  useHiddenControls(ctx, true, `${rig.sub}:${markers.pane}`);
  useHiddenParts(ctx);
  useEffect(() => watchPaintedSinceBind(ctx.app, ctx.session), [ctx]);
  return <Panel ctx={ctx} />;
}

export default function RigStep(props: StepViewProps): JSX.Element {
  const { ctx, slot } = props;
  if (slot === 'overlay') return <Overlay ctx={ctx} />;
  return <PanelWithFooter ctx={ctx} />;
}
