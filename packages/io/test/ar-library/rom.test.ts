// AUTORIG-SPEC §5.4.1 (D5 stretch): the range-of-motion clip. One key per pose every 4 frames at 30 fps; the pose
// table's rotations in the VRM normalized frame (right side mirrored); deterministic VRMA bytes that read back as the
// clip; no fingers when asked.
import { quatAngle, quatFromAxisAngle, quatRotateVec3, type Quat } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../../src/glb/parse';
import { ROM_POSES, romClip, romFrameOf, romRotation } from '../../src/library/rom';
import { writeHumanoidVrma } from '../../src/library/vrma';
import { readVrma } from '../../src/vrma/read';

const META = { generator: 'ekza-studio rom', license: 'MIT', credit: 'Ekza Studio', source: 'Range test' };
const DEG = Math.PI / 180;

const keyOf = (name: string): number => romFrameOf(name) / 4;
const quatAt = (values: Float32Array | undefined, key: number): Quat =>
  Array.from(values?.subarray(key * 4, key * 4 + 4) ?? []) as Quat;

describe('romClip (§5.4.1)', () => {
  it('keys every pose of the table every 4 frames at 30 fps, starting and ending at rest', () => {
    const clip = romClip();
    expect(clip.name).toMatch(/loop/i);
    expect(clip.duration).toBeCloseTo(((ROM_POSES.length - 1) * 4) / 30, 6);
    const arm = clip.rotations.leftUpperArm;
    expect(arm?.times.length).toBe(ROM_POSES.length);
    expect(quatAt(arm?.values, 0)).toEqual([0, 0, 0, 1]);
    expect(quatAt(arm?.values, ROM_POSES.length - 1)).toEqual([0, 0, 0, 1]);
    expect(clip.hips).toBeNull();
  });

  it('turns the bones as the table says (arms down, elbows, knees) with the right side mirrored', () => {
    const clip = romClip();
    const down = keyOf('arms down');
    const left = quatRotateVec3(quatAt(clip.rotations.leftUpperArm?.values, down), [1, 0, 0]);
    const right = quatRotateVec3(quatAt(clip.rotations.rightUpperArm?.values, down), [-1, 0, 0]);
    expect(left[1]).toBeLessThan(-0.95);
    expect(right[1]).toBeLessThan(-0.95);
    expect(right[0]).toBeCloseTo(-left[0], 6);
    const elbow = quatAt(clip.rotations.leftLowerArm?.values, keyOf('elbows 140'));
    expect(quatAngle(elbow, quatFromAxisAngle([0, 1, 0], -140 * DEG))).toBeLessThan(1e-6);
    const knee = quatAt(clip.rotations.rightLowerLeg?.values, keyOf('knees 130'));
    expect(quatAngle(knee, quatFromAxisAngle([1, 0, 0], 130 * DEG))).toBeLessThan(1e-6);
    // the shin of a 130° knee points backwards and up (the foot behind the knee)
    const shin = quatRotateVec3(knee, [0, -1, 0]);
    expect(shin[2]).toBeLessThan(-0.7);
    expect(romRotation(ROM_POSES[0] as (typeof ROM_POSES)[number], 'spine')).toEqual([0, 0, 0, 1]);
  });

  it('leaves the fingers out on request and writes deterministic VRMA bytes that read back', async () => {
    expect(romClip({ fingers: false }).rotations.leftIndexProximal).toBeUndefined();
    expect(romClip().rotations.leftIndexProximal).toBeDefined();
    const a = await writeHumanoidVrma(romClip(), META);
    const b = await writeHumanoidVrma(romClip(), META);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const read = readVrma(await parseGlb(a));
    const knees = keyOf('knees 130');
    expect(
      quatAngle(
        quatAt(read.rotations.leftLowerLeg?.values, knees),
        quatAt(romClip().rotations.leftLowerLeg?.values, knees),
      ),
    ).toBeLessThan(1e-6);
  });
});
