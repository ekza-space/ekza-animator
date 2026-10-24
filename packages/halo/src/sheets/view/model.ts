// The View sheet, the model (STUDIO-TOUCH-SPEC §4.7, §15 rows 1.3–1.12, 1.16, 5.12, 5.13, 5.17, §16.4; P10, P13;
// T6b): the View puck's sheet. Look (shading) and Show (display flags: the essentials first, the rest one level down,
// joint display, secondary controls, controls while rigging) are the only Halo controls that write the pane display
// memory (§16.4); Panes 1 · 2 · 4 on wide containers and Maximize; Cameras (the view presets, every shot camera with
// Look through, Copy view here, Lock and its lens); Pick only… (the selection mask); the manipulator's size and space;
// Hide UI; Full screen. A flag shows its state only when the pane's display can be read (the viewport's display port
// or the pane state); otherwise it is an action. Every control is one operator call. React-free: the sheet renders it,
// the unit tests drive it.
import type { CameraRecord } from '@ekza-studio/doc';
import {
  type DisplayFlags,
  type EditorApp,
  type ManipSpace,
  type OperatorId,
  paneDisplayPort,
  type SelectionMask,
  type Shading,
  type ViewPreset,
  type ViewportLayout,
} from '@ekza-studio/editor-core';

/** Halo's one canvas pane (§4.1). */
export const VIEW_PANE = 'pane-single';

export interface OperatorCall {
  readonly op: OperatorId;
  readonly args?: unknown;
}

/** An on/off control: `on` null when the state cannot be read (then it is an action). */
export interface ViewToggle {
  readonly id: string;
  readonly label: string;
  /** Studio Pro's name, in grey, when it differs. */
  readonly pro: string | null;
  readonly on: boolean | null;
  readonly call: OperatorCall;
  readonly reason: string | null;
}

export interface ViewOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly call: OperatorCall;
}

/** A choice of one (a segmented control): `value` null when it cannot be read (then each option is an action). */
export interface ViewChoice<V extends string> {
  readonly id: string;
  readonly label: string;
  readonly pro: string | null;
  readonly value: V | null;
  readonly options: readonly ViewOption<V>[];
  readonly reason: string | null;
}

export interface ViewAction {
  readonly id: string;
  readonly label: string;
  readonly pro: string | null;
  readonly call: OperatorCall;
  readonly reason: string | null;
}

export interface ViewNumber {
  readonly id: string;
  readonly label: string;
  readonly pro: string | null;
  readonly value: number;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
  readonly write: (value: number) => OperatorCall;
  readonly reason: string | null;
}

export interface ShotCameraEntry {
  readonly id: string;
  readonly name: string;
  /** This pane looks through it now (null: unknown). */
  readonly looking: boolean | null;
  readonly lookThrough: ViewAction;
  readonly copyView: ViewAction;
  readonly lock: ViewToggle;
  /** The lens angle (perspective cameras), degrees. */
  readonly lens: ViewNumber | null;
}

export interface ViewModel {
  /** The pane the Look, Show and Cameras controls act on. */
  readonly paneId: string;
  readonly look: ViewChoice<Shading>;
  readonly show: {
    readonly essentials: readonly ViewToggle[];
    readonly more: readonly ViewToggle[];
    readonly normals: ViewChoice<DisplayFlags['normals']>;
    readonly weights: ViewChoice<DisplayFlags['weights']>;
    readonly joints: {
      readonly size: ViewNumber;
      readonly throughMesh: ViewToggle;
      readonly axes: ViewChoice<DisplayFlags['jointAxes']>;
      readonly labels: ViewChoice<DisplayFlags['jointLabels']>;
    };
    readonly secondary: ViewToggle;
    readonly rigControls: { readonly hide: ViewAction; readonly show: ViewAction };
  };
  readonly panes: {
    /** Panes are offered on wide containers only (§15 row 1.6). */
    readonly shown: boolean;
    readonly layout: ViewChoice<'single' | 'split' | 'quad'>;
    /** The current layout when it is none of the three (Rig's dots layouts). */
    readonly other: ViewportLayout | null;
    /** Maximize a pane (2- or 4-pane layouts only). */
    readonly maximize: ViewToggle | null;
  };
  readonly cameras: {
    readonly views: ViewChoice<ViewPreset>;
    readonly shots: readonly ShotCameraEntry[];
    /** Add a shot camera from this view (when there is none: with one, Copy view here updates it). */
    readonly add: ViewAction | null;
  };
  readonly selection: readonly ViewToggle[];
  readonly manipulator: {
    readonly size: number;
    readonly smaller: ViewAction;
    readonly larger: ViewAction;
    readonly move: ViewChoice<'object' | 'world'>;
    readonly turn: ViewChoice<ManipSpace>;
  };
  readonly hideUi: boolean;
  readonly fullScreen: ViewAction;
}

