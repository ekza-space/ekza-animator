import { expect, test } from '@playwright/test';
import { drag } from './helpers/g1-viewport';
import { clickKey, dragBy, hoverGraph } from './helpers/g2-graph';
import { setMode } from './helpers/m6a-model';
import { checkCharacter, exportCharacterFile, glbJson } from './helpers/m6b-character-writer';
import { ekzaClipMeta, exportClipVrma, firstPane, previewClip } from './helpers/m6b-clip-library';
import { cubeLadTruth } from './helpers/m6b-cube-lad';
import {
  dist,
  documentMarks,
  expectBindChecks,
  gatingRows,
  jointsByKey,
  mirrorX,
  pxPerMetre,
  truthWithDrags,
  validatorErrors,
  writeArtifact,
} from './helpers/m6b-mvp-script';
import { keysHash, RIG_FRONT_PANE, RIG_PERSP_PANE, RIG_SIDE_PANE } from './helpers/m6b-rig';
import {
  createSkeleton,
  cubeLadInRig,
  jointAt,
  markerAt,
  previewOf,
  type QuickRigView,
  quickRig,
  sideZSign,
  startQuickRig,
  toolKey,
} from './helpers/m6b-skeleton-ui';
import {
  asymmetricPoints,
  boxPoints,
  enterSkin,
  partnersOf,
  positionsOf,
  screenCentroid,
  stroke,
  weightMaps,
} from './helpers/m6b-skin-ui';
import { call, runOk } from './helpers/test-api';

// E2E-MVP-01 — AS-MVP-1 "Cube Lad comes alive", scripted (M6B-SPEC §0.7; owner INT, no gates): the owner flow end to
// end through the UI and the test API, steps 1–11 of the AS-MVP-1 table; step 12 (OMOBA's `validate-runtime-vrm`) runs
// locally on the file this spec writes: `node tooling/omoba-validate.mjs apps/web/test-results/m6b-mvp/cube-lad.vrm`.
//
// Readings of the table recorded in docs/wp-notes/m6b-integration.md: drags are in pixels converted from metres with
// the ortho pane's scale (so the marker deltas are what the pointer gave, within 5 mm); the front elbow drag is 0.02 m,
// not §0.7's 0.03 m (a 6° bend that `skel.tpose`'s 5° gate refuses at export); "the shoulder
// box's outer points" are the torso box's top outer (shoulder) corners on the left; `E` on the left elbow is the §5.7
// joint drag (a test rotation, not exactly 30°); "Validation clean" in step 10 is the rig rows (the VRM meta rows are
// step 11's), and clean means no error or warning row (info rows such as `skin.joint-without-weights` never gate).

const truth = cubeLadTruth();
const H = truth.height;
const MARKERS = ['headTop', 'chin', 'pelvis', 'shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'] as const;
const SIDE_MARKERS = ['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'] as const;
const OUT = 'test-results/m6b-mvp/cube-lad.vrm';

const marker = (state: QuickRigView | null, name: string): number[] => state?.markers[name] ?? [];
/** +1 when +Z points right in the side pane (read once in step 3; the pane's camera is the same afterwards). */
let sideSign: 1 | -1 = 1;
const undoLabels = async (page: Parameters<typeof call>[0]) => (await call(page, 'history')).undo;

