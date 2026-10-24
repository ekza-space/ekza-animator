// ① first fixes (AUTORIG-SPEC §5.2, AS-AR-5, AR-D10-2; moved from Auto-Rig ① by T5b): the subject's next fix in the
// order of `./checks` and the fix itself: one `autorig.fix` (one undo step), measured on the ticked parts and applied
// to the whole model (an unticked part follows, `with`), then the report again.
import type { MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, IntakeReport } from '../types';
import { firstFix, transformsUniform } from './checks';
import { type AutoRigFlowHost, enterRigWorkspace, runMessage } from './host';
import { reinspectSubject } from './intake';
import { leftOutParts } from './parts';
import { liveSubjectMeshes } from './subject';

/** The *Size* fix's default target height (metres; ①'s Set height field, `autorig.fix`'s own default). */
export const AUTORIG_TARGET_HEIGHT = 1.7;

/** The subject's next fix now (none without a report or a scene mesh). */
export function nextFix(host: Pick<AutoRigFlowHost, 'app' | 'state'>): AutoRigFix | null {
  const { intake, subject } = host.state.get();
  if (intake === null) return null;
  return firstFix(intake, transformsUniform(host.app, liveSubjectMeshes(host.app, subject)));
}

export type AutoRigFixOutcome =
  | { readonly status: 'finished'; readonly report: IntakeReport | null }
  | { readonly status: 'failed'; readonly error: string }
  /** No scene mesh to fix. */
  | { readonly status: 'skipped' };

/** `autorig.fix`'s arguments for the subject: the ticked parts measured, the unticked ones following (AR-D10-2). */
export function fixArgs(
  host: Pick<AutoRigFlowHost, 'app' | 'state'>,
  fix: AutoRigFix,
  height?: number,
): {
  readonly fix: AutoRigFix;
  readonly meshes: readonly MeshId[];
  readonly height?: number;
  readonly with?: readonly MeshId[];
} | null {
  const meshes = liveSubjectMeshes(host.app, host.state.get().subject);
  if (meshes.length === 0) return null;
  const others = leftOutParts(host.app, host.state.get());
  return {
    fix,
    meshes,
    ...(height === undefined ? {} : { height }),
    ...(others.length === 0 ? {} : { with: others }),
  };
}

/** A one-click fix (§5.2): one `autorig.fix` (the person's run, one undo step), then the report again. */
export async function applyFix(host: AutoRigFlowHost, fix: AutoRigFix, height?: number): Promise<AutoRigFixOutcome> {
  if (liveSubjectMeshes(host.app, host.state.get().subject).length === 0) return { status: 'skipped' };
  await enterRigWorkspace(host);
  const args = fixArgs(host, fix, height);
  if (args === null) return { status: 'skipped' };
  const result = await host.run('autorig.fix', args);
  if (result.status !== 'finished') return { status: 'failed', error: runMessage(result) };
  return { status: 'finished', report: await reinspectSubject(host) };
}
