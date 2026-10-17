// WP-4 stub: final signature (MVP-SPEC §7 WP-4, §4.11.13); throws until the lints land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ExportKind, ExportProfileDef, LintIssue } from '../types';

export function lintExport(
  _kind: ExportKind,
  _bytes: Uint8Array,
  _profile: ExportProfileDef | null,
): Promise<readonly LintIssue[]> {
  throw new EkzaError('not-implemented', 'io.lintExport');
}
