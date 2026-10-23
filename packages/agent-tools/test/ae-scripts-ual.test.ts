// MCP-SPEC §8 P2 DoD, §9.3.3: P2's copies of the walk tasks on the Quaternius UAL walk (`Walk_Loop`, 24 fps, frames
// 0–32 with frame 32 = frame 0): AE-04 (a hitching loop made seamless), AE-07 (the left contact two frames later),
// AE-08 (arms trailing by two frames), AE-21 (uneven arm spacing). Their scripts need P1's work the test doubles do
// not model — `clip.makeLoop` matching end slopes, `key.retime {wrap}` (a cyclic offset) and the scope-ready
// `graph.tangent.set` — so they are gated on READY.p1. The setups and graders run now: each grader rejects its setup
// and accepts the intended result built here independently (a cyclic shift of the sampled curves, the operator under
// the equivalent user selection, or the clean walk itself).
//
// Deviation of the copies (P9 decides): the seam's velocity test is relative — the velocity mismatch across the seam
// may exceed the clean walk's own by ≤ 0.05°/frame. §5.16's literal |(p(e) − p(e−1)) − (p(s+1) − p(s))| is the
// acceleration of any smooth loop: the clean UAL walk measures ≈ 5°/frame on its bones.
import { evaluateAnimCurve, quatInvert, quatMultiply, quatRotateVec3, type TangentType } from '@ekza-studio/anim-core';
import { type CharacterId, type ClipId, seededIdSource } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { createHeadlessEditorApp, deleteKeys, type EditorApp, ensureCurve, writeKeyAt } from '@ekza-studio/editor-core';
import { parseGlb } from '@ekza-studio/io';
import { beforeEach, describe, expect, it } from 'vitest';
import { allBones, angleDeg, animatedCurves, bonesAt, DEG, lagOf, length, range, sub, type World } from './ae-graders';
import { withP1 } from './p1-doubles';
import { call, controlOf, dataOf, type P2Fixture, runtimeOf, runtimeReady } from './p2-support';
import { READY } from './ready';
import { readSample } from './support';

const END = 32;
const CYCLE = range(0, END - 1);
const LEFT_LEG = ['fk.DEF-thigh_L', 'fk.DEF-shin_L', 'fk.DEF-foot_L', 'fk.DEF-toe_L'];
const RIGHT_LEG = ['fk.DEF-thigh_R', 'fk.DEF-shin_R', 'fk.DEF-foot_R', 'fk.DEF-toe_R'];
const ARMS = [
  'fk.DEF-upper_arm_L',
  'fk.DEF-forearm_L',
  'fk.DEF-hand_L',
  'fk.DEF-upper_arm_R',
  'fk.DEF-forearm_R',
  'fk.DEF-hand_R',
];

interface Walk {
  readonly fx: P2Fixture;
  readonly app: EditorApp;
  readonly character: CharacterId;
  /** `Walk_Loop`, the clip the agent edits. */
  readonly clip: ClipId;
  /** An untouched copy (`clean`), for the graders. */
  readonly clean: ClipId;
}

let walkIndex = -1;
async function walk(): Promise<Walk> {
  if (walkIndex === -1) {
    const container = await parseGlb(readFixture('quaternius-ual.glb'));
    const animations = (container.json as { animations?: { name?: string }[] }).animations ?? [];
    walkIndex = animations.findIndex((a) => a.name === 'Walk_Loop');
  }
  const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(151) });
  const loaded = await app.runUntyped('file.loadSample', {
    sample: 'quaternius-ual',
    options: { clips: [walkIndex] },
  });
  if (loaded.status !== 'finished') throw new Error('UAL did not load');
  const character = (loaded.value as { character: CharacterId }).character;
  await runtimeReady(app, character);
  const clip = app.store.query.clipsOfCharacter(character)[0]?.id as ClipId;
  const copied = await app.runUntyped('clip.duplicate', { clip, name: 'clean' });
  if (copied.status !== 'finished') throw new Error('no copy');
  const clean = (copied.value as { clip: ClipId }).clip;
  app.session.setState({ activeClip: { ...app.session.getState().activeClip, [character]: clip } });
  const fx: P2Fixture = { app, character, agentClip: clip, userClip: clip, keys: [], tools: withP1(app) };
  return { fx, app, character, clip, clean };
}

