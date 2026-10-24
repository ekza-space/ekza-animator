// ① checks in the order their fixes run (AUTORIG-SPEC §5.2, AS-AR-5; moved from Auto-Rig ① by T5b): stand up, size,
// freeze, centre (and ground), face — the footer's next fix and the report's rows in the wizard, the Checks list in
// Halo (STUDIO-TOUCH-SPEC §12.1). Pure and import-free: Auto-Rig's first visit reads it (the ① footer), so it stays a
// module of its own, off the flow's runs.
import type { MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, EditorApp, IntakeReport } from '../types';

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
