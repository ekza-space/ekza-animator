// ① first fixes (AUTORIG-SPEC §5.2, AS-AR-5, AR-D10-2; moved from Auto-Rig ① by T5b): the order the one-click fixes
// should run in — stand up, size, freeze, centre, face — and the fix itself: one `autorig.fix` (one undo step),
// measured on the ticked parts and applied to the whole model (an unticked part follows, `with`), then the report
// again. Halo's Checks list the same rows in the same order (STUDIO-TOUCH-SPEC §12.1).
import type { MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, EditorApp, IntakeReport } from '../types';
import { type AutoRigFlowHost, type AutoRigFlowState, enterRigWorkspace, runMessage } from './host';
import { reinspectSubject } from './intake';
import { liveSubjectMeshes } from './subject';

/** The order the fixes run in (§5.2; AS-AR-5): stand up, size, freeze, centre (and ground), face. */
export const AUTORIG_FIX_ORDER: readonly AutoRigFix[] = ['standUp', 'scale', 'freeze', 'center', 'face'];

/** The first failing check's fix, in {@link AUTORIG_FIX_ORDER} (`transformsOk`: {@link transformsUniform}). */
export function firstFix(report: IntakeReport, transformsOk: boolean): AutoRigFix | null {
  const c = report.checks;
  if (!c.upright) return 'standUp';
  if (c.scale !== 'ok') return 'scale';
  if (!transformsOk) return 'freeze';
  if (!c.centred || !c.grounded) return 'center';
  if (!c.facing) return 'face';
  return null;
}

/** The meshes all have a positive uniform scale (C1 refuses others: "Freeze Transformations first"). */
export function transformsUniform(app: EditorApp, meshes: readonly MeshId[]): boolean {
  return meshes.every((id) => {
    const s = app.store.get('meshes', id)?.placement.s;
    if (s === undefined) return true;
    const max = Math.max(...s.map(Math.abs));
    return s.every((v) => v > 0) && max - Math.min(...s) <= 1e-6 * max;
  });
}

/** The scene meshes of the loaded model left out of the character (the unticked parts that still exist). */
export function leftOutParts(app: EditorApp, state: Pick<AutoRigFlowState, 'parts' | 'intake'>): MeshId[] {
  const parts = state.parts;
  if (parts === null || state.intake === null) return [];
  const ticked = new Set(parts);
  return state.intake.meshes.filter((id) => !ticked.has(id) && app.store.get('meshes', id) !== undefined);
}

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
