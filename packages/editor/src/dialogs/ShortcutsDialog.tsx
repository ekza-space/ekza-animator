// Shortcut sheet (`?`, research 09 §7.1 rule 5): generated from the keymap's binding table, grouped by scope, with
// the platform's labels. Operators that are not registered in this build are listed as unavailable.
import { GLOBAL_SCOPE, type EditorApp, type KeyBinding } from '@ekza-animator/editor-core';
import { Dialog, DialogContent, Kbd, Search, TextInput } from '@ekza-animator/ui';
import { type JSX, useMemo, useState } from 'react';
import { useShell } from '../shell/context';

const SCOPE_LABEL: Readonly<Record<string, string>> = {
  [GLOBAL_SCOPE]: 'Everywhere',
  viewport: 'Viewport',
  graph: 'Graph Editor',
  timeline: 'Time slider',
  outliner: 'Outliner',
  channelBox: 'Channel Box',
  clips: 'Clips',
  attributes: 'Attributes',
};

export interface ShortcutRow {
  readonly scope: string;
  readonly keys: string;
  readonly label: string;
  readonly available: boolean;
}

const argsText = (args: unknown): string => {
  if (args === undefined || args === null || typeof args !== 'object') return '';
  const values = Object.values(args as Record<string, unknown>).filter(
    (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  );
  return values.length === 0 ? '' : ` (${values.join(', ')})`;
};

function chordText(app: EditorApp, binding: KeyBinding): string {
  const label = app.keymap.label(binding.chord);
  if (binding.trigger === 'tap') return `${label} tap`;
  if (binding.trigger === 'hold') return `${label} hold`;
  return label;
}

/** One row per binding, grouped by scope (global first), in binding order. */
export function shortcutRows(app: EditorApp): ShortcutRow[] {
  return app.keymap.bindings().map((binding) => {
    const def = app.operators.get(binding.op);
    return {
      scope: binding.scope,
      keys: chordText(app, binding),
      label: `${def?.label ?? binding.op}${argsText(binding.args)}`,
      available: def !== undefined,
    };
  });
}

export function ShortcutsDialog(): JSX.Element {
  const shell = useShell();
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => shortcutRows(shell.app), [shell]);
  const needle = filter.trim().toLowerCase();
  const visible =
    needle === '' ? rows : rows.filter((row) => `${row.keys} ${row.label}`.toLowerCase().includes(needle));
  const scopes = [...new Set(visible.map((row) => row.scope))].sort((a, b) =>
    a === GLOBAL_SCOPE ? -1 : b === GLOBAL_SCOPE ? 1 : a.localeCompare(b),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void shell.runFromUi('ui.close');
      }}
    >
      <DialogContent
        title="Keyboard shortcuts"
        description="Keys follow Maya and use physical key positions, so they work on any keyboard layout."
        width="lg"
        data-testid="shortcuts-dialog"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-fg-3" />
            <TextInput
              className="flex-1"
              placeholder="Filter shortcuts"
              aria-label="Filter shortcuts"
              value={filter}
              data-testid="shortcuts-filter"
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
          {rows.length === 0 ? <p className="text-ui text-fg-3">No shortcuts are bound in this build.</p> : null}
          {scopes.map((scope) => (
            <section key={scope} className="flex flex-col gap-1">
              <h3 className="text-ui font-semibold text-fg-2">{SCOPE_LABEL[scope] ?? scope}</h3>
              <table className="w-full text-ui">
                <tbody>
                  {visible
                    .filter((row) => row.scope === scope)
                    .map((row) => (
                      <tr key={`${row.keys}|${row.label}`} className={row.available ? 'text-fg' : 'text-fg-3'}>
                        <td className="w-48 py-0.5 pr-3 align-top">
                          <Kbd>{row.keys}</Kbd>
                        </td>
                        <td className="py-0.5">
                          {row.label}
                          {row.available ? null : <span className="text-fg-3"> — not available yet</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
