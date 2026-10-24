// Reach (STUDIO-TOUCH-SPEC §10.1, D6, ST-T7-4; T7): with a hand or a foot selected, dragging the part itself moves its
// IK goal and the limb follows. On lift the public wrapper `pose.reach` runs once over `pose.goals` (T5a): one drag is
// one undo step, and with Rec on it keys every control it moved at the playhead. Dragging the turn ring still turns the
// joint (the press on the manipulator is the tool's).
//
// How the drag is taken: a press on the lead selected control (its shape or the mesh it drives, not the manipulator),
// held still and not yet a long-press, travels past the slop; at that moment Reach takes the pointer — the arbiter's
// buffered press is cancelled (a `pointercancel` to the pane, so no tool and no orbit ever saw it) and the rest of the
// gesture is Reach's. A tap stays the grammar's (it reopens the Halo), a long-press its ring, two fingers navigation.
//
// The goal moves on the plane through the hand that faces the camera. While dragging, a ring marks where the hand
// goes (the limb follows on lift: the solved preview needs `solveReach` exported from the wrappers' chunk, P-T7-1).
// Head and hips are not reachable yet (`pose.goals` has no spine solve, P-T5A-5): they turn with the ring. A limb in FK
// at the playhead keeps its own drag (ST-T7-4): `pose.reach` would switch it to IK over a time band only; *Hand leads*
// makes the limb Reach.
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import { type EditorApp, limbOfControlApp } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import type { ShellContext } from '../../shell/context';
import { PANE } from '../../shell/stage';
import { activeClip, reachLimbOf } from './model';

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

const SLOP = { touch: 10, pen: 4, mouse: 3 } as const;

/** q · v (a unit quaternion rotating a vector). */
export function rotate(q: Quat, v: Vec3): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): [number, number, number] => [a[0] * k, a[1] * k, a[2] * k];

/** A placement (`CharacterRecord.placement`) as a map from character space to the scene, and back. */
export interface Placement {
  readonly t: Vec3;
  readonly q: Quat;
  readonly s: Vec3;
}

export function toScene(p: Placement, v: Vec3): [number, number, number] {
  return add(p.t, rotate(p.q, [v[0] * p.s[0], v[1] * p.s[1], v[2] * p.s[2]]));
}

export function toCharacter(p: Placement, v: Vec3): [number, number, number] {
  const local = rotate(conj(p.q), sub(v, p.t));
  return [local[0] / (p.s[0] || 1), local[1] / (p.s[1] || 1), local[2] / (p.s[2] || 1)];
}

/**
 * The scene point under a screen offset (dx, dy), on the camera-facing plane through `origin`: the plane's right and
 * up axes are the camera's; their screen images (from `project`) give the 2 × 2 map, inverted.
 */
export function planePoint(
  origin: Vec3,
  camera: Quat,
  project: (p: Vec3) => { readonly x: number; readonly y: number } | null,
  dx: number,
  dy: number,
): [number, number, number] | null {
  const right = rotate(camera, [1, 0, 0]);
  const up = rotate(camera, [0, 1, 0]);
  const unit = 0.1;
  const s0 = project(origin);
  const sr = project(add(origin, scale(right, unit)));
  const su = project(add(origin, scale(up, unit)));
  if (s0 === null || sr === null || su === null) return null;
  const a = (sr.x - s0.x) / unit;
  const b = (su.x - s0.x) / unit;
  const c = (sr.y - s0.y) / unit;
  const d = (su.y - s0.y) / unit;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  const r = (d * dx - b * dy) / det;
  const u = (-c * dx + a * dy) / det;
  return add(add(origin, scale(right, r)), scale(up, u));
}

interface Candidate {
  readonly pointerId: number;
  readonly type: keyof typeof SLOP;
  readonly clientX: number;
  readonly clientY: number;
  readonly pane: Element;
  readonly control: ControlId;
  readonly limb: string;
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly placement: Placement;
  /** The hand's position at the press, in the scene. */
  readonly origin: Vec3;
  stolen: boolean;
  target: [number, number, number] | null;
}

