// The gating rows of a character export (M6B-SPEC §8.13, §5.21; C10; CR-AR-1 host-agnostic body): the profile's
// Validation rows (C7's service once the rig chunk has loaded) and the VRM meta rows, errors first. Errors block the
// Export button; each row names its code (the e2e and the Validation panel use the same codes).
import type { CharacterId } from '@ekza-studio/doc';
import { characterExportRows, type EditorApp } from '@ekza-studio/editor-core';
import type { LintIssue } from '@ekza-studio/io';
import { Badge, CircleCheck } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { useDocQuery } from '../../../hooks';

/** Tables whose changes can change a row (skeleton, skin, rig, meta, thumbnail). */
const ROW_TABLES = [
  'characters',
  'skeletons',
  'joints',
  'meshes',
  'rigs',
  'controls',
  'assets',
  'palettes',
  'swatches',
] as const;
const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** The rows of a character for a profile and format, re-read on document changes and once the rig chunk loads. */
export function useCharacterRows(
  app: EditorApp,
  character: CharacterId | null,
  profile: string | null,
  format: 'vrm' | 'glb',
): readonly LintIssue[] {
  const [rigLoaded, setRigLoaded] = useState(app.rig.loaded);
  useEffect(() => {
    if (app.rig.loaded) return;
    let live = true;
    app.rig
      .load()
      .then(() => {
        if (live) setRigLoaded(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [app]);
  const version = useDocQuery((store) => ({ store }), [...ROW_TABLES]);
  void version;
  void rigLoaded;
  if (character === null) return [];
  return [...characterExportRows(app, character, profile, format)].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code),
  );
}

export function CharacterChecks(props: { readonly rows: readonly LintIssue[] }): JSX.Element {
  if (props.rows.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-ui text-fg-2" data-testid="export-char-clean">
        <CircleCheck size={14} className="text-ok" />
        Ready to export: no Validation row for this profile.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5" data-testid="export-char-rows">
      {props.rows.map((row) => (
        <li
          key={`${row.code}:${row.message}`}
          className="flex gap-2 text-ui"
          data-testid={`export-char-row-${row.code}`}
        >
          <Badge tone={row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warn' : 'info'}>
            {row.severity}
          </Badge>
          <span className="font-mono text-ui-dense text-fg-3">{row.code}</span>
          <span className="text-fg-2">{row.message}</span>
        </li>
      ))}
    </ul>
  );
}
