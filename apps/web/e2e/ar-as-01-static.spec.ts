// E2E-AR-08 (AUTORIG-SPEC §11 AS-AR-1; D7): "Static T-posed humanoid GLB to an OMOBA VRM", in full through the UI —
// on `polybot-unskinned-tpose.glb` and, parameterized, on `cube-lad.glb`. Step 1 the landing's *Start Auto-Rig*
// (no dockview chunk, no request leaving the origin); 2 a real drop on ①; 3 rename, *Next*, the guess within 0.05 H
// of the truth (no undo step); 4 Elbow dragged back in SIDE (x bit-equal), `Shift+↓` twice on Knee in FRONT (z
// bit-equal); 5 fingers *Thumb + 1*, *Auto-rig*: Skeleton, Skinning, Checking (no Straightening), exactly two steps,
// 34 joints within 0.05 H, clean weights, no `skel.*`/`skin.*` error or warning, `PREVIEW Walk` within 300 ms of
// Checking, the preview no document change; 6 Sword and Dance move a hand; 7 Walk ×1.2 in place, one step, its metadata
// and its playback equal to its preview (bone worlds within 1e-5 at 10 frames); 8 Idle and a mirrored Sword attack;
// 9 ⑤ VRM (Tester, CC0, the auto thumbnail): every row ✓ incl. "T-pose rest", glTF-Validator and vrm-validator clean,
// every `vrm.*` lint clean, read-back ✓, three-vrm plays a VRMA idle on it; 10 Studio's `file.exportCharacter` on the
// same page writes the same SHA-256. The file goes to `test-results/autorig/` for step 11 (OMOBA's validator, local,
// D7's record). Step 12 (negative) is the second test: a T-posed Cube Lad with the elbow 8° off the arm line rigs
// in two steps and shows `skel.tpose` with *Adjust joints* first; moving the elbow back in *Adjust joints* clears it
// (on *Done* the hands turn with their forearms, AR-D7-16) and *Animations ▸* opens.
import { expect, test } from '@playwright/test';
import { characterRequest, checkOf, download, keepExport, studioExport } from './helpers/ar-export';
import { expectStudioShown } from './helpers/ar-host';
import {
  addClip,
  dropModel,
  exportMeta,
  foreignRequests,
  jointsOff,
  markersOff,
  networkLog,
  nextToMarkers,
  onStep,
  primary,
  startFromLanding,
} from './helpers/ar-as';
import { fixtureBytes, checkRow } from './helpers/ar-model';
import {
  cubeLadMarkers,
  dist,
  FRONT,
  hoverPane,
  markerAt,
  polybotMarkers,
  type QuickRigView,
  quickRig,
  SIDE,
  selectMarker,
  wizard,
} from './helpers/ar-markers';
import {
  autoRig,
  expectCleanWeights,
  markerOf,
  nudge,
  readStages,
  recordStages,
  rows,
  stepsSince,
  subjectCharacter,
} from './helpers/ar-rig';
import { clipNamed, exportedMeta } from './helpers/ar-animations';
import { history, loaded, scriptsOf } from './helpers/autorig';
import { drag } from './helpers/g1-viewport';
import { checkCharacter } from './helpers/m6b-character-writer';
import { validatorErrors } from './helpers/m6b-mvp-script';
import { call, runOk } from './helpers/test-api';

const DOCKVIEW_MARKER = 'dv-dockview';

interface Subject {
  readonly file: string;
  readonly name: string;
  readonly saved: string;
  readonly kept: string;
  readonly truth: () => {
    height: number;
    markers: Readonly<Record<string, readonly [number, number, number]>>;
    humanoid: Readonly<Record<string, readonly [number, number, number]>>;
  };
}

const SUBJECTS: readonly Subject[] = [
  {
    file: 'polybot-unskinned-tpose.glb',
    name: 'Polybot',
    saved: 'polybot.vrm',
    kept: 'as-ar-1-polybot.vrm',
    truth: () => polybotMarkers('tpose'),
  },
  {
    file: 'cube-lad.glb',
    name: 'Cube Lad',
    saved: 'lad.vrm',
    kept: 'as-ar-1-cube-lad.vrm',
    truth: () => {
      const truth = cubeLadMarkers();
      const joints = (
        JSON.parse(fixtureBytes('cube-lad-truth.json').toString('utf8')) as {
          joints: Record<string, { position: [number, number, number]; humanBone?: string }>;
        }
      ).joints;
      const humanoid: Record<string, readonly [number, number, number]> = {};
      for (const [key, joint] of Object.entries(joints)) humanoid[joint.humanBone ?? key] = joint.position;
      return { height: truth.height, markers: truth.markers, humanoid };
    },
  },
];

