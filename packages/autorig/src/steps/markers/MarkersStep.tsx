// ② Markers (AUTORIG-SPEC §5.3, §6.1, §8.1–§8.3; D4; the step's lazy view). Everything here is M6b's Quick Rig (C2's
// guess, fit and axis rule; C3's markers tool and marker list) presented differently: over the panes their labels
// (FRONT · drag ↔ ↕, SIDE · depth ↕, 3D · orbit) and, on a phone or a portrait tablet, the pane switch; in the side
// panel M6b's compact marker list (`QuickRigPanelBody`, its own Create Skeleton row hidden: *Auto-rig ▸* replaces it)
// beside a body pictogram, the selected marker's coordinates, the fingers choice (Mixamo's skeleton detail:
// `skel.quickRig.setPreset`), the symmetry line and Auto-Rig's notices (the A-pose one, the non-humanoid one). The
// footer's primary *Auto-rig ▸* is enabled when `quickRigCommitBlock` is null and runs `autorig.rig` (`../rig/run`).
// While it runs the progress sheet covers the wizard.
import { type EditorApp, QUICK_RIG_LABELS, quickRigCommitBlock, type QuickRigState } from '@ekza-studio/editor-core';
import { buttonClass, cn } from '@ekza-studio/ui';
import { type JSX, lazy, Suspense, useCallback, useEffect } from 'react';
import { formatNumber, messages } from '../../i18n';
import { type FooterState, useAppSession, useSession, type WizardContext } from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import { useSmall } from '../../shell/store';
import type { AutoRigSession } from '../../types';
import { ProgressSheet } from '../rig/ProgressSheet';
import { watchPaintedSinceBind } from '../rig/painted';
import { runAutoRig } from '../rig/run';
import { rigUi } from '../rig/ui';
import { enterMarkers } from './enter';
import { type MarkerPane, markerPanes, type ScreenClass, withPane } from './index';
import { installMarkerKeys } from './keys';
import { PaneLabels, useScreenClass } from './panes';
import { Pictogram } from './Pictogram';
import { markersUi } from './ui';

type Preset = QuickRigState['preset'];
type Marker = NonNullable<QuickRigState['selected']>;

const t = (): ReturnType<typeof messages>['markers'] => messages().markers;
const button = (variant: 'default' | 'primary' | 'ghost' = 'default'): string =>
  cn(buttonClass(variant, 'sm'), 'pointer-coarse:min-h-11');

const QuickRigPanelBody = lazy(() =>
  import('@ekza-studio/editor/bodies').then((module) => ({ default: module.QuickRigPanelBody })),
);

const selectMarkers = (s: AutoRigSession): AutoRigSession['markers'] => s.markers;
const selectBusy = (s: AutoRigSession): boolean => s.busy !== null;
const selectStartPose = (s: AutoRigSession): AutoRigSession['startPose'] => s.startPose;

/** Quick Rig's state (U state in the app session). */
function useQuickRig(app: EditorApp): QuickRigState | null {
  return useAppSession(
    app,
    useCallback((s) => s.rig.quickRig, []),
  );
}

