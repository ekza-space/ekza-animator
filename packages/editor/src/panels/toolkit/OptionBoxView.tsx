// The option box popover (M6A-SPEC §8.5 `OptionBoxPopover`, §8.10 `optbox-<operatorId>`, `optbox-field-<param>`,
// `optbox-apply`; B11): an operator's visible params as the defaults of its next run from the UI (menus, keys, marking
// menus, the Toolkit, its tool), stored in `prefs.modeling.optionDefaults[op]` as soon as a field changes. Apply runs
// the operator with them; Reset forgets them; Esc or ✕ closes. A lazy chunk.
import type { ParamValue, ParamValues } from '@ekza-studio/anim-core';
import { type EditorApp, visibleParams } from '@ekza-studio/editor-core';
import { type JSX, useEffect, useRef } from 'react';
import { usePrefs } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import { BUTTON, PRIMARY_BUTTON } from '../channel-box/kit/styles';
import { ParamField, ParamSections } from './ParamField';

export interface OptionBoxViewProps {
  readonly app: EditorApp;
  readonly op: string;
  readonly anchor: { readonly x: number; readonly y: number } | null;
  readonly onClose: () => void;
}

const WIDTH = 288;

/** Writes one option default (or forgets them all with `null`). */
export function setOptionDefault(app: EditorApp, op: string, patch: ParamValues | null): void {
  const modeling = app.prefs.getState().modeling;
  const next = { ...modeling.optionDefaults };
  if (patch === null) delete next[op];
  else next[op] = { ...next[op], ...patch };
  app.prefs.setState({ modeling: { ...modeling, optionDefaults: next } });
}

export default function OptionBoxView(props: OptionBoxViewProps): JSX.Element | null {
  const { app, op, anchor, onClose } = props;
  const shell = useOptionalShell();
  const defaults = usePrefs((p) => p.modeling.optionDefaults[op]);
  const box = useRef<HTMLDialogElement>(null);
  const def = app.operators.get(op);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  if (def === undefined) return null;
  const fields = visibleParams(def.params);
  const value = (name: string, fallback: ParamValue): ParamValue =>
    defaults !== undefined && Object.hasOwn(defaults, name) ? (defaults[name] ?? null) : fallback;
  const apply = (): void => {
    const ctx = { source: 'toolkit' as const, panel: 'toolkit' };
    if (shell !== null) void shell.runFromUi(op, {}, ctx);
    else void app.runUntyped(op, {}, ctx);
    onClose();
  };
  const left = anchor === null ? undefined : Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
  const top = anchor === null ? undefined : Math.max(8, Math.min(anchor.y, window.innerHeight - 320));

  return (
    <dialog
      ref={box}
      open
      aria-label={`${def.label} options`}
      data-testid={`optbox-${op}`}
      className="fixed z-50 m-0 flex flex-col gap-1.5 rounded-md border border-line bg-[var(--bg-overlay,#202227)] p-2 text-ui-dense text-fg shadow-xl"
      style={{ width: WIDTH, ...(anchor === null ? { right: 316, top: 96 } : { left, top }) }}
    >
      <header className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-semibold">{def.label} Options</span>
        <button type="button" className={BUTTON} aria-label="Close" data-testid="optbox-close" onClick={onClose}>
          ✕
        </button>
      </header>
      {fields.length === 0 ? (
        <p className="text-fg-3">{def.label} has no options.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          <ParamSections params={fields} testId="optbox">
            {(field) => (
              <ParamField
                key={field.name}
                app={app}
                def={field}
                value={value(field.name, field.default)}
                fieldTestId={`optbox-field-${field.name}`}
                nameTestId={`optbox-name-${field.name}`}
                onCommit={(next) => setOptionDefault(app, op, { [field.name]: next })}
                onMessage={(text) => shell?.help(text, 'warning')}
              />
            )}
          </ParamSections>
        </div>
      )}
      <footer className="flex items-center justify-end gap-1">
        <button
          type="button"
          className={BUTTON}
          data-testid="optbox-reset"
          disabled={defaults === undefined}
          onClick={() => setOptionDefault(app, op, null)}
        >
          Reset
        </button>
        <button type="button" className={PRIMARY_BUTTON} data-testid="optbox-apply" onClick={apply}>
          Apply
        </button>
      </footer>
    </dialog>
  );
}
