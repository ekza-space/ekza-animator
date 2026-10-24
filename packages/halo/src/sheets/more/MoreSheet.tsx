// ⋯ More (STUDIO-TOUCH-SPEC §6.3, §15 depth L2; T6b): every operator the Disclosure Manifest attaches to the noun and
// stage, grouped, each row reading `plain · Pro name · hotkey`. Rows whose poll fails stay listed, greyed, with the
// reason inline and its one-tap fix when an operator removes it. A row with an option box or a form carries ⚙
// Options: the option box at touch density, run with its values, saved as the defaults only through *Make default*.
// A row that needs its parameters first (a pre-run form, §5.6) opens them with ✓ Run. The footer opens the Pro layout.
import type { ParamDef } from '@ekza-studio/anim-core';
import type { EditorApp, OperatorDef } from '@ekza-studio/editor-core';
import { formArgs, formDefaults, formOf } from '@ekza-studio/editor-core/forms';
import { SheetGroup, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import { type JSX, useMemo, useState } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { type MoreRow, moreFor } from '../../verbs/derive';
import { FieldRow, HaloSheet, OpenInProButton, ParamControl, useAppVersion } from './kit';

/** The option defaults of an operator (Model's or Rig & Skin's table, as Studio Pro's option boxes keep them). */
function optionDefaults(app: EditorApp, op: string): Readonly<Record<string, unknown>> {
  const prefs = app.prefs.getState();
  return (isRigOp(op) ? prefs.rigging.optionDefaults[op] : prefs.modeling.optionDefaults[op]) ?? {};
}

const isRigOp = (op: string): boolean => /^(skel|skin|rig|char)\./.test(op);

/** *Make default* (§5.6, §16.4): the only write to the option defaults, from a visible control. */
function makeDefault(app: EditorApp, op: string, values: Readonly<Record<string, unknown>>): void {
  const prefs = app.prefs.getState();
  if (isRigOp(op)) {
    const rigging = prefs.rigging;
    app.prefs.setState({
      rigging: { ...rigging, optionDefaults: { ...rigging.optionDefaults, [op]: values as never } },
    });
  } else {
    const modeling = prefs.modeling;
    app.prefs.setState({
      modeling: { ...modeling, optionDefaults: { ...modeling.optionDefaults, [op]: values as never } },
    });
  }
}

interface OptionsTarget {
  readonly row: MoreRow;
  /** 'form': a pre-run form (✓ Run); 'options': the option box (Run and Make default). */
  readonly mode: 'form' | 'options';
}

function visibleParams(def: OperatorDef<unknown, unknown, unknown> | undefined): readonly ParamDef[] {
  return (def?.params ?? []).filter((param) => param.hidden !== true && param.kind !== 'data');
}

function OptionsView(props: {
  readonly app: EditorApp;
  readonly target: OptionsTarget;
  readonly onRun: (args: unknown) => void;
  readonly onBack: () => void;
}): JSX.Element {
  const { app, target } = props;
  const def = app.operators.get(target.row.op);
  const form = useMemo(() => formOf(target.row.op, def), [target.row.op, def]);
  const params = form?.params ?? visibleParams(def);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(form === null ? Object.fromEntries(params.map((p) => [p.name, p.default])) : formDefaults(form)),
    ...optionDefaults(app, target.row.op),
  }));
  const [saved, setSaved] = useState(false);
  const run = (): void => {
    if (form !== null) {
      const base = (target.row.args ?? {}) as Readonly<Record<string, unknown>>;
      props.onRun(formArgs(form, values, base).args);
    } else {
      props.onRun({ ...(target.row.args as object | undefined), ...values });
    }
  };
  return (
    <div className="flex flex-col gap-1" data-testid="halo-more-options">
      <FieldRow label={target.row.plain} pro={target.row.pro} testId="halo-more-options-title">
        <TouchButton variant="ghost" onClick={props.onBack}>
          ‹ Back
        </TouchButton>
      </FieldRow>
      {params.length === 0 ? <p className="px-2.5 text-fg-3">This has no options.</p> : null}
      {params.map((param) => (
        <FieldRow key={param.name} label={param.label}>
          <ParamControl
            param={param}
            value={values[param.name]}
            onChange={(value) => setValues((current) => ({ ...current, [param.name]: value }))}
          />
        </FieldRow>
      ))}
      <div className="flex flex-wrap gap-2 px-2.5 pt-3">
        <TouchButton variant="primary" onClick={run} data-testid="halo-more-options-run">
          ✓ {target.mode === 'form' ? 'Run' : target.row.plain}
        </TouchButton>
        {target.mode === 'options' ? (
          <TouchButton
            onClick={() => {
              makeDefault(app, target.row.op, values);
              setSaved(true);
            }}
            data-testid="halo-more-options-default"
          >
            {saved ? 'Saved as default' : 'Make default'}
          </TouchButton>
        ) : null}
      </div>
    </div>
  );
}

