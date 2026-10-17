import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clipToSceneFrame,
  defaultChannelValue,
  EkzaError,
  isRotationChannel,
  sceneToClipFrame,
  TRS_CHANNELS,
  wrapClipFrame,
} from '../src';

const SCENE_30 = { num: 30, den: 1 };

describe('scene clock ↔ clip frames (§4.11.8)', () => {
  it('two characters at 24 and 30 fps with sceneStart 0 and 6 both play clip frame 24 at scene frame 30', () => {
    expect(sceneToClipFrame(SCENE_30, { fps: { num: 24, den: 1 }, sceneStart: 0 }, 30)).toBe(24);
    expect(sceneToClipFrame(SCENE_30, { fps: { num: 30, den: 1 }, sceneStart: 6 }, 30)).toBe(24);
    expect(clipToSceneFrame(SCENE_30, { fps: { num: 24, den: 1 }, sceneStart: 0 }, 24)).toBe(30);
    expect(clipToSceneFrame(SCENE_30, { fps: { num: 30, den: 1 }, sceneStart: 6 }, 24)).toBe(30);
  });

  it('is the identity for one character at the scene rate', () => {
    for (const frame of [-3, 0, 7.5, 60]) {
      expect(sceneToClipFrame(SCENE_30, { fps: SCENE_30, sceneStart: 0 }, frame)).toBe(frame);
    }
  });

  it('handles rational rates (29.97) exactly on whole seconds', () => {
    const ntsc = { num: 30000, den: 1001 };
    expect(sceneToClipFrame(ntsc, { fps: { num: 24000, den: 1001 }, sceneStart: 0 }, 30)).toBe(24);
  });

  it('round-trips', () => {
    const rate = fc.constantFrom(24, 25, 30, 48, 50, 60);
    fc.assert(
      fc.property(
        rate,
        rate,
        fc.integer({ min: -100, max: 100 }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (scene, clip, start, frame) => {
          const sceneFps = { num: scene, den: 1 };
          const record = { fps: { num: clip, den: 1 }, sceneStart: start };
          const back = clipToSceneFrame(sceneFps, record, sceneToClipFrame(sceneFps, record, frame));
          expect(back).toBeCloseTo(frame, 6);
        },
      ),
    );
  });

  it('rejects non-positive rates', () => {
    expect(() => sceneToClipFrame({ num: 0, den: 1 }, { fps: SCENE_30, sceneStart: 0 }, 1)).toThrow(EkzaError);
    expect(() => clipToSceneFrame(SCENE_30, { fps: { num: 30, den: 0 }, sceneStart: 0 }, 1)).toThrow(EkzaError);
  });
});

describe('wrapClipFrame', () => {
  const range = { start: 0, end: 30 };

  it('keeps frames inside the range', () => {
    for (const frame of [0, 12.5, 30]) {
      expect(wrapClipFrame({ range, loop: true }, frame)).toBe(frame);
      expect(wrapClipFrame({ range, loop: false }, frame)).toBe(frame);
    }
  });

  it('wraps looping clips into [start, end) and clamps the others', () => {
    expect(wrapClipFrame({ range, loop: true }, 45)).toBe(15);
    expect(wrapClipFrame({ range, loop: true }, 60)).toBe(0);
    expect(wrapClipFrame({ range, loop: true }, -5)).toBe(25);
    expect(wrapClipFrame({ range: { start: 10, end: 20 }, loop: true }, 31)).toBe(11);
    expect(wrapClipFrame({ range, loop: false }, 45)).toBe(30);
    expect(wrapClipFrame({ range, loop: false }, -5)).toBe(0);
  });

  it('always lands in range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true }),
        fc.boolean(),
        (start, length, frame, loop) => {
          const clip = { range: { start, end: start + length }, loop };
          const wrapped = wrapClipFrame(clip, frame);
          expect(wrapped).toBeGreaterThanOrEqual(start);
          expect(wrapped).toBeLessThanOrEqual(start + length);
          if (loop && (frame < start || frame > start + length)) expect(wrapped).toBeLessThan(start + length);
        },
      ),
    );
  });
});

describe('channels', () => {
  it('defaults: 1 for scale, 0 otherwise', () => {
    expect(TRS_CHANNELS.map(defaultChannelValue)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1]);
    expect(defaultChannelValue('@blink')).toBe(0);
  });

  it('rotation channels', () => {
    expect(TRS_CHANNELS.filter(isRotationChannel)).toEqual(['rx', 'ry', 'rz']);
    expect(isRotationChannel('@rx')).toBe(false);
  });
});
