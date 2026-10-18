import { expect, test } from '@playwright/test';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// M1-stretch items that were not built (MVP-SPEC §1.2, status at acceptance round 1). Their scenarios are declared
// here as `test.fixme` with the reason, so the e2e report lists them next to E2E-00…E2E-27 (§8.2: stretch items are
// excepted and listed in the release notes). Write the body and drop `fixme` when an item lands (FR-GE-17: M2a). The built stretch
// items (plateau, mesh-click picking, camera radial, one-button profile, rotate-order change, `bevy.*` lints) and the
// storage-blocked and context-loss checks (resilience.spec.ts) are covered elsewhere.

const notBuilt = (requirement: string, why: string) => ({
  annotation: { type: 'M1-stretch', description: `${requirement}: ${why}` },
});

test.fixme(
  'stretch FR-IO-10: an animation-only GLB imports onto a loaded character by node name',
  notBuilt(
    'FR-IO-10',
    'not built; file.importAnimation answers "No animation … fits the character". Acceptance: re-importing an ' +
      'E2E-18 export onto UAL reproduces the channel values within 1e-4 rad.',
  ),
  () => {
    throw new Error('M1-stretch item not built');
  },
);

// FR-GE-17 landed in M2a (M2A-SPEC §5.23, A0): the editor compiles curves with cycle-aware auto tangents.
test('stretch FR-GE-17: cycle-aware auto tangents when both infinities cycle', async ({ page }) => {
  const DEG = Math.PI / 180;
  await openEditor(page);
  await expectKernelStarted(page);
  const wave = await seedWaveClip(page);
  await runOk(page, 'graph.infinity.set', { pre: 'cycle', post: 'cycle' });
  const slopes = async () => ({
    left: await call(page, 'curveSlope', wave.rz, 30, 'left'),
    right: await call(page, 'curveSlope', wave.rz, 0, 'right'),
  });
  // Acceptance: C¹ continuity at the seam (1e-9) on the wave clip with pre and post infinity set to cycle.
  const symmetric = await slopes();
  expect(Math.abs(symmetric.left - symmetric.right)).toBeLessThan(1e-9);
  // A key that gives the seam velocity: the seam is still C¹, with a slope the M1 end-key rule would have flattened.
  await runOk(page, 'time.setFrame', { frame: 5 });
  await runOk(page, 'channel.setValues', { edits: [{ control: wave.control, channel: 'rz', value: 50 * DEG }] });
  await runOk(page, 'key.set', { channels: 'rotate' });
  const moving = await slopes();
  expect(Math.abs(moving.left - moving.right)).toBeLessThan(1e-9);
  expect(Math.abs(moving.right)).toBeGreaterThan(1e-3);
  // The value is continuous across the seam as well.
  const before = await call(page, 'curveValue', wave.rz, 30 - 1e-6);
  const after = await call(page, 'curveValue', wave.rz, 30 + 1e-6);
  expect(Math.abs(before - after)).toBeLessThan(1e-6);
});

test.fixme(
  'stretch: the Export dialog shows glTF-Validator results from the in-app worker',
  notBuilt(
    'in-app glTF-Validator worker',
    'not wired (WP-8 W-13); the app runs its read-back check and the e2e run validates every exported file in Node.',
  ),
  () => {
    throw new Error('M1-stretch item not built');
  },
);

test.fixme(
  'stretch NFR-09: the static build works offline after load',
  notBuilt(
    'NFR-09',
    'no static-export e2e yet (M1: manual QA, §8.3). Acceptance: serve the static export, load /editor, go offline, ' +
      'open a user .vrm, key it and export.',
  ),
  () => {
    throw new Error('M1-stretch item not built');
  },
);
