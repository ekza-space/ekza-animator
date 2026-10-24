// How much *Straighten to T-Pose* tore the model (AUTORIG-SPEC §5.4; AR-R4-3, the owner's call on round 4's arms-down
// Wang): the measure (the length the straightened edges grew beyond twice their length before, over the character's
// height; ③ warns above `STRETCH_LIMIT` instead of *All good*, for as long as the meshes keep the straightened points)
// is editor-core's `autorigFlow` (T5b, shared with Halo's readiness). This module binds it to the wizard: the subject
// character of the session, the measure into the `rig` slice. Nothing here writes the document.
import type { CharacterId } from '@ekza-studio/doc';
import { flowCharacterId, watchStraighten as flowWatchStraighten } from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';
import { flowHost } from '../model/flowHost';

export { pointsKey, STRETCH_LIMIT, type StretchData, tornLength, tornNow, tornShare } from '@ekza-studio/editor-core';

/**
 * Watches the history while a run may straighten (*Bind again*, the `skel.tpose` row's Fix, or while ③ is open; the
 * Auto-rig composition is watched by the flow's `runRig`): when *Straighten to T-Pose* lands on top, the stretch it
 * made is recorded in the `rig` slice (`straightened`) once the meshes hold the baked points. Resolves `done()` when
 * the last measure was recorded; `stop()` ends the watch.
 */
export function watchStraighten(ctx: Pick<WizardContext, 'app' | 'session'>): {
  readonly stop: () => void;
  readonly done: () => Promise<void>;
} {
  const host = flowHost(ctx);
  return flowWatchStraighten(
    ctx.app,
    (): CharacterId | null => flowCharacterId(host),
    (straightened) => ctx.session.patch('rig', { straightened }),
  );
}
