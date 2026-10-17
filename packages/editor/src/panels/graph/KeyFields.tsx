// Numeric fields of the selected keys (MVP-SPEC §4.11.4, research 09 §4.7 stats fields): frame, value (degrees for
// rotations), in/out angle and in/out weight (weighted curves only), with expressions; multi-selections show '—'
// and apply relative input (+=, -=) to every key. Edits run `graph.keys.setFields`.
import type { EditorApp } from '@ekza-animator/editor-core';
import { type JSX, useMemo } from 'react';
import { NumberField, PartBoundary } from './controls';
import {
  type FieldInput,
  fieldArgs,
  formatField,
  frameValueFields,
  type KeyField,
  type SelectedKey,
  tangentFieldValues,
} from './model';
import { runGraphOperator } from './run';

function commitField(app: EditorApp, field: KeyField, text: string, current: number | null): string | null {
  let input: FieldInput;
  try {
    input = fieldArgs(field, text, current);
  } catch (error) {
    return error instanceof Error ? error.message : 'Cannot read this expression';
  }
  if (!input.ok) return input.error;
  runGraphOperator(app, 'graph.keys.setFields', input.args);
  return null;
}

export function KeyFields(props: { readonly app: EditorApp; readonly keys: readonly SelectedKey[] }): JSX.Element {
  const { app, keys } = props;
  const base = useMemo(() => frameValueFields(keys), [keys]);
  const none = base.count === 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="ge-fields">
      <NumberField
        testId="ge-field-frame"
        label="Frame"
        value={formatField(base.frame, 'frame')}
        disabled={none}
        onCommit={(text) => commitField(app, 'frame', text, base.frame)}
      />
      <NumberField
        testId="ge-field-value"
        label="Value"
        value={formatField(base.value, 'value')}
        disabled={none}
        title="Degrees for rotation channels"
        onCommit={(text) => commitField(app, 'value', text, base.value)}
      />
      {/* Resolved-handle fields depend on the curve engine; a failure there must not take the frame/value fields
          down. `keys` is re-read on every key change, so a new selection or edit retries a failed part. */}
      <PartBoundary resetKey={keys} fallback={<TangentFieldsUnavailable />}>
        <TangentFields app={app} keys={keys} />
      </PartBoundary>
    </div>
  );
}

function TangentFields(props: { readonly app: EditorApp; readonly keys: readonly SelectedKey[] }): JSX.Element {
  const { app, keys } = props;
  const none = keys.length === 0;
  const fields = useMemo(
    () =>
      keys.length === 0
        ? { inAngle: null, outAngle: null, inWeight: null, outWeight: null, weighted: false }
        : tangentFieldValues(app, keys),
    [app, keys],
  );
  const angleTitle = 'Degrees, Maya convention: time in seconds, values in display units';
  return (
    <>
      <NumberField
        testId="ge-field-in-angle"
        label="In"
        value={formatField(fields.inAngle, 'inAngleDeg')}
        disabled={none}
        title={angleTitle}
        onCommit={(text) => commitField(app, 'inAngleDeg', text, fields.inAngle)}
      />
      <NumberField
        testId="ge-field-out-angle"
        label="Out"
        value={formatField(fields.outAngle, 'outAngleDeg')}
        disabled={none}
        title={angleTitle}
        onCommit={(text) => commitField(app, 'outAngleDeg', text, fields.outAngle)}
      />
      <NumberField
        testId="ge-field-in-weight"
        label="In W"
        value={formatField(fields.inWeight, 'inWeight')}
        disabled={none || !fields.weighted}
        title="Weighted curves only"
        onCommit={(text) => commitField(app, 'inWeight', text, fields.inWeight)}
      />
      <NumberField
        testId="ge-field-out-weight"
        label="Out W"
        value={formatField(fields.outWeight, 'outWeight')}
        disabled={none || !fields.weighted}
        title="Weighted curves only"
        onCommit={(text) => commitField(app, 'outWeight', text, fields.outWeight)}
      />
    </>
  );
}

function TangentFieldsUnavailable(): JSX.Element {
  return (
    <span className="text-[11px] italic text-fg-3" data-testid="ge-fields-unavailable">
      Tangent fields unavailable
    </span>
  );
}
