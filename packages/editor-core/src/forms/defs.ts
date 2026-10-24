// The pre-run forms of the touch shell (STUDIO-TOUCH-SPEC §5.6, §20.3 item 6; T5a). Operators that cannot be adjusted
// after a run and declare no ParamDefs — most animation operators, and the UI wrappers (§20.3 item 7) — get their
// parameters as chips *before* the run, filled with these defaults, with ✓ to run. Labels are the Studio Pro names
// (shown in grey under the touch shell's plain words, §6.3); defaults are the operator's own when it is run without
// the argument, so a form left as it is runs what Studio Pro's menu item runs. Studio Pro, `LastRun` and the agent
// schemas never read this file: no operator becomes repeatable or adjustable through it (OQ-15).
import { DEFAULT_REDUCE } from '@ekza-studio/rig';
import { IDENTITY_CLIP_PARAMS } from '../library/params';
import type { FormDef } from './types';

const DEG = Math.PI / 180;
/** `workflows/loop.ts` DEFAULT_BLEND_FRAMES (kept literal so the forms chunk stays small; a test pins it). */
export const FORM_BLEND_FRAMES = 6;
/** `edit/tween.ts` TWEEN_LIMIT and TWEEN_OVERSHOOT_LIMIT (pinned by a test). */
export const FORM_TWEEN_LIMITS = { limit: 100, overshoot: 150 } as const;
/** `workflows/records.ts` DEFAULT_CLIP_RANGE (pinned by a test). */
export const FORM_CLIP_RANGE = { start: 0, end: 60 } as const;

const TIME_TARGETS = [
  { value: 'selected', label: 'Selected (all when none)' },
  { value: 'character', label: 'Whole Character' },
] as const;
const MIRROR_MODES = [
  { value: 'flip', label: 'Flip' },
  { value: 'leftToRight', label: 'Left → Right' },
  { value: 'rightToLeft', label: 'Right → Left' },
] as const;
const INFINITY = [
  { value: 'constant', label: 'Constant' },
  { value: 'linear', label: 'Linear' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'cycleOffset', label: 'Cycle with offset' },
  { value: 'oscillate', label: 'Oscillate' },
] as const;

// ---------- curves and keys ----------

export const SIMPLIFY_FORM = {
  id: 'graph.curves.simplify',
  params: [
    {
      name: 'tolerance.rotationRad',
      label: 'Rotation Tolerance',
      kind: 'angle',
      bound: 'value',
      default: DEFAULT_REDUCE.rotationRad,
      min: 0,
      softMax: 5 * DEG,
      step: 0.1 * DEG,
      primary: true,
      group: 'Tolerance',
    },
    {
      name: 'tolerance.translationM',
      label: 'Translation Tolerance',
      kind: 'distance',
      bound: 'value',
      default: DEFAULT_REDUCE.translationM,
      min: 0,
      softMax: 0.01,
      step: 0.0005,
      group: 'Tolerance',
    },
    {
      name: 'tolerance.scale',
      label: 'Scale Tolerance',
      kind: 'number',
      bound: 'value',
      default: DEFAULT_REDUCE.scale,
      min: 0,
      softMax: 0.01,
      step: 0.0001,
      group: 'Tolerance',
    },
  ],
  fromSession: ['target'],
} satisfies FormDef<'graph.curves.simplify'>;

export const INFINITY_FORM = {
  id: 'graph.infinity.set',
  params: [
    { name: 'pre', label: 'Pre Infinity', kind: 'enum', bound: 'value', default: 'cycle', options: INFINITY },
    { name: 'post', label: 'Post Infinity', kind: 'enum', bound: 'value', default: 'cycle', options: INFINITY },
  ],
  fromSession: ['target'],
} satisfies FormDef<'graph.infinity.set'>;