for (const subject of SUBJECTS) {
  test(`AS-AR-1 on ${subject.file}: from the landing to an OMOBA VRM, byte-equal to Studio's export`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(420_000);
    const net = networkLog(page);
    const scripts = scriptsOf(page);

    // 1 — the landing's Start Auto-Rig
    await startFromLanding(page);
    expect(loaded(scripts, DOCKVIEW_MARKER)).toBe(false);
    expect(foreignRequests(page, net)).toEqual([]);

    // 2 — drop the file on ①
    await dropModel(page, subject.file, new Uint8Array(fixtureBytes(subject.file)));
    const model = await wizard(page);
    expect(model.intake).toMatchObject({ kind: 'static', pose: { kind: 't' } });
    for (const check of ['centred', 'grounded', 'facing', 'upright', 'size']) {
      await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'true');
    }
    expect(await history(page)).toEqual({ undo: ['Import Static Model'], redo: [] });
    await expect(page.getByTestId('ar-primary')).toBeEnabled();
    const scene = model.subject.meshes[0] ?? '';
    const imported = await call(page, 'meshPositions', scene, undefined, 'local');

    // 3 — rename in the header (one step when the name changes), Next: three panes, the guess on the truth
    await page.getByTestId('ar-subject-name').click();
    const field = page.getByRole('textbox', { name: 'Character name' });
    await field.fill(subject.name === 'Cube Lad' ? 'Lad' : subject.name);
    await field.press('Enter');
    await expect(page.getByTestId('ar-subject-name')).toHaveText(subject.name === 'Cube Lad' ? 'Lad' : subject.name);
    const renamed = await history(page);
    const guessed = await nextToMarkers(page);
    await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '3');
    expect((await call(page, 'state')).layout).toBe('rig-markers');
    const truth = subject.truth();
    expect(markersOff(guessed, truth)).toEqual([]);
    expect(await history(page)).toEqual(renamed);

    // 4 — Elbow dragged 2 cm back in SIDE (x bit-equal); Shift+↓ twice on Knee in FRONT (z bit-equal)
    await selectMarker(page, 'elbow');
    const stacked = (await quickRig(page)) as QuickRigView;
    const toe = await markerAt(page, 'toe', 'R', SIDE);
    const ankle = await markerAt(page, 'ankle', 'R', SIDE);
    const dz = markerOf(stacked, 'toe')[2]! - markerOf(stacked, 'ankle')[2]!;
    const zRight = Math.sign(toe.x - ankle.x) * Math.sign(dz);
    const metresPerPx = Math.abs(dz) / Math.abs(toe.x - ankle.x);
    await drag(page, await markerAt(page, 'elbow', 'R', SIDE), { dx: (-0.02 / metresPerPx) * zRight, dy: 0 });
    const dragged = (await quickRig(page)) as QuickRigView;
    expect(markerOf(dragged, 'elbow')[0]).toBe(markerOf(stacked, 'elbow')[0]);
    expect(markerOf(dragged, 'elbow')[2]).toBeLessThan(markerOf(stacked, 'elbow')[2]! - 0.01);
    expect(dragged.preview).not.toEqual(stacked.preview);
    await selectMarker(page, 'knee');
    await hoverPane(page, FRONT);
    const knee = markerOf(await quickRig(page), 'knee');
    await nudge(page, 'Shift+ArrowDown', 2);
    await expect.poll(async () => markerOf(await quickRig(page), 'knee')[1]).toBeCloseTo(knee[1]! - 0.002, 9);
    const nudged = (await quickRig(page)) as QuickRigView;
    expect(markerOf(nudged, 'knee')[2]).toBe(knee[2]);
    expect(nudged.preview).not.toEqual(dragged.preview);
    expect(await history(page)).toEqual(renamed);

    // 5 — Thumb + 1, Auto-rig: two steps, 34 joints on the truth, clean weights, the motion test at once
    await page.getByTestId('ar-markers-fingers').locator('[data-preset="standard33"]').click();
    await expect.poll(async () => (await quickRig(page))?.preset).toBe('standard33');
    const preview = (await quickRig(page))?.preview ?? [];
    await recordStages(page);
    await autoRig(page);
    const seen = await readStages(page);
    expect(seen.stages).toEqual(expect.arrayContaining(['skeleton', 'skin', 'check']));
    expect(seen.stages).not.toContain('straighten');
    for (const list of seen.rows) expect(list).toEqual(['skeleton', 'skin', 'check']);
    expect(await stepsSince(page, renamed.undo)).toEqual(['Create Skeleton', 'Bind Skin']);
    const { character, mesh } = await subjectCharacter(page);
    expect((await call(page, 'characters')).find((row) => row.id === character)?.source).toBe('model');
    const skeleton = await call(page, 'skeleton', character);
    expect(skeleton?.joints).toHaveLength(34);
    const committed = new Map((skeleton?.joints ?? []).map((joint) => [joint.key, joint.restPosition]));
    for (const joint of preview) expect([joint.key, committed.get(joint.key)]).toEqual([joint.key, joint.position]);
    expect(jointsOff(skeleton?.joints ?? [], truth)).toEqual([]);
    await expectCleanWeights(page, character, mesh);
    expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
    const problems = (await rows(page)).filter(
      (row) => /^(skel|skin)\./.test(row.code) && (row.severity === 'error' || row.severity === 'warning'),
    );
    expect(problems).toEqual([]);
    await expect(page.getByTestId('hud-badge-preview-pane-persp')).toHaveText('PREVIEW walk', { ignoreCase: true });
    const timing = await page.evaluate(() => window.__AR_STAGES__);
    expect((timing?.previewAt ?? Number.POSITIVE_INFINITY) - (timing?.endedAt ?? 0)).toBeLessThanOrEqual(300);
    const version = (await call(page, 'state')).storeVersion;
    const steps = await history(page);
    const keys = await call(page, 'keysHash');
    await page.waitForTimeout(600);
    expect((await call(page, 'state')).storeVersion).toBe(version);
    expect(await history(page)).toEqual(steps);
    expect(await call(page, 'keysHash')).toBe(keys);

    // 6 — the motion test: Sword, then Dance move a hand point over 0.5 s each
    const points = await call(page, 'meshPositions', mesh, undefined, 'local');
    let hand = 0;
    points.forEach((p, i) => {
      if ((p[0] ?? 0) < (points[hand]?.[0] ?? 0)) hand = i;
    });
    for (const clip of ['sword-attack', 'dance']) {
      await page.locator(`[data-testid="ar-rig-motion"] [data-clip="${clip}"]`).click();
      await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe(clip);
      const a = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
      await page.waitForTimeout(500);
      const b = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
      expect(dist(a, b)).toBeGreaterThan(1e-3);
    }

    // 7 — Animations ▸, search "walk" → Walk ×1.2, In place, Add: one step and its metadata
    await primary(page, /Animations/);
    await onStep(page, 'animations');
    await expect(page.getByTestId('ar-anim-grid')).toBeVisible();
    await page.getByTestId('ar-anim-search').fill('walk');
    await expect(page.getByTestId('ar-anim-grid').locator('button')).toHaveCount(1);
    await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' }, { speedSteps: 4, inPlace: true });
    const walk = await clipNamed(page, character, 'Walk');
    const meta = await exportedMeta(page, character, walk.id);
    expect([meta.slot, meta.rootMotion, meta.tags]).toEqual([
      'walk',
      'in-place',
      ['ar-walk', 'ar-speed-120', 'ar-inplace'],
    ]);
    // the clip plays through the shipped path as its preview did: the same pose at the same clip frame (1e-5 m)
    await page.getByTestId('ar-clip-card-walk').click();
    await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
    // The preview's clock is `performance.now()` (C12's service): held at ten instants, each drawn before it is read,
    // so the displayed pose and the preview's time are one sample.
    const samples = await page.evaluate(
      async ([id, bone]) => {
        const api = window.__EKZA_STUDIO_TEST__;
        const real = performance.now.bind(performance);
        const frames = (n: number) =>
          new Promise<void>((resolve) => {
            const tick = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
            tick(n);
          });
        const base = real();
        const out: { seconds: number; at: number[] }[] = [];
        try {
          for (let i = 0; i < 10; i++) {
            const held = base + 97 * i;
            performance.now = () => held;
            await frames(3);
            const at = api?.displayNodeWorld(id, bone) ?? null;
            const seconds = api?.library()?.preview?.seconds ?? null;
            if (at !== null && seconds !== null) out.push({ seconds, at });
          }
        } finally {
          performance.now = real;
        }
        return out;
      },
      [character, 'leftHand'] as const,
    );
    expect(samples.length).toBe(10);
    await page.keyboard.press('Escape');
    await runOk(page, 'clip.setActive', { clip: walk.id });
    for (const sample of samples) {
      const frame = walk.start + sample.seconds * walk.fps;
      const shipped = (await call(page, 'boneWorld', character, 'leftHand', frame)).t;
      expect(dist(shipped, sample.at), `frame ${frame}`).toBeLessThanOrEqual(1e-5);
    }

    // 8 — Idle, and Sword attack with Mirror: three clips, the sword mirrored (the left hand leads)
    await addClip(page, { id: 'idle', name: 'Idle' });
    await addClip(page, { id: 'sword-attack', name: 'Sword attack' }, { mirror: true });
    const names = (await call(page, 'clips', character)).map((clip) => clip.name);
    expect(names).toEqual(['Walk', 'Idle', 'Sword attack']);
    const sword = await clipNamed(page, character, 'Sword attack');
    expect((await exportedMeta(page, character, sword.id)).tags).toEqual(['ar-sword-attack', 'ar-mirror']);
    await runOk(page, 'clip.setActive', { clip: sword.id });
    const mid = Math.round((sword.start + sword.end) / 2);
    const left = (await call(page, 'boneWorld', character, 'leftHand', mid)).t;
    const right = (await call(page, 'boneWorld', character, 'rightHand', mid)).t;
    // the mirrored attack swings the left hand: it travels farther from its rest than the right hand does
    const leftRest = (await call(page, 'boneWorld', character, 'leftHand', sword.start)).t;
    const rightRest = (await call(page, 'boneWorld', character, 'rightHand', sword.start)).t;
    expect(dist(left, leftRest)).toBeGreaterThan(dist(right, rightRest));

    // 9 — Export ▸ VRM: Tester, CC0, the auto thumbnail; every row ✓; Download
    await primary(page, /Export/);
    await onStep(page, 'export');
    await expect(page.getByTestId('ar-export-panel')).toBeVisible();
    await exportMeta(page);
    await expect(page.getByTestId('ar-export-target-ekza-vrm')).toHaveAttribute('data-state', 'checked');
    for (const id of ['humanoid', 'required-bones', 'parents', 'tpose', 'skinned', 'transforms', 'meta', 'licence']) {
      await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
    }
    await expect(checkOf(page, 'tpose')).toContainText('T-pose rest');
    const file = await download(page);
    expect(file.name).toBe(subject.saved);
    keepExport(subject.kept, file.bytes);
    for (const id of ['size', 'nodes', 'bones', 'extensions', 'read-back']) {
      await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
    }
    expect(await validatorErrors(file.bytes)).toEqual({ gltf: [], vrm: [] });
    const check = await checkCharacter(browser, testInfo, file.bytes);
    expect(check.metaVersion).toBe('1');
    expect(check.unresolved).toEqual([]);
    expect(check.vrmaPlayed).toBe(true);
    expect(check.clips).toHaveLength(3);

    // 10 — Studio's file.exportCharacter, same page and document, same request: the same bytes
    await runOk(page, 'autorig.navigate', { to: 'studio', workspace: 'rig' });
    await expectStudioShown(page);
    const base = subject.saved.replace(/\.vrm$/, '');
    const [studio] = await studioExport(page, 'file.exportCharacter', characterRequest(character, 'ekza-vrm', base));
    expect(studio?.errors).toEqual([]);
    expect(studio?.sha256).toBe(file.sha);
    const lints = await page.evaluate(
      async (request) => {
        const result = await window.__EKZA_STUDIO_TEST__?.run('file.exportCharacter', request);
        const [artifact] = (Array.isArray(result?.value) ? result.value : []) as { lints: { code: string }[] }[];
        return artifact?.lints.map((lint) => lint.code) ?? null;
      },
      characterRequest(character, 'ekza-vrm', base),
    );
    expect(lints?.filter((code) => code.startsWith('vrm.'))).toEqual([]);

    // privacy (§8.5): every request of the whole run stayed on the origin, and none posted
    expect(foreignRequests(page, net)).toEqual([]);
  });
}

