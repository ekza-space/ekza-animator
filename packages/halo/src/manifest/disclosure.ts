// The Disclosure Manifest (STUDIO-TOUCH-SPEC §15, §20.5, ST-29; T6b): every live operator id — Studio Pro's, Auto-Rig's,
// the host's, the viewport's and curve editor's UI contributions and the internal ones — mapped to where Ekza Studio's
// Simple layout shows it. Curated from the `§15` coverage map and the `§6.2` verb table over a browser census of every
// mount (`census.ts`, `apps/web/e2e/ha-parity.spec.ts`). The registry is never changed.
//
// Reading an entry: `on(depth, [surfaces…])` — depth 0 on screen, 1 one tap on the thing, 2 a second step (§15 depth
// codes); surfaces are Halo petals (`P`), ⋯ More rows (`M`), stage trays (`T`), sheet sections (`S`) and parts of the
// frame or a stage (`C`). Surfaces owned by a package that has not landed are pending (`types.ts`): such an entry counts
// in the `searchOnly` ratchet until its owner lands. `searchOnly` itself is for developer items only.
//
// A new operator needs an entry here (the PR checkbox "Ekza Studio path (manifest entry) added or not needed").
import type { OperatorId } from '@ekza-studio/editor-core';
import { DIALOG_SURFACES, type DialogSurface } from './dialogs';
import { PRO_REASONS } from './proOnly';
import type {
  ArgPredicate,
  ChromePart,
  Depth,
  Disclosure,
  ManifestEntry,
  NounKind,
  SheetId,
  Stage,
  SurfaceDisclosure,
  SurfaceRef,
} from './types';

// ---------- builders ----------

const P = (noun: NounKind): SurfaceRef => ({ petal: noun });
const M = (noun: NounKind, group: string): SurfaceRef => ({ more: noun, group });
const T = (stage: Stage): SurfaceRef => ({ tray: stage });
const S = (sheet: SheetId, section?: string): SurfaceRef => (section === undefined ? { sheet } : { sheet, section });
const C = (part: ChromePart): SurfaceRef => ({ chrome: part });

interface Extra {
  readonly stages?: readonly Stage[];
  readonly when?: ArgPredicate;
  readonly plain?: string;
  readonly handsOn?: true;
}

function on(depth: Depth, surfaces: readonly SurfaceRef[], extra: Extra = {}): SurfaceDisclosure {
  return { surfaces, depth, ...extra };
}

const ANIMATE: Extra = { stages: ['animate'] };
const MAKE: Extra = { stages: ['make'] };
const PAINT: Extra = { stages: ['paint'] };
const RIG: Extra = { stages: ['rig'] };
const HANDS: Extra = { handsOn: true };

/** The `ui.open` entries, one per Halo surface, from the dialog map (§6.7). */
function dialogEntries(): readonly Disclosure[] {
  const groups = new Map<string, { surface: DialogSurface; dialogs: string[] }>();
  for (const [dialog, surface] of Object.entries(DIALOG_SURFACES)) {
    if ('deferred' in surface) continue;
    const key = JSON.stringify(
      'confirm' in surface
        ? { confirm: true }
        : 'sheet' in surface
          ? { sheet: surface.sheet, s: surface.section }
          : surface,
    );
    const group = groups.get(key) ?? { surface, dialogs: [] };
    group.dialogs.push(dialog);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ surface, dialogs }): Disclosure => {
    const when = { dialog: dialogs };
    if ('proOnly' in surface) return { proOnly: 'PRO_CHROME', reason: surface.reason, when };
    if ('sheet' in surface) return on(2, [S(surface.sheet, surface.section)], { when });
    if ('confirm' in surface) return on(0, [C('confirmCard')], { when });
    if ('picker' in surface) {
      return surface.picker === 'reference'
        ? on(1, [M('empty', 'Reference')], { when, plain: 'Reference image…', ...MAKE })
        : on(1, [C('projectMenu')], { when });
    }
    if ('home' in surface) return on(1, [C('home'), C('projectMenu')], { when });
    return on(0, [C('home')], { when });
  });
}

/** Panels of Studio Pro (`PANEL` and the late ones) for the panel arguments of `view.toggleMaximize`. */
const PANEL_KINDS = [
  'viewport',
  'graph',
  'timeline',
  'outliner',
  'clips',
  'channels',
  'attributes',
  'dopeSheet',
  'toolkit',
  'palette',
  'meshCheck',
  'rigToolkit',
  'paintWeights',
  'componentEditor',
  'validation',
  'clipLibrary',
  'agent',
  'target',
  'quickRig',
  '*',
];

// ---------- the manifest ----------

