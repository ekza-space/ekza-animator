// The verb table (STUDIO-TOUCH-SPEC §6.1, §6.2; T6b, curated further by the stage packages): the first layer of every
// noun — up to six petals in slot order, plus ⋯ More. Petals say what they do in plain words (§3 P8); the Pro name and
// hotkey are one layer down (More, search). Slots never move (§6.1): a petal may change its verb in place — `variants`
// (⟳ Again after a repeatable run, Paste after a copy) — but never its slot. Data only (≈ 4 kB): the Halo (T6a) renders
// it, `derive.ts` polls it, and the parity check resolves every `{petal: noun}` surface against it (§20.5 test 7).
import type { OperatorId } from '@ekza-studio/editor-core';
import { NOUN_KINDS, type NounKind, type SheetId, type Stage } from '../manifest/types';

export interface PetalChoice {
  readonly plain: string;
  readonly op: OperatorId;
  readonly args?: unknown;
}

export interface PetalDef {
  /** Stable slot id within the noun ("pull", "key", "mirror"). */
  readonly id: string;
  readonly plain: string;
  /** The operator the petal runs; absent for a petal that only navigates (`go`). */
  readonly op?: OperatorId;
  readonly args?: unknown;
  /** Only in these stages (the empty space and the character have one row per stage). */
  readonly stages?: readonly Stage[];
  /** A ▾ petal: its choices (the first is the default a tap runs). */
  readonly menu?: readonly PetalChoice[];
  /** A navigation petal: switch the stage or open a sheet. */
  readonly go?: { readonly stage?: Stage; readonly sheet?: SheetId };
  /** Verb → target (§6.4): the petal waits for a second tap on the target. */
  readonly target?: true;
  /** A lucide icon name (the Halo package maps it; operators' own `icon` stays untouched, §6.1). */
  readonly icon?: string;
}

/** A petal that takes another's slot in place (§6.1): `when` names the session condition the Halo checks. */
export interface PetalVariant extends PetalDef {
  readonly replaces: string;
  readonly when: 'repeatable' | 'poseCopied' | 'keysCopied' | 'feetPinned' | 'bound' | 'editableMesh';
}

const choice = (plain: string, op: OperatorId, args?: unknown): PetalChoice =>
  args === undefined ? { plain, op } : { plain, op, args };

