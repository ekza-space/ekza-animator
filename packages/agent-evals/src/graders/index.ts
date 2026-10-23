// Graders (MCP-SPEC §9.3.1, §9.3.4): independent of the tool layer — they read bone worlds and curves from a separate
// headless app that opened the saved project. E2E-AI-01 imports the AE-01 grader from `@ekza-studio/agent-evals/graders`.
// Each grader returns the conditions it checked with their measured values; `pass` is all of them, `score` the share.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { units } from '@ekza-studio/agent-tools';
import type { EditorApp } from '@ekza-studio/editor-core';
import {
  angleDeg,
  boneWorld,
  bonesAt,
  channelAt,
  controlOf,
  cycles,
  DEG,
  dot,
  keyFrames,
  length,
  nodeOf,
  norm,
  principal,
  range,
  relativeRotation,
  restWorld,
  rotate,
  sub,
  type World,
} from './world';

const fpsNumber = units.fpsNumber;

export interface GradeResult {
  readonly pass: boolean;
  readonly score: number; // 0…1
  readonly notes: readonly string[];
}

/** A condition with its measured value. */
export interface Condition {
  readonly name: string;
  readonly ok: boolean;
  readonly measured: string;
}

export function grade(conditions: readonly Condition[]): GradeResult {
  const met = conditions.filter((condition) => condition.ok).length;
  return {
    pass: met === conditions.length,
    score: conditions.length === 0 ? 0 : met / conditions.length,
    notes: conditions.map((condition) => `${condition.ok ? 'ok' : 'FAIL'} ${condition.name}: ${condition.measured}`),
  };
}

const cond = (name: string, ok: boolean, measured: string | number): Condition => ({
  name,
  ok,
  measured: typeof measured === 'number' ? String(Math.round(measured * 1e4) / 1e4) : measured,
});

/** The character's height scale k (§9.3.3: distances scale with k = height / 1.7 m). */
export function scaleK(app: EditorApp, character: CharacterId): number {
  return (app.characters.get(character)?.skeleton.height ?? 1.7) / 1.7;
}

// ---------- AE-01: a wave ----------
/** AE-01 (§9.3.3): 3 cycles of the hand relative to the upper chest, ≥ 5 cm·k peak to peak, 2.0 ± 0.2 s, the hand above
 *  the shoulder ≥ 80 % of the window, the other arm still (≤ 5° RMS). */
export function gradeWave(
  app: EditorApp,
  character: CharacterId,
  clip: ClipId,
  opts: { readonly side?: 'left' | 'right'; readonly times?: number; readonly seconds?: number } = {},
): GradeResult {
  const side = opts.side ?? 'left';
  const other = side === 'left' ? 'right' : 'left';
  const record = app.store.get('clips', clip);
  if (record === undefined) return grade([cond('clip exists', false, 'missing')]);
  const fps = fpsNumber(record.fps);
  const frames = range(record.range.start, record.range.end);
  const k = scaleK(app, character);
  const chest = app.characters.get(character)?.skeleton.humanoid?.upperChest === undefined ? 'chest' : 'upperChest';
  const hands = frames.map((f) => {
    const [hand, body] = bonesAt(app, character, clip, [`${side}Hand`, chest], f) as [World, World];
    return sub(hand.position, body.position);
  });
  const { values } = principal(hands);
  const above = frames.filter((f) => {
    const [hand, shoulder] = bonesAt(app, character, clip, [`${side}Hand`, `${side}UpperArm`], f) as [World, World];
    return hand.position[1] > shoulder.position[1];
  }).length;
  const seconds = (record.range.end - record.range.start) / fps;
  const want = opts.seconds ?? 2;
  let rms = 0;
  const rest = restWorld(app, character, `${other}LowerArm`);
  for (const f of frames) rms += angleDeg(boneWorld(app, character, clip, `${other}LowerArm`, f).rotation, rest.rotation) ** 2;
  rms = Math.sqrt(rms / frames.length);
  const ptp = Math.max(...values) - Math.min(...values);
  return grade([
    cond('cycles', cycles(values) === (opts.times ?? 3), cycles(values)),
    cond('peak to peak ≥ 5 cm·k', ptp >= 0.05 * k, ptp),
    cond('window 2.0 ± 0.2 s', Math.abs(seconds - want) <= 0.2, seconds),
    cond('hand above the shoulder ≥ 80 %', above / frames.length >= 0.8, above / frames.length),
    cond('other arm ≤ 5° RMS', rms <= 5, rms),
  ]);
}

