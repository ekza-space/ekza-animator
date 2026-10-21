// C9 (control shapes; deferred after the MVP, M6B-SPEC §0.3, §5.20). C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ControlId, ControlShape } from '@ekza-studio/doc';
import type { RigDefinition, SkeletonDesc } from '../types';

const stub = (symbol: string): never => {
  throw new EkzaError('not-implemented', `rig.${symbol}`);
};

/** Control-local delta. */
export function transformShape(
  _shape: ControlShape,
  _delta: { readonly t?: readonly number[]; readonly q?: readonly number[]; readonly s?: readonly number[] },
  _pivot: readonly number[],
): ControlShape {
  return stub('transformShape');
}
/** Converts to 'custom'. */
export function editShapePoints(
  _shape: ControlShape,
  _edits: readonly { readonly spline: number; readonly anchor: number; readonly delta: readonly number[] }[],
): ControlShape {
  return stub('editShapePoints');
}
export function mirrorShape(
  _shape: ControlShape,
  _restRotation: readonly number[],
  _counterpartRestRotation: readonly number[],
): ControlShape {
  return stub('mirrorShape');
}
export function generatedShape(_def: RigDefinition, _skeleton: SkeletonDesc, _control: ControlId): ControlShape | null {
  return stub('generatedShape');
}
