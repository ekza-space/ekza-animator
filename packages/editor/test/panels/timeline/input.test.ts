import { describe, expect, it } from 'vitest';
import {
  clipToScene,
  formatFps,
  formatFrameValue,
  parseFps,
  parseFrameInput,
  sameFps,
  sceneToClip,
} from '../../../src/panels/timeline/input';

describe('parseFrameInput', () => {
  it('reads absolute frames, relative steps and absolute negative frames', () => {
    const cases: readonly (readonly [string, number | null])[] = [
      ['24', 24],
      [' 7.5 ', 7.5],
      ['7,5', 7.5],
      ['.5', 0.5],
      ['+10', 25],
      ['-5', 10],
      ['+=10', 25],
      ['-=2.5', 12.5],
      ['=-5', -5],
      ['=12', 12],
      ['', null],
      ['abc', null],
      ['1e3', null],
      ['10-', null],
      ['--5', null],
    ];
    for (const [text, expected] of cases) expect([text, parseFrameInput(text, 15)]).toEqual([text, expected]);
  });
});

describe('frame rates', () => {
  it('parses integers, decimals, ratios and NTSC rates into reduced rationals', () => {
    expect(parseFps('24')).toEqual({ num: 24, den: 1 });
    expect(parseFps('30 fps')).toEqual({ num: 30, den: 1 });
    expect(parseFps('12.5')).toEqual({ num: 25, den: 2 });
    expect(parseFps('29.97')).toEqual({ num: 30000, den: 1001 });
    expect(parseFps('23.976')).toEqual({ num: 24000, den: 1001 });
    expect(parseFps('59,94')).toEqual({ num: 60000, den: 1001 });
    expect(parseFps('60000/1001')).toEqual({ num: 60000, den: 1001 });
    expect(parseFps('48/2')).toEqual({ num: 24, den: 1 });
    for (const bad of ['', '0', '-24', '24/0', 'abc', '1001', '2.12345']) expect(parseFps(bad)).toBeNull();
  });

  it('formats and compares rationals', () => {
    expect(formatFps({ num: 30000, den: 1001 })).toBe('29.97');
    expect(formatFps({ num: 24, den: 1 })).toBe('24');
    expect(sameFps({ num: 48, den: 2 }, { num: 24, den: 1 })).toBe(true);
    expect(sameFps({ num: 30000, den: 1001 }, { num: 30, den: 1 })).toBe(false);
  });
});

describe('clip ↔ scene frames (§4.11.8)', () => {
  it('maps through sceneStart and the fps ratio, and back', () => {
    const scene = { num: 30, den: 1 };
    const clip = { fps: { num: 24, den: 1 }, sceneStart: 6 };
    expect(clipToScene(scene, clip, 24)).toBe(36);
    expect(sceneToClip(scene, clip, 30)).toBeCloseTo(19.2, 12);
    for (const frame of [-3, 0, 7.25, 24, 100]) {
      expect(sceneToClip(scene, clip, clipToScene(scene, clip, frame))).toBeCloseTo(frame, 12);
    }
    expect(clipToScene(scene, { fps: scene, sceneStart: 0 }, 17)).toBe(17);
  });

  it('formats whole frames as integers and others with two decimals', () => {
    expect(formatFrameValue(12)).toBe('12');
    expect(formatFrameValue(12.0000001)).toBe('12');
    expect(formatFrameValue(-3)).toBe('-3');
    expect(formatFrameValue(7.256)).toBe('7.26');
    expect(formatFrameValue(19.2)).toBe('19.2');
  });
});
