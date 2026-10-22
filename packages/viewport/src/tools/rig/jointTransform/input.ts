// Joints in Skeleton mode (M6B-SPEC §5.7, §0.4.3, §8.3; C3): selection and the §5.7 state table on the select (`Q`),
// move (`W`), rotate (`E`) and scale (`R`) tools.
//
// - A click picks a joint (sphere > bone; Shift toggle, Mod remove, Mod+Shift add — `select.joints`); a drag from
//   empty space draws a marquee over the joints; a click on empty space clears the joint selection; a click on a
//   missing required bone's ring opens Validation.
// - `W` drag on a joint moves the selected joints' rests with their subtrees, `D` held the joints only (knees,
//   elbows), the partners mirrored — `skel.joint.move`, one undo step on release; the overlay previews the edit while
//   dragging. In an orthographic pane the drag stays in the pane's plane (the hidden axis does not move).
// - `E` drag rotates the rests about the lead joint (`skel.joint.rotateRest`, subtree), `D` + `E` re-orients the joint
//   only; on a bound skeleton `E` is a test pose instead: the joint's driving control turns about the view axis
//   through the channel-edit gesture (Rig & Skin writes it to the test pose, never a key), and on an IK limb the limb
//   is switched to FK for the test (`@ikFk` = 0 in the test pose; the `FK FOR TEST` badge shows it).
// - Test or Clip view: `W`, `D` + `W`, `D` + `E` are refused ("Go to Bind Pose"); `R` never scales joints.
import { type Mat4, mat4Compose, mat4Invert, quatFromAxisAngle, quatToEuler } from '@ekza-studio/anim-core';
import type { CharacterId, JointId, JointRecord } from '@ekza-studio/doc';
import {
  beginChannelEditGesture,
  type ChannelEdit,
  type ChannelEditGesture,
  type EditorApp,
  limbOfControlIn,
  quickRigOf,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
import { controlForNode, moveJoints } from '@ekza-studio/rig';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { type DragControl, dragControl, rotateEdits } from '../../../manipulators/drag';
import type { JointPreview } from '../../../rig/joints/data';
import type { JointOverlay, JointPick } from '../../../rig/joints/overlay';
import {
  type PaneProjection,
  pointerRay,
  projectPoint,
  rayOnAxisPlane,
  type Vec3,
  viewDirection,
} from '../../../rig/joints/pane';
import { PICK } from '../../../theme';
import { hiddenAxisOf } from '../quickRig/rules';
import { selectModeOf } from '../../selectTool';
import type { HeldKeys } from '../quickRig/input';
import { JOINT_SCALE_REFUSAL, type JointAction, jointAction, jointGestureOf, jointSkeletonState } from './stateTable';

/** The help line's hint while a test pose turns an IK limb to FK. */
export const FK_FOR_TEST = 'FK FOR TEST';

const DRAG_PX = 2;

interface RestDrag {
  readonly kind: 'rest';
  readonly action: Extract<JointAction, { kind: 'rest-move' | 'rest-rotate' }>;
  readonly ids: readonly JointId[];
  readonly joints: readonly JointRecord[];
  readonly symmetry: boolean;
  readonly toCharacter: Mat4;
  readonly pivot: Vec3;
  readonly pivotScreen: { readonly x: number; readonly y: number };
  readonly hidden: 0 | 1 | 2 | null;
  readonly startHit: Vec3 | null;
  readonly axis: Vec3;
  args: Record<string, unknown> | null;
}

interface TestDrag {
  readonly kind: 'test';
  readonly control: DragControl;
  readonly extra: readonly ChannelEdit[];
  readonly gesture: ChannelEditGesture;
  readonly axis: Vec3;
  readonly pivotScreen: { readonly x: number; readonly y: number };
  readonly references: [number, number, number][];
}

interface Press {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly pick: JointPick | null;
  readonly tool: string;
  readonly mod: { readonly shift: boolean; readonly mod: boolean };
  moved: boolean;
  marquee: boolean;
  drag: RestDrag | TestDrag | null;
  refused: boolean;
}

/** Where a joint input reports a refusal or a running operator (the runtime routes these). */
export interface JointInputHost {
  readonly overlay: JointOverlay;
  setPreview(preview: JointPreview | null): void;
  setMarquee(paneId: string, rect: { x0: number; y0: number; x1: number; y1: number } | null): void;
  toast(text: string): void;
}

export class JointInput {
  private press: Press | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly vm: Pick<ViewportManager, 'paneView' | 'paneState'>,
    private readonly host: JointInputHost,
    private readonly keys: HeldKeys,
  ) {}

  /** Skeleton mode in Rig & Skin with the joints pickable (and Quick Rig closed). */
  get active(): boolean {
    const state = this.app.session.getState();
    return (
      state.workspace === 'rig' &&
      state.rig.mode === 'skeleton' &&
      state.tools.selectionMask.joints &&
      quickRigOf(this.app) === null &&
      ['select', 'move', 'rotate', 'scale'].includes(state.tools.viewport)
    );
  }

  get dragging(): boolean {
    return this.press !== null && this.press.drag !== null;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null || !this.active) return false;
    const tool = this.app.session.getState().tools.viewport;
    const pick = this.host.overlay.pick(e.paneId, e.x, e.y);
    this.press = {
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      pick,
      tool,
      mod: { shift: e.shift, mod: e.mod },
      moved: false,
      marquee: false,
      drag: null,
      refused: false,
    };
    if (pick !== null && pick.kind !== 'missing' && tool === 'scale') {
      this.press.refused = true;
      this.host.toast(JOINT_SCALE_REFUSAL);
      return true;
    }
    // A press on an unselected joint with a transform tool selects it first (Maya), so the drag moves it.
    if (pick !== null && pick.kind !== 'missing' && (tool === 'move' || tool === 'rotate')) {
      const selection = this.app.session.getState().selection.joints;
      if (!selection.includes(pick.joint)) this.select([pick.joint], 'replace');
    }
    return true;
  }

  pointerMove(e: ToolPointerEvent): void {
    const press = this.press;
    if (press === null || press.refused) return;
    if (!press.moved && Math.hypot(e.x - press.x, e.y - press.y) < DRAG_PX) return;
    press.moved = true;
    const onJoint = press.pick !== null && press.pick.kind !== 'missing';
    if (!onJoint || press.tool === 'select') {
      if (press.marquee || Math.hypot(e.x - press.x, e.y - press.y) >= PICK.marqueeMinPx) {
        press.marquee = true;
        this.host.setMarquee(press.paneId, { x0: press.x, y0: press.y, x1: e.x, y1: e.y });
      }
      return;
    }
    if (press.drag === null) {
      press.drag = this.beginDrag(press);
      if (press.drag === null) {
        press.refused = true;
        return;
      }
    }
    this.updateDrag(press, press.drag, e);
  }

  pointerUp(e: ToolPointerEvent): void {
    const press = this.press;
    this.press = null;
    if (press === null || press.refused) return;
    if (press.marquee) {
      this.host.setMarquee(press.paneId, null);
      const ids = this.host.overlay.marquee(press.paneId, { x0: press.x, y0: press.y, x1: e.x, y1: e.y });
      const mode = selectModeOf(press.mod);
      if (ids.length > 0 || mode === 'replace') this.select(ids, mode);
      return;
    }
    const drag = press.drag;
    if (drag !== null) {
      this.finishDrag(drag);
      return;
    }
    if (press.moved) return;
    // A click.
    const pick = press.pick;
    if (pick === null) {
      if (selectModeOf(press.mod) === 'replace') this.select([], 'replace');
      return;
    }
    if (pick.kind === 'missing') {
      this.host.toast(`${pick.missing.bone} missing — Skeleton › Add Missing Bones, or map a joint to it`);
      void this.app.runUntyped('workspace.showPanel', { panel: 'validation' });
      return;
    }
    this.select([pick.joint], selectModeOf(press.mod));
  }

  cancel(): void {
    const press = this.press;
    this.press = null;
    if (press === null) return;
    if (press.marquee) this.host.setMarquee(press.paneId, null);
    const drag = press.drag;
    if (drag?.kind === 'rest') this.host.setPreview(null);
    if (drag?.kind === 'test' && drag.gesture.active) drag.gesture.cancel();
  }

  private select(ids: readonly JointId[], mode: 'replace' | 'toggle' | 'add' | 'remove'): void {
    void this.app.runUntyped('select.joints', { ids, mode });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // drags

  private beginDrag(press: Press): RestDrag | TestDrag | null {
    const view = this.vm.paneView(press.paneId);
    const pick = press.pick;
    if (view === null || pick === null || pick.kind === 'missing') return null;
    const selection = this.app.session.getState().selection.joints;
    const ids = selection.includes(pick.joint) ? selection : [pick.joint];
    const leadId = ids.at(-1) as JointId;
    const lead = this.app.store.get('joints', leadId);
    if (lead === undefined) return null;
    const skeleton = this.app.store.get('skeletons', lead.skeleton);
    const character = skeleton === undefined ? undefined : this.app.store.get('characters', skeleton.character);
    if (skeleton === undefined || character === undefined) return null;
    const gesture = jointGestureOf(press.tool, this.keys.isHeld('KeyD'));
    if (gesture === null) return null;
    const bound = this.app.store.query.meshesBoundTo(skeleton.id).length > 0;
    const action = jointAction(gesture, jointSkeletonState(bound, this.app.session.getState().rig.poseView));
    if (action.kind === 'refused') {
      this.host.toast(action.reason);
      return null;
    }
    const placement = mat4Compose(character.placement);
    const toCharacter = mat4Invert(placement) ?? placement;
    const drawn = this.host.overlay.joint(leadId);
    const pivotWorld: Vec3 = drawn?.position ?? [lead.restPosition[0], lead.restPosition[1], lead.restPosition[2]];
    const pivotScreen = projectPoint(view, pivotWorld) ?? { x: press.x, y: press.y };
    // The view axis toward the viewer, in character space.
    const towards = viewDirection(view).map((v) => -v) as unknown as Vec3;
    const axis = linear(toCharacter, towards);
    if (action.kind === 'test-pose') return this.beginTestPose(character.id, lead, axis, pivotScreen);
    const hidden = hiddenAxisOf(this.vm.paneState(press.paneId)?.preset ?? null);
    return {
      kind: 'rest',
      action,
      ids,
      joints: this.app.store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null),
      symmetry: skeleton.symmetry,
      toCharacter,
      pivot: [lead.restPosition[0], lead.restPosition[1], lead.restPosition[2]],
      pivotScreen,
      hidden,
      startHit: this.planeHit(view, press.x, press.y, pivotWorld, hidden),
      axis,
      args: null,
    };
  }

  /** The pointer's point on the drag plane through `at` (the pane's axis plane in ortho views, else facing the view). */
  private planeHit(view: PaneProjection, x: number, y: number, at: Vec3, hidden: 0 | 1 | 2 | null): Vec3 | null {
    const ray = pointerRay(view, x, y);
    if (hidden !== null) return rayOnAxisPlane(ray, hidden, at[hidden]);
    const n = viewDirection(view);
    const denom = n[0] * ray.dir[0] + n[1] * ray.dir[1] + n[2] * ray.dir[2];
    if (Math.abs(denom) < 1e-9) return null;
    const t =
      (n[0] * (at[0] - ray.origin[0]) + n[1] * (at[1] - ray.origin[1]) + n[2] * (at[2] - ray.origin[2])) / denom;
    return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
  }

  private updateDrag(press: Press, drag: RestDrag | TestDrag, e: ToolPointerEvent): void {
    const angle = screenAngle(drag.pivotScreen, press, e);
    if (drag.kind === 'test') {
      const edits = rotateEdits('rview', 'world', [drag.control], drag.axis, angle, drag.references);
      drag.gesture.update([...edits, ...drag.extra]);
      return;
    }
    const view = this.vm.paneView(press.paneId);
    if (view === null) return;
    if (drag.action.kind === 'rest-move') {
      const drawn = this.host.overlay.joint(drag.ids.at(-1) as JointId);
      const at = drawn?.position ?? drag.pivot;
      const hit = drag.startHit === null ? null : this.planeHit(view, e.x, e.y, at, drag.hidden);
      if (hit === null || drag.startHit === null) return;
      const worldDelta: [number, number, number] = [
        hit[0] - drag.startHit[0],
        hit[1] - drag.startHit[1],
        hit[2] - drag.startHit[2],
      ];
      if (drag.hidden !== null) worldDelta[drag.hidden] = 0;
      const scale = e.shift ? 0.1 : 1;
      let t = linear(drag.toCharacter, worldDelta).map((v) => v * scale) as unknown as Vec3;
      // `X` held: the lead joint's rest lands on the grid (the pane's hidden axis stays where it is).
      const grid = this.keys.isHeld('KeyX') ? this.app.prefs.getState().modeling.gridStep : null;
      if (grid !== null && grid > 0) {
        t = [0, 1, 2].map((k) => {
          if (k === drag.hidden) return 0;
          const p = drag.pivot[k] as number;
          return Math.round((p + (t[k] as number)) / grid) * grid - p;
        }) as unknown as Vec3;
      }
      const mode = drag.action.mode;
      drag.args = { joints: drag.ids, translateX: t[0], translateY: t[1], translateZ: t[2], mode };
      this.host.setPreview(previewOf(moveJoints(drag.joints, drag.ids, { t, pivot: [0, 0, 0] }, mode, drag.symmetry)));
      return;
    }
    const q = quatFromAxisAngle(drag.axis, angle * (e.shift ? 0.1 : 1));
    const euler = quatToEuler(q, 'xyz');
    const mode = drag.action.mode;
    drag.args = {
      joints: drag.ids,
      rotateX: euler[0],
      rotateY: euler[1],
      rotateZ: euler[2],
      mode,
      pivot: [...drag.pivot],
    };
    this.host.setPreview(previewOf(moveJoints(drag.joints, drag.ids, { q, pivot: drag.pivot }, mode, drag.symmetry)));
  }

  private finishDrag(drag: RestDrag | TestDrag): void {
    if (drag.kind === 'test') {
      if (drag.gesture.active) drag.gesture.commit();
      return;
    }
    const args = drag.args;
    if (args === null) {
      this.host.setPreview(null);
      return;
    }
    const op = drag.action.kind === 'rest-move' ? 'skel.joint.move' : 'skel.joint.rotateRest';
    void this.app.runUntyped(op, args).then((result) => {
      this.host.setPreview(null);
      if (result.status === 'cancelled') this.host.toast(result.reason);
      else if (result.status === 'failed') this.host.toast(result.error.message);
    });
  }

  /** §5.7 / §5.17: a test pose on the joint's driving control (IK limbs switched to FK for the test). */
  private beginTestPose(
    character: CharacterId,
    joint: JointRecord,
    axis: Vec3,
    pivotScreen: { readonly x: number; readonly y: number },
  ): TestDrag | null {
    const runtime = this.app.characters.get(character);
    const node = runtime?.skeleton.nodes.find((candidate) => candidate.name === joint.name);
    const control = runtime === undefined || node === undefined ? null : controlForNode(runtime.program, node.index);
    if (runtime === undefined || control === null) {
      this.host.toast(`No control drives ${joint.name}`);
      return null;
    }
    const record = this.app.store.get('controls', control);
    const slot = runtime.program.controlIndex.get(control);
    if (record === undefined || slot === undefined) {
      this.host.toast(`No control drives ${joint.name}`);
      return null;
    }
    const characterRecord = this.app.store.get('characters', character);
    const placement = mat4Compose(characterRecord?.placement ?? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    const world = new Float64Array(16);
    multiply(placement, runtime.pose.controlWorld, slot * 16, world);
    const v = this.app.evaluation.channelValues(control);
    const free = (keyable: readonly boolean[], locked: readonly boolean[]): [boolean, boolean, boolean] => [
      (keyable[0] ?? false) && !(locked[0] ?? false),
      (keyable[1] ?? false) && !(locked[1] ?? false),
      (keyable[2] ?? false) && !(locked[2] ?? false),
    ];
    const dc = dragControl({
      control,
      order: record.rotateOrder,
      world,
      t: [v.tx, v.ty, v.tz],
      r: [v.rx, v.ry, v.rz],
      s: [v.sx, v.sy, v.sz],
      keyable: {
        t: free(record.keyable.t, record.locked.t),
        r: free(record.keyable.r, record.locked.r),
        s: free(record.keyable.s, record.locked.s),
      },
    });
    // IK → FK for the test (§5.17): the limb's switch at 0 in the test pose while its FK control turns.
    const extra: ChannelEdit[] = [];
    const limb = limbOfControlIn(runtime.program, control);
    if (limb !== null && limb.fkControls.includes(control) && (this.app.evaluation.ikFk(character, limb.id) ?? 0) > 0) {
      extra.push({ control: limb.params.ikControl, channel: '@ikFk', value: 0 });
    }
    let gesture: ChannelEditGesture;
    try {
      gesture = beginChannelEditGesture(this.app, 'Rotate', { key: 'auto' });
    } catch (error) {
      this.host.toast(error instanceof Error ? error.message : String(error));
      return null;
    }
    // Rotations act about the world axis through the control's own pivot; the axis stays in scene space.
    const sceneAxis = linear(placement, axis);
    return {
      kind: 'test',
      control: dc,
      extra,
      gesture,
      axis: sceneAxis,
      pivotScreen,
      references: [[...dc.r0] as [number, number, number]],
    };
  }
}

/** The signed screen angle (radians, counter-clockwise on screen) swept around a pivot from the press to `e`. */
export function screenAngle(
  pivot: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): number {
  const a0 = Math.atan2(-(from.y - pivot.y), from.x - pivot.x);
  const a1 = Math.atan2(-(to.y - pivot.y), to.x - pivot.x);
  let angle = a1 - a0;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function linear(m: Mat4, v: Vec3): Vec3 {
  return [
    (m[0] as number) * v[0] + (m[4] as number) * v[1] + (m[8] as number) * v[2],
    (m[1] as number) * v[0] + (m[5] as number) * v[1] + (m[9] as number) * v[2],
    (m[2] as number) * v[0] + (m[6] as number) * v[1] + (m[10] as number) * v[2],
  ];
}

function multiply(a: Mat4, b: Float64Array, offset: number, out: Float64Array): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[offset + c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
}

function previewOf(edit: { readonly upserts: readonly JointRecord[] }): JointPreview {
  const out = new Map<JointId, Pick<JointRecord, 'restPosition' | 'restRotation' | 'tail'>>();
  for (const joint of edit.upserts) {
    out.set(joint.id, { restPosition: joint.restPosition, restRotation: joint.restRotation, tail: joint.tail });
  }
  return out;
}
