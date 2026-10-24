// Health (STUDIO-TOUCH-SPEC §7.2, §7.3, §12.1, §6.2 "Health dot"; T6b): every readiness row of the destination, by
// stage, each with Fix, Show me and Why? (the rule id and the profile one layer down, in grey); the glyph legend at the
// top; the destination chips (`ctx.setDestination`, the Rig checks' profile follows); the checks that ran with *Check
// the model* and the Fixes group. Opened with a stage id (the Path's ⚠n) it scrolls to that stage's rows. Every
// control is one operator run through `ctx.run`; the counts are readiness's, never "All good" while a row exists.
import type { MeshId } from '@ekza-studio/doc';
import { type EditorApp, type IntakeReport, rigValidation } from '@ekza-studio/editor-core';
import { Segmented, SheetGroup, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useId, useReducer, useRef, useState } from 'react';
import type { HaloSheetContext, HaloSheetProps } from '../../manifest/sheets';
import { type DestinationId, STAGE_WORKSPACE } from '../../path/destinations';
import { HaloSheet, useAppVersion } from '../more/kit';
import {
  type HealthAction,
  type HealthControl,
  type HealthModel,
  type HealthRow,
  type HealthStageGroup,
  healthModel,
  isHaloStage,
  type ModelCheckRow,
  type ModelCheckRun,
  pollCall,
  profileSwitch,
  sectionTarget,
  whenWorkspace,
} from './model';

/** Re-renders when the Rig checks' profile changes (the rows follow the document through `useAppVersion`). */
function useRigValidationVersion(app: EditorApp): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const loaded = app.rig.loaded;
  useEffect(() => (loaded ? rigValidation(app).subscribe(bump) : undefined), [app, loaded]);
}

/** Runs a row's action: About this character opens as a sheet (§6.7), everything else is one `ctx.run`. */
function runAction(ctx: HaloSheetContext, action: HealthAction): void {
  if (action.sheet !== undefined) {
    ctx.open(action.sheet);
    return;
  }
  void ctx.run(action.op, action.args);
}

/**
 * *Show me* (§6.2): selects and frames the offending thing, then switches to its stage. When the selection needs the
 * stage's workspace first (Mesh Check selection is a Model tool), the switch comes first and the run follows it.
 */
async function showMe(ctx: HaloSheetContext, app: EditorApp, row: HealthRow): Promise<void> {
  const show = row.show;
  const stage = row.stage;
  const other = isHaloStage(stage) && stage !== ctx.stage;
  if (show === null) {
    if (isHaloStage(stage)) ctx.setStage(stage);
    else ctx.open('share');
    return;
  }
  if (other && isHaloStage(stage) && !pollCall(app, show.op, show.args).enabled) {
    ctx.setStage(stage);
    await whenWorkspace(app, STAGE_WORKSPACE[stage]);
    await ctx.run(show.op, show.args);
    return;
  }
  await ctx.run(show.op, show.args);
  if (other && isHaloStage(stage)) ctx.setStage(stage);
}

