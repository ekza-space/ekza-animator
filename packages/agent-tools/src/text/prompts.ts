// Prompts (MCP-SPEC §5.20.4): user-invoked motion recipes; Claude Code shows them as `/ekza:<name>`. Arguments are
// single words. D0 landed the names, arguments and the reference grader of each; P2 writes the plans (one user
// message naming the tools in order, every edit with its clip, starting with one labelled history_checkpoint) and P9
// the reference scripts (a test asserts every tool a plan names appears in its script). Plans never contain document
// strings beyond the user's own arguments, which are reduced to safe single words (§5.3).
export interface PromptArgumentDef {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}
export interface PromptDef {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly PromptArgumentDef[];
  /** The tools the plan names, in order (the reference script must call each). */
  readonly tools: readonly string[];
  /** The grader of its reference script (§5.20.4 table). */
  readonly grader: string;
  /** The plan as one user message; null until P2 writes it (the prompt is not listed while null). */
  readonly plan: ((args: Readonly<Record<string, string>>) => string) | null;
}

const arg = (name: string, description: string, required = false): PromptArgumentDef => ({
  name,
  description,
  required,
});

/** The closing line of every plan (§5.20.4). */
export const PLAN_CLOSE =
  'Change only what was asked; check with numbers and one contact sheet; report the AI steps you made.';

