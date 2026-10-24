// The View sheet (STUDIO-TOUCH-SPEC §4.7, §15 rows 1.3–1.12, 1.16, 5.12, 5.13, 5.17, §16.4, §18; T6b): the View puck's
// long-press sheet over `./model`. Look and Show are the only Halo controls that write the pane display memory; the
// rest are Panes (wide containers), Cameras, Pick only…, the manipulator, Hide UI and Full screen. A flag whose state
// cannot be read is a plain action chip, never a toggle drawn off (P13).

import { useHostUi } from '@ekza-studio/editor/host';
import { ActionChip, Glyph, Segmented, ToggleChip, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import type { PaneState, ViewportManager } from '@ekza-studio/viewport';
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { FieldRow, HaloSheet, NumberControl, SheetGroup, useAppVersion } from '../more/kit';
import {
  type OperatorCall,
  type PaneSnapshot,
  targetPane,
  VIEW_PANE,
  type ViewAction,
  type ViewChoice,
  type ViewNumber,
  type ViewSectionId,
  type ViewToggle,
  viewModel,
} from './model';

const SECTION_TITLE: Readonly<Record<ViewSectionId, string>> = {
  look: 'Look',
  show: 'Show',
  panes: 'Panes',
  cameras: 'Cameras',
  selection: 'Pick only…',
  manipulator: 'Move and turn rings',
  hideUi: 'Hide UI',
  fullScreen: 'Full screen',
};

/** The pane's state from the viewport (re-read when its panes change), or null without a viewport. */
function usePane(vm: ViewportManager | null, paneId: string): PaneState | null {
  const subscribe = useCallback(
    (notify: () => void) => (vm === null ? () => undefined : vm.subscribePanes(notify)),
    [vm],
  );
  const get = useCallback(() => vm?.paneState(paneId) ?? null, [vm, paneId]);
  return useSyncExternalStore(subscribe, get, get);
}

const snapshotOf = (state: PaneState | null): PaneSnapshot | null =>
  state === null
    ? null
    : {
        display: state.display,
        cameraKind: state.cameraKind,
        preset: state.preset,
        shotCameraId: state.shotCameraId,
      };

function Section(props: {
  readonly id: ViewSectionId;
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}): JSX.Element {
  return (
    <section data-section={props.id} aria-label={SECTION_TITLE[props.id]} data-testid={`halo-view-section-${props.id}`}>
      <SheetGroup>{SECTION_TITLE[props.id]}</SheetGroup>
      {props.hint === undefined ? null : <p className="px-2.5 pb-1 text-touch-label text-fg-3">{props.hint}</p>}
      {props.children}
    </section>
  );
}

const Reason = (props: { readonly reason: string | null }): JSX.Element | null =>
  props.reason === null ? null : <span className="px-1 text-touch-label text-fg-3">{props.reason}</span>;

/** A choice of one: segments when its value is known, else one action chip per option. */
function ChoiceControl<V extends string>(props: {
  readonly choice: ViewChoice<V>;
  readonly onCall: (call: OperatorCall) => void;
  readonly testId: string;
}): JSX.Element {
  const { choice } = props;
  const value = choice.value;
  return (
    <span className="flex flex-col items-start gap-1">
      {value !== null && choice.options.some((option) => option.value === value) ? (
        <Segmented<V>
          label={choice.label}
          value={value}
          onValueChange={(next) => {
            const option = choice.options.find((each) => each.value === next);
            if (option !== undefined) props.onCall(option.call);
          }}
          items={choice.options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(choice.reason === null ? {} : { disabled: true }),
          }))}
          data-testid={props.testId}
        />
      ) : (
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0" data-testid={props.testId}>
          <legend className="sr-only">{choice.label}</legend>
          {choice.options.map((option) => (
            <ActionChip
              key={option.value}
              disabled={choice.reason !== null}
              onClick={() => props.onCall(option.call)}
              data-testid={`${props.testId}-${option.value}`}
            >
              {option.label}
            </ActionChip>
          ))}
        </fieldset>
      )}
      <Reason reason={choice.reason} />
    </span>
  );
}

/** An on/off flag: a toggle chip when its state is known, else an action chip that switches it. */
function ToggleControl(props: {
  readonly toggle: ViewToggle;
  readonly onCall: (call: OperatorCall) => void;
  readonly testId: string;
}): JSX.Element {
  const { toggle } = props;
  const title = toggle.pro === null ? undefined : `Studio Pro: ${toggle.pro}`;
  return (
    <span className="inline-flex flex-col gap-0.5">
      {toggle.on === null ? (
        <ActionChip
          aria-label={`Switch ${toggle.label}`}
          disabled={toggle.reason !== null}
          title={title}
          onClick={() => props.onCall(toggle.call)}
          data-testid={props.testId}
        >
          {toggle.label} ⇄
        </ActionChip>
      ) : (
        <ToggleChip
          label={toggle.label}
          pressed={toggle.on}
          disabled={toggle.reason !== null}
          title={title}
          onPressedChange={() => props.onCall(toggle.call)}
          data-testid={props.testId}
        />
      )}
      <Reason reason={toggle.reason} />
    </span>
  );
}