/** What the sheet knows of the pane (the ViewportManager's pane state), when it can read it. */
export interface PaneSnapshot {
  readonly display: DisplayFlags | null;
  readonly cameraKind: 'shot' | 'view' | null;
  readonly preset: ViewPreset | null;
  readonly shotCameraId: string | null;
}

export interface ViewInput {
  /** The pane the frame shows (default `pane-single`). */
  readonly paneId?: string;
  /** The pane's state, when the viewport is mounted (else the display port is read for the flags). */
  readonly pane?: PaneSnapshot | null;
  /** A wide container (sheets dock on the right): Panes are offered. */
  readonly wide: boolean;
  /** The frame offers Hide UI. */
  readonly hideUi: boolean;
}

// ---------- vocabulary ----------

const SHADING: readonly { readonly value: Shading; readonly label: string }[] = [
  { value: 'wire', label: 'Wire' },
  { value: 'shaded', label: 'Shaded' },
  { value: 'colours', label: 'Colours' },
  { value: 'lit', label: 'Lit' },
];

type BooleanFlag = { [K in keyof DisplayFlags]: DisplayFlags[K] extends boolean ? K : never }[keyof DisplayFlags];

interface FlagWords {
  readonly flag: BooleanFlag;
  readonly label: string;
  readonly pro: string | null;
}

/** The essentials (§15 row 1.9): X-ray, Skeleton, Controls, Grid, Joints. */
const ESSENTIALS: readonly FlagWords[] = [
  { flag: 'xray', label: 'X-ray', pro: 'X-ray meshes' },
  { flag: 'skeleton', label: 'Skeleton', pro: 'Show skeleton' },
  { flag: 'controls', label: 'Controls', pro: null },
  { flag: 'grid', label: 'Grid', pro: null },
  { flag: 'joints', label: 'Joints', pro: 'Joints (Rig & Skin)' },
];

/** The rest of the on/off flags, one level down (joint x-ray sits with the joint display). */
const MORE_FLAGS: readonly FlagWords[] = [
  { flag: 'mesh', label: 'Meshes', pro: null },
  { flag: 'components', label: 'Points and edges', pro: 'Components' },
  { flag: 'wireOnShaded', label: 'Wire on shaded', pro: null },
  { flag: 'flat', label: 'Flat shading', pro: null },
  { flag: 'cull', label: 'Hide back faces', pro: 'Backface Culling' },
  { flag: 'faceOrientation', label: 'Face direction', pro: 'Face Orientation' },
  { flag: 'triangulation', label: 'Triangles', pro: 'Triangulation' },
  { flag: 'hardEdges', label: 'Hard edges', pro: null },
  { flag: 'dimUnhilited', label: 'Dim other shapes', pro: 'Dim Unhilited' },
  { flag: 'polyCount', label: 'Triangle count', pro: 'Poly Count' },
  { flag: 'meshCheck', label: 'Mesh check', pro: null },
  { flag: 'symmetryPlane', label: 'Mirror plane', pro: 'Symmetry Plane' },
  { flag: 'imagePlanes', label: 'Reference images', pro: 'Image Planes' },
  { flag: 'hud', label: 'Info overlay', pro: 'HUD' },
  { flag: 'springBones', label: 'Spring preview', pro: 'Spring bones' },
  { flag: 'constraintLines', label: 'Constraint lines', pro: null },
  { flag: 'weightNumbers', label: 'Weight numbers', pro: null },
  { flag: 'lockRelative', label: 'Lock relative', pro: null },
];

const NORMALS: readonly { readonly value: DisplayFlags['normals']; readonly label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'face', label: 'Faces' },
  { value: 'vertex', label: 'Points' },
  { value: 'both', label: 'Both' },
];

const WEIGHTS: readonly { readonly value: DisplayFlags['weights']; readonly label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'greyscale', label: 'Grey' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'influences', label: 'Colours' },
];

