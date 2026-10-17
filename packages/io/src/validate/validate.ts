// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4, §4.11.13); bodies throw until validation lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { BakedClip, ExportKind, ReadBackReport, ValidationIssue, ValidationReport } from '../types';

export function readBackCheck(
  _kind: ExportKind,
  _bytes: Uint8Array,
  _expected: readonly BakedClip[],
  _skeleton: SkeletonDesc,
): Promise<ReadBackReport> {
  throw new EkzaError('not-implemented', 'io.readBackCheck');
}

export function validateGltf(_bytes: Uint8Array, _opts?: { readonly maxIssues?: number }): Promise<ValidationReport> {
  throw new EkzaError('not-implemented', 'io.validateGltf');
}

/** Error-severity issues of `output` whose (code, pointer) is absent from `source` (§4.11.13). */
export function compareValidation(_source: ValidationReport, _output: ValidationReport): readonly ValidationIssue[] {
  throw new EkzaError('not-implemented', 'io.compareValidation');
}
