// The Validation panel (M6B-SPEC §8.12, §5.21, §0.4.5; C7): the active character's rows under the chosen profile, as
// the export gate. Header: Profile [▾] · ✕ errors ⚠ warnings ℹ infos · [Re-run]; one row per problem with Select (the
// mode, the selection and frames it: joints → Skeleton, points → Skin; `selectValidationRow`) and Fix (a named
// operator, one undo step); [Re-run] forgets the cached rows; the footer says which profiles the character is ready
// for and opens Export Character…. A lazy chunk (panels/index.ts registers it).
import {
  PANEL,
  profileKind,
  RIG_PROFILES,
  type RigValidationRow,
  type RunContext,
  selectValidationRow,
} from '@ekza-studio/editor-core';
import { NativeSelect } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useRunOperator, useSession } from '../../hooks';
import { useRig } from '../../shell/rig/hooks';
import type { PanelProps } from '../types';

const CTX: RunContext = { panel: PANEL.validation, source: 'toolkit' };
const GLYPH: Readonly<Record<RigValidationRow['severity'], string>> = { error: '✕', warning: '⚠', info: 'ℹ' };
const BUTTON =
  'inline-flex h-6 items-center rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-2 text-[11px] text-fg ' +
  'hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] disabled:cursor-not-allowed disabled:opacity-50';

export default function ValidationView(props: PanelProps): JSX.Element {
  const { app } = props;
  const validation = useRig(app);
  const character = useSession((s) => s.rig.character);
  const run = useRunOperator();
  if (validation === null || character === null) {
    return (
      <div className="grid h-full place-items-center p-4 text-ui text-fg-3" data-testid="val-panel">
        {validation === null ? 'Loading Rig & Skin…' : 'No character to validate'}
      </div>
    );
  }
  const profile = validation.profile;
  const rows = validation.rows(character, null);
  const count = (severity: RigValidationRow['severity']): number =>
    rows.filter((row) => row.severity === severity).length;
  const ready = RIG_PROFILES.map((entry) => ({
    ...entry,
    ok: !validation.rows(character, entry.id).some((row) => row.severity === 'error'),
  }));
  return (
    <div className="flex h-full flex-col gap-1 overflow-auto p-2 text-ui text-fg-2" data-testid="val-panel">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg">Validation</span>
        <span className="text-fg-3">Profile</span>
        <NativeSelect
          aria-label="Validation profile"
          data-testid="val-profile"
          className="h-6"
          value={profile}
          options={RIG_PROFILES.map((entry) => ({ value: entry.id, label: entry.label }))}
          onChange={(event) => void run('rig.validation.profile', { profile: event.target.value }, CTX)}
        />
        <span data-testid="val-counts">
          ✕ {count('error')} ⚠ {count('warning')} ℹ {count('info')}
        </span>
        <span className="text-fg-3">({profileKind(profile) === 'plain' ? 'plain' : 'VRM / Ekza'})</span>
        <button type="button" className={BUTTON} data-testid="val-rerun" onClick={() => validation.rerun()}>
          Re-run
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="text-fg-3" data-testid="val-clean">
          No problems for this profile
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((row, i) => (
            <li
              key={`${row.code}:${row.ids.join(',')}:${i}`}
              className="flex items-center gap-2"
              data-testid={`val-row-${row.code}`}
              data-severity={row.severity}
            >
              <span className="w-3 text-center" aria-label={row.severity}>
                {GLYPH[row.severity]}
              </span>
              <code className="w-48 shrink-0 truncate text-fg-3">{row.code}</code>
              <span className="min-w-0 flex-1 truncate" title={row.message}>
                {row.message}
              </span>
              <button
                type="button"
                className={BUTTON}
                data-testid={`val-select-${row.code}`}
                onClick={() => void selectValidationRow(app, row, CTX)}
              >
                Select
              </button>
              {row.fix === null ? null : (
                <button
                  type="button"
                  className={BUTTON}
                  data-testid={`val-fix-${row.code}`}
                  onClick={() => void run(row.fix?.op ?? '', row.fix?.args, CTX)}
                >
                  Fix: {row.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-1">
        <span data-testid="val-ready">
          Ready for: {ready.map((entry) => `${entry.label} ${entry.ok ? '✓' : '✕'}`).join(' · ')}
        </span>
        <button
          type="button"
          className={BUTTON}
          data-testid="val-export"
          onClick={() => void run('ui.open', { dialog: 'export' }, CTX)}
        >
          Export character…
        </button>
      </footer>
    </div>
  );
}
