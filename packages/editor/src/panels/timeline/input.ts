// Text input of the timeline panel: frame expressions (research 09 §4.9 "accepts +10, -5"), frame rates, and the
// clip ↔ scene frame mapping of §4.11.8 for playback ranges (the panel passes scene frames to the operator).
import type { Fps, Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '@ekza-animator/doc';

const NUMBER = String.raw`(\d+(?:\.\d*)?|\.\d+)`;
const RELATIVE = new RegExp(String.raw`^([+-])=?\s*${NUMBER}$`);
const ABSOLUTE = new RegExp(String.raw`^=?\s*(-?)\s*${NUMBER}$`);

/**
 * A frame typed into a frame field: `24` absolute; `+10` / `-5` (or `+=10` / `-=5`) relative to `current`; `=-5`
 * an absolute negative frame. A decimal comma is accepted. Null when the text is not a frame.
 */
export function parseFrameInput(text: string, current: Frame): Frame | null {
  const value = text.trim().replace(',', '.');
  const relative = RELATIVE.exec(value);
  if (relative !== null) {
    const amount = Number(relative[2]);
    return relative[1] === '-' ? current - amount : current + amount;
  }
  const absolute = ABSOLUTE.exec(value);
  if (absolute === null) return null;
  const amount = Number(absolute[2]);
  return absolute[1] === '-' ? -amount : amount;
}

/** Standard rates of the fps menu (FR-TIME-05). */
export const STANDARD_FPS: readonly number[] = [24, 25, 30, 48, 50, 60];

/** NTSC rates typed as decimals map to their exact rationals. */
const NTSC: Readonly<Record<string, Fps>> = {
  '23.976': { num: 24000, den: 1001 },
  '23.98': { num: 24000, den: 1001 },
  '29.97': { num: 30000, den: 1001 },
  '47.952': { num: 48000, den: 1001 },
  '59.94': { num: 60000, den: 1001 },
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `30`, `29.97`, `30000/1001` or `12.5` → a reduced rational in (0, 1000] fps; null when invalid. */
export function parseFps(text: string): Fps | null {
  const value = text
    .trim()
    .replace(',', '.')
    .replace(/\s*fps$/i, '');
  const ntsc = NTSC[value];
  if (ntsc !== undefined) return ntsc;
  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  let num: number;
  let den: number;
  if (ratio !== null) {
    num = Number(ratio[1]);
    den = Number(ratio[2]);
  } else {
    const decimal = /^(\d+)(?:\.(\d{1,3}))?$/.exec(value);
    if (decimal === null) return null;
    const fraction = decimal[2] ?? '';
    den = 10 ** fraction.length;
    num = Number(decimal[1]) * den + (fraction === '' ? 0 : Number(fraction));
  }
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) return null;
  if (num / den > 1000) return null;
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

export function sameFps(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/** `30`, `29.97`, `12.5`: the rate rounded to at most three decimals. */
export function formatFps(fps: Fps): string {
  return String(Math.round((fps.num / fps.den) * 1000) / 1000);
}

/** Scene frames per frame of the clip (§4.11.8); the same formula as `doc`'s `clipToSceneFrame`. */
function sceneFramesPerClipFrame(sceneFps: Fps, clip: Pick<ClipRecord, 'fps'>): number {
  return (sceneFps.num * clip.fps.den) / (sceneFps.den * clip.fps.num);
}

export function clipToScene(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, frame: Frame): Frame {
  return clip.sceneStart + frame * sceneFramesPerClipFrame(sceneFps, clip);
}

export function sceneToClip(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, frame: Frame): Frame {
  return (frame - clip.sceneStart) / sceneFramesPerClipFrame(sceneFps, clip);
}

/** Whole frames shown as integers, others with up to two decimals. */
export function formatFrameValue(frame: Frame): string {
  const whole = Math.round(frame);
  if (Math.abs(frame - whole) < 1e-6) return String(whole);
  return String(Math.round(frame * 100) / 100);
}