export const DISCLOSURE: Readonly<Record<string, ManifestEntry>> = {
  // ===== file (§15.11, §15.12) =====
  'file.new': on(1, [C('projectMenu'), C('home')]),
  'file.open': on(1, [C('projectMenu'), C('home')]),
  'file.openProject': on(1, [C('projectMenu'), C('home')]),
  'file.importModel': on(1, [C('projectMenu'), C('home')]),
  'file.importAnimation': on(2, [S('library', 'fromFile'), C('projectMenu')], ANIMATE),
  'file.loadSample': on(1, [C('projectMenu'), C('home')]),
  'file.save': on(1, [C('projectMenu'), S('share', 'footer')]),
  'file.saveAs': on(1, [C('projectMenu')]),
  'file.saveJson': { searchOnly: 'A developer item: the debug JSON of the project (Share › Advanced, T11)' },
  'file.export': on(1, [S('share')]),
  'file.exportModel': on(2, [S('share', 'moreFormats'), M('mesh', 'Show')], MAKE),
  'file.exportCharacter': on(1, [S('share')]),
  'file.recover': on(1, [C('home'), C('projectMenu')]),
  'file.discardRecovery': on(2, [C('home'), C('projectMenu')]),
  'file.autosaveNow': on(2, [C('projectMenu')], { plain: 'Recovery point' }),
  'mesh.importStatic': on(1, [C('home'), C('projectMenu')]),

  // ===== edit and history (§15.12) =====
  'edit.undo': on(0, [C('undo'), P('historyStep')]),
  'edit.redo': on(1, [C('undo'), M('historyStep', 'History')]),
  'edit.copy': on(2, [M('mesh', 'Edit'), M('control', 'Edit'), M('keyDot', 'Edit')], { plain: 'Copy' }),
  'edit.paste': on(1, [P('empty'), M('control', 'Edit'), M('playhead', 'Edit')], { plain: 'Paste' }),
  'edit.delete': on(2, [M('mesh', 'Edit'), M('faces', 'Edit'), M('keyDot', 'Edit')], { plain: 'Delete' }),
  'edit.escape': on(0, [C('sessionBar'), C('canvas')]),
  'edit.adjustLast': on(0, [C('echoChips'), P('historyStep')]),
  'edit.repeatLast': on(1, [C('echoChips'), P('faces')]),
  'edit.revertSteps': on(1, [P('historyStep'), C('historyRibbon')]),
  'edit.restoreDocument': on(2, [M('historyStep', 'History'), S('ask', 'revertAll')]),
  'view.lastOpCard': on(0, [C('echoChips')], MAKE),
  'tool.last': on(1, [T('make')], { ...MAKE, plain: 'Last tool' }),

  // ===== select (§15.2) =====
  'select.controls': on(0, [C('canvas'), S('scene', 'objects')], ANIMATE),
  'select.all': on(1, [P('empty'), M('empty', 'Select')]),
  'select.none': on(0, [C('canvas'), M('empty', 'Select')]),
  'select.mirror': on(2, [C('breadcrumb'), M('control', 'Select')], { plain: 'Other side' }),
  'select.pickWalk': on(1, [C('breadcrumb')]),
  'select.keys': on(0, [C('thread'), P('keyDot')], ANIMATE),
  'select.channels': on(1, [S('numbers', 'channels'), P('channel')], ANIMATE),
  'select.curveKeys': on(1, [C('threadCurves'), M('curve', 'Select')], ANIMATE),
  'select.mode': on(1, [P('mesh'), T('make')], MAKE),
  'select.components': on(0, [C('canvas')], MAKE),
  'select.mesh.loop': on(1, [C('selectChip'), M('faces', 'Select'), M('edges', 'Select')], MAKE),
  'select.mesh.ring': on(1, [C('selectChip'), M('faces', 'Select'), M('edges', 'Select')], MAKE),
  'select.mesh.grow': on(1, [C('selectChip'), M('vertices', 'Select'), M('faces', 'Select')], MAKE),
  'select.mesh.shrink': on(1, [C('selectChip'), M('vertices', 'Select'), M('faces', 'Select')], MAKE),
  'select.mesh.border': on(1, [C('selectChip'), M('edges', 'Select')], MAKE),
  'select.mesh.shell': on(1, [C('selectChip'), M('faces', 'Select')], MAKE),
  'select.mesh.all': on(2, [M('empty', 'Select'), M('faces', 'Select')], MAKE),
  'select.mesh.invert': on(2, [M('empty', 'Select'), M('faces', 'Select')], MAKE),
  'select.mesh.none': on(0, [C('canvas'), M('faces', 'Select')], MAKE),
  'select.mesh.convert': on(2, [M('faces', 'Select'), M('edges', 'Select'), M('vertices', 'Select')], MAKE),
  'select.mesh.matching': on(1, [P('healthDot'), S('health', 'problems')], MAKE),
  'select.mesh.bySwatch': on(1, [P('swatch'), M('faces', 'Colour & surface')], { stages: ['make', 'paint'] }),
  'select.mesh.pickWalk': on(1, [C('breadcrumb')], MAKE),
  'select.objects': on(0, [C('canvas'), S('scene', 'objects')]),
  'select.joints': on(1, [P('empty'), C('canvas'), S('scene', 'objects')], RIG),
  'model.hilite': on(0, [C('canvas'), M('mesh', 'Select')], { ...MAKE, plain: 'Edit this shape' }),
  'view.selectionMask': on(2, [M('empty', 'Select'), S('view', 'selection')]),
  'model.selectionStyle.set': on(2, [M('empty', 'Selection options')], MAKE),
  'model.cameraBased.set': on(2, [M('empty', 'Selection options')], MAKE),
  'model.backfaces.toggle': on(2, [M('empty', 'Selection options')], MAKE),
  'model.constraint.set': on(2, [M('empty', 'Selection options')], MAKE),
  'model.softSelect.toggle': on(1, [T('make'), M('empty', 'Selection options')], MAKE),
  'model.softSelect.set': on(2, [T('make'), M('empty', 'Selection options')], MAKE),
  'model.symmetry.set': on(1, [T('make'), M('mesh', 'Clean up')], MAKE),

  // ===== keys, channels and pose (§15.7, §15.8) =====
  'key.set': on(1, [P('control'), P('foot'), P('channel'), P('empty'), P('character')], ANIMATE),
  'key.deleteAtFrame': on(2, [M('control', 'Pose'), M('channel', 'Channel')], ANIMATE),
  'key.toggleAutoKey': on(2, [S('settings', 'animation')], { ...ANIMATE, plain: 'Auto Key in Studio Pro' }),
  'key.setTarget': on(2, [M('control', 'Pose')], { ...ANIMATE, plain: 'What to key' }),
  'key.toggleRipple': on(1, [C('threadKeys')], { ...ANIMATE, plain: 'Push later keys' }),
  'key.tween': on(1, [C('thread'), M('keyDot', 'Key')], { ...ANIMATE, plain: 'Blend' }),
  'key.convert': on(1, [P('keyDot'), M('control', 'Pose')], { ...ANIMATE, plain: 'In-between' }),
  'key.write': {
    searchOnly:
      "The agents' explicit-target key writer; Ekza Studio keys through Key ◆ (key.set), channel rows and the Thread",
    stages: ['animate'],
  },
  'key.delete': {
    searchOnly: "The agents' explicit-target key eraser; Ekza Studio deletes keys on the key dot, band and playhead",
    stages: ['animate'],
  },
  'key.adjust': { wraps: 'key.scaleValues' },
  'key.retime': { wraps: 'key.offsetInLoop' },
  'key.scaleValues': on(2, [M('band', 'Values'), M('curve', 'Values')], ANIMATE),
  'key.offsetValues': on(2, [M('band', 'Values'), M('curve', 'Values')], ANIMATE),
  'key.offsetInLoop': on(2, [M('band', 'Values'), M('clip', 'Animation')], ANIMATE),
  'channel.setValues': on(0, [S('numbers', 'channels'), P('channel'), C('echoChips'), C('canvas')]),
  'channel.toggleLock': on(1, [P('channel'), S('numbers', 'channels')], ANIMATE),
  'pose.resetToRest': on(1, [P('control'), P('foot'), P('character'), P('empty')], ANIMATE),
  'pose.copy': on(1, [P('control'), P('character')], ANIMATE),
  'pose.paste': on(1, [P('control'), M('control', 'Pose')], ANIMATE),
  'pose.mirror': on(1, [P('control'), P('character')], ANIMATE),
  'pose.pinFeet': on(1, [P('foot'), M('character', 'Feet')], ANIMATE),
  'pose.unpinFeet': on(1, [P('foot'), M('character', 'Feet')], ANIMATE),
  'pose.plantFeet': on(1, [P('foot'), M('character', 'Feet')], ANIMATE),
  'pose.mirrorAnimation': on(2, [M('clip', 'Animation'), M('character', 'Animation')], {
    ...ANIMATE,
    plain: 'Mirror cycle',
  }),
  'pose.hold': on(1, [P('band'), M('control', 'Pose')], ANIMATE),
  'pose.pasteAt': on(2, [M('control', 'Pose'), C('targetMode')], ANIMATE),
  'pose.placeGoal': on(2, [M('control', 'Pose'), M('foot', 'Limb'), C('targetMode')], ANIMATE),
  'pose.lookAt': on(2, [M('control', 'Pose'), C('targetMode')], ANIMATE),
  'pose.reach': on(0, [C('canvas'), M('control', 'Pose')], ANIMATE),
  'pose.setAt': { wraps: 'pose.pasteAt' },
  'pose.goals': { wraps: 'pose.placeGoal' },
  'pose.transfer': { wraps: 'pose.hold' },

  // ===== time and the Thread (§10.3, §15.8) =====
  'time.setFrame': on(0, [C('thread'), M('playhead', 'Time')], ANIMATE),
  'time.step': [
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { delta: 1 }, plain: 'Next frame' }),
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { delta: -1 }, plain: 'Previous frame' }),
    on(1, [C('thread')], ANIMATE),
  ],
  'time.nextKey': on(1, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.prevKey': on(1, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.goToStart': on(1, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.goToEnd': on(1, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.togglePlay': on(0, [C('thread'), P('clip')], ANIMATE),
  'time.play': on(1, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.stop': on(0, [C('thread'), M('empty', 'Time')], ANIMATE),
  'time.setLoop': [
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { loop: 'loop' }, plain: 'Loop: repeat' }),
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { loop: 'once' }, plain: 'Loop: once' }),
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { loop: 'oscillate' }, plain: 'Loop: ping-pong' }),
  ],
  'time.setSpeed': [
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { speed: 'realtime' }, plain: 'Speed: realtime' }),
    on(1, [C('thread'), M('empty', 'Time')], {
      ...ANIMATE,
      when: { speed: 'every-frame' },
      plain: 'Speed: every frame',
    }),
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { speed: 'half' }, plain: 'Speed: half' }),
    on(1, [C('thread'), M('empty', 'Time')], { ...ANIMATE, when: { speed: 'double' }, plain: 'Speed: double' }),
  ],
  'time.setPlaybackRange': on(1, [P('playhead'), C('thread')], ANIMATE),
  'time.selectBand': on(0, [C('thread'), C('threadKeys')], ANIMATE),
  'time.insertTime': on(1, [P('playhead'), M('band', 'Time')], ANIMATE),
  'time.deleteTime': on(1, [P('playhead'), M('band', 'Time')], ANIMATE),

  // ===== Keys and Curves (§10.4, §10.5) =====
  'graph.tangent.set': on(1, [P('keyDot'), P('curve')], { ...ANIMATE, plain: 'Ease' }),
  'graph.tangent.break': on(2, [M('keyDot', 'Tangents')], ANIMATE),
  'graph.tangent.unify': on(2, [M('keyDot', 'Tangents')], ANIMATE),
  'graph.curve.setWeighted': on(2, [M('keyDot', 'Tangents'), M('curve', 'Curve')], ANIMATE),
  'graph.tangent.lockWeight': on(2, [M('keyDot', 'Tangents')], ANIMATE),
  'graph.infinity.set': on(1, [P('curve')], { ...ANIMATE, plain: 'Cycle' }),
  'graph.keys.setFields': on(2, [M('keyDot', 'Key'), C('threadCurves')], ANIMATE),
  'graph.keys.move': on(0, [P('band'), C('threadKeys'), C('threadCurves')], ANIMATE),
  'graph.keys.scale': on(1, [P('band'), C('threadKeys')], { ...ANIMATE, plain: 'Stretch' }),
  'graph.keys.delete': on(1, [P('keyDot'), P('band')], ANIMATE),
  'graph.key.insert': on(1, [P('curve')], ANIMATE),
  'graph.keys.keyCurves': on(2, [M('curve', 'Curve')], { ...ANIMATE, plain: 'Key curves here' }),
  'graph.keys.copy': on(1, [P('keyDot'), P('band')], ANIMATE),
  'graph.keys.copyTo': on(2, [M('band', 'Time')], ANIMATE),
  'graph.keys.paste': on(1, [P('keyDot'), P('playhead')], ANIMATE),
  'graph.eulerFilter': on(1, [P('curve')], { ...ANIMATE, plain: 'Fix flips' }),
  'graph.curves.simplify': on(1, [P('curve')], { ...ANIMATE, plain: 'Fewer keys' }),
  'graph.buffer.snapshot': on(2, [M('curve', 'Compare')], ANIMATE),
  'graph.buffer.swap': on(2, [M('curve', 'Compare')], ANIMATE),
  'graph.buffer.clear': on(2, [M('curve', 'Compare')], ANIMATE),
  'graph.view.setMode': on(2, [M('curve', 'View')], ANIMATE),
  'graph.frame': on(0, [C('threadCurves')], ANIMATE),
  'dopeSheet.frame': on(0, [C('threadKeys')], ANIMATE),

  // ===== animations and the library (§10.6, §15.9) =====
  'clip.new': on(0, [C('animationsRow'), P('empty')], ANIMATE),
  'clip.rename': on(1, [P('clip'), S('numbers', 'animation')], ANIMATE),
  'clip.duplicate': on(1, [P('clip')], ANIMATE),
  'clip.delete': on(2, [M('clip', 'Animation')], ANIMATE),
  'clip.setActive': on(0, [C('animationsRow'), M('clip', 'Animation')], ANIMATE),
  'clip.setSettings': on(1, [P('clip'), S('numbers', 'animation')], ANIMATE),
  'clip.loop': on(1, [P('clip')], { ...ANIMATE, plain: 'Loop it' }),
  'clip.makeLoop': { wraps: 'clip.loop' },
  'library.open': on(1, [P('empty'), C('animationsRow')], { stages: ['animate'] }),
  'library.preview': on(1, [P('libraryCard')], ANIMATE),
  'library.stop': on(1, [M('libraryCard', 'Preview')], ANIMATE),
  'library.useClip': on(1, [P('libraryCard')], ANIMATE),
  'autorig.clip.add': on(1, [S('library', 'starterSet'), C('statusCorner')], ANIMATE),
  'target.bind': on(1, [S('share', 'destination')]),
  'target.unbind': on(2, [S('share', 'destination')]),
  'target.update': on(2, [S('share', 'destination')]),
  'target.slot.assign': on(2, [M('clip', 'Animation')], ANIMATE),
  'target.slot.clear': on(2, [M('clip', 'Animation')], ANIMATE),
  'target.slot.alias': on(2, [M('clip', 'Animation')], ANIMATE),

  // ===== view (§15.1) =====
  'view.frame': on(0, [C('canvas'), C('puck')]),
  'view.layout': on(2, [S('view', 'panes')]),
  'view.toggleMaximize': [
    on(1, [C('canvas'), S('view', 'panes')], { when: { panel: null }, plain: 'Maximize pane' }),
    { proOnly: 'PRO_CHROME', reason: PRO_REASONS.panel, when: { panel: PANEL_KINDS } },
  ],
  'view.display.toggle': on(1, [S('view', 'show')]),
  'view.display.set': on(1, [S('view', 'show')]),
  'view.shading': on(1, [S('view', 'look')]),
  'view.lookThrough': on(0, [C('puck'), S('view', 'cameras'), P('camera')]),
  'view.copyViewToShot': on(1, [P('camera'), S('view', 'cameras')]),
  'view.toggleCameraLock': on(1, [P('camera'), S('view', 'cameras')]),
  'view.camera.setSettings': on(1, [P('camera'), S('numbers', 'camera')]),
  'view.hide': on(2, [M('mesh', 'Show'), M('faces', 'Show'), M('control', 'Show')]),
  'view.showAll': on(1, [P('empty'), S('scene', 'visibility')]),
  'view.isolate': on(2, [M('mesh', 'Show'), M('joint', 'Show')]),
  'view.toggleFullscreen': on(1, [C('projectMenu'), S('view', 'fullScreen')]),
  'view.manipulatorSize': on(1, [P('manipulator'), S('view', 'manipulator')]),
  'view.setManipSpace': on(1, [P('manipulator'), M('control', 'Rig')]),
  'view.setNavProfile': on(2, [S('settings', 'input')]),
  'view.tool': [
    on(0, [C('canvas'), T('make')], { when: { panel: 'viewport', tool: 'select' }, plain: 'Select' }),
    on(2, [M('mesh', 'Transform'), M('control', 'Show'), M('faces', 'Transform'), P('joint')], {
      when: { panel: 'viewport', tool: ['move', 'rotate', 'scale'] },
      plain: 'Move / Turn / Scale rings',
    }),
    on(1, [T('make'), M('edges', 'Cut')], {
      ...MAKE,
      ...HANDS,
      when: { panel: 'viewport', tool: ['multiCut', 'insertLoop', 'slide', 'extrude'] },
    }),
    on(1, [T('make'), M('vertices', 'Merge')], {
      ...MAKE,
      ...HANDS,
      when: { panel: 'viewport', tool: 'targetWeld' },
      plain: 'Weld to…',
    }),
    on(1, [T('paint')], { ...PAINT, ...HANDS, when: { panel: 'viewport', tool: 'paint' }, plain: 'Paint colour' }),
    on(1, [P('joint'), C('brushTray')], {
      ...RIG,
      ...HANDS,
      when: { panel: 'viewport', tool: 'paintSkinWeights' },
      plain: 'Paint its weights',
    }),
    on(1, [T('rig'), C('dotsSession')], {
      ...RIG,
      ...HANDS,
      when: { panel: 'viewport', tool: ['jointTool', 'insertJoint', 'quickRigMarker', 'socket', 'shapeCv', '*'] },
    }),
    on(1, [C('threadCurves')], { ...ANIMATE, when: { panel: 'graph' } }),
    on(1, [C('threadKeys')], { ...ANIMATE, when: { panel: 'dopeSheet' } }),
  ],
  'ui.commandPalette': { searchOnly: 'Opens search itself: Ekza Studio shows the search pill on screen (§8)' },
  'ui.open': dialogEntries(),
  'ui.close': { plumbing: 'ui.close' },
  'ui.markingMenu': { plumbing: 'ui.markingMenu' },
  'view.cameraRadial': { plumbing: 'view.cameraRadial' },
  'prefs.set': on(2, [S('settings')]),

  // ===== workspaces, layouts and the Pro hand-offs (§15.15) =====
  'workspace.set': on(0, [C('path')]),
  'workspace.showPanel': [
    on(2, [S('health', 'problems')], { when: { panel: ['meshCheck', 'validation'] }, plain: 'Health' }),
    on(2, [S('scene')], { when: { panel: 'outliner' }, plain: 'Scene' }),
    on(2, [S('numbers')], { when: { panel: ['channels', 'attributes'] }, plain: 'Numbers' }),
    on(2, [S('library')], { when: { panel: 'clipLibrary' }, plain: 'Library' }),
    on(1, [C('animationsRow')], { when: { panel: 'clips' }, plain: 'Animations' }),
    on(1, [C('threadCurves')], { when: { panel: 'graph' }, plain: 'Curves' }),
    on(1, [C('threadKeys')], { when: { panel: 'dopeSheet' }, plain: 'Keys' }),
    on(0, [C('thread')], { when: { panel: 'timeline' }, plain: 'Timeline' }),
    on(1, [C('brushTray')], { when: { panel: 'paintWeights' }, plain: 'Weight brush' }),
    on(1, [T('make')], { when: { panel: 'toolkit' }, plain: 'Make tools' }),
    on(1, [T('rig')], { when: { panel: 'rigToolkit' }, plain: 'Rig tools' }),
    on(1, [T('paint'), S('palette')], { when: { panel: 'palette' }, plain: 'Colours' }),
    on(1, [S('ask')], { when: { panel: 'agent' }, plain: 'Ask' }),
    on(1, [S('share', 'destination')], { when: { panel: 'target' }, plain: 'Game target' }),
    on(1, [C('rigCard')], { when: { panel: 'quickRig' }, plain: 'Rig it for me' }),
    on(0, [C('canvas')], { when: { panel: 'viewport' }, plain: 'Canvas' }),
    { proOnly: 'PRO_CHROME', reason: PRO_REASONS.showPanel },
  ],
  'workspace.reset': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.dock },
  'workspace.preset.apply': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.presets },
  'workspace.preset.save': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.presets },
  'workspace.preset.rename': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.presets },
  'workspace.preset.delete': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.presets },
  'workspace.toggleChrome': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.chrome },
  'workspace.toggleTimeline': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.chrome },
  'workspace.toggleFocus': { proOnly: 'PRO_CHROME', reason: PRO_REASONS.focus },
  'shell.navigate': [
    on(0, [C('proLayout')], { when: { to: 'studio' }, plain: 'Pro layout' }),
    on(1, [C('home')], { when: { to: ['autorig', 'chooser'] }, plain: 'Rig a model for me' }),
    on(0, [C('path')], { when: { to: 'halo' }, plain: 'Ekza Studio' }),
  ],
  'shell.halo': { plumbing: 'shell.halo' },
  'model.animateOnly': { plumbing: 'model.animateOnly' },
  'rig.animateOnly': { plumbing: 'rig.animateOnly' },
  'shell.autoRig': { plumbing: 'shell.autoRig' },
  'autorig.navigate': [
    on(0, [C('proLayout')], { when: { to: 'studio' }, plain: 'Pro layout' }),
    on(1, [C('home')], { when: { to: ['autorig', 'chooser', '*'] }, plain: 'Rig a model for me' }),
  ],

  // ===== Make: components and shapes (§11, §15.3) =====
  'mesh.transformComponents': on(0, [C('canvas'), C('echoChips')], MAKE),
  'mesh.extrude': on(1, [P('faces'), M('faces', 'Shape')], { ...MAKE, plain: 'Pull' }),
  'mesh.inset': on(1, [P('faces'), M('faces', 'Shape')], MAKE),
  'mesh.bevel': on(1, [P('faces'), P('edges')], MAKE),
  'mesh.insertLoop': on(1, [P('edges'), T('make')], { ...MAKE, ...HANDS, plain: 'Loop cut' }),
  'mesh.offsetLoop': on(2, [M('edges', 'Cut')], { ...MAKE, plain: 'Offset loop' }),
  'mesh.connect': on(1, [P('vertices'), M('edges', 'Cut')], MAKE),
  'mesh.cut': on(1, [T('make'), M('faces', 'Cut')], { ...MAKE, ...HANDS, plain: 'Multi-cut' }),
  'mesh.slide': on(1, [P('edges'), P('vertices')], { ...MAKE, ...HANDS }),
  'mesh.averageVertices': on(2, [M('vertices', 'Shape')], { ...MAKE, plain: 'Average' }),
  'mesh.bridge': on(1, [P('edges'), M('faces', 'Shape')], MAKE),
  'mesh.fillHole': on(2, [M('faces', 'Shape'), M('edges', 'Shape')], MAKE),
  'mesh.merge': on(1, [P('edges'), P('vertices')], MAKE),
  'mesh.mergeToCenter': on(1, [M('vertices', 'Merge'), M('edges', 'Merge')], { ...MAKE, plain: 'Merge to centre' }),
  'mesh.mergeByDistance': on(2, [M('vertices', 'Merge'), M('mesh', 'Clean up')], MAKE),
  'mesh.targetWeld': on(1, [P('vertices'), C('targetMode')], { ...MAKE, ...HANDS, plain: 'Weld to…' }),
  'mesh.collapse': on(2, [M('edges', 'Shape'), M('vertices', 'Shape')], MAKE),
  'mesh.delete': on(1, [P('faces'), P('vertices')], MAKE),
  'mesh.deleteEdgeVertex': on(2, [M('edges', 'Shape'), M('vertices', 'Shape')], {
    ...MAKE,
    plain: 'Delete edge & vertices',
  }),
  'mesh.spinEdge': on(2, [M('edges', 'Shape')], MAKE),
  'mesh.flipTriangleEdge': on(2, [M('edges', 'Shape')], MAKE),
  'mesh.triangulate': on(2, [M('mesh', 'Clean up'), M('faces', 'Shape')], MAKE),
  'mesh.quadrangulate': on(2, [M('mesh', 'Clean up'), M('faces', 'Shape')], MAKE),
  'mesh.harden': on(2, [M('edges', 'Normals'), M('mesh', 'Normals')], { ...MAKE, plain: 'Sharp' }),
  'mesh.soften': on(2, [M('edges', 'Normals'), M('mesh', 'Normals')], { ...MAKE, plain: 'Smooth' }),
  'mesh.setNormalAngle': on(2, [M('edges', 'Normals'), M('mesh', 'Normals')], { ...MAKE, plain: 'Normal angle' }),
  'mesh.reverse': on(2, [M('faces', 'Colour & surface'), M('mesh', 'Normals')], { ...MAKE, plain: 'Flip normals' }),
  'mesh.conform': on(2, [M('mesh', 'Normals')], MAKE),
  'mesh.mirror': on(1, [P('mesh')], MAKE),
  'mesh.symmetrize': on(2, [M('mesh', 'Clean up')], MAKE),
  'mesh.applyTransform': on(2, [M('mesh', 'Transform')], { ...MAKE, plain: 'Apply transforms' }),
  'mesh.uv.planar': on(2, [M('mesh', 'UV'), M('faces', 'Colour & surface')], MAKE),
  'mesh.uv.box': on(2, [M('mesh', 'UV'), M('faces', 'Colour & surface')], MAKE),
  'mesh.uv.cylindrical': on(2, [M('mesh', 'UV'), M('faces', 'Colour & surface')], MAKE),
  'mesh.cleanup': on(2, [M('mesh', 'Clean up'), S('health', 'problems')], MAKE),
  'mesh.combine': on(2, [M('mesh', 'Object')], MAKE),
  'mesh.separate': on(2, [M('mesh', 'Object')], MAKE),
  'mesh.extract': on(2, [M('faces', 'Shape')], MAKE),
  'mesh.duplicateFaces': on(2, [M('faces', 'Shape')], { ...MAKE, plain: 'Duplicate face' }),
  'mesh.create.cube': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.sphere': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.cylinder': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.cone': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.plane': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.torus': on(1, [P('empty'), T('make')], MAKE),
  'mesh.create.template': on(1, [P('empty'), C('home')], MAKE),
  'mesh.primitive.set': on(0, [C('echoChips'), S('numbers', 'shapeInputs')], MAKE),
  'mesh.makeEditable': on(1, [P('mesh'), M('character', 'Rig')], { stages: ['make', 'paint', 'rig'] }),
  'mesh.setAttributes': on(2, [S('numbers', 'mesh')], MAKE),
  'model.snap.toggle': on(1, [T('make'), M('empty', 'Snap'), C('thumb')], MAKE),
  'model.pivot.editToggle': on(1, [P('manipulator'), C('thumb')], { ...MAKE, plain: 'Pivot edit' }),
  'mesh.pivot.set': on(2, [S('numbers', 'pivot')], MAKE),
  'mesh.pivot.center': on(2, [M('manipulator', 'Pivot'), M('mesh', 'Transform'), S('numbers', 'pivot')], MAKE),
  'mesh.pivot.bottomCenter': on(2, [M('manipulator', 'Pivot'), M('mesh', 'Transform'), S('numbers', 'pivot')], MAKE),
  'mesh.pivot.reset': on(2, [M('manipulator', 'Pivot'), M('mesh', 'Transform'), S('numbers', 'pivot')], MAKE),
  'mesh.pivot.bake': on(2, [M('manipulator', 'Pivot'), M('mesh', 'Transform'), S('numbers', 'pivot')], MAKE),
  'mesh.resetTransforms': on(2, [M('mesh', 'Transform')], MAKE),
  'mesh.freezeTransforms': on(2, [M('mesh', 'Transform')], MAKE),
  'scene.object.transform': on(0, [C('canvas'), S('numbers', 'transform')], MAKE),
  'scene.group': on(2, [M('mesh', 'Object')], MAKE),
  'scene.parent': on(2, [M('mesh', 'Object'), S('scene', 'reparent'), C('targetMode')], {
    ...MAKE,
    plain: 'Parent to…',
  }),
  'scene.unparent': on(2, [M('mesh', 'Object'), S('scene', 'reparent')], MAKE),
  'scene.duplicate': on(1, [P('mesh')], MAKE),
  'scene.delete': on(2, [M('mesh', 'Object')], MAKE),
  'scene.rename': on(1, [C('breadcrumb'), S('numbers', 'mesh'), S('scene', 'objects')], MAKE),
  'imagePlane.import': on(1, [P('empty')], { ...MAKE, plain: 'Reference' }),
  'imagePlane.set': on(1, [P('imagePlane'), S('numbers', 'imagePlane')], MAKE),
  'imagePlane.delete': on(1, [P('imagePlane')], MAKE),
  'imagePlane.replace': on(2, [M('imagePlane', 'Image')], MAKE),

  // ===== Paint (§13.1, §15.4) =====
  'mesh.paint': on(1, [P('faces'), T('paint')], { stages: ['make', 'paint'], ...HANDS, plain: 'Colour' }),
  'mesh.paint.fillShell': on(1, [P('empty'), T('paint')], { ...PAINT, ...HANDS, plain: 'Fill part' }),
  'mesh.paint.remap': on(1, [P('swatch')], { ...PAINT, plain: 'Replace with active' }),
  'palette.ensureDefault': on(1, [T('paint')], PAINT),
  'palette.create': on(1, [P('empty'), S('palette')], { ...PAINT, plain: 'New palette' }),
  'palette.duplicate': on(2, [S('palette')], PAINT),
  'palette.rename': on(2, [S('palette')], PAINT),
  'palette.addSwatch': on(0, [T('paint')], PAINT),
  'palette.setSwatch': on(1, [P('swatch')], { ...PAINT, plain: 'Edit colour' }),
  'palette.removeSwatch': on(2, [M('swatch', 'Swatch')], PAINT),
  'palette.assign': on(2, [S('palette')], PAINT),
  'palette.replaceSwatch': on(2, [M('swatch', 'Swatch')], PAINT),
  'palette.setActive': on(0, [T('paint')], PAINT),
  'palette.assignMaterial': on(2, [M('swatch', 'Swatch')], { ...PAINT, plain: 'New material' }),

  // ===== Rig: characters, skeletons, quick rig (§12, §15.5) =====
  'char.fromModel': on(1, [P('character'), P('mesh')], { ...RIG, plain: 'Make a character' }),
  'char.adopt': on(2, [M('mesh', 'Rig')], { ...RIG, plain: 'Add to character' }),
  'char.setVrmMeta': on(2, [S('about')], { stages: ['rig'] }),
  'char.renderThumbnail': on(2, [S('about', 'thumbnail'), M('character', 'Rig')]),
  'rig.autoRig.update': on(2, [M('character', 'Rig')], RIG),
  'rig.addLimbIk': on(2, [M('character', 'Rig')], RIG),
  'rig.toggleSecondary': on(1, [S('view', 'show')], ANIMATE),
  'rig.ikFk.switch': on(1, [P('control'), P('foot')], { ...ANIMATE, plain: 'Hand leads / Foot leads' }),
  'rig.ikFk.match': on(2, [M('control', 'Rig'), M('foot', 'Limb')], { ...ANIMATE, plain: 'Match now' }),
  'rig.ikFk.matchRange': on(2, [M('foot', 'Limb'), M('band', 'Values')], { ...ANIMATE, plain: 'Match range' }),
  'rig.setFootParams': on(2, [M('foot', 'Limb'), S('numbers', 'foot')], { ...ANIMATE, plain: 'Foot pivots' }),
  'rig.setRotateOrder': on(2, [M('control', 'Rig')], ANIMATE),
  'rig.setControlSize': on(2, [M('control', 'Rig')], ANIMATE),
  'rig.mode': on(0, [T('rig'), C('canvas')], RIG),
  'rig.pose.view': on(0, [T('rig')], RIG),
  'rig.pose.resetTest': on(1, [M('character', 'Rig')], RIG),
  'rig.validation.profile': on(2, [S('health', 'checks')], RIG),
  'rig.jointSize.set': on(2, [M('joint', 'Joint'), S('view', 'show')], RIG),
  'rig.snap.projectedCenter': on(2, [M('joint', 'Joint')], { ...RIG, plain: 'Snap to centre' }),
  'skel.template.create': on(1, [P('empty')], { ...RIG, plain: 'Add skeleton' }),
  'skel.template.addMissing': on(1, [S('health', 'problems'), M('character', 'Rig')], RIG),
  'skel.joint.rename': on(1, [P('joint'), C('breadcrumb')], RIG),
  'skel.joint.setHumanBone': on(2, [M('joint', 'Joint'), S('numbers', 'joint')], { ...RIG, plain: 'Humanoid bone' }),
  'skel.joint.move': on(0, [C('canvas'), S('numbers', 'joint')], RIG),
  'skel.joint.rotateRest': on(0, [C('canvas'), S('numbers', 'joint')], RIG),
  'skel.joint.setRest': on(2, [S('numbers', 'joint')], { ...RIG, plain: 'Rest values' }),
  'skel.joint.orient': on(1, [P('joint')], RIG),
  'skel.joint.mirror': on(1, [P('joint')], RIG),
  'skel.joint.flex': on(2, [M('joint', 'Joint')], { ...RIG, plain: 'Restore bend' }),
  'skel.symmetry.set': on(2, [M('joint', 'Joint')], { ...RIG, plain: 'Symmetry X' }),
  'skel.pose.tStance': on(2, [M('character', 'Rig')], RIG),
  'skel.pose.applyAsRest': on(2, [M('character', 'Rig'), S('health', 'problems')], RIG),
  'skel.quickRig.start': on(1, [P('empty'), C('rigCard')], { ...RIG, plain: 'Rig it for me' }),
  'skel.quickRig.guess': on(1, [P('rigDot'), C('rigCard')], { ...RIG, plain: 'Re-guess' }),
  'skel.quickRig.setMarker': on(0, [C('dotsSession'), P('rigDot')], RIG),
  'skel.quickRig.clear': on(1, [P('rigDot')], RIG),
  'skel.quickRig.setPreset': on(1, [C('rigCard')], RIG),
  'skel.quickRig.cancel': on(0, [C('dotsSession'), C('sessionBar')], RIG),
  'skel.quickRig.pick': on(2, [M('rigDot', 'Dots'), C('dotsSession')], { ...RIG, plain: 'Pick from view' }),
  'skel.quickRig.commit': on(2, [C('rigCard')], { ...RIG, plain: 'Skeleton only' }),
  'skel.quickRig.center': on(1, [S('health', 'problems'), C('rigCard')], { ...RIG, plain: 'Centre and ground' }),
  'skel.quickRig.faceForward': on(1, [S('health', 'problems'), C('rigCard')], { ...RIG, plain: 'Face forward' }),
  'autorig.sample': on(1, [C('home'), C('projectMenu')]),
  'autorig.intake': on(1, [C('home')]),
  'autorig.inspect': on(1, [S('health', 'checks')], RIG),
  'autorig.fix': on(1, [P('healthDot'), S('health', 'problems')], RIG),
  'autorig.rig': on(1, [C('rigCard'), C('statusCorner')], { ...RIG, plain: 'Rig it' }),
  'autorig.cancel': on(0, [C('rigCard')], RIG),
  'autorig.export': on(1, [S('share')]),
  'autorig.controls': on(1, [S('view', 'show')], { ...RIG, plain: 'Hide controls while rigging' }),
  'autorig.parts': on(2, [M('character', 'Rig'), S('scene', 'visibility')], { ...RIG, plain: 'Parts & fingers' }),

  // ===== Skin and weights (§12.4, §15.6) =====
  'skin.bind': on(1, [P('empty'), P('character')], { ...RIG, plain: 'Bind skin' }),
  'skin.unbind': on(2, [M('character', 'Skin')], { ...RIG, plain: 'Unbind' }),
  'skin.weights.paint': on(0, [C('brushTray'), C('canvas'), T('rig')], { ...RIG, ...HANDS }),
  'skin.weights.flood': on(1, [C('brushTray')], { ...RIG, plain: 'Flood' }),
  'skin.weights.set': on(2, [M('skinSpot', 'Weights'), M('vertices', 'Skin')], { ...RIG, plain: 'Set weight…' }),
  'skin.weights.mirror': on(2, [M('skinSpot', 'Weights'), M('joint', 'Skin'), C('brushTray')], {
    ...RIG,
    plain: 'Mirror weights',
  }),
  'skin.weights.smooth': on(1, [P('skinSpot'), M('joint', 'Skin'), C('brushTray')], { ...RIG, plain: 'Smooth' }),
  'skin.weights.prune': on(2, [M('skinSpot', 'Weights'), M('joint', 'Skin'), C('brushTray')], {
    ...RIG,
    plain: 'Prune small weights',
  }),
  'skin.weights.normalize': on(2, [C('brushTray'), S('health', 'problems')], RIG),
  'skin.palette.compact': on(2, [C('brushTray'), S('health', 'problems')], { ...RIG, plain: 'Remove unused bones' }),
  'skin.influence.setActive': on(0, [C('brushTray'), P('skinSpot')], RIG),
  'skin.influence.hold': on(2, [M('skinSpot', 'Weights'), C('brushTray')], RIG),
  'skin.influence.holdAll': on(2, [C('brushTray')], RIG),
  'skin.influence.releaseAll': on(2, [C('brushTray')], RIG),
  'skin.influence.walk': on(0, [C('brushTray')], RIG),
  'skin.influence.pickDominant': on(1, [P('skinSpot'), C('thumb')], { ...RIG, plain: 'Who owns this?' }),
  'skin.paint.mode': on(0, [C('brushTray')], RIG),
  'skin.paint.set': on(0, [C('brushTray'), C('thumb')], RIG),
  'skin.paint.mirrorToggle': on(0, [C('brushTray')], { ...RIG, plain: 'Mirror' }),
  'skin.paint.sample': on(1, [C('thumb'), C('brushTray')], { ...RIG, plain: 'Sample value' }),
  'skin.testRotate.toggle': on(0, [T('rig')], RIG),

  // ===== the AI agent (§14, §15.13) =====
  'agent.show': on(1, [P('historyStep')], { plain: 'Show' }),
};

/** Operator ids the manifest knows, typed (for the More sheet and search). */
export const DISCLOSED_IDS = Object.keys(DISCLOSURE) as readonly OperatorId[];
