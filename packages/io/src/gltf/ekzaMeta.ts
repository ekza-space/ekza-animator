// Adapted from ekza-avatar-renderer/src/normalization.ts @ 33c417c (MIT, © Ekza). Changes: returns the raw
// declared value (null when absent or not numeric) instead of a clamped scale defaulting to 1; the range check is the
// `ekza.height-scale-range` lint, and the surgeon never touches the value.
import type { GltfJson } from '../types';
import { isRecord, type JsonRecord } from './schema';

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Ekza's optional, model-owned height multiplier `extras.ekza.avatar.heightScale` (root `extras`, then
 * `asset.extras`, as the Space renderer reads it), or null.
 */
export function readEmbeddedAvatarHeightScale(json: GltfJson): number | null {
  const root = json as unknown as JsonRecord;
  const asset = root['asset'];
  for (const candidate of [root['extras'], isRecord(asset) ? asset['extras'] : undefined]) {
    const ekza = isRecord(candidate) ? candidate['ekza'] : undefined;
    const avatar = isRecord(ekza) ? ekza['avatar'] : undefined;
    if (isRecord(avatar) && 'heightScale' in avatar) return finiteNumber(avatar['heightScale']);
  }
  return null;
}
