// M6B-SPEC §5.25 row "Character export (3k tris, 34 joints, five clips × 60 frames, validator off) ≤ 500 ms" (C10 bench,
// report-only): Polybot's T-pose mesh (2,130 triangles) as a model character with the Standard 33 truth joints (34 with
// the root helper), bound, five slot clips of 60 frames keyed on four controls, VRM meta and thumbnail; the median of
// three `file.exportCharacter` runs (VRM 1.0, Space profile, validator off) is annotated, never asserted.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { type EditorApp, loadMeshKernel } from '@ekza-studio/editor-core';
import type { CharacterReadBack } from '@ekza-studio/io';
import { beforeAll, describe, expect, it } from 'vitest';
import { realApp, runOk, setSceneFrame } from './ops.support';
import { bodyCharacter, exportCharacter, settled } from './m6b.writer.support';

const DEG = Math.PI / 180;
const SLOTS = ['idle', 'walk', 'attack', 'cast', 'death'] as const;
const KEYED = ['fk.upperArm.L', 'fk.upperArm.R', 'fk.lowerArm.L', 'fk.spine'] as const;

beforeAll(async () => {
  await loadMeshKernel();
});

async function sixtyFrameClip(a: EditorApp, character: CharacterId, slot: string, phase: number): Promise<ClipId> {
  const { clip } = (await runOk(a, 'clip.new', { character, name: slot, range: { start: 0, end: 60 } })) as {
    clip: ClipId;
  };
  await runOk(a, 'clip.setSettings', { clip, slot });
  const rig = a.store.query.rigOfCharacter(character);
  for (const key of KEYED) {
    const control = rig === undefined ? undefined : a.store.query.controlByKey(rig.id, key);
    if (control === undefined) continue;
    for (const frame of [0, 20, 40, 60]) {
      setSceneFrame(a, frame);
      const degrees = 15 * Math.sin((frame / 60) * 2 * Math.PI + phase);
      await runOk(a, 'channel.setValues', {
        edits: [{ control: control.id, channel: 'rz', value: degrees * DEG }],
        key: 'force',
      });
    }
  }
  return clip;
}

describe('character export bench (§5.25, report-only)', { timeout: 300_000 }, () => {
  it('Polybot T-pose, 34 joints, five clips × 60 frames, validator off', async ({ annotate }) => {
    const { app } = realApp({ validator: false });
    const { character } = await bodyCharacter(app, { source: 'polybot', name: 'Polybot Lad' });
    for (const [i, slot] of SLOTS.entries()) await sixtyFrameClip(app, character, slot, i);
    await runOk(app, 'char.setVrmMeta', { character, patch: { authors: ['Bench'], licensePreset: 'cc0' } });
    await runOk(app, 'char.renderThumbnail', { character });
    await settled(app);
    const times: number[] = [];
    let readBack: CharacterReadBack | null = null;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      const artifact = await exportCharacter(app, { character, validate: false });
      times.push(performance.now() - start);
      readBack = artifact.readBack as CharacterReadBack;
    }
    const median = [...times].sort((a, b) => a - b)[1] ?? Number.NaN;
    expect(readBack?.animations).toBe(5);
    await annotate(
      `character export: median ${median.toFixed(0)} ms of ${times.map((t) => t.toFixed(0)).join('/')} ms ` +
        `(${readBack?.tris} tris, ${readBack?.joints} joints, 5 clips × 60 frames; budget 500 ms, report-only)`,
      'bench',
    );
  });
});