export const TWEEN_FORM = {
  id: 'key.tween',
  params: [
    {
      name: 'mode',
      label: 'Mode',
      kind: 'enum',
      bound: 'value',
      default: 'tween',
      options: [
        { value: 'tween', label: 'Tween' },
        { value: 'neighbor', label: 'Blend to Neighbour' },
        { value: 'ease', label: 'Ease' },
        { value: 'pushPull', label: 'Push/Pull' },
        { value: 'toDefault', label: 'Blend to Default' },
      ],
    },
    {
      name: 'amount',
      label: 'Amount',
      kind: 'number',
      bound: 'value',
      default: 0,
      min: -FORM_TWEEN_LIMITS.overshoot,
      max: FORM_TWEEN_LIMITS.overshoot,
      softMin: -FORM_TWEEN_LIMITS.limit,
      softMax: FORM_TWEEN_LIMITS.limit,
      step: 1,
      primary: true,
    },
    {
      name: 'target',
      label: 'Apply To',
      kind: 'enum',
      bound: 'value',
      default: 'frame',
      options: [
        { value: 'frame', label: 'Current Frame' },
        { value: 'keys', label: 'Selected Keys' },
      ],
    },
    { name: 'breakdown', label: 'Breakdown', kind: 'bool', bound: 'value', default: true },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'key.tween'>;

export const INSERT_TIME_FORM = {
  id: 'time.insertTime',
  params: [
    {
      name: 'frames',
      label: 'Frames',
      kind: 'int',
      time: 'frames',
      bound: 'value',
      default: 1,
      min: -100_000,
      max: 100_000,
      softMin: -30,
      softMax: 30,
      primary: true,
    },
    { name: 'target', label: 'Controls', kind: 'enum', bound: 'value', default: 'selected', options: TIME_TARGETS },
    { name: 'removeKeys', label: 'Remove Keys', kind: 'bool', bound: 'value', default: false },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'time.insertTime'>;

export const DELETE_TIME_FORM = {
  id: 'time.deleteTime',
  params: [
    { name: 'target', label: 'Controls', kind: 'enum', bound: 'value', default: 'selected', options: TIME_TARGETS },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'time.deleteTime'>;

// ---------- poses, clips and IK/FK ----------

export const MIRROR_ANIMATION_FORM = {
  id: 'pose.mirrorAnimation',
  params: [
    { name: 'mode', label: 'Mirror', kind: 'enum', bound: 'value', default: 'flip', options: MIRROR_MODES },
    {
      name: 'offset',
      label: 'Offset',
      kind: 'enum',
      bound: 'value',
      default: 'none',
      options: [
        { value: 'none', label: 'None' },
        { value: 'halfCycle', label: 'Half Cycle' },
      ],
    },
  ],
  fromSession: ['target'],
} satisfies FormDef<'pose.mirrorAnimation'>;

export const NEW_CLIP_FORM = {
  id: 'clip.new',
  params: [
    {
      name: 'name',
      label: 'Name',
      kind: 'data',
      bound: 'value',
      default: null,
      nullable: true,
      schema: { type: 'string' },
      description: 'Empty: the next free name',
    },
    {
      name: 'range.start',
      label: 'Start Frame',
      kind: 'int',
      time: 'frames',
      bound: 'value',
      default: FORM_CLIP_RANGE.start,
      group: 'Range',
    },
    {
      name: 'range.end',
      label: 'End Frame',
      kind: 'int',
      time: 'frames',
      bound: 'value',
      default: FORM_CLIP_RANGE.end,
      softMin: 1,
      softMax: 600,
      primary: true,
      group: 'Range',
    },
    { name: 'loop', label: 'Loop', kind: 'bool', bound: 'value', default: false },
  ],
  fromSession: ['target'],
} satisfies FormDef<'clip.new'>;

const IK_FK_SIDES = [
  { value: 'ik', label: 'IK' },
  { value: 'fk', label: 'FK' },
] as const;

export const IK_FK_SWITCH_FORM = {
  id: 'rig.ikFk.switch',
  params: [
    { name: 'to', label: 'Switch To', kind: 'enum', bound: 'value', default: 'ik', options: IK_FK_SIDES },
    { name: 'match', label: 'Match Pose', kind: 'bool', bound: 'value', default: true },
    {
      name: 'key',
      label: 'Key Mode',
      kind: 'enum',
      bound: 'value',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'none', label: 'None' },
        { value: 'key', label: 'Key' },
        { value: 'seamless', label: 'Seamless' },
      ],
    },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'rig.ikFk.switch'>;

export const MATCH_RANGE_FORM = {
  id: 'rig.ikFk.matchRange',
  params: [
    { name: 'side', label: 'Match', kind: 'enum', bound: 'value', default: 'ik', options: IK_FK_SIDES },
    {
      name: 'step',
      label: 'Step',
      kind: 'enum',
      bound: 'value',
      default: null,
      nullable: true,
      description: 'Auto: every key for IK, every frame for FK',
      options: [
        { value: 'keys', label: 'Each Key' },
        { value: 'frames', label: 'Every Frame' },
      ],
    },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'rig.ikFk.matchRange'>;

export const USE_CLIP_FORM = {
  id: 'library.useClip',
  params: [
    {
      name: 'params.speed',
      label: 'Speed',
      kind: 'number',
      bound: 'value',
      default: IDENTITY_CLIP_PARAMS.speed,
      min: 0.25,
      max: 3,
      step: 0.05,
      primary: true,
    },
    { name: 'params.inPlace', label: 'In Place', kind: 'bool', bound: 'value', default: IDENTITY_CLIP_PARAMS.inPlace },
    { name: 'params.mirror', label: 'Mirror', kind: 'bool', bound: 'value', default: IDENTITY_CLIP_PARAMS.mirror },
    {
      name: 'params.armSpace',
      label: 'Arm Space (°)',
      kind: 'number',
      bound: 'value',
      default: IDENTITY_CLIP_PARAMS.armSpace,
      min: -10,
      max: 30,
      step: 1,
    },
  ],
  fromSession: ['target'],
  base: { params: IDENTITY_CLIP_PARAMS },
} satisfies FormDef<'library.useClip'>;

// ---------- the UI wrappers (§20.3 item 7) ----------

export const HOLD_FORM = {
  id: 'pose.hold',
  params: [],
  fromSession: ['time', 'target'],
} satisfies FormDef<'pose.hold'>;

export const PASTE_AT_FORM = {
  id: 'pose.pasteAt',
  params: [{ name: 'mirrored', label: 'Mirrored', kind: 'bool', bound: 'value', default: false }],
  fromSession: ['time', 'target'],
} satisfies FormDef<'pose.pasteAt'>;

export const PLACE_GOAL_FORM = {
  id: 'pose.placeGoal',
  params: [],
  fromSession: ['time', 'target'],
} satisfies FormDef<'pose.placeGoal'>;

export const LOOK_AT_FORM = {
  id: 'pose.lookAt',
  params: [
    { name: 'weight', label: 'Weight', kind: 'fraction', bound: 'value', default: 1, primary: true },
    { name: 'keepTwist', label: 'Keep Twist', kind: 'bool', bound: 'value', default: true },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'pose.lookAt'>;

export const REACH_FORM = {
  id: 'pose.reach',
  params: [],
  fromSession: ['time', 'target'],
} satisfies FormDef<'pose.reach'>;

export const LOOP_FORM = {
  id: 'clip.loop',
  params: [
    {
      name: 'method',
      label: 'Method',
      kind: 'enum',
      bound: 'value',
      default: 'matchEnds',
      primary: true,
      options: [
        { value: 'matchEnds', label: 'Match Ends' },
        { value: 'blend', label: 'Blend' },
        { value: 'cycleOnly', label: 'Cycle Only' },
      ],
    },
    {
      name: 'rootTravel',
      label: 'Root Travel',
      kind: 'enum',
      bound: 'value',
      default: 'cycleOffset',
      options: [
        { value: 'cycleOffset', label: 'Keep (Cycle with offset)' },
        { value: 'inPlace', label: 'In Place' },
        { value: 'keep', label: 'Leave Alone' },
      ],
    },
    {
      name: 'blendFrames',
      label: 'Blend Frames',
      kind: 'int',
      time: 'frames',
      bound: 'value',
      default: FORM_BLEND_FRAMES,
      min: 1,
      softMax: 30,
    },
  ],
  fromSession: ['target'],
} satisfies FormDef<'clip.loop'>;

const SCALE_PIVOTS = [
  { value: 'rest', label: 'Rest Pose' },
  { value: 'mean', label: 'Mean' },
  { value: 'rangeStart', label: 'Range Start' },
] as const;

export const SCALE_VALUES_FORM = {
  id: 'key.scaleValues',
  params: [
    {
      name: 'factor',
      label: 'Factor',
      kind: 'number',
      bound: 'value',
      default: 1.25,
      min: 0.01,
      max: 100,
      softMin: 0,
      softMax: 3,
      step: 0.05,
      primary: true,
    },
    { name: 'pivot', label: 'Pivot', kind: 'enum', bound: 'value', default: 'rest', options: SCALE_PIVOTS },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'key.scaleValues'>;

export const OFFSET_VALUES_FORM = {
  id: 'key.offsetValues',
  params: [
    { name: 'rotate', label: 'Rotate', kind: 'angle', bound: 'value', default: 0, step: DEG, primary: true },
    { name: 'translate', label: 'Translate', kind: 'distance', bound: 'value', default: 0, step: 0.01 },
    { name: 'scale', label: 'Scale', kind: 'number', bound: 'value', default: 0, step: 0.05 },
    { name: 'attr', label: 'Attributes', kind: 'number', bound: 'value', default: 0, step: 0.1 },
  ],
  fromSession: ['time', 'target'],
} satisfies FormDef<'key.offsetValues'>;

export const OFFSET_IN_LOOP_FORM = {
  id: 'key.offsetInLoop',
  params: [
    {
      name: 'offset',
      label: 'Offset (frames)',
      kind: 'int',
      time: 'frames',
      bound: 'value',
      default: 1,
      min: -100_000,
      max: 100_000,
      softMin: -30,
      softMax: 30,
      primary: true,
    },
  ],
  fromSession: ['target'],
} satisfies FormDef<'key.offsetInLoop'>;

export const REPLACE_IMAGE_FORM = {
  id: 'imagePlane.replace',
  params: [],
  fromSession: ['target'],
} satisfies FormDef<'imagePlane.replace'>;
