// Numeric fields of the selected keys (MVP-SPEC §4.11.4, research 09 §4.7 stats fields): frame, value (degrees for
// rotations), in/out angle and in/out weight (weighted curves only), with expressions; multi-selections show '—'
// and apply relative input (+=, -=) to every key. Edits run `graph.keys.setFields`.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { JSX } from 'react';
import { NumberField } from './controls';
import { type FieldInput, fieldArgs, formatField, type KeyField, type KeyFieldValues } from './model';
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

/**
 * Takes the derived `KeyFieldValues`, never the selected keys: a large selection would make every key change a
 * large prop change (React's development build diffs changed props for its performance track).
 */
export function KeyFields(props: { readonly app: EditorApp; readonly fields: KeyFieldValues }): JSX.Element {
  const { app, fields } = props;
  const none = fields.count === 0;
  const tangent = fields.tangent;
  const angleTitle = 'Degrees, DCC convention: time in seconds, values in display units';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="ge-fields">
      <NumberField
        testId="ge-field-frame"
        label="Frame"
        value={formatField(fields.frame, 'frame')}
        disabled={none}
        onCommit={(text) => commitField(app, 'frame', text, fields.frame)}
      />
      <NumberField
        testId="ge-field-value"
        label="Value"
        value={formatField(fields.value, 'value')}
        disabled={none}
        title="Degrees for rotation channels"
        onCommit={(text) => commitField(app, 'value', text, fields.value)}
      />
      {tangent === null ? (
        <span className="text-[11px] italic text-fg-3" data-testid="ge-fields-unavailable">
          Tangent fields unavailable
        </span>
      ) : (
        <>
          <NumberField
            testId="ge-field-in-angle"
            label="In"
            value={formatField(tangent.inAngle, 'inAngleDeg')}
            disabled={none}
            title={angleTitle}
            onCommit={(text) => commitField(app, 'inAngleDeg', text, tangent.inAngle)}
          />
          <NumberField
            testId="ge-field-out-angle"
            label="Out"
            value={formatField(tangent.outAngle, 'outAngleDeg')}
            disabled={none}
            title={angleTitle}
            onCommit={(text) => commitField(app, 'outAngleDeg', text, tangent.outAngle)}
          />
          <NumberField
            testId="ge-field-in-weight"
            label="In W"
            value={formatField(tangent.inWeight, 'inWeight')}
            disabled={none || !tangent.weighted}
            title="Weighted curves only"
            onCommit={(text) => commitField(app, 'inWeight', text, tangent.inWeight)}
          />
          <NumberField
            testId="ge-field-out-weight"
            label="Out W"
            value={formatField(tangent.outWeight, 'outWeight')}
            disabled={none || !tangent.weighted}
            title="Weighted curves only"
            onCommit={(text) => commitField(app, 'outWeight', text, tangent.outWeight)}
          />
        </>
      )}
    </div>
  );
}