test('AS-AR-1 step 12 (negative): the elbow 8° off rigs in two steps with skel.tpose; moving it back clears the row', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await startFromLanding(page);
  await dropModel(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));
  const scene = (await wizard(page)).subject.meshes[0] ?? '';
  const imported = await call(page, 'meshPositions', scene, undefined, 'local');
  const state = await nextToMarkers(page);
  // ② the right Elbow nudged down in FRONT until the upper arm runs 8° below ±X (3 × 1 cm, 9 × 1 mm)
  await selectMarker(page, 'elbow');
  await hoverPane(page, FRONT);
  await nudge(page, 'ArrowDown', 3);
  await nudge(page, 'Shift+ArrowDown', 9);
  const nudged = await quickRig(page);
  const shoulder = markerOf(nudged, 'shoulder');
  const elbow = markerOf(nudged, 'elbow');
  expect(elbow[0]).toBe(markerOf(state, 'elbow')[0]);
  expect(elbow[2]).toBe(markerOf(state, 'elbow')[2]);
  const angle = (Math.atan2(shoulder[1]! - elbow[1]!, Math.abs(elbow[0]! - shoulder[0]!)) * 180) / Math.PI;
  expect(angle).toBeGreaterThan(7.5);
  expect(angle).toBeLessThan(8.5);

  const before = (await history(page)).undo;
  await recordStages(page);
  await autoRig(page);
  // startPose is the input's ('t'): no straighten — two steps, the mesh points bit-equal to the import
  expect((await wizard(page)).startPose).toMatchObject({ kind: 't' });
  expect((await readStages(page)).stages).not.toContain('straighten');
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);
  const { character, mesh } = await subjectCharacter(page);
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
  // ③: the skel.tpose row, Adjust joints first, Straighten to T-Pose second; Animations ▸ blocked by the row
  expect((await rows(page)).map((row) => row.code)).toContain('skel.tpose');
  const row = page.locator('[data-testid="ar-rig-validation"] [data-row="skel.tpose"]');
  const buttons = row.locator('button');
  await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'ar-rig-row-adjust');
  await expect(buttons.nth(1)).toHaveText('Straighten to T-Pose');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  expect((await wizard(page)).reachable.animations).toBe(false);
  await expect(page.locator('[data-step="animations"] button')).toBeDisabled();

  // Adjust joints: the elbow joint dragged back onto the arm line (D + W, one "Move Joint" step)
  await buttons.nth(0).click();
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skeleton');
  const skeleton = await call(page, 'skeleton', character);
  const id = (bone: string): string => skeleton?.joints.find((joint) => joint.humanBone === bone)?.id ?? bone;
  const restOf = async (bone: string): Promise<number[]> =>
    (await call(page, 'skeleton', character))?.joints.find((joint) => joint.humanBone === bone)?.restPosition ?? [];
  const upper = await restOf('rightUpperArm');
  const lower = await restOf('rightLowerArm');
  const handRest = await restOf('rightHand');
  const { jointAt, toolKey } = await import('./helpers/m6b-skeleton-ui');
  const a = await jointAt(page, id('rightUpperArm'), FRONT);
  const b = await jointAt(page, id('rightHand'), FRONT);
  const perPx = Math.abs(handRest[0]! - upper[0]!) / Math.abs(b.x - a.x);
  const steps = (await history(page)).undo.length;
  await toolKey(page, 'KeyW', FRONT);
  const at = await jointAt(page, id('rightLowerArm'), FRONT);
  await page.keyboard.down('KeyD');
  await drag(page, at, { dx: 0, dy: -(upper[1]! - lower[1]!) / perPx });
  await page.keyboard.up('KeyD');
  await expect.poll(async () => (await history(page)).undo.length).toBe(steps + 1);
  expect((await history(page)).undo.at(-1)).toBe('Move Joint');
  expect(Math.abs((await restOf('rightLowerArm'))[1]! - upper[1]!)).toBeLessThan(0.01);
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 30_000 }).toBe('Bind Skin');
  // moving the elbow back clears it: the arm segments are on the line and the hands turned with their forearms
  expect((await rows(page)).map((r) => r.code)).not.toContain('skel.tpose');
  await expect(page.locator('[data-testid="ar-rig-validation"] [data-row="skel.tpose"]')).toHaveCount(0);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  expect((await wizard(page)).reachable.animations).toBe(true);
  await expect(page.locator('[data-step="animations"] button')).toBeEnabled();
  // the mesh never moved (a T-posed input is not straightened)
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
});

// AS-AR-1 step 5 by the palette or MCP instead of the button (§4.5: the compositions are registered for every shell):
// `autorig.rig` run on ② outside the wizard's own flow still makes the wizard's subject the new character (AR-D7-17),
// so ③ is done and reachable as after *Auto-rig ▸*.
test('AS-AR-1 step 5 by operator: autorig.rig from the palette on ② adopts the subject character', async ({ page }) => {
  test.setTimeout(180_000);
  await startFromLanding(page);
  await dropModel(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));
  await nextToMarkers(page);
  expect((await wizard(page)).subject.character).toBeNull();
  const made = await runOk<{ character: string }>(page, 'autorig.rig', { straighten: false });
  await expect.poll(async () => (await wizard(page)).subject.character).toBe(made.character);
  const models = (await call(page, 'characters')).filter((row) => row.id === made.character);
  expect(models).toHaveLength(1);
  await expect.poll(async () => (await wizard(page)).done['rig']).toBe(true);
  expect((await wizard(page)).reachable.rig).toBe(true);
  const { character } = await subjectCharacter(page);
  expect(character).toBe(made.character);
});