/** §8.3: one pane at a time on a phone (Front │ Side │ 3D), front │ side with a 3D toggle on a portrait tablet. */
function PaneSwitch(props: { readonly ctx: WizardContext; readonly screen: ScreenClass }): JSX.Element | null {
  const { ctx, screen } = props;
  const slice = useSession(ctx.session, selectMarkers);
  if (screen === 'desktop') return null;
  const m = t();
  const choices: readonly (readonly [MarkerPane, string])[] =
    screen === 'phone'
      ? [
          ['front', m.front],
          ['side', m.side],
          ['persp', m.persp],
        ]
      : [
          ['front', `${m.front} │ ${m.side}`],
          ['persp', m.persp],
        ];
  const current: MarkerPane = screen === 'tablet' && slice.pane !== 'persp' ? 'front' : slice.pane;
  return (
    <fieldset
      className="pointer-events-auto absolute right-1 bottom-1 m-0 flex rounded-field border border-line bg-panel/90 p-0"
      aria-label={m.paneSwitch}
      data-testid="ar-markers-pane-switch"
    >
      {choices.map(([pane, label]) => (
        <button
          key={pane}
          type="button"
          className={cn(button(current === pane ? 'primary' : 'ghost'), 'min-w-11')}
          aria-pressed={current === pane}
          data-pane={pane}
          onClick={() => {
            const patch = withPane(ctx.session.getState().markers, pane);
            if (Object.keys(patch).length > 0) ctx.session.patch('markers', patch);
          }}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

function Overlay(props: { readonly ctx: WizardContext }): JSX.Element {
  const screen = useScreenClass();
  const slice = useSession(props.ctx.session, selectMarkers);
  return (
    <>
      <PaneLabels panes={markerPanes(slice, screen)} />
      <PaneSwitch ctx={props.ctx} screen={screen} />
      <ProgressSheet ctx={props.ctx} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the side panel

const FINGERS: readonly (readonly [Preset, () => string])[] = [
  ['core21', () => t().fingersNone],
  ['standard33', () => t().fingersMitten],
  ['full52', () => t().fingersAll],
];

function Fingers(props: { readonly ctx: WizardContext; readonly state: QuickRigState }): JSX.Element {
  const { ctx, state } = props;
  const m = t();
  const locked = state.refit !== null;
  const choose = (preset: Preset): void => {
    if (preset !== state.preset) void ctx.run('skel.quickRig.setPreset', { preset });
  };
  const fingerLabel = (FINGERS.find(([preset]) => preset === state.preset)?.[1] ?? (() => m.fingersMinimal))();
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="ar-fingers-title" data-testid="ar-markers-fingers">
      <h3 id="ar-fingers-title" className="text-[11px] font-semibold tracking-wide text-fg-2 uppercase">
        {m.fingers}
      </h3>
      <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-labelledby="ar-fingers-title">
        {FINGERS.map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            className={button(state.preset === preset ? 'primary' : 'default')}
            aria-pressed={state.preset === preset}
            disabled={locked && state.preset !== preset}
            title={locked ? m.fingersLocked : undefined}
            data-preset={preset}
            onClick={() => choose(preset)}
          >
            {label()}
          </button>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-fg-2">
        <input
          type="checkbox"
          checked={state.preset === 'lite17'}
          disabled={locked}
          title={locked ? m.fingersLocked : undefined}
          data-preset="lite17"
          onChange={(e) => choose(e.currentTarget.checked ? 'lite17' : 'standard33')}
        />
        {m.fingersMinimal}
      </label>
      <p className="text-fg-3" data-testid="ar-markers-joints">
        {m.joints(state.preview?.length ?? 0, fingerLabel)}
      </p>
    </section>
  );
}

const cm = (metres: number): string => formatNumber(metres * 100, { maximumFractionDigits: 1 });

function Notices(props: { readonly ctx: WizardContext; readonly state: QuickRigState }): JSX.Element | null {
  const { state } = props;
  const startPose = useSession(props.ctx.session, selectStartPose);
  const m = t();
  const aPose = state.guess?.aPose === true || startPose?.kind === 'a';
  const rows: { key: string; text: string; tone: 'warn' | 'info' }[] = [];
  if (state.refit !== null) rows.push({ key: 'rerun', text: m.rerun, tone: 'info' });
  if (aPose && state.refit === null) rows.push({ key: 'apose', text: m.aPoseAuto, tone: 'info' });
  if (state.guess?.failed !== null && state.guess?.failed !== undefined) {
    rows.push({ key: 'humanoid', text: m.notHumanoid, tone: 'warn' });
  }
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <p
          key={row.key}
          role="note"
          className={row.tone === 'warn' ? 'text-warn' : 'text-fg-2'}
          data-testid={`ar-markers-notice-${row.key}`}
        >
          {row.text}
        </p>
      ))}
    </div>
  );
}

function Panel(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  const state = useQuickRig(ctx.app);
  const ui = useSmall(markersUi(ctx));
  const m = t();
  if (state === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="ar-markers-panel" data-open="false">
        <p className="text-fg-2" role={ui.error === null ? undefined : 'alert'}>
          {ui.starting ? m.starting : (ui.error ?? m.closed)}
        </p>
        {ui.starting ? null : (
          <button
            type="button"
            className={button()}
            data-testid="ar-markers-reopen"
            onClick={() => void enterMarkers(ctx)}
          >
            {m.reopen}
          </button>
        )}
      </section>
    );
  }
  const selected = state.selected;
  const point = selected === null ? undefined : state.markers[selected];
  const placed = new Set((Object.keys(state.markers) as Marker[]).filter((name) => state.markers[name] !== undefined));
  const selectedName = selected === null ? null : QUICK_RIG_LABELS[selected];
  return (
    <section className="flex flex-col gap-3" data-testid="ar-markers-panel" data-open="true">
      <p className="text-fg-2">{m.intro}</p>
      <Notices ctx={ctx} state={state} />
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Suspense fallback={null}>
            <QuickRigPanelBody app={ctx.app} compact hideCommit />
          </Suspense>
        </div>
        <Pictogram
          selected={selected}
          placed={placed}
          label={selectedName === null ? m.pictogramNone : `${m.pictogram}: ${selectedName}`}
        />
      </div>
      {selected !== null && point !== undefined ? (
        <p className="text-fg-2 tabular-nums" data-testid="ar-markers-selected">
          {m.selectedAt(selectedName ?? selected, cm(point[0]), cm(point[1]), cm(point[2]))}
        </p>
      ) : null}
      <Fingers ctx={ctx} state={state} />
      <p className="text-fg-3" data-testid="ar-markers-symmetry">
        ↔ {m.symmetry}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// the footer and the keys

function useMarkersFooter(ctx: WizardContext): void {
  const state = useQuickRig(ctx.app);
  const busy = useSession(ctx.session, selectBusy);
  const ui = useSmall(markersUi(ctx));
  const rig = useSmall(rigUi(ctx));
  useEffect(() => {
    const m = t();
    const block = state === null ? (ui.error ?? m.closed) : quickRigCommitBlock(state);
    const selectedLabel =
      state?.selected === null || state?.selected === undefined ? null : QUICK_RIG_LABELS[state.selected];
    const footer: FooterState = {
      status: rig.error ?? block ?? (selectedLabel === null ? m.hint : m.hintSelected(selectedLabel)),
      tone: rig.error !== null ? 'error' : block !== null ? 'warning' : 'info',
      primary: {
        label: m.autoRig,
        disabled: busy || state === null || block !== null,
        run: () => runAutoRig(ctx),
      },
    };
    ctx.setFooter(footer);
  }, [ctx, state, busy, ui.error, rig.error]);
}

function PanelWithFooter(props: { readonly ctx: WizardContext }): JSX.Element {
  const { ctx } = props;
  useMarkersFooter(ctx);
  useEffect(() => installMarkerKeys(ctx), [ctx]);
  useEffect(() => watchPaintedSinceBind(ctx.app, ctx.session), [ctx]);
  return <Panel ctx={ctx} />;
}

export default function MarkersStep(props: StepViewProps): JSX.Element {
  const { ctx, slot } = props;
  if (slot === 'overlay') return <Overlay ctx={ctx} />;
  return <PanelWithFooter ctx={ctx} />;
}
