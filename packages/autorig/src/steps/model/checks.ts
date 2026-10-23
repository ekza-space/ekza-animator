// ① check helpers shared by the frame's footer and the report (AUTORIG-SPEC §5.2; D3): the order the fixes should
// run in and the transforms row (C1 refuses a non-uniform or negative object scale: "Freeze Transformations first").
import type { MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, IntakeReport } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';

const t = (): ReturnType<typeof messages>['model'] => messages().model;

/** The first failing check's fix, in the order the fixes should run (§5.2; AS-AR-5: stand up, size, centre, face). */
export function firstFix(report: IntakeReport, transformsOk: boolean): AutoRigFix | null {
  const c = report.checks;
  if (!c.upright) return 'standUp';
  if (c.scale !== 'ok') return 'scale';
  if (!transformsOk) return 'freeze';
  if (!c.centred || !c.grounded) return 'center';
  if (!c.facing) return 'face';
  return null;
}

export const FIX_LABEL: Readonly<Record<AutoRigFix, () => string>> = {
  center: () => t().fixCenter,
  face: () => t().fixFace,
  standUp: () => t().fixStandUp,
  scale: () => t().fixScale,
  freeze: () => t().fixFreeze,
};

/** The subject's scene meshes all have a positive uniform scale (C1 refuses others: "Freeze Transformations first"). */
export function transformsUniform(ctx: WizardContext, meshes: readonly MeshId[]): boolean {
  return meshes.every((id) => {
    const s = ctx.app.store.get('meshes', id)?.placement.s;
    if (s === undefined) return true;
    const max = Math.max(...s.map(Math.abs));
    return s.every((v) => v > 0) && max - Math.min(...s) <= 1e-6 * max;
  });
}