export const VERB_TABLE: Readonly<Record<NounKind, readonly PetalDef[]>> = {
  empty: [
    {
      id: 'newShape',
      plain: 'New shape',
      op: 'mesh.create.cube',
      stages: ['make'],
      icon: 'box',
      menu: [
        choice('Cube', 'mesh.create.cube'),
        choice('Sphere', 'mesh.create.sphere'),
        choice('Cylinder', 'mesh.create.cylinder'),
        choice('Cone', 'mesh.create.cone'),
        choice('Plane', 'mesh.create.plane'),
        choice('Ring', 'mesh.create.torus'),
      ],
    },
    {
      id: 'template',
      plain: 'Template',
      op: 'mesh.create.template',
      args: { template: 'humanoid' },
      stages: ['make'],
      icon: 'person-standing',
      menu: [
        choice('Character', 'mesh.create.template', { template: 'humanoid' }),
        choice('Character body', 'mesh.create.template', { template: 'humanoidBody' }),
        choice('Prop', 'mesh.create.template', { template: 'prop' }),
        choice('Hand-held prop', 'mesh.create.template', { template: 'handheld' }),
      ],
    },
    {
      id: 'reference',
      plain: 'Reference',
      op: 'imagePlane.import',
      stages: ['make'],
      icon: 'image',
      menu: [
        choice('Front', 'imagePlane.import', { camera: 'front' }),
        choice('Side', 'imagePlane.import', { camera: 'side' }),
        choice('Top', 'imagePlane.import', { camera: 'top' }),
      ],
    },
    { id: 'paste', plain: 'Paste', op: 'edit.paste', stages: ['make'], icon: 'clipboard' },
    { id: 'showAll', plain: 'Show all', op: 'view.showAll', stages: ['make'], icon: 'eye' },
    { id: 'palette', plain: 'Palette', op: 'palette.create', stages: ['paint'], icon: 'palette' },
    { id: 'fillPart', plain: 'Fill part', op: 'mesh.paint.fillShell', stages: ['paint'], icon: 'paint-bucket' },
    { id: 'rigIt', plain: 'Rig it for me', op: 'skel.quickRig.start', stages: ['rig'], icon: 'wand' },
    {
      id: 'addSkeleton',
      plain: 'Add skeleton',
      op: 'skel.template.create',
      stages: ['rig'],
      icon: 'bone',
      menu: [
        choice('Simple (17 bones)', 'skel.template.create', { preset: 'lite17' }),
        choice('Body (21 bones)', 'skel.template.create', { preset: 'core21' }),
        choice('With thumbs (33 bones)', 'skel.template.create', { preset: 'standard33' }),
        choice('All fingers (52 bones)', 'skel.template.create', { preset: 'full52' }),
      ],
    },
    { id: 'checks', plain: 'Checks', go: { sheet: 'health' }, stages: ['rig'], icon: 'stethoscope' },
    { id: 'allJoints', plain: 'All joints', op: 'select.joints', args: { all: true }, stages: ['rig'], icon: 'bone' },
    { id: 'bind', plain: 'Bind skin', op: 'skin.bind', stages: ['rig'], icon: 'link' },
    { id: 'newAnimation', plain: '+ New animation', op: 'clip.new', stages: ['animate'], icon: 'plus' },
    { id: 'library', plain: 'Library', op: 'library.open', stages: ['animate'], icon: 'library' },
    {
      id: 'keyAll',
      plain: 'Key all',
      op: 'key.set',
      args: { channels: 'all', target: 'character' },
      stages: ['animate'],
      icon: 'diamond',
    },
    { id: 'allControls', plain: 'All controls', op: 'select.all', stages: ['animate'], icon: 'scan' },
    { id: 'resetPose', plain: 'Reset pose', op: 'pose.resetToRest', stages: ['animate'], icon: 'rotate-ccw' },
  ],
  mesh: [
    {
      id: 'editShape',
      plain: 'Edit shape',
      op: 'select.mode',
      args: { mode: 'face' },
      stages: ['make'],
      icon: 'square-dashed',
    },
    { id: 'duplicate', plain: 'Duplicate', op: 'scene.duplicate', stages: ['make'], icon: 'copy' },
    { id: 'mirror', plain: 'Mirror', op: 'mesh.mirror', stages: ['make'], icon: 'flip-horizontal' },
    { id: 'paint', plain: 'Paint', go: { stage: 'paint' }, stages: ['make'], icon: 'brush' },
    { id: 'rigIt', plain: 'Rig it', go: { stage: 'rig' }, stages: ['make'], icon: 'bone' },
    { id: 'makeCharacter', plain: 'Make a character', op: 'char.fromModel', stages: ['rig'], icon: 'person-standing' },
    { id: 'checks', plain: 'Checks', go: { sheet: 'health' }, stages: ['rig'], icon: 'stethoscope' },
  ],
  faces: [
    { id: 'pull', plain: 'Pull', op: 'mesh.extrude', icon: 'arrow-up-from-square' },
    { id: 'inset', plain: 'Inset', op: 'mesh.inset', icon: 'square' },
    { id: 'bevel', plain: 'Bevel', op: 'mesh.bevel', icon: 'square-round-corner' },
    { id: 'colour', plain: 'Colour', op: 'mesh.paint', icon: 'paintbrush' },
    { id: 'delete', plain: 'Delete', op: 'mesh.delete', icon: 'trash' },
  ],
  edges: [
    { id: 'loopCut', plain: 'Loop cut', op: 'mesh.insertLoop', icon: 'scissors' },
    { id: 'bevel', plain: 'Bevel', op: 'mesh.bevel', icon: 'square-round-corner' },
    {
      id: 'merge',
      plain: 'Merge',
      op: 'mesh.merge',
      icon: 'merge',
      menu: [
        choice('Merge', 'mesh.merge'),
        choice('Merge to centre', 'mesh.mergeToCenter'),
        choice('Merge by distance', 'mesh.mergeByDistance'),
      ],
    },
    { id: 'slide', plain: 'Slide', op: 'mesh.slide', icon: 'move-horizontal' },
    { id: 'bridge', plain: 'Bridge', op: 'mesh.bridge', icon: 'spline', target: true },
  ],
  vertices: [
    {
      id: 'merge',
      plain: 'Merge',
      op: 'mesh.merge',
      icon: 'merge',
      menu: [
        choice('Merge', 'mesh.merge'),
        choice('Merge to centre', 'mesh.mergeToCenter'),
        choice('Merge by distance', 'mesh.mergeByDistance'),
      ],
    },
    { id: 'weld', plain: 'Weld to…', op: 'mesh.targetWeld', icon: 'crosshair', target: true },
    { id: 'slide', plain: 'Slide', op: 'mesh.slide', icon: 'move-horizontal' },
    { id: 'connect', plain: 'Connect', op: 'mesh.connect', icon: 'spline' },
    { id: 'delete', plain: 'Delete', op: 'mesh.delete', icon: 'trash' },
  ],
  imagePlane: [
    { id: 'opacity', plain: 'Opacity', op: 'imagePlane.set', icon: 'blend' },
    { id: 'size', plain: 'Size', op: 'imagePlane.set', icon: 'scaling' },
    { id: 'lock', plain: 'Lock', op: 'imagePlane.set', icon: 'lock' },
    { id: 'hide', plain: 'Hide', op: 'imagePlane.set', icon: 'eye-off' },
    { id: 'delete', plain: 'Delete', op: 'imagePlane.delete', icon: 'trash' },
  ],
  character: [
    { id: 'copyPose', plain: 'Copy pose', op: 'pose.copy', stages: ['animate'], icon: 'copy' },
    {
      id: 'mirror',
      plain: 'Mirror',
      op: 'pose.mirror',
      args: { mode: 'flip' },
      stages: ['animate'],
      icon: 'flip-horizontal',
      menu: [
        choice('Flip', 'pose.mirror', { mode: 'flip' }),
        choice('Left to right', 'pose.mirror', { mode: 'leftToRight' }),
        choice('Right to left', 'pose.mirror', { mode: 'rightToLeft' }),
      ],
    },
    { id: 'reset', plain: 'Reset to rest', op: 'pose.resetToRest', stages: ['animate'], icon: 'rotate-ccw' },
    {
      id: 'keyAll',
      plain: 'Key all',
      op: 'key.set',
      args: { channels: 'all', target: 'character' },
      stages: ['animate'],
      icon: 'diamond',
    },
    { id: 'checks', plain: 'Checks', go: { sheet: 'health' }, stages: ['rig'], icon: 'stethoscope' },
    { id: 'bind', plain: 'Bind skin', op: 'skin.bind', stages: ['rig'], icon: 'link' },
    { id: 'makeCharacter', plain: 'Make a character', op: 'char.fromModel', stages: ['rig'], icon: 'person-standing' },
    { id: 'about', plain: 'About this character', go: { sheet: 'about' }, stages: ['rig'], icon: 'id-card' },
  ],
  control: [
    { id: 'key', plain: 'Key ◆', op: 'key.set', icon: 'diamond' },
    {
      id: 'mirror',
      plain: 'Mirror',
      op: 'pose.mirror',
      args: { mode: 'flip' },
      icon: 'flip-horizontal',
      menu: [
        choice('Flip', 'pose.mirror', { mode: 'flip' }),
        choice('Left to right', 'pose.mirror', { mode: 'leftToRight' }),
        choice('Right to left', 'pose.mirror', { mode: 'rightToLeft' }),
      ],
    },
    { id: 'reset', plain: 'Reset', op: 'pose.resetToRest', icon: 'rotate-ccw' },
    { id: 'copyPose', plain: 'Copy pose', op: 'pose.copy', icon: 'copy' },
    { id: 'leads', plain: 'Hand leads', op: 'rig.ikFk.switch', icon: 'hand' },
  ],
  foot: [
    { id: 'key', plain: 'Key ◆', op: 'key.set', icon: 'diamond' },
    { id: 'plant', plain: 'Plant', op: 'pose.plantFeet', icon: 'footprints' },
    { id: 'pin', plain: 'Pin', op: 'pose.pinFeet', icon: 'pin' },
    { id: 'reset', plain: 'Reset', op: 'pose.resetToRest', icon: 'rotate-ccw' },
    { id: 'leads', plain: 'Foot leads', op: 'rig.ikFk.switch', icon: 'footprints' },
  ],
  joint: [
    { id: 'turn', plain: 'Turn', op: 'view.tool', args: { panel: 'viewport', tool: 'rotate' }, icon: 'rotate-cw' },
    { id: 'orient', plain: 'Orient', op: 'skel.joint.orient', icon: 'compass' },
    { id: 'mirror', plain: 'Mirror', op: 'skel.joint.mirror', icon: 'flip-horizontal' },
    {
      id: 'paintWeights',
      plain: 'Paint its weights',
      op: 'view.tool',
      args: { panel: 'viewport', tool: 'paintSkinWeights' },
      icon: 'brush',
    },
    { id: 'rename', plain: 'Rename', op: 'skel.joint.rename', icon: 'pencil' },
  ],
  skinSpot: [
    { id: 'whoOwns', plain: 'Who owns this?', op: 'skin.influence.pickDominant', icon: 'search' },
    { id: 'paint', plain: 'Paint', op: 'skin.influence.setActive', icon: 'brush' },
    { id: 'smooth', plain: 'Smooth here', op: 'skin.weights.smooth', icon: 'waves' },
  ],
  keyDot: [
    {
      id: 'ease',
      plain: 'Ease',
      op: 'graph.tangent.set',
      args: { type: 'auto' },
      icon: 'spline',
      menu: [
        choice('Smooth', 'graph.tangent.set', { type: 'auto' }),
        choice('Linear', 'graph.tangent.set', { type: 'linear' }),
        choice('Flat', 'graph.tangent.set', { type: 'flat' }),
        choice('Step', 'graph.tangent.set', { type: 'step' }),
      ],
    },
    { id: 'inBetween', plain: 'In-between', op: 'key.convert', args: { to: 'breakdown' }, icon: 'arrow-left-right' },
    { id: 'copy', plain: 'Copy', op: 'graph.keys.copy', icon: 'copy' },
    { id: 'delete', plain: 'Delete', op: 'graph.keys.delete', icon: 'trash' },
    { id: 'allKeysHere', plain: 'All keys here', op: 'select.keys', icon: 'columns' },
  ],
  band: [
    { id: 'move', plain: 'Move', op: 'graph.keys.move', icon: 'move-horizontal' },
    { id: 'stretch', plain: 'Stretch', op: 'graph.keys.scale', icon: 'stretch-horizontal' },
    { id: 'copy', plain: 'Copy', op: 'graph.keys.copy', icon: 'copy' },
    { id: 'delete', plain: 'Delete', op: 'graph.keys.delete', icon: 'trash' },
    { id: 'holdPose', plain: 'Hold pose', op: 'pose.hold', icon: 'pause' },
  ],
  playhead: [
    {
      id: 'paste',
      plain: 'Paste keys',
      op: 'graph.keys.paste',
      icon: 'clipboard',
      menu: [
        choice('Merge', 'graph.keys.paste', { mode: 'merge' }),
        choice('Replace', 'graph.keys.paste', { mode: 'replace' }),
        choice('Insert', 'graph.keys.paste', { mode: 'insert' }),
      ],
    },
    { id: 'insertFrame', plain: 'Insert frame', op: 'time.insertTime', args: { frames: 1 }, icon: 'plus' },
    {
      id: 'removeFrame',
      plain: 'Remove frame',
      op: 'time.insertTime',
      args: { frames: -1, removeKeys: true },
      icon: 'minus',
    },
    { id: 'deleteTime', plain: 'Delete time…', op: 'time.deleteTime', icon: 'scissors' },
    { id: 'setRange', plain: 'Set range', op: 'time.setPlaybackRange', icon: 'brackets' },
  ],
  curve: [
    {
      id: 'easeAll',
      plain: 'Ease all',
      op: 'graph.tangent.set',
      args: { type: 'auto' },
      icon: 'spline',
      menu: [
        choice('Smooth', 'graph.tangent.set', { type: 'auto' }),
        choice('Linear', 'graph.tangent.set', { type: 'linear' }),
        choice('Flat', 'graph.tangent.set', { type: 'flat' }),
        choice('Step', 'graph.tangent.set', { type: 'step' }),
      ],
    },
    { id: 'fewerKeys', plain: 'Fewer keys', op: 'graph.curves.simplify', icon: 'minimize' },
    { id: 'fixFlips', plain: 'Fix flips', op: 'graph.eulerFilter', icon: 'refresh-cw' },
    {
      id: 'cycle',
      plain: 'Cycle',
      op: 'graph.infinity.set',
      args: { pre: 'cycle', post: 'cycle' },
      icon: 'repeat',
      menu: [
        choice('Repeat', 'graph.infinity.set', { pre: 'cycle', post: 'cycle' }),
        choice('Repeat with offset', 'graph.infinity.set', { pre: 'cycleOffset', post: 'cycleOffset' }),
        choice('Ping-pong', 'graph.infinity.set', { pre: 'oscillate', post: 'oscillate' }),
        choice('Hold', 'graph.infinity.set', { pre: 'constant', post: 'constant' }),
      ],
    },
    { id: 'insertKey', plain: 'Insert key', op: 'graph.key.insert', icon: 'diamond-plus' },
  ],
  channel: [
    { id: 'key', plain: 'Key this channel', op: 'key.set', args: { channels: 'selected' }, icon: 'diamond' },
    { id: 'lock', plain: 'Lock', op: 'channel.toggleLock', icon: 'lock' },
    { id: 'reset', plain: 'Reset to default', op: 'channel.setValues', icon: 'rotate-ccw' },
    { id: 'onlyThis', plain: 'Show only this', op: 'select.channels', icon: 'filter' },
  ],
  clip: [
    { id: 'play', plain: 'Play', op: 'time.togglePlay', icon: 'play' },
    { id: 'loop', plain: 'Loop it', op: 'clip.loop', icon: 'repeat' },
    { id: 'rename', plain: 'Rename', op: 'clip.rename', icon: 'pencil' },
    { id: 'duplicate', plain: 'Duplicate', op: 'clip.duplicate', icon: 'copy' },
    { id: 'settings', plain: 'Settings', op: 'clip.setSettings', icon: 'sliders-horizontal' },
  ],
  libraryCard: [
    { id: 'preview', plain: 'Preview', op: 'library.preview', icon: 'play' },
    { id: 'add', plain: 'Add', op: 'library.useClip', icon: 'plus' },
  ],
  swatch: [
    { id: 'edit', plain: 'Edit colour', op: 'palette.setSwatch', icon: 'pipette' },
    { id: 'finish', plain: 'Finish', op: 'palette.setSwatch', icon: 'sparkles' },
    { id: 'selectFaces', plain: 'Select faces', op: 'select.mesh.bySwatch', icon: 'scan' },
    { id: 'replace', plain: 'Replace with active', op: 'mesh.paint.remap', icon: 'replace' },
    { id: 'rename', plain: 'Rename', op: 'palette.setSwatch', icon: 'pencil' },
  ],
  healthDot: [
    { id: 'fix', plain: 'Fix', op: 'autorig.fix', icon: 'wrench' },
    { id: 'showMe', plain: 'Show me', op: 'select.mesh.matching', icon: 'scan-eye' },
    { id: 'why', plain: 'Why?', go: { sheet: 'health' }, icon: 'circle-help' },
  ],
  historyStep: [
    { id: 'undoTo', plain: 'Undo to here', op: 'edit.undo', icon: 'undo' },
    { id: 'revert', plain: 'Revert this', op: 'edit.revertSteps', icon: 'history' },
    { id: 'adjust', plain: 'Adjust', op: 'edit.adjustLast', icon: 'sliders-horizontal' },
    { id: 'show', plain: 'Show', op: 'agent.show', icon: 'eye' },
  ],
  camera: [
    { id: 'lookThrough', plain: 'Look through', op: 'view.lookThrough', icon: 'camera' },
    { id: 'copyView', plain: 'Copy view here', op: 'view.copyViewToShot', icon: 'copy' },
    { id: 'lock', plain: 'Lock', op: 'view.toggleCameraLock', icon: 'lock' },
    { id: 'lens', plain: 'Lens', op: 'view.camera.setSettings', icon: 'aperture' },
  ],
  manipulator: [
    { id: 'space', plain: 'Space', op: 'view.setManipSpace', icon: 'globe' },
    { id: 'size', plain: 'Size', op: 'view.manipulatorSize', icon: 'scaling' },
    { id: 'pivot', plain: 'Pivot', op: 'model.pivot.editToggle', icon: 'locate' },
  ],
  rigDot: [
    { id: 'reGuess', plain: 'Re-guess', op: 'skel.quickRig.guess', icon: 'wand' },
    { id: 'mirror', plain: 'Mirror to other side', op: 'skel.quickRig.setMarker', icon: 'flip-horizontal' },
    { id: 'remove', plain: 'Remove', op: 'skel.quickRig.clear', icon: 'trash' },
  ],
};

