import type { VrmLicenseInfo } from '@ekza-studio/io';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AttributesPanel, CAMERA_SETTINGS_OP } from '../../src/panels/attributes/AttributesPanel';
import {
  focalLengthFromFov,
  fovFromFocalLength,
  validateFocalLength,
  validateFovDegrees,
} from '../../src/panels/attributes/lens';
import { licenceSummary } from '../../src/panels/attributes/licence';
import {
  by,
  CLIP,
  callsOf,
  cleanup,
  contributeOperator,
  input,
  LOWER_ARM_L,
  loadFixtures,
  maybe,
  mount,
  newCamera,
  ROOT,
  select,
  transact,
  user,
  waveApp,
} from './helpers';

afterEach(cleanup);
beforeAll(async () => {
  await loadFixtures();
});

const panel = (app: ReturnType<typeof waveApp>) =>
  mount(app, <AttributesPanel app={app} instanceId="attributes#1" />, { width: 340, height: 900 });

describe('Attributes: control section', () => {
  it('shows the lead control: name, side, read-only rotate order, shape, binding and mirror', async () => {
    const app = waveApp();
    const view = await panel(app);
    expect(by('attr-section-control').textContent).toContain('Select a control');
    await select(app, [ROOT, LOWER_ARM_L]);
    expect(by('attr-control-name').textContent).toBe('L Lower Arm');
    expect(by('attr-control-key').textContent).toBe('fk.lowerArm.L');
    expect(by('attr-control-side').textContent).toContain('Left');
    const order = by('attr-rotate-order') as HTMLSelectElement;
    expect(order.value).toBe('xzy');
    expect(order.disabled).toBe(true);
    expect(order.title).toContain("unknown operator 'rig.setRotateOrder'");
    expect(by('attr-shape-kind').textContent).toBe('circle');
    expect(input('attr-shape-size').value).toBe('0.043');
    expect(by('attr-control-drives').textContent).toBe('leftLowerArm (humanoid)');
    expect(by('attr-control-mirror').textContent).toBe('R Lower Arm');

    await select(app, [ROOT]);
    expect(by('attr-control-drives').textContent).toContain('space control');
    expect(by('attr-control-mirror').textContent).toBe('—');
    await view.unmount();
  });

  it('edits the shape size through rig.setControlSize with validation', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.fill(input('attr-shape-size'), '-1');
    await user.keyboard('{Enter}');
    expect(input('attr-shape-size').dataset.invalid).toBe('true');
    await user.fill(input('attr-shape-size'), '*2');
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'rig.setControlSize')).toEqual([{ control: LOWER_ARM_L, size: 0.085 }]);
    await view.unmount();
  });

  it('lets the rotate order change once rig.setRotateOrder exists and polls (M1-stretch)', async () => {
    const app = waveApp();
    contributeOperator(app, 'rig.setRotateOrder');
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    const order = by('attr-rotate-order') as HTMLSelectElement;
    expect(order.disabled).toBe(false);
    await user.selectOptions(order, 'xyz');
    expect(callsOf(app, 'rig.setRotateOrder')).toEqual([{ control: LOWER_ARM_L, order: 'xyz' }]);
    await view.unmount();
  });
});

describe('Attributes: clip and character sections', () => {
  it('edits the active clip with the clip settings form and renames it', async () => {
    const app = waveApp();
    const view = await panel(app);
    expect(by('attr-clip-name').textContent).toBe('wave');
    await user.click(by('clip-settings-loop'));
    await user.click(by('clip-settings-apply'));
    expect(callsOf(app, 'clip.setSettings')).toEqual([{ clip: CLIP, loop: false }]);
    await user.click(by('attr-clip-rename'));
    await user.fill(input('clips-rename-input'), 'wave_02');
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'clip.rename')).toEqual([{ clip: CLIP, name: 'wave_02' }]);
    await view.unmount();
  });

  it('describes the character: format, file, height and a licence badge', async () => {
    const app = waveApp();
    const view = await panel(app);
    expect(by('attr-character-name').textContent).toBe('Synthetic Humanoid');
    expect(by('attr-character-format').textContent).toBe('VRM 1.0');
    expect(by('attr-character-file').textContent).toBe('synthetic-humanoid.vrm · 0 B');
    expect(by('attr-character-height').textContent).toBe('1.70 m (joint estimate)');
    // The test kit's placeholder container carries no VRM meta: no licence either way.
    expect(by('attr-licence-badge').dataset.tone).toBe('muted');
    await view.unmount();

    const noRuntime = waveApp({ skeleton: false });
    const second = await panel(noRuntime);
    expect(by('attr-character-height').textContent).toBe('Loading…');
    await second.unmount();
  });

  it('summarizes VRM meta licences (research 09 §10.3)', () => {
    const info: VrmLicenseInfo = {
      title: 'Seed-san',
      authors: ['VRM Consortium'],
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      allowRedistribution: false,
      modification: 'prohibited',
      commercialUsage: 'personalNonProfit',
      creditNotation: 'required',
      licenseName: 'LicenseRef-VRM-PL-1.0',
    };
    expect(licenceSummary('vrm1', info)).toEqual({
      title: 'LicenseRef-VRM-PL-1.0',
      details: 'Redistribution: no · Modification: prohibited · Commercial: personalNonProfit',
      tone: 'warn',
      credits: 'Seed-san by VRM Consortium (credit required)',
    });
    const open: VrmLicenseInfo = {
      ...info,
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
      commercialUsage: null,
      creditNotation: 'unnecessary',
      licenseName: 'CC0-1.0',
      title: null,
      authors: [],
    };
    expect(licenceSummary('vrm0', open)).toMatchObject({ title: 'CC0-1.0', tone: 'ok', credits: null });
    expect(licenceSummary('gltf', null)).toMatchObject({ title: 'No VRM licence (glTF)', tone: 'muted' });
    expect(licenceSummary('vrm1', null)).toMatchObject({ title: 'No licence metadata', details: null });
    expect(licenceSummary('vrm1', undefined)).toMatchObject({ title: 'Licence not read', tone: 'muted' });
  });
});