test('E2E-MVP-01: AS-MVP-1 — the Cube Lad comes alive (model → markers → skeleton → skin → clips → VRM 1.0)', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(360_000);

  // ---------- 1. Model: build the Cube Lad, select it, Rig & Skin → the checklist shows ① ----------
  const scene = await test.step('1. the Cube Lad in Rig & Skin', async () => {
    const mesh = await cubeLadInRig(page);
    await expect(page.getByTestId('rtk-step-1')).toHaveAttribute('data-glyph', 'attention');
    return mesh;
  });

  // ---------- 2. ① Place markers: Quick Rig, R-Markers, the guessed markers ----------
  const guessed = await test.step('2. Quick Rig guesses nine markers (six ghosts), the history untouched', async () => {
    const before = await undoLabels(page);
    const state = await startQuickRig(page);
    expect((await call(page, 'panes')).map((pane) => pane.id).sort()).toEqual(
      [RIG_FRONT_PANE, RIG_SIDE_PANE, RIG_PERSP_PANE].sort(),
    );
    expect(Object.keys(state.markers).sort()).toEqual([...MARKERS].sort());
    const off = MARKERS.map((name) => [name, dist(marker(state, name), truth.markers[name] ?? []) / H] as const).filter(
      ([, error]) => error > 0.05,
    );
    expect(off).toEqual([]);
    for (const name of SIDE_MARKERS) await markerAt(page, name, 'L', RIG_FRONT_PANE);
    expect(await undoLabels(page)).toEqual(before);
    return state;
  });

  // ---------- 3. front elbow drag, side knee drag, side elbow drag (the list-selected marker wins) ----------
  const placed = await test.step('3. the axis rule, the pick rule, the live preview, no document change', async () => {
    const steps = (await undoLabels(page)).length;
    const front = await pxPerMetre(page, RIG_FRONT_PANE);
    const side = await pxPerMetre(page, RIG_SIDE_PANE);
    const zRight = await sideZSign(page);
    sideSign = zRight;

    // Front pane: the right elbow 0.02 m down — x/y only, z bit-equal; the preview follows every pointer frame. (INT:
    // §0.7 said 0.03 m, which bends the T-posed arm 6° and trips `skel.tpose`'s 5° export gate in step 11; 0.02 m
    // bends it 4°. Recorded in the M6B-SPEC integration record.)
    const elbowAt = await markerAt(page, 'elbow', 'R', RIG_FRONT_PANE);
    const dy = 0.02 * front;
    await page.mouse.move(elbowAt.x, elbowAt.y);
    await page.mouse.down();
    const frames: number[] = [];
    for (let i = 1; i <= 2; i++) {
      await page.mouse.move(elbowAt.x, elbowAt.y + (dy * i) / 2);
      frames.push(previewOf((await quickRig(page)) as QuickRigView, 'rightLowerArm')?.[1] ?? Number.NaN);
    }
    await page.mouse.up();
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeLessThan(frames[i - 1] as number);
    const afterFront = (await quickRig(page)) as QuickRigView;
    expect(marker(afterFront, 'elbow')[2]).toBe(marker(guessed, 'elbow')[2]);
    expect((marker(guessed, 'elbow')[1] ?? 0) - (marker(afterFront, 'elbow')[1] ?? 0)).toBeCloseTo(0.02, 2);

    // Side pane: the right knee 0.02 m forward — z/y only, x bit-equal.
    await drag(page, await markerAt(page, 'knee', 'R', RIG_SIDE_PANE), { dx: 0.02 * side * zRight, dy: 0 });
    const afterKnee = (await quickRig(page)) as QuickRigView;
    expect(marker(afterKnee, 'knee')[0]).toBe(marker(guessed, 'knee')[0]);
    expect((marker(afterKnee, 'knee')[2] ?? 0) - (marker(guessed, 'knee')[2] ?? 0)).toBeCloseTo(0.02, 2);
    expect(previewOf(afterKnee, 'rightLowerLeg')).not.toEqual(previewOf(afterFront, 'rightLowerLeg'));

    // Panel list: Elbow; side pane: 0.02 m back where shoulder, elbow and wrist overlap — only the elbow moves.
    await page.getByTestId('quickrig-marker-elbow').click();
    expect((await quickRig(page))?.selected).toBe('elbow');
    const stacked = (await quickRig(page)) as QuickRigView;
    await drag(page, await markerAt(page, 'elbow', 'R', RIG_SIDE_PANE), { dx: -0.02 * side * zRight, dy: 0 });
    const state = (await quickRig(page)) as QuickRigView;
    expect(marker(state, 'elbow')[0]).toBe(marker(stacked, 'elbow')[0]);
    expect((marker(stacked, 'elbow')[2] ?? 0) - (marker(state, 'elbow')[2] ?? 0)).toBeCloseTo(0.02, 2);
    for (const name of MARKERS.filter((n) => n !== 'elbow'))
      expect(marker(state, name), name).toEqual(marker(stacked, name));
    // The bend now exceeds the 2° minimum: the preview's elbow is the marker exactly; the left side mirrors.
    expect(previewOf(state, 'rightLowerArm')).toEqual(marker(state, 'elbow'));
    expect(previewOf(state, 'leftLowerArm')).toEqual(mirrorX(marker(state, 'elbow')));
    expect(previewOf(state, 'leftLowerLeg')).toEqual(mirrorX(previewOf(state, 'rightLowerLeg') ?? []));
    expect(state.moved.sort()).toEqual(['elbow', 'knee']);
    expect((await undoLabels(page)).length).toBe(steps);
    return state;
  });

  // ---------- 4. Create Skeleton (Standard 33) ----------
  const character =
    await test.step('4. Create Skeleton: one step, 34 joints, the dragged elbow bit for bit', async () => {
      const steps = (await undoLabels(page)).length;
      const made = await createSkeleton(page);
      expect((await undoLabels(page)).length).toBe(steps + 1);
      expect((await undoLabels(page)).at(-1)).toBe('Create Skeleton');
      const row = (await call(page, 'characters')).find((c) => c.id === made);
      expect(row?.source).toBe('model');
      const joints = await jointsByKey(page, made);
      expect(joints.size).toBe(34);
      expect(joints.get('root')?.role).toBe('helper');
      // Committed = the last preview, bit for bit; the right elbow joint = the side-dragged marker.
      expect(placed.preview?.map((joint) => [joint.key, joint.position])).toEqual(
        placed.preview?.map((joint) => [joint.key, joints.get(joint.key)?.restPosition]),
      );
      expect(joints.get('rightLowerArm')?.restPosition).toEqual(marker(placed, 'elbow'));
      // Every humanoid joint within 0.03 H of the truth with the three drags applied.
      const delta = (name: string) =>
        [0, 1, 2].map((k) => (marker(placed, name)[k] ?? 0) - (marker(guessed, name)[k] ?? 0));
      const target = truthWithDrags(truth.joints, { elbow: delta('elbow'), knee: delta('knee') });
      const off = [...target]
        .filter(([key]) => key !== 'root' && joints.has(key))
        .map(([key, p]) => [key, dist(joints.get(key)?.restPosition ?? [], p) / H] as const)
        .filter(([, error]) => error > 0.03);
      expect(off).toEqual([]);
      // A control rig with IK legs (arms FK); Skeleton mode with no key press.
      const keys = (await call(page, 'controls', made)).map((control) => control.key);
      expect(keys.filter((key) => key.startsWith('ik.leg')).length).toBeGreaterThanOrEqual(2);
      expect(keys.some((key) => key.startsWith('ik.arm'))).toBe(false);
      expect((await call(page, 'rigState')).mode).toBe('skeleton');
      return made;
    });

  // ---------- 5. D + W: the right knee 0.01 m in z in the side pane (symmetry) ----------
  await test.step('5. D + W on the right knee: both knees move, the feet keep their rests, one step', async () => {
    const before = await jointsByKey(page, character);
    const steps = (await undoLabels(page)).length;
    const knee = before.get('rightLowerLeg');
    await runOk(page, 'select.joints', { ids: [knee?.id], mode: 'replace' });
    // Zoom the side pane in around the knee (wheel): at the whole-body framing 0.01 m is under a pixel.
    const kneeAt = await jointAt(page, knee?.id ?? '', RIG_SIDE_PANE);
    await page.mouse.move(kneeAt.x, kneeAt.y);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(50);
    }
    // Pixels per metre from the knee and the ankle; +Z on screen as Quick Rig's side pane showed it (same camera).
    const kneeNow = await jointAt(page, knee?.id ?? '', RIG_SIDE_PANE);
    const ankle = await jointAt(page, before.get('rightFoot')?.id ?? '', RIG_SIDE_PANE);
    const ppm =
      Math.abs(kneeNow.y - ankle.y) /
      Math.abs((knee?.restPosition[1] ?? 0) - (before.get('rightFoot')?.restPosition[1] ?? 0));
    expect(ppm, 'side pane pixels per metre after the zoom').toBeGreaterThan(400);
    const sign = sideSign;
    await toolKey(page, 'KeyW', RIG_SIDE_PANE);
    await page.keyboard.down('KeyD');
    await drag(page, await jointAt(page, knee?.id ?? '', RIG_SIDE_PANE), { dx: 0.01 * ppm * sign, dy: 0 });
    await page.keyboard.up('KeyD');
    await expect.poll(async () => (await undoLabels(page)).length).toBe(steps + 1);
    const after = await jointsByKey(page, character);
    const moved = (key: string) => dist(after.get(key)?.restPosition ?? [], before.get(key)?.restPosition ?? []);
    expect(moved('rightLowerLeg')).toBeGreaterThan(0.004);
    expect(after.get('leftLowerLeg')?.restPosition).toEqual(mirrorX(after.get('rightLowerLeg')?.restPosition ?? []));
    for (const key of ['rightFoot', 'leftFoot', 'rightToes', 'leftToes']) {
      expect(after.get(key)?.restPosition, key).toEqual(before.get(key)?.restPosition);
    }
  });

  // ---------- 6. ③ Bind Skin, one click ----------
  const mesh =
    await test.step('6. Bind Skin: one step, ≤ 4 influences, normalized, no root, forearms dominated', async () => {
      const steps = (await undoLabels(page)).length;
      await runOk(page, 'workspace.showPanel', { panel: 'rigToolkit' });
      await page.getByTestId('rtk-step-3-btn').click();
      await expect.poll(async () => (await undoLabels(page)).length, { timeout: 30_000 }).toBe(steps + 1);
      expect((await undoLabels(page)).at(-1)).toBe('Bind Skin');
      const bound = (await call(page, 'meshes')).find((row) => row.owner === `char:${character}`)?.id ?? '';
      expect(bound).not.toBe(scene);
      expect((await call(page, 'skin', bound))?.skeleton).not.toBeNull();
      await expectBindChecks(page, bound);
      return bound;
    });

  const positions = await positionsOf(page, mesh);
  const joints = await jointsByKey(page, character);
  const byBone = new Map([...joints.values()].map((joint) => [joint.humanBone ?? joint.name, joint.id]));
  const boneOf = new Map([...joints.values()].map((joint) => [joint.id, joint.humanBone ?? joint.name]));
  const mirrorJoint = (id: string): string => {
    const bone = boneOf.get(id) ?? '';
    const swapped = bone.startsWith('left')
      ? `right${bone.slice(4)}`
      : bone.startsWith('right')
        ? `left${bone.slice(5)}`
        : bone;
    return byBone.get(swapped) ?? id;
  };

  // ---------- 7. E on the left elbow (test pose); 2; a mirrored Replace stroke; Go to Bind Pose ----------
  await test.step('7. a test pose, a mirrored stroke on the posed mesh, Go to Bind Pose', async () => {
    const hash = await keysHash(page);
    if ((await call(page, 'rigState')).mode !== 'skeleton') await runOk(page, 'rig.mode', { mode: 'skeleton' });
    await runOk(page, 'select.joints', { ids: [joints.get('leftLowerArm')?.id], mode: 'replace' });
    await toolKey(page, 'KeyE', RIG_FRONT_PANE);
    await drag(page, await jointAt(page, joints.get('leftLowerArm')?.id ?? '', RIG_FRONT_PANE), { dx: -2, dy: 24 });
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
    await expect(page.getByTestId(`hud-badge-pose-${RIG_FRONT_PANE}`)).toHaveText('TEST POSE');
    expect(await keysHash(page)).toBe(hash);

    await enterSkin(page);
    await runOk(page, 'workspace.showPanel', { panel: 'paintWeights' });
    const upperArm = joints.get('leftUpperArm')?.id ?? '';
    await page.getByTestId(`pw-influence-${upperArm}`).click();
    await expect.poll(async () => (await call(page, 'paint')).active?.joint).toBe(upperArm);
    expect(await call(page, 'paint')).toMatchObject({ op: 'replace', value: 1, mirror: true });
    await page.getByTestId('pw-falloff').selectOption('constant');
    await page.getByTestId('pw-radius').fill('40');
    await page.getByTestId('pw-radius').press('Enter');

    const partners = partnersOf(positions);
    const shoulder = boxPoints(positions, 'torso').filter(
      (v) => (positions[v]?.[0] ?? 0) > 0 && (positions[v]?.[1] ?? 0) > 1.39 && (positions[v]?.[2] ?? 0) > 0,
    );
    expect(shoulder.length).toBe(1);
    const before = await weightMaps(page, mesh);
    const steps = (await undoLabels(page)).length;
    // The stroke starts on the torso's front face just inside its top outer (shoulder) corner (front pane, ortho:
    // placed from the two bottom front corners, which the weight labels list), so its 40 px reach covers the corner.
    const torso = boxPoints(positions, 'torso');
    const at = (x: number, y: number) =>
      torso.find(
        (v) =>
          Math.abs((positions[v]?.[0] ?? 0) - x) < 1e-5 &&
          Math.abs((positions[v]?.[1] ?? 0) - y) < 1e-5 &&
          (positions[v]?.[2] ?? 0) > 0,
      ) as number;
    const left = await screenCentroid(page, mesh, [at(0.18, 1.0)], RIG_FRONT_PANE);
    const right = await screenCentroid(page, mesh, [at(-0.18, 1.0)], RIG_FRONT_PANE);
    const ppm = Math.abs(left.x - right.x) / 0.36;
    const start = { x: left.x + 0.1 * (right.x - left.x), y: left.y - 0.36 * ppm };
    await stroke(page, start, 6, 0);
    await expect.poll(async () => (await undoLabels(page)).length).toBe(steps + 1);
    expect((await undoLabels(page)).at(-1)).toBe('Paint Skin Weights');
    const after = await weightMaps(page, mesh);
    const changed = after
      .map((_, v) => v)
      .filter((v) => {
        const a = after[v] as Map<string, number>;
        const b = before[v] as Map<string, number>;
        return a.size !== b.size || [...a].some(([key, w]) => b.get(key) !== w);
      });
    // The shoulder corner now leans on leftUpperArm (Replace 1 at full opacity), and so does its right partner on
    // rightUpperArm (mirror stroke): w(p(v)) = M(w(v)) everywhere.
    expect(changed).toEqual(expect.arrayContaining(shoulder));
    expect(after[shoulder[0] as number]?.get(upperArm)).toBe(1);
    expect(changed.some((v) => (positions[v]?.[0] ?? 0) > 0)).toBe(true);
    expect(changed.some((v) => (positions[v]?.[0] ?? 0) < 0)).toBe(true);
    expect(asymmetricPoints(after, partners, mirrorJoint)).toEqual([]);
    expect(await keysHash(page)).toBe(hash);

    // Go to Bind Pose: the rest returns.
    await page.getByTestId('status-poseview-bind').click();
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('bind');
    const forearm = boxPoints(positions, 'forearm.L');
    await expect
      .poll(async () => {
        const posed = await call(page, 'posedPositions', mesh, forearm);
        return Math.max(...posed.map((p, i) => dist(p, positions[forearm[i] as number] ?? [])));
      })
      .toBeLessThan(1e-5);
  });

  const hand = boxPoints(positions, 'hand.L')[0] as number;

  // ---------- 8. Clip Library: Walk, Sword attack, Death in turn ----------
  await test.step('8. three library previews move the hand; the document never changes; Stop returns the bind pose', async () => {
    const bind = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
    const marks = await documentMarks(page);
    await runOk(page, 'workspace.showPanel', { panel: 'rigToolkit' });
    await page.getByTestId('rtk-library-open').click();
    await expect(page.getByTestId('clip-card-walk')).toBeVisible({ timeout: 15_000 });
    const pane = await firstPane(page);
    for (const [id, label] of [
      ['walk', 'Walk'],
      ['sword-attack', 'Sword attack'],
      ['death', 'Death'],
    ] as const) {
      await page.getByTestId(`clip-play-${id}`).click();
      await expect.poll(() => previewClip(page)).toBe(id);
      await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveText(`PREVIEW ${label}`);
      const t0 = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
      await page.waitForTimeout(500);
      const t1 = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
      expect(dist(t0, t1), `${label}: the hand moves over 0.5 s`).toBeGreaterThan(1e-4);
      expect(await documentMarks(page)).toEqual(marks);
    }
    // Stop (a second click on the playing card): the bind pose again.
    await page.getByTestId('clip-play-death').click();
    await expect.poll(() => previewClip(page)).toBeNull();
    await expect
      .poll(async () => dist((await call(page, 'posedPositions', mesh, [hand]))[0] ?? [], bind))
      .toBeLessThan(1e-5);
    expect(await documentMarks(page)).toEqual(marks);
  });

  // ---------- 9. Use Clip Walk; Animate; a Graph Editor key edit ----------
  await test.step('9. Use Clip Walk (one step, slot walk, CC0 Quaternius); a Graph Editor key edit', async () => {
    const steps = (await undoLabels(page)).length;
    await page.getByTestId('clip-use-walk').click();
    await expect.poll(async () => (await undoLabels(page)).at(-1)).toBe('Use Clip Walk');
    expect((await undoLabels(page)).length).toBe(steps + 1);
    const walk = (await call(page, 'clips', character)).find((clip) => clip.name === 'Walk');
    if (walk === undefined) throw new Error('no Walk clip');
    expect(walk.loop).toBe(true);
    const controls = new Set((await call(page, 'controls', character)).map((control) => control.id));
    const curves = await call(page, 'curves', walk.id);
    expect(curves.length).toBeGreaterThan(0);
    expect(curves.filter((curve) => !controls.has(curve.control))).toEqual([]);
    const meta = ekzaClipMeta(await exportClipVrma(page, character, walk.id));
    expect([meta.slot, meta.loop]).toEqual(['walk', true]);
    expect(meta.derivedFrom[0]).toMatchObject({ author: 'Quaternius', license: 'CC0-1.0' });

    await runOk(page, 'workspace.set', { workspace: 'animate' });
    const arm = (await call(page, 'controls', character)).find((control) => control.key === 'fk.upperArm.L')?.id ?? '';
    await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
    await runOk(page, 'graph.frame', { what: 'all' });
    const curve = (await call(page, 'curves', walk.id, arm)).find((candidate) => candidate.channel === 'rz');
    const key = curve?.keys[Math.floor((curve?.keys.length ?? 0) / 2)];
    if (curve === undefined || key === undefined) throw new Error('no rz key on fk.upperArm.L');
    const world = await call(page, 'boneWorld', character, 'leftUpperArm', key.t);
    await hoverGraph(page);
    const at = await clickKey(page, key.id, 'the rz key');
    const before = (await undoLabels(page)).length;
    await dragBy(page, at, 0, -40);
    await expect
      .poll(
        async () =>
          (await call(page, 'curves', walk.id, arm)).find((c) => c.id === curve.id)?.keys.find((k) => k.id === key.id)
            ?.v,
      )
      .toBeGreaterThan(key.v);
    expect((await undoLabels(page)).length).toBe(before + 1);
    const edited = await call(page, 'boneWorld', character, 'leftUpperArm', key.t);
    expect(edited.q).not.toEqual(world.q);
  });

  // ---------- 10. Model: Assign New Material › Blinn on the torso faces ----------
  await test.step('10. a Blinn swatch on the torso faces: every weight bit-equal, the rig rows clean', async () => {
    const weights = await call(page, 'weights', mesh);
    await runOk(page, 'workspace.set', { workspace: 'model' });
    const torso = new Set(boxPoints(positions, 'torso'));
    const faces = (await call(page, 'meshFaces', mesh))
      .map((verts, f) => [f, verts] as const)
      .filter(([, verts]) => verts.every((v) => torso.has(v)))
      .map(([f]) => f);
    expect(faces.length).toBe(6);
    await runOk(page, 'model.hilite', { meshes: [mesh], mode: 'replace' });
    await setMode(page, 'face');
    await runOk(page, 'select.components', { mesh, kind: 'face', indices: faces, mode: 'replace' });
    const assigned = await runOk<{ meshes: string[] }>(page, 'palette.assignMaterial', { shader: 'blinn' });
    expect(assigned.meshes).toEqual([mesh]);
    const paint = await call(page, 'meshLayer', mesh, 'paint');
    const slots = new Set(faces.map((f) => paint[f]?.[0]));
    expect(slots.size).toBe(1);
    expect(paint.filter((_, f) => !faces.includes(f)).some((row) => slots.has(row[0]))).toBe(false);
    await setMode(page, 'object');
    expect(await call(page, 'weights', mesh)).toEqual(weights);
    await runOk(page, 'workspace.set', { workspace: 'rig' });
    expect((await gatingRows(page)).filter((code) => !code.startsWith('vrm.'))).toEqual([]);
  });

  // ---------- 11. VRM Meta, Render Thumbnail, Export Character (VRM 1.0, the Space and OMOBA profile) ----------
  await test.step('11. Export VRM 1.0: validators, vrm.* lints, read-back, three-vrm, deterministic, written', async () => {
    await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
    await runOk(page, 'char.renderThumbnail', { character });
    expect(await gatingRows(page, 'ekza/space-avatar-v1')).toEqual([]);
    await runOk(page, 'ui.open', { dialog: 'export' });
    await expect(page.getByTestId('export-confirm')).toBeEnabled();
    await expect(page.locator('[data-testid^="export-char-row-"]').filter({ hasText: /^(error|warning)/ })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');

    const args = { character, format: 'vrm', profile: 'ekza/space-avatar-v1', clips: 'slots' };
    const first = await exportCharacterFile(page, args);
    expect(first.artifact.kind).toBe('character');
    expect(first.artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(first.artifact.readBack).toMatchObject({
      ok: true,
      kind: 'character',
      jointsEqual: true,
      humanoidEqual: true,
      fingerprintEqual: true,
    });
    expect(await validatorErrors(first.bytes)).toEqual({ gltf: [], vrm: [] });
    const json = glbJson(first.bytes);
    expect(json['extensionsUsed']).toContain('KHR_materials_specular');
    expect(json['extensionsRequired'] ?? []).not.toContain('KHR_materials_specular');
    const vrmc = (json['extensions'] as Record<string, Record<string, unknown>>)['VRMC_vrm'] ?? {};
    expect(vrmc['specVersion']).toBe('1.0');
    expect(vrmc['meta']).toMatchObject({ authors: ['Tester'], licenseUrl: 'https://vrm.dev/licenses/1.0/' });
    const check = await checkCharacter(browser, testInfo, first.bytes);
    expect(check.unresolved).toEqual([]);
    expect(check.vrmaPlayed).toBe(true);
    expect(check.clips).toContain('walk');
    const readBack = first.artifact.readBack as { tris: number; joints: number };
    expect([check.tris, check.joints]).toEqual([readBack.tris, readBack.joints]);
    // Twice: byte-identical.
    const second = await exportCharacterFile(page, args);
    expect(second.artifact.sha256).toBe(first.artifact.sha256);
    // Step 12's input (OMOBA's validate-runtime-vrm, run locally by INT).
    const written = writeArtifact(OUT, first.bytes);
    testInfo.annotations.push({ type: 'vrm', description: `${written} (${first.bytes.byteLength} B)` });
  });
});