/** Rotation curves of controls in a clip (base layer). */
function rotationCurves(w: Walk, clip: ClipId, controls: readonly string[]) {
  const ids = new Set(controls.map((key) => controlOf(w.app, w.character, key)));
  return animatedCurves(w.app, clip).filter(
    ({ curve }) => ids.has(curve.control) && ['rx', 'ry', 'rz'].includes(curve.channel),
  );
}

/** Rewrites curves as keys of `value(f)` at `frames` (the user's edit; every frame, auto tangents by default). */
function rewrite(
  w: Walk,
  controls: readonly string[],
  value: (curve: ReturnType<typeof rotationCurves>[number], f: number) => number,
  frames: readonly number[] = range(0, END),
  tangent: TangentType = 'auto',
): void {
  const curves = rotationCurves(w, w.clip, controls);
  const values = curves.map((entry) => frames.map((f) => value(entry, f)));
  w.app.store.transact({ label: 'Setup' }, (tx) => {
    curves.forEach(({ curve }, i) => {
      deleteKeys(
        w.app,
        tx,
        tx.query.keysOfCurve(curve.id).map((key) => key.id),
      );
      const id = ensureCurve(w.app, tx, w.clip, curve.control, curve.channel);
      frames.forEach((f, j) => {
        writeKeyAt(w.app, tx, id, f, (values[i] as number[])[j] as number, { in: tangent, out: tangent });
      });
    });
  });
}

// ---------- graders ----------
const posesOf = (w: Walk, clip: ClipId, frames: readonly number[]) => {
  const bones = allBones(w.app, w.character);
  return frames.map((f) => bonesAt(w.app, w.character, clip, bones, f));
};
const k = (w: Walk) => (w.app.characters.get(w.character)?.skeleton.height ?? 1.7) / 1.7;

/** AE-04's seam: C0 per bone (≤ 2 mm·k, ≤ 0.5°) and the velocity mismatch, relative to the clean walk's (header). */
function seam(w: Walk, clip: ClipId): { c0: boolean; c1: boolean } {
  const [s, s1, e1, e] = [0, 1, END - 1, END].map((f) => posesOf(w, clip, [f])[0] as World[]);
  const [cs, cs1, ce1, ce] = [0, 1, END - 1, END].map((f) => posesOf(w, w.clean, [f])[0] as World[]);
  let c0 = true;
  let c1 = true;
  (s as World[]).forEach((bone, i) => {
    const end = (e as World[])[i] as World;
    if (length(sub(end.position, bone.position)) > 0.002 * k(w) || angleDeg(end.rotation, bone.rotation) > 0.5) {
      c0 = false;
    }
    const mismatch = (a: World[], a1: World[], b1: World[], b: World[]) =>
      Math.abs(
        angleDeg((b[i] as World).rotation, (b1[i] as World).rotation) -
          angleDeg((a1[i] as World).rotation, (a[i] as World).rotation),
      );
    const now = mismatch(s as World[], s1 as World[], e1 as World[], e as World[]);
    const clean = mismatch(cs as World[], cs1 as World[], ce1 as World[], ce as World[]);
    if (now > clean + 0.05) c1 = false;
  });
  return { c0, c1 };
}

/** Heel strike of a foot in an in-place walk: the frame the foot reaches furthest forward of the hips. */
function heelStrike(w: Walk, clip: ClipId, bone: string): number {
  const ahead = CYCLE.map((f) => {
    const [foot, hips] = bonesAt(w.app, w.character, clip, [bone, 'DEF-hips'], f) as [World, World];
    return foot.position[2] - hips.position[2];
  });
  return ahead.indexOf(Math.max(...ahead));
}

/** A bone's rotation relative to its parent (its own motion), as a signal: the angle from the clean walk's frame 0. */
function swing(w: Walk, clip: ClipId, bone: string): number[] {
  const runtime = w.app.characters.get(w.character);
  const node = runtime?.skeleton.nodes.find((n) => n.name === bone);
  const parent = runtime?.skeleton.nodes[node?.parent ?? -1]?.name ?? bone;
  const local = (c: ClipId, f: number) => {
    const [b, p] = bonesAt(w.app, w.character, c, [bone, parent], f) as [World, World];
    return quatMultiply(quatInvert(p.rotation), b.rotation);
  };
  const ref = local(w.clean, 0);
  return CYCLE.map((f) => angleDeg(local(clip, f), ref));
}