/** The scene position of a limb's end (hand or foot) in the current pose, with the character's placement. */
function endOf(
  app: EditorApp,
  control: ControlId,
): { origin: Vec3; placement: Placement; character: CharacterId } | null {
  const record = app.store.get('controls', control);
  const character = record === undefined ? undefined : app.store.get('rigs', record.rig)?.character;
  if (character === undefined) return null;
  const runtime = app.characters.get(character);
  const limb = limbOfControlApp(app, control);
  if (runtime === undefined || limb === null) return null;
  const end = limb.nodes.end;
  const m = runtime.pose.boneWorld;
  if (m.length < end * 16 + 16) return null;
  const local: Vec3 = [m[end * 16 + 12] as number, m[end * 16 + 13] as number, m[end * 16 + 14] as number];
  const place = app.store.get('characters', character)?.placement;
  const placement: Placement =
    place === undefined
      ? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }
      : { t: [...place.t] as unknown as Vec3, q: [...place.q] as unknown as Quat, s: [...place.s] as unknown as Vec3 };
  return { origin: toScene(placement, local), placement, character };
}

function marker(root: Element | null): HTMLElement | null {
  if (root === null || typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-testid', 'halo-reach-marker');
  el.setAttribute('data-halo-uncounted', '');
  el.style.cssText =
    'position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;pointer-events:none;' +
    'border:3px solid var(--accent,#7c5cff);box-shadow:0 0 0 2px rgba(0,0,0,.35);z-index:5;';
  root.appendChild(el);
  return el;
}

/**
 * Installs Reach on the page (a capture listener on the document, ahead of the pane's own listeners); the disposer
 * removes it. `count` adds one touch to the journeys' counter (one drag).
 */
export function installReach(ctx: ShellContext, count: () => void): () => void {
  const { app, store } = ctx;
  let candidate: Candidate | null = null;
  /** A press on a handle or a selected thing that is not Reach's: one touch when it drags (the ring, a move arrow). */
  let toolDrag: { readonly pointerId: number; readonly x: number; readonly y: number; readonly slop: number } | null =
    null;
  /**
   * A tap on the manipulator over another body part (the forearm under the upper arm's turn ring): a ring is for
   * dragging, so the tap selects what lies under it — as a tap anywhere else on the body does (§6.1 "tap = select").
   */
  let ringTap: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly time: number;
    readonly slop: number;
    readonly under: ControlId;
  } | null = null;
  let mark: HTMLElement | null = null;
  /** True while Reach sends its own `pointercancel` to the pane (its listeners must not take it for the finger's). */
  let cancelling = false;
  const touches = new Set<number>();

  const clear = (): void => {
    candidate = null;
    mark?.remove();
    mark = null;
    if (store.get().breathing) store.set({ breathing: false });
  };

  const paneOf = (e: PointerEvent): Element | null => {
    const target = e.target instanceof Element ? e.target : null;
    return target?.closest(`[data-ekza-pane="${PANE}"]`) ?? null;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') touches.add(e.pointerId);
    if (candidate !== null) {
      // a second pointer before the drag was taken: it is navigation, not Reach
      if (!candidate.stolen) candidate = null;
      return;
    }
    const ui = store.get();
    if (ui.stage !== 'animate' || ui.target !== null || ui.home) return;
    const pane = paneOf(e);
    if (pane === null) return;
    const type = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    if (type === 'mouse' && (e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)) return;
    if (type === 'touch' && touches.size > 1) return;
    const vm: ViewportManager | null = ctx.vm();
    const rect = vm?.paneRect(PANE) ?? null;
    if (vm === null || rect === null) return;
    const x = e.clientX - rect.x;
    const y = e.clientY - rect.y;
    const hit = vm.pick(PANE, x, y);
    const control = hit?.kind === 'control' ? hit.control : hit?.kind === 'mesh' ? hit.control : null;
    const selected = app.session.getState().selection.controls;
    if (hit?.kind === 'manipulator' || (control !== null && selected.includes(control))) {
      toolDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, slop: SLOP[type] };
    }
    if (hit?.kind === 'manipulator') {
      // the nearest body part under the ring; a tap on the selected one stays the grammar's (it reopens its Halo)
      const first = vm
        .pickCandidates(PANE, x, y)
        .map((c) => (c.kind === 'control' ? c.control : c.kind === 'mesh' ? c.control : null))
        .find((id): id is ControlId => id !== null);
      const under = first === undefined || selected.includes(first) ? undefined : first;
      ringTap =
        under === undefined
          ? null
          : { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp, slop: SLOP[type], under };
    }
    if (hit === null || hit.kind === 'manipulator') return;
    const lead = selected.at(-1) ?? null;
    if (control === null || control !== lead) return;
    const limb = reachLimbOf(app, lead);
    const clip = activeClip(app);
    if (limb === null || clip === null) return;
    const end = endOf(app, lead);
    if (end === null || end.character !== clip.character) return;
    // an FK limb here keeps its own drag (the goal would switch it to IK over a band only, P-T5A-5); *Hand leads*
    // makes it Reach
    if ((app.evaluation.ikFk(end.character, limb as never) ?? 0) < 0.5) return;
    candidate = {
      pointerId: e.pointerId,
      type,
      clientX: e.clientX,
      clientY: e.clientY,
      pane,
      control: lead,
      limb,
      character: end.character,
      clip: clip.id,
      placement: end.placement,
      origin: end.origin,
      stolen: false,
      target: null,
    };
  };

  const onMove = (e: PointerEvent): void => {
    const current = candidate;
    if (current === null || e.pointerId !== current.pointerId) return;
    const dx = e.clientX - current.clientX;
    const dy = e.clientY - current.clientY;
    if (!current.stolen) {
      if (Math.hypot(dx, dy) < SLOP[current.type]) return;
      // a long-press already opened the ring: the drag is its flick
      if (store.get().halo?.mode === 'ring') {
        candidate = null;
        return;
      }
      current.stolen = true;
      e.stopPropagation();
      e.preventDefault();
      // the arbiter drops its buffered press (nothing was delivered yet); a mouse's tool press is cancelled
      cancelling = true;
      try {
        current.pane.dispatchEvent(
          new PointerEvent('pointercancel', {
            bubbles: true,
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            clientX: e.clientX,
            clientY: e.clientY,
            isPrimary: e.isPrimary,
          }),
        );
      } finally {
        cancelling = false;
      }
      store.set({ breathing: true, halo: null });
      mark = marker(current.pane.parentElement);
    }
    e.stopPropagation();
    e.preventDefault();
    const vm = ctx.vm();
    if (vm === null) return;
    const camera = vm.camera(PANE).quaternion as unknown as Quat;
    const target = planePoint(current.origin, camera, (p) => vm.project(PANE, p), dx, dy);
    if (target === null) return;
    current.target = target;
    const rect = vm.paneRect(PANE);
    const screen = vm.project(PANE, target);
    if (mark !== null && rect !== null && screen !== null) {
      mark.style.left = `${screen.x + (current.pane as HTMLElement).offsetLeft}px`;
      mark.style.top = `${screen.y + (current.pane as HTMLElement).offsetTop}px`;
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (cancelling) return;
    touches.delete(e.pointerId);
    const tap = ringTap;
    if (tap !== null && tap.pointerId === e.pointerId) {
      ringTap = null;
      const still = Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < tap.slop;
      if (still && e.type === 'pointerup' && e.timeStamp - tap.time < 450 && store.get().halo?.mode !== 'ring') {
        const add = store.get().thumb.latch !== 'off';
        // after the grammar's own tap (the tool saw a press on its handle and kept the selection)
        setTimeout(() => {
          void ctx.run('select.controls', { ids: [tap.under], mode: add ? 'add' : 'replace' });
        }, 0);
      }
    }
    const drag = toolDrag;
    if (drag !== null && drag.pointerId === e.pointerId) {
      toolDrag = null;
      const stolen = candidate?.pointerId === e.pointerId && candidate.stolen;
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= drag.slop;
      // the tool's drag (a turn, a move): one touch; a ring's flick was counted by the grammar
      if (!stolen && moved && e.type === 'pointerup' && store.get().halo?.mode !== 'ring') count();
    }
    const current = candidate;
    if (current === null || e.pointerId !== current.pointerId) return;
    if (!current.stolen) {
      candidate = null;
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const target = current.target;
    clear();
    if (e.type === 'pointercancel' || target === null) return;
    count();
    const position = toCharacter(current.placement, target);
    void ctx.run('pose.reach', { position, limb: current.limb, clip: current.clip });
  };

  const options = { capture: true } as const;
  document.addEventListener('pointerdown', onDown, options);
  document.addEventListener('pointermove', onMove, options);
  document.addEventListener('pointerup', onUp, options);
  document.addEventListener('pointercancel', onUp, options);
  return () => {
    document.removeEventListener('pointerdown', onDown, options);
    document.removeEventListener('pointermove', onMove, options);
    document.removeEventListener('pointerup', onUp, options);
    document.removeEventListener('pointercancel', onUp, options);
    clear();
  };
}
