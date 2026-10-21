// The Rig Toolkit's Skin section (M6B-SPEC §8.6, §5.9, §5.13, §0.3; C6). Rendered by the Toolkit frame (C7) inside the
// lazy rigToolkit body. Bind Skin in one click (the option box's choices are the next run's args, remembered in
// `prefs.rigging.optionDefaults['skin.bind']`) with its `⋯` option box generated from the operator's params, the
// progress pill while the skin worker binds, Unbind, Paint (Skin mode with the brush), Mirror ⋯, Smooth ⋯, Prune ⋯,
// Normalize, and Attributes › Skin of the bound meshes (skeleton, method, influences, points). Buttons run operators
// with `source: 'toolkit'`; a disabled button shows the poll reason.
import type { ParamDef, ParamValue } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import {
  boundMeshesOf,
  type EditorApp,
  meshKernel,
  PANEL,
  type RunContext,
  skinCharacter,
} from '@ekza-studio/editor-core';
import { Checkbox, NativeSelect, NumberField } from '@ekza-studio/ui';
import { type JSX, useState } from 'react';
import { usePrefs, useRunOperator, useSession } from '../../../../hooks';
import { useReasons } from '../../../../shell/rig/hooks';
import type { RigToolkitSectionProps } from '../types';

const CTX: RunContext = { panel: PANEL.rigToolkit, source: 'toolkit' };
const BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';

/** The remembered option-box values of an operator (only its visible params). */
function useOptionDefaults(op: string): Readonly<Record<string, ParamValue>> {
  return usePrefs((p) => p.rigging.optionDefaults[op] ?? EMPTY);
}
const EMPTY: Readonly<Record<string, ParamValue>> = {};

function setOptionDefault(app: EditorApp, op: string, name: string, value: ParamValue): void {
  const prefs = app.prefs.getState();
  const current = prefs.rigging.optionDefaults[op] ?? {};
  app.prefs.setState({
    rigging: {
      ...prefs.rigging,
      optionDefaults: { ...prefs.rigging.optionDefaults, [op]: { ...current, [name]: value } },
    },
  });
}

/** The option box of an operator: one field per visible param, remembered for the next run (§8.6). */
function OptionBox(props: { readonly app: EditorApp; readonly op: string }): JSX.Element | null {
  const { app, op } = props;
  const values = useOptionDefaults(op);
  const params = (app.operators.get(op)?.params ?? []).filter(
    (param) => param.hidden !== true && param.kind !== 'data',
  );
  if (params.length === 0) return null;
  const field = (param: ParamDef): JSX.Element => {
    const value = values[param.name] ?? param.default;
    const testId = `rtk-opt-${op}-${param.name}`;
    if (param.kind === 'enum') {
      return (
        <NativeSelect
          className="h-5 text-[11px]"
          data-testid={testId}
          aria-label={param.label}
          value={typeof value === 'string' ? value : ''}
          options={(param.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setOptionDefault(app, op, param.name, event.target.value)}
        />
      );
    }
    if (param.kind === 'bool') {
      if (param.nullable === true) {
        return (
          <NativeSelect
            className="h-5 text-[11px]"
            data-testid={testId}
            aria-label={param.label}
            value={value === null ? 'auto' : value === true ? 'on' : 'off'}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(event) =>
              setOptionDefault(app, op, param.name, event.target.value === 'auto' ? null : event.target.value === 'on')
            }
          />
        );
      }
      return (
        <Checkbox
          checked={value === true}
          data-testid={testId}
          aria-label={param.label}
          onChange={(event) => setOptionDefault(app, op, param.name, event.target.checked)}
        />
      );
    }
    return (
      <NumberField
        className="h-5 text-[11px]"
        data-testid={testId}
        aria-label={param.label}
        value={typeof value === 'number' ? value : null}
        {...(param.min === undefined ? {} : { min: param.min })}
        {...(param.max === undefined ? {} : { max: param.max })}
        step={param.step ?? (param.kind === 'int' ? 1 : 0.05)}
        format={(v) => (param.kind === 'int' ? String(Math.round(v)) : v.toFixed(3))}
        onCommit={(v) => setOptionDefault(app, op, param.name, param.kind === 'int' ? Math.round(v) : v)}
      />
    );
  };
  return (
    <div
      className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 rounded-[4px] border border-line p-1"
      data-testid={`rtk-optbox-${op}`}
    >
      {params.map((param) => (
        <label key={param.name} className="contents">
          <span className="text-fg-3">{param.label}</span>
          {field(param)}
        </label>
      ))}
      <button
        type="button"
        className={`${BUTTON} col-span-2 justify-center`}
        data-testid={`rtk-opt-${op}-reset`}
        onClick={() => {
          const prefs = app.prefs.getState();
          const { [op]: _dropped, ...rest } = prefs.rigging.optionDefaults;
          app.prefs.setState({ rigging: { ...prefs.rigging, optionDefaults: rest } });
        }}
      >
        Reset
      </button>
    </div>
  );
}