describe('Attributes: shot cameras', () => {
  it('shows lens fields read-only without a camera operator and toggles the lock', async () => {
    const app = waveApp();
    const view = await panel(app);
    expect(by('attr-section-cameras').textContent).toContain('No shot camera');
    const camera = newCamera('cam_SyntheticShot001');
    await transact(app, (tx) => tx.put('cameras', camera));
    expect(input(`attr-camera-focal-${camera.id}`).value).toBe('35.0');
    expect(input(`attr-camera-fov-${camera.id}`).value).toBe('37.85');
    expect(input(`attr-camera-focal-${camera.id}`).readOnly).toBe(true);
    expect(input(`attr-camera-focal-${camera.id}`).title).toContain(CAMERA_SETTINGS_OP);
    const lock = input(`attr-camera-lock-${camera.id}`);
    expect(lock.checked).toBe(true);
    await user.click(lock);
    expect(callsOf(app, 'view.toggleCameraLock')).toEqual([{ cameraId: camera.id }]);
    await view.unmount();
  });

  it('edits focal length ↔ FOV once the camera operator is registered (contract request R-3)', async () => {
    const app = waveApp();
    contributeOperator(app, CAMERA_SETTINGS_OP);
    const camera = newCamera('cam_SyntheticShot001', { locked: false });
    await transact(app, (tx) => tx.put('cameras', camera));
    const view = await panel(app);
    await user.fill(input(`attr-camera-focal-${camera.id}`), '50');
    await user.keyboard('{Enter}');
    await user.fill(input(`attr-camera-fov-${camera.id}`), '90');
    await user.keyboard('{Enter}');
    await user.fill(input(`attr-camera-fov-${camera.id}`), '180');
    await user.keyboard('{Enter}');
    const calls = callsOf(app, CAMERA_SETTINGS_OP) as { camera: string; fovY: number }[];
    expect(calls).toHaveLength(2);
    expect(calls[0]?.camera).toBe(camera.id);
    expect(calls[0]?.fovY).toBeCloseTo(2 * Math.atan(12 / 50), 12);
    expect(calls[1]?.fovY).toBeCloseTo(Math.PI / 2, 12);
    expect(input(`attr-camera-fov-${camera.id}`).dataset.invalid).toBe('true');
    await view.unmount();
  });

  it('shows the ortho height of an orthographic camera', async () => {
    const app = waveApp();
    const camera = newCamera('cam_SyntheticOrtho01', { projection: 'orthographic', orthoHeight: 3 });
    await transact(app, (tx) => tx.put('cameras', camera));
    const view = await panel(app);
    expect(maybe(`attr-camera-focal-${camera.id}`)).toBeNull();
    expect(by(`attr-camera-${camera.id}`).textContent).toContain('3.000');
    await view.unmount();
  });

  it('converts lenses on a 24 mm sensor height', () => {
    expect((fovFromFocalLength(35) * 180) / Math.PI).toBeCloseTo(37.849, 3);
    for (const mm of [8, 24, 35, 50, 85, 200]) expect(focalLengthFromFov(fovFromFocalLength(mm))).toBeCloseTo(mm, 9);
    expect(validateFocalLength(0)).not.toBeNull();
    expect(validateFocalLength(50)).toBeNull();
    expect(validateFovDegrees(180)).not.toBeNull();
    expect(validateFovDegrees(60)).toBeNull();
  });
});