function ActionControl(props: {
  readonly action: ViewAction;
  readonly onCall: (call: OperatorCall) => void;
  readonly testId: string;
}): JSX.Element {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <ActionChip
        disabled={props.action.reason !== null}
        title={props.action.pro === null ? undefined : `Studio Pro: ${props.action.pro}`}
        onClick={() => props.onCall(props.action.call)}
        data-testid={props.testId}
      >
        {props.action.label}
      </ActionChip>
      <Reason reason={props.action.reason} />
    </span>
  );
}

function NumberField(props: {
  readonly number: ViewNumber;
  readonly onCall: (call: OperatorCall) => void;
  readonly testId: string;
}): JSX.Element {
  const { number } = props;
  return (
    <FieldRow label={number.label} pro={number.pro ?? undefined} testId={`${props.testId}-row`}>
      <NumberControl
        label={number.label}
        value={number.value}
        step={number.step}
        min={number.min}
        max={number.max}
        {...(number.unit === undefined ? {} : { unit: number.unit })}
        {...(number.pro === null ? {} : { proName: number.pro })}
        disabled={number.reason !== null}
        onCommit={(value) => props.onCall(number.write(value))}
        testId={props.testId}
      />
    </FieldRow>
  );
}

const Chips = (props: { readonly children: ReactNode }): JSX.Element => (
  <div className="flex flex-wrap gap-2 px-2.5 py-1">{props.children}</div>
);

const Pro = (props: { readonly children: ReactNode }): JSX.Element => (
  <p className="px-2.5 pt-1 text-touch-label text-fg-3">{props.children}</p>
);

