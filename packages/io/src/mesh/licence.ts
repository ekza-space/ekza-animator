// The Make editable licence gate (M6A-SPEC §5.21 step 1, Q-SKIN-2): a VRM whose meta forbids modification is refused.
// VRM 1.0 says so in `meta.modification: 'prohibited'`; VRM 0.x has no modification field, and its no-derivatives
// licences (CC_BY_ND, CC_BY_NC_ND) are the equivalent (`readVrmLicense` maps them to 'prohibited'). Animation-only
// exports of such a character stay allowed: this gate covers geometry edits only.
import { detectModelFormat, readVrmLicense } from '../gltf/format';
import { isRecord, rootExtensions } from '../gltf/schema';
import type { GlbContainer } from '../types';

export function editLicence(
  container: GlbContainer,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  let format: ReturnType<typeof detectModelFormat>;
  try {
    format = detectModelFormat(container.json);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (format === 'gltf') return { ok: true };
  const licence = readVrmLicense(container);
  if (licence?.modification !== 'prohibited') return { ok: true };
  if (format === 'vrm1') {
    return {
      ok: false,
      reason:
        "This avatar's licence does not allow modification (VRM meta: modification 'prohibited'). " +
        'Its meshes stay read-only; animation-only exports are still allowed.',
    };
  }
  const meta = rootExtensions(container.json)['VRM'];
  const name = isRecord(meta) && isRecord(meta['meta']) ? meta['meta']['licenseName'] : undefined;
  return {
    ok: false,
    reason:
      `This avatar's licence${typeof name === 'string' ? ` (${name})` : ''} does not allow modification ` +
      '(no derivatives). Its meshes stay read-only; animation-only exports are still allowed.',
  };
}