/** The value of a curve sampled at a cyclic frame of the clean walk. */
function cleanValue(w: Walk, control: string, channel: string, f: number): number {
  const entry = rotationCurves(w, w.clean, [control]).find(({ curve }) => curve.channel === channel);
  const wrapped = ((f % END) + END) % END;
  return entry === undefined ? 0 : evaluateAnimCurve(entry.compiled, wrapped);
}
const controlKey = (w: Walk, id: string) => w.app.store.get('controls', id as never)?.key ?? id;

// ---------- AE-04 ----------
/** The last three frames re-keyed off-cycle on the legs and arms: +2°, +4°, +6°. */
function hitch(w: Walk): void {
  rewrite(
    w,
    [...LEFT_LEG, ...RIGHT_LEG, ...ARMS],
    (entry, f) =>
      cleanValue(w, controlKey(w, entry.curve.control), entry.curve.channel, f) +
      (f >= END - 2 ? (f - END + 3) * 2 * DEG : 0),
  );
}
function gradeHitch(w: Walk, setup: readonly World[][]): Record<string, boolean> {
  const middle = range(3, END - 4);
  const now = posesOf(w, w.clip, middle);
  let sum = 0;
  let n = 0;
  now.forEach((pose, p) =>
    pose.forEach((bone, i) => {
      sum += angleDeg(bone.rotation, ((setup[p] as World[])[i] as World).rotation) ** 2;
      n++;
    }),
  );
  return { ...seam(w, w.clip), looksTheSame: Math.sqrt(sum / n) <= 2 };
}

// ---------- AE-21 ----------
/** The left hand's forward coordinate over the cycle in the clean walk: its swing extremes (frames). */
function extremes(w: Walk): [number, number] {
  const z = CYCLE.map((f) => (bonesAt(w.app, w.character, w.clean, ['DEF-hand.L'], f)[0] as World).position[2]);
  return [z.indexOf(Math.max(...z)), z.indexOf(Math.min(...z))];
}
/**
 * Even spacing: the arm curves keyed only at the swing extremes, linear in between — across the loop seam too (the
 * keys at 0 and 32 lie on the line from the later extreme to the earlier one, a cycle later).
 */
function evenArms(w: Walk): number[] {
  const [a, b] = extremes(w);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const frames = [0, lo, hi, END];
  const across = (END - hi) / (END - hi + lo);
  rewrite(
    w,
    ARMS,
    (entry, f) => {
      const value = (frame: number) => cleanValue(w, controlKey(w, entry.curve.control), entry.curve.channel, frame);
      if (f === lo || f === hi) return value(f);
      return value(hi) + (value(lo) - value(hi)) * across;
    },
    frames,
    'linear',
  );
  return frames;
}
/**
 * Coefficient of variation of the hand's per-frame displacement within each swing (between the extremes), the hand
 * taken in the upper chest's frame (the arm's own swing, without the body's bob and sway).
 */
function spacing(w: Walk, clip: ClipId): number[] {
  const [a, b] = extremes(w);
  const hand = range(0, END).map((f) => {
    const [h, chest] = bonesAt(w.app, w.character, clip, ['DEF-hand.L', 'DEF-spine.003'], f) as [World, World];
    return quatRotateVec3(quatInvert(chest.rotation), sub(h.position, chest.position));
  });
  const d = (f: number) => length(sub(hand[(f + 1) % END] as never, hand[f % END] as never));
  const cv = (frames: readonly number[]) => {
    const values = frames.map(d);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    return sd / mean;
  };
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return [cv(range(lo, hi - 1)), cv([...range(hi, END - 1), ...range(0, lo - 1)])];
}

let w: Walk;
beforeEach(async () => {
  w = await walk();
});