const AXES: readonly { readonly value: DisplayFlags['jointAxes']; readonly label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'selected', label: 'Selected' },
  { value: 'all', label: 'All' },
];

/** Joint labels keep Pro's values: none / on hover / all (§15 row 1.9). */
const LABELS: readonly { readonly value: DisplayFlags['jointLabels']; readonly label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'hover', label: 'On hover' },
  { value: 'all', label: 'All' },
];

const VIEWS: readonly { readonly value: ViewPreset; readonly label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'top', label: 'Top' },
  { value: 'persp', label: 'Perspective' },
];

const LAYOUTS: readonly { readonly value: 'single' | 'split' | 'quad'; readonly label: string }[] = [
  { value: 'single', label: '1' },
  { value: 'split', label: '2' },
  { value: 'quad', label: '4' },
];

const MASK: readonly { readonly key: keyof SelectionMask; readonly label: string }[] = [
  { key: 'controls', label: 'Controls' },
  { key: 'joints', label: 'Joints' },
  { key: 'meshes', label: 'Meshes' },
  { key: 'groups', label: 'Groups' },
];

/** `view.manipulatorSize` (40–200 px) in Pro's key steps (− / =). */
export const MANIPULATOR_STEP = 10;
const MANIPULATOR_MIN = 40;
const MANIPULATOR_MAX = 200;

/** `rig.jointSize.set` (a preference; Display › Joint Size). */
const JOINT_SIZE = { min: 0.25, max: 4, step: 0.25 } as const;

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// ---------- building ----------

/** The poll reason of a call, or null when it may run (an unregistered operator is left to the run's own toast). */
function reasonOf(app: EditorApp, call: OperatorCall): string | null {
  if (app.operators.get(call.op) === undefined) return null;
  const verdict = app.operators.poll(call.op, undefined, call.args);
  return verdict === true ? null : verdict.reason;
}

function choice<V extends string>(
  app: EditorApp,
  id: string,
  label: string,
  pro: string | null,
  value: V | null,
  options: readonly { readonly value: V; readonly label: string }[],
  callOf: (value: V) => OperatorCall,
): ViewChoice<V> {
  const built = options.map((option) => ({ value: option.value, label: option.label, call: callOf(option.value) }));
  const first = built[0];
  return { id, label, pro, value, options: built, reason: first === undefined ? null : reasonOf(app, first.call) };
}

function toggle(
  app: EditorApp,
  id: string,
  label: string,
  pro: string | null,
  on: boolean | null,
  call: OperatorCall,
): ViewToggle {
  return { id, label, pro, on, call, reason: reasonOf(app, call) };
}

function act(
  app: EditorApp,
  id: string,
  label: string,
  pro: string | null,
  call: OperatorCall,
  blocked?: string | null,
): ViewAction {
  return { id, label, pro, call, reason: blocked ?? reasonOf(app, call) };
}

/** The pane the sheet's display controls act on: the frame's, else the viewport's active pane. */
export function targetPane(app: EditorApp, wanted: string): string {
  const port = paneDisplayPort(app);
  if (port === null || port.panes().includes(wanted)) return wanted;
  return port.activePane() ?? wanted;
}