function RowView(props: {
  readonly ctx: HaloSheetContext;
  readonly app: EditorApp;
  readonly row: HealthRow;
}): JSX.Element {
  const { ctx, app, row } = props;
  const [why, setWhy] = useState(false);
  const id = useId();
  const developer = [`Rule ${row.rule}`, row.profile === null ? null : `profile ${row.profile}`]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <div
      className="flex flex-col gap-1.5 rounded-touch px-2.5 py-2"
      data-testid="halo-health-row"
      data-row={row.id}
      data-rule={row.rule}
    >
      <div className="flex items-start gap-2">
        <span className={row.severity === 'error' ? 'pt-0.5 text-warn' : 'pt-0.5 text-fg-3'} aria-hidden="true">
          ⚠
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium text-fg">
            <span className="sr-only">{row.severity === 'error' ? 'Must fix: ' : 'Worth fixing: '}</span>
            {row.text}
          </span>
          {row.fix === null ? (
            <span className="text-touch-label text-fg-3">
              Fixed by hand in {row.stage === 'share' ? 'Share' : 'its stage'}
            </span>
          ) : (
            <span className="truncate text-touch-label text-fg-3">
              {row.fix.plain}
              {row.fix.pro.toLowerCase() === row.fix.plain.toLowerCase() ? '' : ` · ${row.fix.pro}`}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {row.fix === null ? (
          <TouchButton onClick={() => void showMe(ctx, app, row)} data-testid="halo-health-gofix">
            Go fix ▸
          </TouchButton>
        ) : (
          <TouchButton
            variant="primary"
            aria-label={`Fix: ${row.fix.plain}`}
            onClick={() => {
              if (row.fix !== null) runAction(ctx, row.fix);
            }}
            data-op={row.fix.sheet === undefined ? row.fix.op : undefined}
            data-testid="halo-health-fix"
          >
            {row.fix.label}
          </TouchButton>
        )}
        {row.show === null || row.fix === null ? null : (
          <TouchButton onClick={() => void showMe(ctx, app, row)} data-op={row.show.op} data-testid="halo-health-show">
            {row.show.label}
          </TouchButton>
        )}
        <TouchButton
          variant="ghost"
          aria-expanded={why}
          aria-controls={id}
          onClick={() => setWhy((open) => !open)}
          data-testid="halo-health-why"
        >
          Why?
        </TouchButton>
      </div>
      {why ? (
        <div id={id} className="flex flex-col gap-0.5 pl-6 text-fg-2" data-testid="halo-health-why-text">
          <span>{row.why}</span>
          <span className="text-touch-label text-fg-3" data-testid="halo-health-rule">
            {developer}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function StageGroupView(props: {
  readonly ctx: HaloSheetContext;
  readonly app: EditorApp;
  readonly group: HealthStageGroup;
  readonly highlighted: boolean;
}): JSX.Element {
  const { group } = props;
  return (
    <div
      data-anchor={`stage-${group.stage}`}
      data-stage={group.stage}
      data-highlighted={props.highlighted || undefined}
      className={props.highlighted ? 'rounded-touch ring-2 ring-accent/50' : undefined}
      data-testid={`halo-health-stage-${group.stage}`}
    >
      <SheetGroup>
        <span aria-label={`${group.title}, ${group.meaning}`}>
          {group.title} <span aria-hidden="true">{group.glyph}</span>
        </span>
      </SheetGroup>
      {group.rows.length === 0 ? (
        <p className="px-2.5 pb-2 text-touch-label text-fg-3">{group.empty}</p>
      ) : (
        group.rows.map((row) => <RowView key={row.id} ctx={props.ctx} app={props.app} row={row} />)
      )}
    </div>
  );
}

/** A poll-gated control row (the Fixes group, the model check's fixes): greyed with the reason when it cannot run. */
function ControlRow(props: {
  readonly control: HealthControl;
  readonly onRun: (control: HealthControl) => void;
  readonly testId: string;
  readonly expanded?: boolean;
}): JSX.Element {
  const { control } = props;
  const pro = control.pro.toLowerCase() === control.plain.toLowerCase() ? '' : control.pro;
  return (
    <button
      type="button"
      aria-disabled={!control.enabled || undefined}
      {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded })}
      className="flex min-h-[52px] w-full min-w-0 flex-col justify-center rounded-touch px-2.5 py-1.5 text-left active:bg-header aria-disabled:cursor-default"
      onClick={() => {
        if (control.enabled) props.onRun(control);
      }}
      data-op={control.op}
      data-testid={props.testId}
    >
      <span className={control.enabled ? 'font-medium text-fg' : 'font-medium text-fg-3'}>
        {control.plain}
        {control.choices === undefined ? null : <span aria-hidden="true"> {props.expanded === true ? '▴' : '▾'}</span>}
      </span>
      {pro === '' && control.reason === null ? null : (
        <span className="truncate text-touch-label text-fg-3">
          {pro}
          {control.reason === null ? null : (
            <span className="text-fg-2" data-testid="halo-health-reason">
              {pro === '' ? '' : ' · '}
              {control.reason}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function FixesView(props: { readonly ctx: HaloSheetContext; readonly fixes: readonly HealthControl[] }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const run = (control: HealthControl): void => {
    void props.ctx.run(control.op, control.args);
  };
  return (
    <div data-testid="halo-health-fixes">
      <SheetGroup>Fixes</SheetGroup>
      {props.fixes.map((fix) =>
        fix.choices === undefined ? (
          <ControlRow key={fix.id} control={fix} onRun={run} testId="halo-health-fixrow" />
        ) : (
          <div key={fix.id}>
            <ControlRow
              control={fix}
              expanded={open === fix.id}
              onRun={() => setOpen((current) => (current === fix.id ? null : fix.id))}
              testId="halo-health-fixrow"
            />
            {open === fix.id ? (
              <fieldset className="m-0 min-w-0 border-0 p-0 pl-4">
                <legend className="sr-only">{fix.plain}</legend>
                {fix.choices.map((choice) => (
                  <ControlRow
                    key={choice.id}
                    control={choice}
                    onRun={(control) => {
                      setOpen(null);
                      run(control);
                    }}
                    testId="halo-health-fixchoice"
                  />
                ))}
              </fieldset>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

function ModelCheckList(props: { readonly rows: readonly ModelCheckRow[] }): JSX.Element {
  return (
    <ul className="flex flex-col px-2.5 pb-1" data-testid="halo-health-modelcheck">
      {props.rows.map((row) => (
        <li key={row.fix} className="flex min-h-[32px] items-center gap-2 text-fg-2">
          <span aria-hidden="true" className={row.ok ? 'text-fg-3' : 'text-warn'}>
            {row.ok ? '✓' : '⚠'}
          </span>
          <span className="sr-only">{row.ok ? 'Fine: ' : 'To fix: '}</span>
          {row.ok ? row.label : row.problem}
        </li>
      ))}
    </ul>
  );
}

function ChecksSection(props: {
  readonly ctx: HaloSheetContext;
  readonly model: HealthModel;
  readonly checking: boolean;
  readonly onCheck: () => void;
  readonly highlighted: boolean;
}): JSX.Element {
  const { ctx, model } = props;
  const profile = model.profile.control;
  return (
    <section
      data-section="checks"
      data-anchor="checks"
      aria-label="Checks"
      data-highlighted={props.highlighted || undefined}
      data-testid="halo-health-checks"
    >
      <SheetGroup>Checks</SheetGroup>
      {model.checks.map((check) => (
        <div
          key={check.id}
          className="flex min-h-[52px] flex-col justify-center px-2.5 py-1.5"
          data-testid={`halo-health-check-${check.id}`}
          data-ran={check.ran}
        >
          <span className="font-medium text-fg">{check.label}</span>
          <span className="text-touch-label text-fg-2">{check.status}</span>
          <span className="truncate text-touch-label text-fg-3">{check.pro}</span>
          {check.id === 'model' && model.modelCheck !== null ? <ModelCheckList rows={model.modelCheck} /> : null}
          {check.id === 'model' ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <TouchButton
                disabled={!model.inspect.enabled || props.checking}
                onClick={props.onCheck}
                data-op={model.inspect.op}
                data-testid="halo-health-inspect"
              >
                {props.checking ? 'Checking…' : model.inspect.plain}
              </TouchButton>
              {model.inspect.reason === null ? null : (
                <span className="text-touch-label text-fg-2">{model.inspect.reason}</span>
              )}
            </div>
          ) : null}
          {check.id === 'rig' ? (
            <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="halo-health-profile">
              <TouchButton
                disabled={!profile.enabled}
                onClick={() => void ctx.run(profile.op, profile.args)}
                data-op={profile.op}
                data-testid="halo-health-profile-match"
              >
                Check for {model.destination.name}
              </TouchButton>
              <span className="text-touch-label text-fg-3">
                {profile.reason ?? `Studio Pro's Validation shows ${model.profile.current ?? 'its default'}`}
              </span>
            </div>
          ) : null}
        </div>
      ))}
      <FixesView ctx={ctx} fixes={model.fixes} />
    </section>
  );
}

export default function HealthSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  useRigValidationVersion(app);
  const [run, setRun] = useState<ModelCheckRun | null>(null);
  const [checking, setChecking] = useState(false);
  const model = healthModel(app, ctx.destination, run);
  const body = useRef<HTMLDivElement>(null);
  const target = sectionTarget(args?.section);

  useEffect(() => {
    if (target === null) return;
    body.current?.querySelector(`[data-anchor="${target}"]`)?.scrollIntoView({ block: 'start' });
  }, [target]);

  const check = (): void => {
    const call = model.inspect;
    if (!call.enabled) return;
    const meshes = (call.args as { readonly meshes: readonly MeshId[] }).meshes;
    setChecking(true);
    void ctx.run(call.op, call.args).then((result) => {
      setChecking(false);
      if (result.status === 'finished') setRun({ report: result.value as IntakeReport, meshes });
    });
  };

  const fixModel = (row: ModelCheckRow): void => {
    const action = row.action;
    if (action === null || !action.enabled) return;
    void ctx.run(action.op, action.args).then((result) => {
      if (result.status === 'finished') check();
    });
  };

  const switchDestination = (id: DestinationId): void => {
    ctx.setDestination(id);
    const call = profileSwitch(app, id);
    if (call !== null) void ctx.run(call.op, call.args);
  };

  return (
    <HaloSheet ctx={ctx} id="health" title="Health" description="Fix · Show me · Why? on every row">
      <div ref={body} className="flex flex-col gap-1">
        <div className="flex flex-col gap-2 px-2.5 pb-1" data-testid="halo-health-header">
          <output className="font-semibold text-fg" data-testid="halo-health-count" data-total={model.total}>
            {model.header}
          </output>
          {model.suggestions === null ? null : (
            <p className="text-touch-label text-fg-2" data-testid="halo-health-suggestions">
              {model.suggestions}
            </p>
          )}
          <div className="flex items-center gap-2 overflow-x-auto" data-touch-scroll>
            <span className="shrink-0 text-touch-label text-fg-3">For:</span>
            <Segmented<DestinationId>
              label="Where it is going"
              value={model.destination.id}
              onValueChange={switchDestination}
              items={model.destinations.map((d) => ({ value: d.id, label: d.name }))}
              data-testid="halo-health-destination"
            />
          </div>
        </div>

        <section
          data-section="legend"
          data-anchor="legend"
          aria-label="What the stage marks mean"
          data-highlighted={target === 'legend' || undefined}
          data-testid="halo-health-legend"
        >
          <ul className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-2.5 pb-2 text-touch-label">
            {model.legend.map((entry) => (
              <li key={entry.glyph} className="contents">
                <span className="text-center font-semibold text-fg" aria-hidden="true">
                  {entry.text}
                </span>
                <span className="text-fg-2">
                  <span className="sr-only">{entry.text}: </span>
                  {entry.meaning}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          data-section="problems"
          data-anchor="problems"
          aria-label="Things to fix"
          data-highlighted={target === 'problems' || undefined}
          data-testid="halo-health-problems"
        >
          {model.groups.map((group) => (
            <StageGroupView
              key={group.stage}
              ctx={ctx}
              app={app}
              group={group}
              highlighted={target === `stage-${group.stage}`}
            />
          ))}
          {model.beforeRigging.length === 0 ? null : (
            <div data-testid="halo-health-before-rigging">
              <SheetGroup>Before rigging</SheetGroup>
              {model.beforeRigging.map((row) =>
                row.action === null ? null : (
                  <ControlRow
                    key={row.fix}
                    control={{ ...row.action, plain: `${row.problem}: ${row.action.plain}` }}
                    onRun={() => fixModel(row)}
                    testId="halo-health-modelfix"
                  />
                ),
              )}
            </div>
          )}
        </section>

        <ChecksSection ctx={ctx} model={model} checking={checking} onCheck={check} highlighted={target === 'checks'} />
      </div>
    </HaloSheet>
  );
}