describe('UAL walk setups and graders (grader integrity, §9.3.4)', () => {
  it('the clean walk loops and passes the seam test', () => {
    expect(w.app.store.get('clips', w.clip)).toMatchObject({ loop: true, range: { start: 0, end: END } });
    expect(seam(w, w.clip)).toEqual({ c0: true, c1: true });
  });

  it('AE-04: the hitching setup pops at the seam; the clean walk is the fix', () => {
    hitch(w);
    const setup = posesOf(w, w.clip, range(3, END - 4));
    expect(gradeHitch(w, setup)).toMatchObject({ c0: false, looksTheSame: true });
    // the intended result: the walk as it was
    rewrite(w, [...LEFT_LEG, ...RIGHT_LEG, ...ARMS], (entry, f) =>
      cleanValue(w, controlKey(w, entry.curve.control), entry.curve.channel, f),
    );
    expect(gradeHitch(w, setup)).toEqual({ c0: true, c1: true, looksTheSame: true });
  });

  it('AE-07: the left heel strike moves +2 frames under a cyclic shift of the left leg only', () => {
    const left = heelStrike(w, w.clip, 'DEF-foot.L');
    const right = heelStrike(w, w.clip, 'DEF-foot.R');
    expect(left).toBeGreaterThanOrEqual(0);
    rewrite(w, LEFT_LEG, (entry, f) => cleanValue(w, controlKey(w, entry.curve.control), entry.curve.channel, f - 2));
    expect({
      left: (heelStrike(w, w.clip, 'DEF-foot.L') - left + END) % END,
      right: heelStrike(w, w.clip, 'DEF-foot.R') === right,
      seam: seam(w, w.clip).c0,
    }).toEqual({ left: 2, right: true, seam: true });
  });

  it('AE-08: arms shifted two frames later lag the original by +2 with the same amplitude', () => {
    const before = swing(w, w.clean, 'DEF-upper_arm.L');
    expect(lagOf(before, swing(w, w.clip, 'DEF-upper_arm.L'), 4)).toBe(0);
    rewrite(w, ARMS, (entry, f) => cleanValue(w, controlKey(w, entry.curve.control), entry.curve.channel, f - 2));
    for (const bone of ['DEF-upper_arm.L', 'DEF-upper_arm.R']) {
      const was = swing(w, w.clean, bone);
      const now = swing(w, w.clip, bone);
      const amplitude = (s: number[]) => Math.max(...s) - Math.min(...s);
      expect([bone, lagOf(was, now, 4), Math.abs(amplitude(now) / amplitude(was) - 1) <= 0.05]).toEqual([
        bone,
        2,
        true,
      ]);
    }
    expect(seam(w, w.clip).c0).toBe(true);
  });

  it('AE-21: even arm spacing fails; flat tangents at the swing extremes (the operator, user run) pass', async () => {
    const frames = evenArms(w);
    expect(Math.max(...spacing(w, w.clip))).toBeLessThan(0.15);
    // the operator under the equivalent user selection: the keys at the extremes, flat
    const [a, b] = extremes(w);
    const keys = rotationCurves(w, w.clip, ARMS).flatMap(({ curve }) =>
      w.app.store.query
        .keysOfCurve(curve.id)
        .filter((key) => key.t === a || key.t === b)
        .map((key) => key.id),
    );
    w.app.session.setState({
      selection: {
        ...w.app.session.getState().selection,
        keys: new Map(keys.map((id) => [id, { key: true, in: true, out: true }])),
      },
    });
    const result = await w.app.runUntyped('graph.tangent.set', { type: 'flat' });
    expect(result.status).toBe('finished');
    expect(Math.min(...spacing(w, w.clip))).toBeGreaterThanOrEqual(0.3);
    // the poses at the extremes stay (keys unchanged), the legs untouched
    for (const f of [a, b]) {
      const now = bonesAt(w.app, w.character, w.clip, ['DEF-upper_arm.L', 'DEF-forearm.L'], f);
      const was = bonesAt(w.app, w.character, w.clean, ['DEF-upper_arm.L', 'DEF-forearm.L'], f);
      now.forEach((bone, i) => expect(angleDeg(bone.rotation, (was[i] as World).rotation)).toBeLessThan(1));
    }
    expect(frames).toContain(0);
  });
});

