import type { ControlRecord } from '@ekza-studio/doc';
import type { RigInternals } from '../kernel/internals';
import type { RigWarning } from '../types';

/** Fallback character height when the skeleton reports none (metres). */
const DEFAULT_HEIGHT = 1.7;

/**
 * Structural checks that do not change evaluation: sided controls without a mirror counterpart, mirror pairs whose
 * rest positions are not mirror images (|M·p_L − p_R| > 0.01·H), and driven bones under non-uniform rest scale.
 */
export function checkRig(internals: RigInternals, warnings: RigWarning[]): void {
  const { controls, mirror, controlRest, skeleton } = internals;
  const height = Number.isFinite(skeleton.height) && skeleton.height > 0 ? skeleton.height : DEFAULT_HEIGHT;
  controls.forEach((control: ControlRecord, slot) => {
    if (control.side === 'C') return;
    const other = mirror[slot] as number;
    if (other === -1) {
      warnings.push({
        code: 'unpaired-mirror',
        message: `${control.key}: no mirror counterpart; mirroring leaves it unchanged`,
        ids: [control.id],
      });
      return;
    }
    if (control.side !== 'L') return;
    const dx = -(controlRest.t[slot * 3] as number) - (controlRest.t[other * 3] as number);
    const dy = (controlRest.t[slot * 3 + 1] as number) - (controlRest.t[other * 3 + 1] as number);
    const dz = (controlRest.t[slot * 3 + 2] as number) - (controlRest.t[other * 3 + 2] as number);
    if (Math.hypot(dx, dy, dz) > 0.01 * height) {
      const counterpart = controls[other] as ControlRecord;
      warnings.push({
        code: 'asymmetric-rest',
        message: `${control.key} and ${counterpart.key} are not mirror images at rest; mirrored poses may drift`,
        ids: [control.id, counterpart.id],
      });
    }
  });

  const nonUniform: string[] = [];
  for (let node = 0; node < internals.nodeCount; node++) {
    if (internals.driver[node] === -1) continue;
    const sx = internals.restWorld.s[node * 3] as number;
    const sy = internals.restWorld.s[node * 3 + 1] as number;
    const sz = internals.restWorld.s[node * 3 + 2] as number;
    const scale = Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz));
    // 1e-4 relative: float32 rest data carries scale noise of a few 1e-7 that is not worth a warning.
    if (sx <= 0 || sy <= 0 || sz <= 0 || Math.abs(sx - sy) > 1e-4 * scale || Math.abs(sx - sz) > 1e-4 * scale) {
      nonUniform.push(skeleton.nodes[node]?.name ?? `#${node}`);
    }
  }
  if (nonUniform.length > 0) {
    warnings.push({
      code: 'non-uniform-scale',
      message: `Driven bones under non-uniform or negative scale evaluate approximately: ${nonUniform.join(', ')}`,
      ids: nonUniform,
    });
  }
}