/** Petals that take another's slot in place (§6.1); they never add a slot. */
export const PETAL_VARIANTS: Readonly<Partial<Record<NounKind, readonly PetalVariant[]>>> = {
  faces: [
    { id: 'again', plain: 'Again', op: 'edit.repeatLast', replaces: 'delete', when: 'repeatable', icon: 'repeat' },
  ],
  control: [
    {
      id: 'paste',
      plain: 'Paste',
      op: 'pose.paste',
      replaces: 'copyPose',
      when: 'poseCopied',
      icon: 'clipboard',
      menu: [
        choice('Paste', 'pose.paste'),
        choice('Paste mirrored', 'pose.paste', { mirrored: true }),
        choice('Copy again', 'pose.copy'),
      ],
    },
  ],
  character: [
    { id: 'paste', plain: 'Paste', op: 'pose.paste', replaces: 'copyPose', when: 'poseCopied', icon: 'clipboard' },
  ],
  foot: [{ id: 'unpin', plain: 'Unpin', op: 'pose.unpinFeet', replaces: 'pin', when: 'feetPinned', icon: 'pin-off' }],
  keyDot: [
    {
      id: 'paste',
      plain: 'Paste',
      op: 'graph.keys.paste',
      replaces: 'copy',
      when: 'keysCopied',
      icon: 'clipboard',
      menu: [
        choice('Merge', 'graph.keys.paste', { mode: 'merge' }),
        choice('Replace', 'graph.keys.paste', { mode: 'replace' }),
        choice('Insert', 'graph.keys.paste', { mode: 'insert' }),
      ],
    },
  ],
  mesh: [
    {
      id: 'makeEditable',
      plain: 'Make editable',
      op: 'mesh.makeEditable',
      replaces: 'editShape',
      when: 'editableMesh',
      icon: 'pencil',
    },
  ],
};

/** At most six petals plus ⋯ More (§6.1). */
export const MAX_PETALS = 6;

/** The petals of a noun in a stage, in slot order (at most six). */
export function petalsFor(noun: NounKind, stage: Stage): readonly PetalDef[] {
  return VERB_TABLE[noun]
    .filter((petal) => petal.stages === undefined || petal.stages.includes(stage))
    .slice(0, MAX_PETALS);
}

function opsOf(petal: PetalDef): OperatorId[] {
  return [...(petal.op === undefined ? [] : [petal.op]), ...(petal.menu ?? []).map((c) => c.op)];
}

/** Every operator a noun's petals can run (petals, their ▾ choices and their in-place variants). */
export const PETAL_OPS: Readonly<Record<NounKind, ReadonlySet<string>>> = Object.fromEntries(
  NOUN_KINDS.map((noun) => [
    noun,
    new Set<string>([...VERB_TABLE[noun].flatMap(opsOf), ...(PETAL_VARIANTS[noun] ?? []).flatMap(opsOf)]),
  ]),
) as unknown as Record<NounKind, ReadonlySet<string>>;