// ---------- AE-06: 1.5× slower ----------
/** AE-06: range × 1.5 ± 1 frame; fps unchanged; pose at 1.5·t equals the original at t (hand within 2 cm·k, the
 *  snapping moves keys by ≤ ½ frame); no subframe keys. */
export function gradeSlower(
  before: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
  after: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
  factor = 1.5,
): GradeResult {
  const was = before.app.store.get('clips', before.clip);
  const now = after.app.store.get('clips', after.clip);
  if (was === undefined || now === undefined) return grade([cond('clip exists', false, 'missing')]);
  const span = (record: typeof was) => record.range.end - record.range.start;
  const k = scaleK(after.app, after.character);
  let worst = 0;
  for (const t of range(was.range.start, was.range.end)) {
    const a = boneWorld(before.app, before.character, before.clip, 'leftHand', t).position;
    const b = boneWorld(after.app, after.character, after.clip, 'leftHand', Math.round(factor * t)).position;
    worst = Math.max(worst, length(sub(a, b)));
  }
  let subframe = 0;
  for (const curve of after.app.store.query.curvesOfClip(after.clip)) {
    for (const key of after.app.store.query.keysOfCurve(curve.id)) if (!Number.isInteger(key.t)) subframe++;
  }
  return grade([
    cond('range × 1.5 ± 1', Math.abs(span(now) - factor * span(was)) <= 1, span(now)),
    cond('fps unchanged', fpsNumber(now.fps) === fpsNumber(was.fps), fpsNumber(now.fps)),
    cond('poses kept (≤ 2 cm·k)', worst <= 0.02 * k, worst),
    cond('no subframe keys', subframe === 0, subframe),
  ]);
}

// ---------- AE-13: a hand on the head top ----------
/** The head top at a frame: the head joint plus, turned with the head, its highest descendant's rest height (else
 *  12 cm·k). */
function headTop(app: EditorApp, character: CharacterId, clip: ClipId, f: number): [number, number, number] {
  const runtime = app.characters.get(character);
  const head = nodeOf(app, character, 'head');
  const rest = restWorld(app, character, 'head');
  const below = (node: number): boolean => {
    for (let n = runtime?.skeleton.nodes[node]?.parent ?? -1; n !== -1; n = runtime?.skeleton.nodes[n]?.parent ?? -1) {
      if (n === head) return true;
    }
    return false;
  };
  let top = 0;
  for (const node of runtime?.skeleton.nodes ?? []) {
    if (below(node.index)) top = Math.max(top, restWorld(app, character, node.name).position[1] - rest.position[1]);
  }
  const offset: [number, number, number] = [0, top > 0 ? top : 0.12 * scaleK(app, character), 0];
  const now = boneWorld(app, character, clip, 'head', f);
  const q = relativeRotation(now.rotation, rest.rotation);
  const turned = rotate(q, offset);
  return [now.position[0] + turned[0], now.position[1] + turned[1], now.position[2] + turned[2]];
}

/** AE-13: the right hand within 6 cm·k of the head top over frames 30–40, no elbow hyperextension, frames outside
 *  20–50 unchanged. */