function RowView(props: {
  readonly row: MoreRow;
  readonly onRun: (row: MoreRow) => void;
  readonly onFix: (row: MoreRow) => void;
  readonly onOptions: (row: MoreRow) => void;
}): JSX.Element {
  const { row } = props;
  const detail = [row.pro, row.hotkey].filter((part) => part !== null && part !== '').join(' · ');
  return (
    <div className="flex items-center gap-1" data-testid="halo-more-row" data-op={row.op}>
      <button
        type="button"
        aria-disabled={!row.enabled || undefined}
        className="flex min-h-[52px] min-w-0 flex-1 flex-col justify-center rounded-touch px-2.5 py-1.5 text-left active:bg-header aria-disabled:cursor-default"
        onClick={() => {
          if (row.enabled) props.onRun(row);
        }}
      >
        <span className={row.enabled ? 'font-medium text-fg' : 'font-medium text-fg-3'}>{row.plain}</span>
        {detail === '' && row.reason === null ? null : (
          <span className="truncate text-touch-label text-fg-3">
            {detail}
            {row.reason === null ? null : (
              <span className="text-fg-2" data-testid="halo-more-reason">
                {detail === '' ? '' : ' · '}
                {row.reason}
              </span>
            )}
          </span>
        )}
      </button>
      {row.fix === null || row.enabled ? null : (
        <TouchButton variant="ghost" className="text-accent-text" onClick={() => props.onFix(row)}>
          {row.fix.label} ▸
        </TouchButton>
      )}
      {row.options ? (
        <TouchIconButton
          label={`Options for ${row.plain}`}
          icon={<span aria-hidden="true">⚙</span>}
          onClick={() => props.onOptions(row)}
        />
      ) : null}
    </div>
  );
}

export default function MoreSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const [filter, setFilter] = useState(args?.query ?? '');
  const [options, setOptions] = useState<OptionsTarget | null>(null);
  const groups = moreFor(app, ctx.noun, ctx.stage, filter);
  const label = ctx.noun === null || ctx.noun.kind === 'empty' ? 'here' : ctx.noun.label;

  const run = (row: MoreRow): void => {
    const def = app.operators.get(row.op);
    if (formOf(row.op, def) !== null) {
      setOptions({ row, mode: 'form' });
      return;
    }
    void ctx.run(row.op, row.args).then((result) => {
      if (result.status === 'finished') ctx.close();
    });
  };

  return (
    <HaloSheet
      ctx={ctx}
      id="more"
      title={`Everything for ${label}`}
      description="Plain name · Studio Pro name · hotkey · ⚙ options"
      footer={<OpenInProButton ctx={ctx} />}
    >
      {options !== null ? (
        <OptionsView
          app={app}
          target={options}
          onBack={() => setOptions(null)}
          onRun={(runArgs) => {
            void ctx.run(options.row.op, runArgs).then((result) => {
              if (result.status === 'finished') ctx.close();
            });
          }}
        />
      ) : (
        <>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            aria-label="Filter"
            data-testid="halo-more-filter"
            className="mx-1 mt-1 mb-2 min-h-(--touch-hit) w-[calc(100%-8px)] rounded-touch border border-line bg-field px-3 text-[16px] text-fg placeholder:text-fg-3"
          />
          {groups.length === 0 ? (
            <p className="px-2.5 py-4 text-fg-3" data-testid="halo-more-empty">
              Nothing matches. Search (⌕ Do or find…) reaches every verb in every stage.
            </p>
          ) : null}
          {groups.map((group) => (
            <section key={group.title} aria-label={group.title} data-testid="halo-more-group">
              <SheetGroup>{group.title}</SheetGroup>
              {group.rows.map((row) => (
                <RowView
                  key={row.key}
                  row={row}
                  onRun={run}
                  onOptions={(target) => setOptions({ row: target, mode: 'options' })}
                  onFix={(target) => {
                    if (target.fix !== null) void ctx.run(target.fix.op, target.fix.args);
                  }}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </HaloSheet>
  );
}