/** The View sheet's controls for the app now. */
export function viewModel(app: EditorApp, input: ViewInput): ViewModel {
  const paneId = targetPane(app, input.paneId ?? VIEW_PANE);
  const pane = input.pane ?? null;
  const display = pane?.display ?? paneDisplayPort(app)?.display(paneId) ?? null;
  const state = app.session.getState();
  const prefs = app.prefs.getState();
  const flag = (words: FlagWords): ViewToggle =>
    toggle(app, words.flag, words.label, words.pro, display === null ? null : display[words.flag], {
      op: 'view.display.toggle',
      args: { flag: words.flag, paneId },
    });
  const set = (patch: Partial<DisplayFlags>): OperatorCall => ({ op: 'view.display.set', args: { patch, paneId } });

  const look = choice(app, 'look', 'Look', 'Shading', display?.shading ?? null, SHADING, (mode) => ({
    op: 'view.shading',
    args: { mode, paneId },
  }));

  const controls = app.store.list('controls').filter((control) => control.deleted === null);
  const show: ViewModel['show'] = {
    essentials: ESSENTIALS.map(flag),
    more: MORE_FLAGS.map(flag),
    normals: choice(app, 'normals', 'Normals', null, display?.normals ?? null, NORMALS, (normals) => set({ normals })),
    weights: choice(app, 'weights', 'Weights', 'Weight display', display?.weights ?? null, WEIGHTS, (weights) =>
      set({ weights }),
    ),
    joints: {
      size: {
        id: 'jointSize',
        label: 'Joint size',
        pro: 'Joint Size',
        value: prefs.rigging.jointSize,
        step: JOINT_SIZE.step,
        min: JOINT_SIZE.min,
        max: JOINT_SIZE.max,
        unit: '×',
        write: (size) => ({ op: 'rig.jointSize.set', args: { size } }),
        reason: reasonOf(app, { op: 'rig.jointSize.set', args: { size: prefs.rigging.jointSize } }),
      },
      throughMesh: flag({ flag: 'xrayJoints', label: 'Joints through the mesh', pro: 'X-Ray Joints' }),
      axes: choice(
        app,
        'jointAxes',
        'Joint axes',
        'Local Rotation Axes',
        display?.jointAxes ?? null,
        AXES,
        (jointAxes) => set({ jointAxes }),
      ),
      labels: choice(
        app,
        'jointLabels',
        'Joint names',
        'Joint Labels',
        display?.jointLabels ?? null,
        LABELS,
        (jointLabels) => set({ jointLabels }),
      ),
    },
    secondary: toggle(app, 'secondary', 'Secondary controls', 'Show Secondary', state.showSecondary, {
      op: 'rig.toggleSecondary',
    }),
    rigControls: {
      hide: act(
        app,
        'hideRigControls',
        'Hide',
        'Hide Rig Controls',
        { op: 'autorig.controls', args: { hidden: true } },
        controls.length === 0 ? 'No rig controls yet' : null,
      ),
      show: act(app, 'showRigControls', 'Show', null, { op: 'autorig.controls', args: { hidden: false } }),
    },
  };

  const layout = state.viewportLayout;
  const simple = layout === 'single' || layout === 'split' || layout === 'quad' ? layout : null;
  const maximizeTarget = state.maximizedPane ?? paneDisplayPort(app)?.activePane() ?? paneId;
  const panes: ViewModel['panes'] = {
    shown: input.wide,
    layout: choice(app, 'panes', 'Panes', 'Viewport Layout', simple, LAYOUTS, (value) => ({
      op: 'view.layout',
      args: { layout: value },
    })),
    other: simple === null ? layout : null,
    maximize:
      layout === 'single'
        ? null
        : toggle(app, 'maximize', 'Maximize pane', 'Maximize Panel', state.maximizedPane !== null, {
            op: 'view.toggleMaximize',
            args: { paneId: maximizeTarget },
          }),
  };

  const viewing = pane === null || pane.cameraKind === null ? null : pane.cameraKind === 'view' ? pane.preset : null;
  const cameraRecords = app.store
    .list('cameras')
    .filter((camera) => camera.deleted === null)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
  const shots = cameraRecords.map((camera: CameraRecord): ShotCameraEntry => {
    const looking =
      pane === null || pane.cameraKind === null ? null : pane.cameraKind === 'shot' && pane.shotCameraId === camera.id;
    return {
      id: camera.id,
      name: camera.name,
      looking,
      lookThrough: act(app, 'lookThrough', 'Look through', 'Look Through', {
        op: 'view.lookThrough',
        args: { paneId, camera: { kind: 'shot', cameraId: camera.id } },
      }),
      copyView: act(app, 'copyView', 'Copy view here', 'Copy View to Shot Camera', {
        op: 'view.copyViewToShot',
        args: { paneId, cameraId: camera.id },
      }),
      lock: toggle(app, 'lock', 'Lock', 'Camera Lock', camera.locked, {
        op: 'view.toggleCameraLock',
        args: { cameraId: camera.id },
      }),
      lens:
        camera.projection === 'perspective'
          ? {
              id: 'lens',
              label: 'Lens angle',
              pro: 'Field of view',
              value: Math.round(camera.fovY * RAD2DEG * 100) / 100,
              step: 1,
              min: 1,
              max: 170,
              unit: '°',
              write: (degrees) => ({
                op: 'view.camera.setSettings',
                args: { camera: camera.id, fovY: degrees * DEG2RAD },
              }),
              reason: null,
            }
          : null,
    };
  });
  const cameras: ViewModel['cameras'] = {
    views: choice(app, 'views', 'Look from', 'Look Through', viewing, VIEWS, (preset) => ({
      op: 'view.lookThrough',
      args: { paneId, camera: { kind: 'view', preset } },
    })),
    shots,
    add:
      shots.length === 0
        ? act(app, 'addShot', 'Add a shot camera from this view', 'Copy View to Shot Camera', {
            op: 'view.copyViewToShot',
            args: { paneId },
          })
        : null,
  };

  const mask = state.tools.selectionMask;
  const selection = MASK.map(({ key, label }) =>
    toggle(app, key, label, null, mask[key], { op: 'view.selectionMask', args: { mask: { [key]: !mask[key] } } }),
  );

  const size = state.tools.manipulatorSize;
  const manipulator: ViewModel['manipulator'] = {
    size,
    smaller: act(
      app,
      'smaller',
      'Smaller',
      'Manipulator Size',
      { op: 'view.manipulatorSize', args: { delta: -MANIPULATOR_STEP } },
      size <= MANIPULATOR_MIN ? 'Already the smallest' : null,
    ),
    larger: act(
      app,
      'larger',
      'Larger',
      'Manipulator Size',
      { op: 'view.manipulatorSize', args: { delta: MANIPULATOR_STEP } },
      size >= MANIPULATOR_MAX ? 'Already the largest' : null,
    ),
    move: choice(
      app,
      'moveSpace',
      'Move along',
      'Move tool space',
      prefs.moveSpace,
      [
        { value: 'object', label: 'Object' },
        { value: 'world', label: 'World' },
      ],
      (space) => ({ op: 'view.setManipSpace', args: { tool: 'move', space } }),
    ),
    turn: choice(
      app,
      'rotateSpace',
      'Turn around',
      'Rotate tool space',
      prefs.rotateSpace,
      [
        { value: 'object', label: 'Object' },
        { value: 'world', label: 'World' },
        { value: 'gimbal', label: 'Gimbal' },
      ],
      (space) => ({ op: 'view.setManipSpace', args: { tool: 'rotate', space } }),
    ),
  };

  return {
    paneId,
    look,
    show,
    panes,
    cameras,
    selection,
    manipulator,
    hideUi: input.hideUi,
    fullScreen: act(app, 'fullScreen', 'Full screen', 'Full Screen', { op: 'view.toggleFullscreen' }),
  };
}

