// ① check helpers shared by the frame's footer and the report (AUTORIG-SPEC §5.2; D3): the order the fixes should
// run in and the transforms row (C1 refuses a non-uniform or negative object scale: "Freeze Transformations first").
// The order and the rule are editor-core's `autorigFlow` (T5b, shared with Halo's Checks); the labels are ①'s.
import type { MeshId } from '@ekza-studio/doc';
import { type AutoRigFix, transformsUniform as flowTransformsUniform } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';

/** The first failing check's fix, in the order the fixes should run (§5.2; AS-AR-5: stand up, size, centre, face). */
export { firstFix } from '@ekza-studio/editor-core';

const t = (): ReturnType<typeof messages>['model'] => messages().model;

export const FIX_LABEL: Readonly<Record<AutoRigFix, () => string>> = {
  center: () => t().fixCenter,
  face: () => t().fixFace,
  standUp: () => t().fixStandUp,
  scale: () => t().fixScale,
  freeze: () => t().fixFreeze,
};

/** The subject's scene meshes all have a positive uniform scale (C1 refuses others: "Freeze Transformations first"). */
export function transformsUniform(ctx: WizardContext, meshes: readonly MeshId[]): boolean {
  return flowTransformsUniform(ctx.app, meshes);
}