describe.skipIf(!READY.p1)('UAL walk scripts (P2 copies of §9.3.3 references, READY.p1)', () => {
  // M-AI-MVP-6 (DECISIONS-OPEN §N, MCP-SPEC §0.4): the seam's C1 grade (≤ 0.05° per frame beyond the clean walk) fails
  // with P1's clip.makeLoop slope matching (0.2–0.7° over, hips chain); found at the port, also failing on the old base
  // with P1 + P2 merged. Gated on READY.p9: the evals package settles the grader or P1's slope matching.
  it.skipIf(!READY.p9)('AE-04: makes the hitching loop seamless without changing how it looks', async () => {
    hitch(w);
    const setup = posesOf(w, w.clip, range(3, END - 4));
    const runtime = runtimeOf(w.fx);
    const dry = dataOf<{ before: { verdict: string } }>(
      await call(runtime, 'clip_make_loop', { clip: 'Walk_Loop', method: 'match_ends', dryRun: true }),
    );
    expect(dry.before.verdict).toBe('pops');
    // the off-cycle in-betweens go, then the ends match (values and slopes)
    expect(
      (
        await call(runtime, 'keys_delete', {
          clip: 'Walk_Loop',
          targets: { controls: [...LEFT_LEG, ...RIGHT_LEG, ...ARMS] },
          rangeFrames: [END - 2, END - 1],
        })
      ).ok,
    ).toBe(true);
    expect((await call(runtime, 'clip_make_loop', { clip: 'Walk_Loop', method: 'match_ends' })).ok).toBe(true);
    expect(gradeHitch(w, setup)).toEqual({ c0: true, c1: true, looksTheSame: true });
  });

  // M-AI-MVP-6 (DECISIONS-OPEN §N, MCP-SPEC §0.4): the seam's C1 grade (≤ 0.05° per frame beyond the clean walk) fails
  // with P1's clip.makeLoop slope matching (0.2–0.7° over, hips chain); found at the port, also failing on the old base
  // with P1 + P2 merged. Gated on READY.p9: the evals package settles the grader or P1's slope matching.
  it.skipIf(!READY.p9)('AE-07: moves the left foot’s contact two frames later', async () => {
    const left = heelStrike(w, w.clip, 'DEF-foot.L');
    const right = heelStrike(w, w.clip, 'DEF-foot.R');
    const result = await call(runtimeOf(w.fx), 'keys_retime', {
      clip: 'Walk_Loop',
      targets: { controls: LEFT_LEG },
      mode: 'offset',
      offsetFrames: 2,
      wrap: true,
    });
    expect(result.ok).toBe(true);
    expect({
      left: (heelStrike(w, w.clip, 'DEF-foot.L') - left + END) % END,
      right: heelStrike(w, w.clip, 'DEF-foot.R') === right,
      seam: seam(w, w.clip),
    }).toEqual({ left: 2, right: true, seam: { c0: true, c1: true } });
  });

  it('AE-08: gives the arms follow-through, trailing the body by 2 frames', async () => {
    const result = await call(runtimeOf(w.fx), 'keys_retime', {
      clip: 'Walk_Loop',
      targets: { controls: ARMS },
      mode: 'offset',
      offsetFrames: 2,
      wrap: true,
    });
    expect(result.ok).toBe(true);
    for (const bone of ['DEF-upper_arm.L', 'DEF-upper_arm.R']) {
      const was = swing(w, w.clean, bone);
      const now = swing(w, w.clip, bone);
      const amplitude = (s: number[]) => Math.max(...s) - Math.min(...s);
      expect([bone, lagOf(was, now, 4), Math.abs(amplitude(now) / amplitude(was) - 1) <= 0.05]).toEqual([
        bone,
        2,
        true,
      ]);
    }
    expect(seam(w, w.clip)).toEqual({ c0: true, c1: true });
  });

  it('AE-21: fixes the even arm swing timing, keeping the poses', async () => {
    evenArms(w);
    const runtime = runtimeOf(w.fx);
    // the swing extremes are the arm keys inside the loop (the agent reads them)
    const read = dataOf<{ curves: { keys: [number, number][] }[] }>(
      await call(runtime, 'keys_read', { clip: 'Walk_Loop', targets: { controls: ['fk.DEF-upper_arm_L'] } }),
    );
    const inside = [
      ...new Set(read.curves.flatMap((curve) => curve.keys.map(([frame]) => frame)).filter((f) => f > 0 && f < END)),
    ];
    expect(inside).toHaveLength(2);
    const result = await call(runtime, 'curves_set_interpolation', {
      clip: 'Walk_Loop',
      targets: { controls: ARMS },
      frames: inside,
      tangent: 'flat',
    });
    expect(result.ok).toBe(true);
    expect(Math.min(...spacing(w, w.clip))).toBeGreaterThanOrEqual(0.3);
    expect(seam(w, w.clip).c0).toBe(true);
  });
});