export type ViewSectionId =
  | 'look'
  | 'show'
  | 'panes'
  | 'cameras'
  | 'selection'
  | 'manipulator'
  | 'hideUi'
  | 'fullScreen';

/** Every operator call a control of the sheet runs, by section (the parity test's view of the sheet). */
export function viewCalls(
  model: ViewModel,
): readonly { readonly section: ViewSectionId; readonly call: OperatorCall }[] {
  const out: { section: ViewSectionId; call: OperatorCall }[] = [];
  const add = (section: ViewSectionId, calls: readonly OperatorCall[]): void => {
    for (const call of calls) out.push({ section, call });
  };
  const options = <V extends string>(c: ViewChoice<V>): OperatorCall[] => c.options.map((option) => option.call);
  add('look', options(model.look));
  const { show } = model;
  add('show', [
    ...show.essentials.map((t) => t.call),
    ...show.more.map((t) => t.call),
    ...options(show.normals),
    ...options(show.weights),
    show.joints.size.write(show.joints.size.value),
    show.joints.throughMesh.call,
    ...options(show.joints.axes),
    ...options(show.joints.labels),
    show.secondary.call,
    show.rigControls.hide.call,
    show.rigControls.show.call,
  ]);
  add('panes', [...options(model.panes.layout), ...(model.panes.maximize === null ? [] : [model.panes.maximize.call])]);
  add('cameras', [
    ...options(model.cameras.views),
    ...model.cameras.shots.flatMap((shot) => [
      shot.lookThrough.call,
      shot.copyView.call,
      shot.lock.call,
      ...(shot.lens === null ? [] : [shot.lens.write(shot.lens.value)]),
    ]),
    ...(model.cameras.add === null ? [] : [model.cameras.add.call]),
  ]);
  add(
    'selection',
    model.selection.map((t) => t.call),
  );
  add('manipulator', [
    model.manipulator.smaller.call,
    model.manipulator.larger.call,
    ...options(model.manipulator.move),
    ...options(model.manipulator.turn),
  ]);
  add('fullScreen', [model.fullScreen.call]);
  return out;
}