/** An operator button with its optional `⋯` option box; the run takes the remembered option values. */
function SkinButton(props: {
  readonly app: EditorApp;
  readonly op: string;
  readonly label: string;
  readonly options?: boolean;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly testId?: string;
}): JSX.Element {
  const { app, op } = props;
  const run = useRunOperator();
  const values = useOptionDefaults(op);
  const [reason] = useReasons(app, [[op, props.args]]);
  const [open, setOpen] = useState(false);
  // The outcome of this button's last run (`data-runs` counts settled runs): a no-op run records no undo step, so
  // this is how a test sees that it finished (E2E-SKIN-03).
  const [last, setLast] = useState<{ readonly runs: number; readonly status: string }>({ runs: 0, status: '' });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          className={`${BUTTON} min-w-0 flex-1 justify-start`}
          disabled={reason !== null}
          title={reason ?? undefined}
          data-testid={props.testId ?? `rtk-btn-${op}`}
          data-runs={last.runs}
          data-status={last.status}
          onClick={() =>
            void run(op, { ...(props.options === true ? values : {}), ...props.args }, CTX).then(
              (result) => setLast((was) => ({ runs: was.runs + 1, status: result.status })),
              () => setLast((was) => ({ runs: was.runs + 1, status: 'failed' })),
            )
          }
        >
          {props.label}
        </button>
        {props.options === true ? (
          <button
            type="button"
            className={BUTTON}
            aria-expanded={open}
            aria-label={`${props.label} options`}
            data-testid={`rtk-opt-${op}`}
            onClick={() => setOpen(!open)}
          >
            ⋯
          </button>
        ) : null}
      </div>
      {open ? <OptionBox app={app} op={op} /> : null}
    </div>
  );
}

/** Attributes › Skin of the bound meshes (read-only fields; §8.9). */
function SkinAttributes(props: { readonly app: EditorApp; readonly meshes: readonly MeshId[] }): JSX.Element | null {
  const { app, meshes } = props;
  const kernel = meshKernel();
  if (meshes.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]" data-testid="attr-skin">
      {meshes.map((id) => {
        const record = app.store.get('meshes', id);
        const data = app.meshes.get(id)?.data() ?? null;
        const skin = kernel === null || data === null ? null : kernel.readSkin(data);
        const bind =
          record?.skin !== null && record?.skin !== undefined && 'bind' in record.skin ? record.skin.bind : null;
        const raw = bind !== null && typeof bind === 'object' && 'method' in bind ? bind['method'] : null;
        const method = typeof raw === 'string' ? raw : '—';
        return (
          <div key={id} className="contents" data-testid={`attr-skin-${id}`}>
            <dt className="text-fg-3">{record?.name ?? id}</dt>
            <dd data-testid="attr-skin-summary">
              {method} · {skin?.palette.length ?? 0} influences · {skin?.points ?? 0} points
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function SkinSection(props: RigToolkitSectionProps): JSX.Element | null {
  const { app } = props;
  const character = useSession((s) => (skinCharacter(app) === null ? null : s.rig.character));
  const busy = useSession((s) => s.busy);
  useSession((s) => s.rig.mode);
  if (character === null) return null;
  const meshes = boundMeshesOf(app, character);
  return (
    <div className="flex flex-col gap-1" data-testid="rtk-skin">
      <SkinButton app={app} op="skin.bind" label="Bind Skin" options />
      {busy !== null && busy.label.startsWith('Binding') ? (
        <span className="text-[10px] text-fg-3" data-testid="rtk-skin-progress">
          {busy.label} {Math.round((busy.progress ?? 0) * 100)}%
        </span>
      ) : null}
      <SkinButton app={app} op="skin.unbind" label="Unbind Skin" />
      <SkinButton app={app} op="rig.mode" label="Paint Skin Weights" args={{ mode: 'skin' }} testId="rtk-btn-paint" />
      <SkinButton app={app} op="skin.weights.mirror" label="Mirror Skin Weights" options />
      <SkinButton app={app} op="skin.weights.smooth" label="Smooth Skin Weights" options />
      <SkinButton app={app} op="skin.weights.prune" label="Prune Small Weights" options />
      <SkinButton app={app} op="skin.weights.normalize" label="Normalize Weights" />
      <SkinAttributes app={app} meshes={meshes} />
    </div>
  );
}