export default function ViewSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const vm = useHostUi((s) => s.viewport);
  const paneId = targetPane(app, VIEW_PANE);
  const paneState = usePane(vm, paneId);
  const [moreDisplay, setMoreDisplay] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const model = viewModel(app, {
    paneId,
    pane: snapshotOf(paneState),
    wide: ctx.side === 'right',
    hideUi: ctx.hideUi !== undefined,
  });
  const call = (one: OperatorCall): void => {
    void ctx.run(one.op, one.args);
  };

  // Open on a section (`args.section`): scroll it into view once.
  const section = args?.section;
  useEffect(() => {
    if (section === undefined) return;
    const element = body.current?.querySelector(`[data-section="${section}"]`);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'start' });
  }, [section]);

  const { look, show, panes, cameras, manipulator } = model;
  return (
    <HaloSheet ctx={ctx} id="view" title="View" description="How the canvas looks, and where you look from">
      <div ref={body} className="flex flex-col gap-1">
        <Section id="look">
          <Chips>
            <ChoiceControl choice={look} onCall={call} testId="halo-view-look" />
          </Chips>
          <Pro>Studio Pro: Shading · Wireframe, Shaded, Colours, Lit</Pro>
        </Section>

        <Section id="show">
          <Chips>
            {show.essentials.map((toggle) => (
              <ToggleControl key={toggle.id} toggle={toggle} onCall={call} testId={`halo-view-show-${toggle.id}`} />
            ))}
            <ToggleControl toggle={show.secondary} onCall={call} testId="halo-view-secondary" />
          </Chips>
          <FieldRow label="Hide controls while rigging" pro="Hide Rig Controls" testId="halo-view-rig-controls">
            <span className="flex gap-2">
              <ActionControl action={show.rigControls.hide} onCall={call} testId="halo-view-rig-controls-hide" />
              <ActionControl action={show.rigControls.show} onCall={call} testId="halo-view-rig-controls-show" />
            </span>
          </FieldRow>
          <NumberField number={show.joints.size} onCall={call} testId="halo-view-joint-size" />
          <Chips>
            <ToggleControl toggle={show.joints.throughMesh} onCall={call} testId="halo-view-joints-through" />
          </Chips>
          <FieldRow label={show.joints.axes.label} pro={show.joints.axes.pro ?? undefined}>
            <ChoiceControl choice={show.joints.axes} onCall={call} testId="halo-view-joint-axes" />
          </FieldRow>
          <FieldRow label={show.joints.labels.label} pro={show.joints.labels.pro ?? undefined}>
            <ChoiceControl choice={show.joints.labels} onCall={call} testId="halo-view-joint-labels" />
          </FieldRow>
          <TouchButton
            variant="ghost"
            aria-expanded={moreDisplay}
            onClick={() => setMoreDisplay((open) => !open)}
            data-testid="halo-view-more-display"
          >
            More display {moreDisplay ? '▴' : '▾'}
          </TouchButton>
          {moreDisplay ? (
            <div data-testid="halo-view-more-display-list">
              <Chips>
                {show.more.map((toggle) => (
                  <ToggleControl key={toggle.id} toggle={toggle} onCall={call} testId={`halo-view-show-${toggle.id}`} />
                ))}
              </Chips>
              <FieldRow label={show.normals.label}>
                <ChoiceControl choice={show.normals} onCall={call} testId="halo-view-normals" />
              </FieldRow>
              <FieldRow label={show.weights.label} pro={show.weights.pro ?? undefined}>
                <ChoiceControl choice={show.weights} onCall={call} testId="halo-view-weights" />
              </FieldRow>
            </div>
          ) : null}
        </Section>

        <Section id="panes">
          {panes.shown ? (
            <>
              <Chips>
                <ChoiceControl choice={panes.layout} onCall={call} testId="halo-view-panes" />
                {panes.maximize === null ? null : (
                  <ToggleControl toggle={panes.maximize} onCall={call} testId="halo-view-maximize" />
                )}
              </Chips>
              {panes.other === null ? null : <Pro>Now: the rig dots layout ({panes.other})</Pro>}
              <Pro>Studio Pro: Viewport Layout · Single, Split, Quad</Pro>
            </>
          ) : (
            <p className="px-2.5 py-2 text-fg-3">More panes need a wider screen: one pane here.</p>
          )}
        </Section>

        <Section id="cameras">
          <Chips>
            <ChoiceControl choice={cameras.views} onCall={call} testId="halo-view-camera-views" />
          </Chips>
          {cameras.shots.map((shot) => (
            <div key={shot.id} className="flex flex-col gap-1 py-1" data-testid={`halo-view-shot-${shot.id}`}>
              <FieldRow
                label={shot.name}
                pro={shot.looking === true ? 'Shot camera · looking through it' : 'Shot camera'}
              >
                <ToggleControl toggle={shot.lock} onCall={call} testId={`halo-view-shot-${shot.id}-lock`} />
              </FieldRow>
              <Chips>
                <ActionControl action={shot.lookThrough} onCall={call} testId={`halo-view-shot-${shot.id}-look`} />
                <ActionControl action={shot.copyView} onCall={call} testId={`halo-view-shot-${shot.id}-copy`} />
              </Chips>
              {shot.lens === null ? null : (
                <NumberField number={shot.lens} onCall={call} testId={`halo-view-shot-${shot.id}-lens`} />
              )}
            </div>
          ))}
          {cameras.add === null ? null : (
            <Chips>
              <ActionControl action={cameras.add} onCall={call} testId="halo-view-add-shot" />
            </Chips>
          )}
        </Section>

        <Section id="selection" hint="What a tap on the canvas can pick.">
          <Chips>
            {model.selection.map((toggle) => (
              <ToggleControl key={toggle.id} toggle={toggle} onCall={call} testId={`halo-view-pick-${toggle.id}`} />
            ))}
          </Chips>
          <Pro>Studio Pro: Selection Mask</Pro>
        </Section>

        <Section id="manipulator">
          <FieldRow label="Handle size" pro="Manipulator Size" testId="halo-view-manip-size">
            <span className="flex items-center gap-2">
              <TouchIconButton
                label={`${manipulator.smaller.label} handles`}
                icon={<Glyph name="minus" />}
                disabled={manipulator.smaller.reason !== null}
                onClick={() => call(manipulator.smaller.call)}
                data-testid="halo-view-manip-smaller"
              />
              <span className="min-w-14 text-center font-mono tabular-nums text-fg" aria-live="polite">
                {manipulator.size} px
              </span>
              <TouchIconButton
                label={`${manipulator.larger.label} handles`}
                icon={<Glyph name="plus" />}
                disabled={manipulator.larger.reason !== null}
                onClick={() => call(manipulator.larger.call)}
                data-testid="halo-view-manip-larger"
              />
            </span>
          </FieldRow>
          <FieldRow label={manipulator.move.label} pro={manipulator.move.pro ?? undefined}>
            <ChoiceControl choice={manipulator.move} onCall={call} testId="halo-view-move-space" />
          </FieldRow>
          <FieldRow label={manipulator.turn.label} pro={manipulator.turn.pro ?? undefined}>
            <ChoiceControl choice={manipulator.turn} onCall={call} testId="halo-view-turn-space" />
          </FieldRow>
        </Section>

        {model.hideUi ? (
          <Section id="hideUi">
            <Chips>
              <TouchButton
                onClick={() => {
                  ctx.hideUi?.();
                  ctx.close();
                }}
                data-testid="halo-view-hide-ui"
              >
                Hide UI
              </TouchButton>
            </Chips>
            <Pro>Only the canvas stays, with a faint button to bring the rest back.</Pro>
          </Section>
        ) : null}

        <Section id="fullScreen">
          <Chips>
            <TouchButton
              disabled={model.fullScreen.reason !== null}
              onClick={() => call(model.fullScreen.call)}
              data-testid="halo-view-full-screen"
            >
              {model.fullScreen.label}
            </TouchButton>
          </Chips>
          <Reason reason={model.fullScreen.reason} />
        </Section>
      </div>
    </HaloSheet>
  );
}