/** A user argument as one safe word (letters, digits, _ . -; ≤ 40 characters), else the fallback. */
export function planWord(value: string | undefined, fallback: string): string {
  const word = (value ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[A-Za-z0-9_.-]{1,40}$/.test(word) ? word : fallback;
}

/** A positive number argument, else the fallback (bounded). */
export function planNumber(value: string | undefined, fallback: number, max: number): number {
  const n = Number(planWord(value, String(fallback)));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

const lines = (...parts: readonly string[]): string => parts.join('\n');

function wavePlan(args: Readonly<Record<string, string>>): string {
  const side = planWord(args['side'], 'L').toUpperCase().startsWith('R') ? 'R' : 'L';
  const times = Math.round(planNumber(args['times'], 3, 10));
  const seconds = planNumber(args['seconds'], 2, 30);
  const bone = side === 'L' ? 'left' : 'right';
  const x = side === 'L' ? 1 : -1;
  return lines(
    `Make a new ${seconds}-second clip where the character waves its ${side === 'L' ? 'left' : 'right'} hand ${times} times above the shoulder.`,
    'Pass character and clip on every call; never edit the clip the user has active.',
    '1. scene_summary — note the character and the project fps.',
    `2. rig_describe {character} — the ${bone} arm is FK: fk.upperArm.${side}, fk.lowerArm.${side}.`,
    `3. history_checkpoint {label: "Wave ${side === 'L' ? 'left' : 'right'} hand ×${times}"}.`,
    `4. clip_create {character, name: "wave", durationSeconds: ${seconds}} — from now on pass clip: "wave".`,
    `5. pose_aim {clip: "wave", frame: 0, aims: [{bone: "${bone}UpperArm", direction: [${0.8 * x}, 0.6, 0]}, {bone: "${bone}LowerArm", direction: [${0.55 * x}, 0.83, 0.1]}]} — upper arm out and up, forearm up.`,
    `6. step = fps × ${seconds} / ${2 * times} frames. At every frame n·step up to the clip end call pose_aim {clip: "wave", frame: n·step, aims: [the same upper-arm aim, {bone: "${bone}LowerArm", direction: n even ? [${0.55 * x}, 0.83, 0.1] : [${-0.25 * x}, 0.97, 0.1]}]}.`,
    `7. analyze_motion {clip: "wave", targets: {bones: ["${bone}Hand"]}, metrics: ["oscillation"]} — expect ${times} cycles.`,
    '8. view_capture {clip: "wave", frames: "keys", views: ["front"], crop: "upper_body"}.',
    PLAN_CLOSE,
  );
}

function walkPlan(args: Readonly<Record<string, string>>): string {
  const character = planWord(args['character'], 'the character');
  const seconds = planNumber(args['seconds'], 1, 10);
  return lines(
    `Block an in-place walk cycle of about ${seconds} s for ${character}.`,
    'Pass character and clip on every call; legs are IK (place the feet), arms FK (aim them).',
    `1. rig_describe {character} — the leg IK controls, cog and the arm FK controls.`,
    `2. history_checkpoint {label: "Walk cycle ${seconds}s"}.`,
    `3. clip_create {character, name: "walk", durationSeconds: ${seconds}, loop: true} — then pass clip: "walk".`,
    '4. Left leg over the first half cycle (frames 0, ¼, ½ of the cycle and the poses between): contact (left heel forward), down, passing and up poses with pose_ik_target {clip: "walk", limb: "leg.L", frame, positionM: [x, y, z]} — feet in character space (+Z forward, +X the character’s left), forward foot ahead, back foot behind, the passing foot lifted.',
    '5. The body bob: pose_set {clip: "walk", frame, set: [{control: "cog", translateM: {y: …}}]} — lowest on the down pose, highest on the up pose, twice per cycle.',
    '6. Arm swing opposite the legs: pose_aim {clip: "walk", frame, aims: [{bone: "rightUpperArm", direction: …}]} forward when the left leg is forward.',
    '7. operator_run {id: "pose.mirrorAnimation", args: {mode: "leftToRight", offset: "halfCycle"}, context: {clip: "walk", controls: [the left leg’s and the right arm’s controls]}} — the other half of the cycle.',
    '8. clip_make_loop {clip: "walk", method: "cycle_only"}.',
    '9. analyze_contacts {clip: "walk"} — one contact per foot per cycle, no sliding; analyze_loop {clip: "walk"} — seamless.',
    '10. view_capture {clip: "walk", frames: "keys", views: ["left", "right"]}.',
    PLAN_CLOSE,
  );
}

function breathingPlan(args: Readonly<Record<string, string>>): string {
  const seconds = planNumber(args['seconds'], 4, 30);
  return lines(
    `Create a ${seconds}-second seamless breathing idle.`,
    'Pass character and clip on every call.',
    `1. history_checkpoint {label: "Breathing idle ${seconds}s"}.`,
    `2. clip_create {character, name: "breathe", durationSeconds: ${seconds}, loop: true} — then pass clip: "breathe".`,
    '3. pose_set {clip: "breathe", frame: 0, set: [{control: "fk.chest", rotateDeg: {x: 0}}]} and at the middle frame pose_set {clip: "breathe", frame: half, set: [{control: "fk.chest", rotateDeg: {x: 2}}]} — a small chest pitch of 1–3° (the same on fk.upperChest when the rig has it).',
    '4. clip_make_loop {clip: "breathe", method: "match_ends"}.',
    '5. analyze_loop {clip: "breathe"} — seamless.',
    PLAN_CLOSE,
  );
}

function polishPlan(args: Readonly<Record<string, string>>): string {
  const clip = planWord(args['clip'], 'the clip');
  return lines(
    `Polish clip ${clip}: fix what is clearly broken and propose the rest.`,
    `Pass clip: "${clip}" on every call.`,
    `1. history_checkpoint {label: "Polish ${clip}"}.`,
    `2. curves_euler_filter {clip: "${clip}"} — removes rotation flips without changing the motion.`,
    `3. analyze_loop {clip: "${clip}"} (looping clips) and analyze_contacts {clip: "${clip}"} — seam and foot sliding.`,
    `4. analyze_motion {clip: "${clip}", targets: {bodyParts: ["arm.L", "arm.R", "head"]}, metrics: ["pops", "spacing", "arcs"]}.`,
    `5. view_capture {clip: "${clip}", frames: "extremes", overlays: {trails: ["leftHand", "rightHand"]}}.`,
    '6. Propose fixes with the numbers you found and ask the user before broad changes.',
    PLAN_CLOSE,
  );
}

function footPlan(args: Readonly<Record<string, string>>): string {
  const clip = planWord(args['clip'], 'the clip');
  return lines(
    `Fix the foot sliding in clip ${clip}.`,
    `Pass clip: "${clip}" on every call.`,
    `1. analyze_contacts {clip: "${clip}"} — each foot's contact intervals [a, b] and their slide.`,
    `2. history_checkpoint {label: "Fix foot sliding"}.`,
    '3. For each sliding contact [a, b] of a foot:',
    `   a. pose_read {clip: "${clip}", space: "world", bones: [the foot, e.g. "leftFoot"], frames: [a]} — the planted position P.`,
    `   b. keys_delete {clip: "${clip}", targets: {controls: ["ik.leg.L"]}, rangeFrames: [a + 1, b − 1]} — the IK foot's keys strictly inside the contact.`,
    `   c. pose_ik_target {clip: "${clip}", limb: "leg.L", frame, positionM: P} at a, at b and at every frame in between where root or cog has a key (every 4th frame when the root travels without keys).`,
    `   d. curves_set_interpolation {clip: "${clip}", targets: {controls: ["ik.leg.L"]}, rangeFrames: [a, b], tangent: "linear"}.`,
    `4. analyze_contacts {clip: "${clip}"} again — the slide is gone.`,
    PLAN_CLOSE,
  );
}

function loopPlan(args: Readonly<Record<string, string>>): string {
  const clip = planWord(args['clip'], 'the clip');
  return lines(
    `Make clip ${clip} loop seamlessly without changing how it looks.`,
    `Pass clip: "${clip}" on every call.`,
    `1. analyze_loop {clip: "${clip}"} — the verdict and the worst channels at the seam.`,
    `2. history_checkpoint {label: "Seamless loop"}.`,
    `3. clip_make_loop {clip: "${clip}", method: "match_ends"} (blend when the ends differ a lot).`,
    `4. view_plot_curves {clip: "${clip}", targets: {controls: [the worst controls]}} — the seam is smooth.`,
    `5. analyze_loop {clip: "${clip}"} — seamless.`,
    PLAN_CLOSE,
  );
}

function reviewPlan(args: Readonly<Record<string, string>>): string {
  const clip = planWord(args['clip'], 'the clip');
  return lines(
    `Review clip ${clip} and write a critique. Change nothing.`,
    `Pass clip: "${clip}" on every call.`,
    '1. scene_summary — the clip’s fps, range and loop flag.',
    `2. analyze_contacts {clip: "${clip}"}, analyze_loop {clip: "${clip}"} and analyze_motion {clip: "${clip}", targets: {bodyParts: ["arm.L", "arm.R", "head", "torso"]}, metrics: ["pops", "spacing", "arcs"]}.`,
    `3. view_capture {clip: "${clip}", frames: "keys", overlays: {trails: ["leftHand", "rightHand"]}} — one contact sheet.`,
    '4. Write the critique: timing and spacing, arcs, contacts, the loop, pops — each point with the numbers behind it.',
    'Read only: make no edits and no checkpoint.',
  );
}

/** MCP-SPEC §0.4.4 (B4): "rig this model and add a walk" — the Auto-Rig wizard's steps through the setup tools. */
function rigAndAnimatePlan(args: Readonly<Record<string, string>>): string {
  const clip = planWord(args['clip'], 'walk').toLowerCase();
  const author = planWord(args['author'], '');
  const license = planWord(args['license'], '').toLowerCase();
  const meta =
    author === '' || !['cc0', 'cc-by-4.0', 'personal'].includes(license)
      ? 'meta: {authors: [the author], license: cc0 | cc-by-4.0 | personal} — ask the user for the author and the licence first'
      : `meta: {authors: ["${author}"], license: "${license}"}`;
  return lines(
    `Rig the static model in the scene and add the library clip ${clip}, then export a VRM.`,
    "The steps are the Auto-Rig wizard's; every tool reports what to call next.",
    '1. model_inspect — the checks, the pose (T or A) and the fixes in order; readyToRig says the rig will accept it.',
    `2. history_checkpoint {label: "Rig and add ${clip}"}.`,
    '3. model_fix {fix} for each fix model_inspect listed, in its order (scale with heightM 1.7 when the size is off: the rig refuses outside 0.3–3 m).',
    '4. rig_create {} — the guess places the markers; an A-pose is straightened to a T-pose. When it says the arms were not found, pass markers shoulder, elbow and wrist of the right arm (x < 0) in metres. Note the character it names.',
    `5. library_list — find the clip; then library_use {character, clip: "${clip}"} (inPlace: true for a treadmill cycle). Pass that clip on any later edit.`,
    `6. project_export {character, kind: "vrm", ${meta}}. Report its lints and read-back (humanoid bones).`,
    PLAN_CLOSE,
  );
}

export const PROMPTS: readonly PromptDef[] = [
  {
    name: 'wave',
    title: 'Wave',
    description: 'Block a hand wave on a new clip.',
    arguments: [arg('side', 'L or R'), arg('times', 'waves (default 3)'), arg('seconds', 'clip length (default 2)')],
    tools: [
      'scene_summary',
      'rig_describe',
      'history_checkpoint',
      'clip_create',
      'pose_aim',
      'analyze_motion',
      'view_capture',
    ],
    grader: 'AE-01',
    plan: wavePlan,
  },
  {
    name: 'block_walk_cycle',
    title: 'Block a walk cycle',
    description: 'Block a looping walk cycle with contact, down, passing and up poses.',
    arguments: [arg('character', 'the character name'), arg('seconds', 'cycle length')],
    tools: [
      'rig_describe',
      'history_checkpoint',
      'clip_create',
      'pose_ik_target',
      'pose_set',
      'pose_aim',
      'operator_run',
      'clip_make_loop',
      'analyze_contacts',
      'analyze_loop',
      'view_capture',
    ],
    grader: 'AE-14',
    plan: walkPlan,
  },
  {
    name: 'breathing_idle',
    title: 'Breathing idle',
    description: 'Make a looping breathing idle.',
    arguments: [arg('seconds', 'cycle length')],
    tools: ['history_checkpoint', 'clip_create', 'pose_set', 'clip_make_loop', 'analyze_loop'],
    grader: 'AE-03',
    plan: breathingPlan,
  },
  {
    name: 'polish_clip',
    title: 'Polish a clip',
    description: 'Clean up a clip: Euler flips, loop, contacts, pops, spacing and arcs; ask before broad changes.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: [
      'history_checkpoint',
      'curves_euler_filter',
      'analyze_loop',
      'analyze_contacts',
      'analyze_motion',
      'view_capture',
    ],
    grader: 'invariants',
    plan: polishPlan,
  },
  {
    name: 'fix_foot_sliding',
    title: 'Fix foot sliding',
    description: 'Find sliding foot contacts and plant the feet.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: [
      'analyze_contacts',
      'history_checkpoint',
      'pose_read',
      'keys_delete',
      'pose_ik_target',
      'curves_set_interpolation',
    ],
    grader: 'AE-05',
    plan: footPlan,
  },
  {
    name: 'make_seamless_loop',
    title: 'Make a seamless loop',
    description: 'Make a clip loop seamlessly and check the seam.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: ['analyze_loop', 'history_checkpoint', 'clip_make_loop', 'view_plot_curves'],
    grader: 'AE-04',
    plan: loopPlan,
  },
  {
    name: 'review_clip',
    title: 'Review a clip',
    description: 'Critique a clip with numbers and one contact sheet; change nothing.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: ['scene_summary', 'analyze_contacts', 'analyze_loop', 'analyze_motion', 'view_capture'],
    grader: 'read-only',
    plan: reviewPlan,
  },
  {
    name: 'rig_and_animate',
    title: 'Rig and animate a model',
    description: 'Rig the static model in the scene like Auto-Rig, add a library clip (walk) and export a VRM.',
    arguments: [
      arg('clip', 'library clip id (default walk)'),
      arg('author', 'author saved in the VRM'),
      arg('license', 'cc0, cc-by-4.0 or personal'),
    ],
    tools: [
      'model_inspect',
      'history_checkpoint',
      'model_fix',
      'rig_create',
      'library_list',
      'library_use',
      'project_export',
    ],
    grader: 'AE-R1',
    plan: rigAndAnimatePlan,
  },
];