export function gradeHandOnHead(
  before: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
  after: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
): GradeResult {
  const { app, character, clip } = after;
  const k = scaleK(app, character);
  let far = 0;
  let flexOk = true;
  for (const f of range(30, 40)) {
    const [shoulder, elbow, hand] = bonesAt(app, character, clip, ['rightUpperArm', 'rightLowerArm', 'rightHand'], f) as [
      World,
      World,
      World,
    ];
    far = Math.max(far, length(sub(hand.position, headTop(app, character, clip, f))));
    const upper = norm(sub(elbow.position, shoulder.position));
    const lower = norm(sub(hand.position, elbow.position));
    const flexion = Math.acos(Math.max(-1, Math.min(1, dot(upper, lower)))) / DEG;
    if (flexion < 20 || flexion > 170) flexOk = false;
  }
  let outside = 0;
  const bones = ['rightUpperArm', 'rightLowerArm', 'rightHand', 'leftHand', 'head'];
  for (const f of [...range(0, 19), ...range(51, 60)]) {
    const a = bonesAt(before.app, before.character, before.clip, bones, f);
    const b = bonesAt(app, character, clip, bones, f);
    a.forEach((bone, i) => {
      outside = Math.max(outside, angleDeg(bone.rotation, (b[i] as World).rotation));
    });
  }
  return grade([
    cond('hand on the head top (≤ 6 cm·k)', far <= 0.06 * k, far),
    cond('no elbow hyperextension', flexOk, flexOk ? 'ok' : 'out of 20–170°'),
    cond('frames outside 20–50 unchanged', outside < 1e-3, outside),
  ]);
}

// ---------- AE-19: ease out and in ----------
/** AE-19: per-frame hand displacement rising over the first third of 10–30 and falling over the last; the peak in the
 *  middle third; poses at 10 and 30 within 0.5°. */
export function gradeEase(
  before: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
  after: { readonly app: EditorApp; readonly character: CharacterId; readonly clip: ClipId },
): GradeResult {
  const { app, character, clip } = after;
  const hand = range(10, 30).map((f) => boneWorld(app, character, clip, 'leftHand', f).position);
  const d = hand.slice(0, -1).map((p, i) => length(sub(hand[i + 1] as typeof p, p)));
  const third = Math.floor(d.length / 3);
  const first = d.slice(0, third);
  const last = d.slice(d.length - third);
  const peak = d.indexOf(Math.max(...d));
  const arm = (side: typeof before, f: number) => boneWorld(side.app, side.character, side.clip, 'leftUpperArm', f).rotation;
  const poses = Math.max(angleDeg(arm(after, 10), arm(before, 10)), angleDeg(arm(after, 30), arm(before, 30)));
  return grade([
    cond('eases out', (first.at(-1) as number) > 1.2 * (first[0] as number), `${first[0]} → ${first.at(-1)}`),
    cond('eases in', (last[0] as number) > 1.2 * (last.at(-1) as number), `${last[0]} → ${last.at(-1)}`),
    cond('peak in the middle third', peak >= third && peak < d.length - third, peak),
    cond('poses at 10 and 30 kept (≤ 0.5°)', poses <= 0.5, poses),
  ]);
}

// ---------- AE-09 / AE-24: spine flips ----------
export const SPINE_CONTROLS = ['fk.spine', 'fk.chest'] as const;
/** AE-09: orientation at every frame equal to the clean motion (geodesic ≤ 0.1°); no Euler channel jump > 30°/frame. */
export function gradeFlips(app: EditorApp, character: CharacterId, clip: ClipId, clean: ClipId): GradeResult {
  const frames = range(0, 40);
  const bones = ['spine', 'chest', 'upperChest', 'neck', 'head'];
  let worst = 0;
  for (const f of frames) {
    const now = bonesAt(app, character, clip, bones, f);
    const was = bonesAt(app, character, clean, bones, f);
    now.forEach((bone, i) => {
      worst = Math.max(worst, angleDeg(bone.rotation, (was[i] as World).rotation));
    });
  }
  let jump = 0;
  for (const key of SPINE_CONTROLS) {
    const id = controlOf(app, character, key);
    for (const channel of ['rx', 'ry', 'rz']) {
      for (const f of frames.slice(1)) {
        jump = Math.max(jump, Math.abs(channelAt(app, clip, id, channel, f) - channelAt(app, clip, id, channel, f - 1)) / DEG);
      }
    }
  }
  return grade([cond('orientation kept (≤ 0.1°)', worst <= 0.1, worst), cond('no jump > 30°/frame', jump <= 30, jump)]);
}

export { keyFrames };
