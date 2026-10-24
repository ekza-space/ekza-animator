import { expect, test } from '@playwright/test';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// Stretch items that were not built, declared as `test.fixme` with the reason, the fallback and an acceptance line,
// so the e2e report lists them next to the scenarios (MVP-SPEC §8.2 and M2A-SPEC §10.2: stretch items are excepted
// and listed in the release notes). Write the body and drop `fixme` when an item lands.
//
// - M1-stretch (MVP-SPEC §1.2, status at acceptance round 1). FR-GE-17 landed in M2a (below). The built M1-stretch
//   items (plateau, mesh-click picking, camera radial, one-button profile, rotate-order change, `bevy.*` lints) and
//   the storage-blocked and context-loss checks (resilience.spec.ts) are covered elsewhere.
// - M2a-stretch (M2A-SPEC §1.2): none of the six items was built in M2a. Their M2a-core fallbacks are built; the last
//   test of this file checks the ones the test API can reach.

const notBuilt = (requirement: string, why: string) => ({
  annotation: { type: 'M1-stretch', description: `${requirement}: ${why}` },
});

/** An M2a-stretch item (M2A-SPEC §1.2): what it is, the M2a-core fallback that ships instead, and its acceptance. */
const m2aStretch = (item: string, fallback: string, acceptance: string) => ({
  annotation: {
    type: 'M2a-stretch',
    description: `${item}: not built in M2a. Fallback: ${fallback}. Acceptance: ${acceptance}`,
  },
});

const notBuiltBody = (milestone: string) => () => {
  throw new Error(`${milestone} item not built`);
};

test.fixme(
  'stretch FR-IO-10: an animation-only GLB imports onto a loaded character by node name',
  notBuilt(
    'FR-IO-10',
    'not built; file.importAnimation answers "No animation … fits the character". Acceptance: re-importing an ' +
      'E2E-18 export onto UAL reproduces the channel values within 1e-4 rad.',
  ),
  notBuiltBody('M1-stretch'),
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
  notBuiltBody('M1-stretch'),
);

test.fixme(
  'stretch NFR-09: the static build works offline after load',
  notBuilt(
    'NFR-09',
    'no static-export e2e yet (M1: manual QA, §8.3). Acceptance: serve the static export, load /editor, go offline, ' +
      'open a user .vrm, key it and export.',
  ),
  notBuiltBody('M1-stretch'),
);

// ---------- M2a-stretch (M2A-SPEC §1.2) ----------

test.fixme(
  'M2a-stretch: the inactive IK/FK control set can be shown as a 25 % alpha ghost',
  m2aStretch(
    "Ghost display of the inactive IK/FK set (prefs.ikFkVisibility 'ghost', R07 §6)",
    "prefs.ikFkVisibility accepts only 'hide'; 'ghost' poll-fails \"not available yet\" (checked below)",
    'with ghost on, an IK leg draws its FK chain at 25 % alpha, the ghosts are neither pickable nor marquee-selected, ' +
      'and switching the limb swaps which set is ghosted',
  ),
  notBuiltBody('M2a-stretch'),
);

test.fixme(
  'M2a-stretch: the Dope Sheet shows all keyable channels, keyed or not',
  m2aStretch(
    "Dope Sheet 'show all keyable channels' (rows for channels without curves, FR-DS-01)",
    'only animated channels get rows; key a channel from the Channels panel to give it a row',
    'with the option on, every keyable channel of the shown controls has a row in the Channels panel order, an empty ' +
      'row takes a key from `S` at the current frame, and the option off restores the animated-only rows',
  ),
  notBuiltBody('M2a-stretch'),
);

test.fixme(
  'M2a-stretch: a mesh click on a limb in IK selects its IK control',
  m2aStretch(
    'Mesh-pick → IK control mapping when ikFk > 0.5 (R07 §6 inverse binding)',
    'the mesh pick keeps selecting the FK control the bone maps to and says "IK limb: pick the IK control" ' +
      '(viewport select behaviour, packages/viewport/test/m2a-mesh-pick-hint.test.ts)',
    'on Seed-san with IK legs a mesh click on the left shin selects ik.leg.L; with the leg switched to FK the same ' +
      'click selects fk.lowerLeg.L; arms follow their own ikFk',
  ),
  notBuiltBody('M2a-stretch'),
);

test.fixme(
  'M2a-stretch: key hold and a stepped preview for blocking',
  m2aStretch(
    "Key hold (R01 KY-08: the previous key's value at the current frame) and a stepped preview toggle",
    'set a key with the same value (copy the previous key and paste at the frame, or retype it and `S`); set ' +
      'stepped tangents (`6` in the Graph Editor and on the time slider band)',
    'key hold at f writes keys equal to the previous keys of the selected channels (1e-12) in one undo step; the ' +
      'stepped preview plays and scrubs the clip held between keys without changing any tangent (document deep-equal)',
  ),
  notBuiltBody('M2a-stretch'),
);

test.fixme(
  'M2a-stretch: ankle and wrist motion trails',
  m2aStretch(
    'Ankle and wrist motion trail (positions sampled once per committed edit, a polyline with frame ticks)',
    'judge arcs by scrubbing; onion skin and full motion trails are M2c (FR-VP-14, FR-VP-15)',
    "the trail's points equal the ankle and wrist world positions at every clip frame (1e-6 m), are resampled " +
      'after each committed edit and never during a drag, and the trail hides with its toggle',
  ),
  notBuiltBody('M2a-stretch'),
);

test.fixme(
  'M2a-stretch: rig.ikFk.matchRange simplifies the curves it writes',
  m2aStretch(
    'rig.ikFk.matchRange followed by an automatic Simplify of the written curves',
    'run Graph › Simplify on the written curves (graph.curves.simplify)',
    'after matchRange over a range the written curves have fewer keys than frames and stay within the Simplify ' +
      'tolerance of the per-frame match at every frame; one undo step reverts both',
  ),
  notBuiltBody('M2a-stretch'),
);

// The M2a-core fallbacks of the items above that the test API reaches (the others are UI or operator choices).
test('M2a-stretch fallbacks: the ghost display is refused; Simplify runs on curves', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const ghost = await run(page, 'prefs.set', { patch: { ikFkVisibility: 'ghost' } });
  expect(ghost).toEqual({ status: 'cancelled', reason: 'not available yet' });
  await runOk(page, 'prefs.set', { patch: { ikFkVisibility: 'hide' } });
  await seedWaveClip(page);
  expect((await run(page, 'graph.curves.simplify')).status).toBe('finished');
});
