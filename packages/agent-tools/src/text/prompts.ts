// Prompts (MCP-SPEC §5.20.4): user-invoked motion recipes; Claude Code shows them as `/ekza:<name>`. Arguments are
// single words. D0 lands the names, arguments and the reference grader of each; P2 writes the plan text and P9 the
// reference scripts (a test asserts every tool a plan names appears in its script).
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
    plan: null,
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
    plan: null,
  },
  {
    name: 'breathing_idle',
    title: 'Breathing idle',
    description: 'Make a looping breathing idle.',
    arguments: [arg('seconds', 'cycle length')],
    tools: ['history_checkpoint', 'clip_create', 'pose_set', 'clip_make_loop', 'analyze_loop'],
    grader: 'AE-03',
    plan: null,
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
    plan: null,
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
    plan: null,
  },
  {
    name: 'make_seamless_loop',
    title: 'Make a seamless loop',
    description: 'Make a clip loop seamlessly and check the seam.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: ['analyze_loop', 'history_checkpoint', 'clip_make_loop', 'view_plot_curves'],
    grader: 'AE-04',
    plan: null,
  },
  {
    name: 'review_clip',
    title: 'Review a clip',
    description: 'Critique a clip with numbers and one contact sheet; change nothing.',
    arguments: [arg('clip', 'the clip name', true)],
    tools: ['scene_summary', 'analyze_contacts', 'analyze_loop', 'analyze_motion', 'view_capture'],
    grader: 'read-only',
    plan: null,
  },
];
