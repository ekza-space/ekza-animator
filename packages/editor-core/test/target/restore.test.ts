// CHARACTER-CONTRACT-SPEC §8.14 (C2): what a Studio-written file recorded per clip comes back on import — slot,
// contact (seconds → frames), root motion, tags, the label as the clip's name and the named markers; another tool's
// file (or an entry that is not Studio's) changes nothing.
import type { ClipId, ClipRecord, CharacterId } from '@ekza-studio/doc';
import type { GlbContainer } from '@ekza-studio/io';
import { describe, expect, it } from 'vitest';
import type { ClipWritePlan } from '../../src/workflows/clipWrite';
import { embeddedClipSettings, withRestoredSettings } from '../../src/workflows/ekzaClipRestore';

const container = (tool: string, clip: Record<string, unknown>): GlbContainer =>
  ({
    json: {
      asset: { version: '2.0', extras: { ekza_animation_v1: { schema: 1, clips: [clip], provenance: { tool } } } },
    },
  }) as unknown as GlbContainer;

const PLAN = {
  clip: {
    id: 'clp_restore000000001' as ClipId,
    character: 'chr_restore000000001' as CharacterId,
    name: 'skill.wild_zap.release',
    slot: null,
    fps: { num: 30, den: 1 },
    range: { start: 0, end: 15 },
    loop: false,
    rootMotion: 'hips',
    contact: null,
    tags: [],
  } as unknown as ClipRecord,
  layer: {},
  curves: [],
  stats: { sourceKeys: 0, keys: 0, maxReduceError: 0 },
} as unknown as ClipWritePlan;

describe('the clip metadata round-trip', () => {
  const entry = {
    index: 0,
    name: 'skill.wild_zap.release',
    slot: 'skill.wild_zap.release',
    rootMotion: 'in-place',
    contactSeconds: 0.1,
    tags: ['omoba', 'Bad Tag'],
    label: 'Shockline (W) — release',
    markers: { release: 0.2, contact: 0.3 },
  };

  it('restores slot, contact, root motion, tags, the label as the name and the named markers', () => {
    const restored = withRestoredSettings(PLAN, embeddedClipSettings(container('ekza-animator', entry), 0));
    expect(restored.clip).toMatchObject({
      name: 'Shockline W - release',
      slot: 'skill.wild_zap.release',
      rootMotion: 'in-place',
      contact: 3,
      tags: ['omoba'],
    });
    expect((restored as { markers?: Record<string, number> }).markers).toEqual({ release: 6 });
  });

  it("leaves another tool's file alone", () => {
    expect(embeddedClipSettings(container('other-tool', entry), 0)).toBeNull();
    expect(withRestoredSettings(PLAN, null)).toBe(PLAN);
  });
});
