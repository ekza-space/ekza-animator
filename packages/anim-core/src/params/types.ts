// Contract file: M6A-SPEC §4.1 (parameter descriptions), copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec. The functions of §4.1 live in
// ./index.ts.

/** Scalar kinds. Compound DCC attributes are flattened per component (`localTranslateX/Y/Z`), so every param is a
 *  scalar and can be the primary field; structured pointer/selection data uses kind 'data'. */
export type ParamKind = 'number' | 'int' | 'distance' | 'angle' | 'fraction' | 'bool' | 'enum' | 'axis' | 'data';
/** 'fraction': stored 0…1, shown as a fraction ('0.300'); typed '30%' and '0.3' are the same value (§1, §5.10). */
/**
 * Where the value comes from (ADR 0016 D6):
 * - 'value': chosen by the user; kept by Adjust Last and Repeat Last.
 * - 'selection': resolved from the current component selection when absent (a loop seed, bridge loops in pick order);
 *   the resolved value is recorded in LastRun so an adjusted re-run is bit-identical; Repeat Last drops it and
 *   re-resolves it from the then-current selection.
 * - 'pointer': supplied by a tool from pointer picks (Multi-Cut points, Target Weld pairs, a slide rail); recorded for
 *   Adjust Last; an operation with a required pointer-bound param is never repeatable (`G` re-activates its tool).
 */
export type ParamBound = 'selection' | 'pointer' | 'value';
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- verbatim contract (JsonValue includes the scalars)
export type ParamValue = number | boolean | string | null | JsonValue;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };
export interface ParamDef {
  readonly name: string;                       // JSON arg name; the DCC-standard parameter name where one exists
  readonly label: string;                      // UI label, DCC-standard wording: 'Local Translate Z', 'Divisions'
  readonly kind: ParamKind;
  readonly bound: ParamBound;
  /** Default; null only with `nullable` ("auto", resolved at invoke time, e.g. smoothingAngle). */
  readonly default: ParamValue;
  readonly nullable?: boolean;
  /** Hard limits in stored units (values outside are clamped by `coerceArgs`, with a problem string). */
  readonly min?: number;
  readonly max?: number;
  /** Slider range for the virtual slider and the option box (stored units). */
  readonly softMin?: number;
  readonly softMax?: number;
  /** Arrow and virtual-slider step in stored units (int: 1; angle: 1° = π/180; distance: 0.01). */
  readonly step?: number;
  /** enum and axis: the allowed string values with labels ('x' | 'y' | 'z' for axis). */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** At most one per list: typed digits after a keyboard-invoked run and `T` go here. */
  readonly primary?: boolean;
  /** Not shown in the Last-op card or INPUTS ('data' params are always hidden). */
  readonly hidden?: boolean;
  /** JSON schema of a 'data' param (draft 2020-12 subset: type, properties, items, required, enum, minimum, maximum). */
  readonly schema?: JsonValue;
  /** Card section label ('Offsets', 'Shape'); fields keep list order. */
  readonly group?: string;
  readonly description?: string;
}
export type ParamValues = Readonly<Record<string, ParamValue>>;
