// The contract's marks on the time slider (CHARACTER-CONTRACT-SPEC §8.8; GAME-PROTOCOL-SPEC §4.5; C2): a lazy layer of
// the slider, loaded by the slider when the active clip holds a contract slot. For that clip and its slot it draws
// - the markers ◆ the slot declares (`contact`, `release`, `fire`, `footstep_l`, …) at the clip's frames, a hollow ◇
//   at a marker's target time while it is unset, and a dashed limit line at its `maxSecs` (the 0.15 s contact limit of
//   an edge-released slot);
// - the window bracket along the bottom: min … target … max of the slot's length, red where the clip runs past max
//   (and up to min when it is too short);
// - the lead-in band left of the first frame for a release of a held phase ("game wind-up plays first, 0.8 s").
// Dragging a ◆ moves the marker: the slider previews it, the release runs `target.marker.set` (one undo step).
import type { SliderLayout, TimelineTheme, TimeSliderController, TimeSliderLayer } from '@ekza-studio/curve-editor';
import type { ClipRecord } from '@ekza-studio/doc';
import { type EditorApp, loadTargetKit, PANEL, type TargetKit } from '@ekza-studio/editor-core';
import type { AnimationSlotSpec } from '@ekza-studio/io';

const MARKER_ROW = 14; // the ◆ row's centre below the top (CSS px)
const HIT_PX = 7;
const CONTACT = '#ffb547';
const OTHER = '#5ec8f2';
const WINDOW = 'rgba(126, 211, 138, 0.9)';
const OVER = 'rgba(239, 107, 107, 0.22)';
const LIMIT = 'rgba(239, 107, 107, 0.85)';
const LEAD = 'rgba(232, 176, 74, 0.28)';

interface Scene {
  readonly clip: ClipRecord;
  readonly anim: AnimationSlotSpec;
  /** Marker frames (clip frames), set ones only. */
  readonly markers: Readonly<Record<string, number>>;
}

const fps = (clip: ClipRecord): number => clip.fps.num / clip.fps.den;
const xOf = (layout: SliderLayout, frame: number): number => layout.left + (frame - layout.start) * layout.scale;

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | null, line: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** The scene of the active clip, or null when it holds no slot of its character's contract target. */
function sceneOf(app: EditorApp, kit: TargetKit): Scene | null {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const id = character === null ? undefined : state.activeClip[character];
  const clip = id === undefined ? undefined : app.store.get('clips', id);
  if (clip === undefined || character === null || clip.slot === null) return null;
  const binding = kit.bindingOf(app, character);
  const anim = binding?.model?.slots[clip.slot]?.animation ?? null;
  if (anim === null) return null;
  return { clip, anim, markers: kit.clipMarkers(app.store, clip) };
}

/**
 * Attaches the layer to a slider (and its canvas, whose `data-contract-markers` lists the drawn markers for tests);
 * returns the detach function.
 */
export function attachContractLayer(
  app: EditorApp,
  slider: TimeSliderController,
  canvas: HTMLCanvasElement,
): () => void {
  let kit: TargetKit | null = null;
  let scene: Scene | null = null;
  /** A marker being dragged and its previewed frame. */
  let dragging: { readonly name: string; frame: number } | null = null;
  let shown: string | null = null;

  const paint = (ctx: CanvasRenderingContext2D, layout: SliderLayout, theme: TimelineTheme): void => {
    if (scene === null) return;
    const { clip, anim } = scene;
    const rate = fps(clip);
    const start = clip.range.start;
    const h = layout.height;
    ctx.save();
    ctx.font = `9px ${theme.font}`;
    ctx.textBaseline = 'middle';
    // lead-in band (the game's wind-up before frame 0)
    if (anim.leadInSecs !== null && anim.leadInSecs > 0) {
      const right = xOf(layout, start);
      const left = Math.max(0, xOf(layout, start - anim.leadInSecs * rate));
      ctx.fillStyle = LEAD;
      ctx.fillRect(left, 0, right - left, h);
      ctx.fillStyle = theme.label;
      if (right - left > 34) ctx.fillText(`wind-up ${anim.leadInSecs.toFixed(2)} s`, left + 2, h - 8);
    }
    // the window bracket
    const at = (secs: number) => xOf(layout, start + secs * rate);
    const y = h - 2.5;
    const end = xOf(layout, clip.range.end);
    ctx.fillStyle = OVER;
    if (end > at(anim.window.maxSecs)) ctx.fillRect(at(anim.window.maxSecs), 0, end - at(anim.window.maxSecs), h);
    if (end < at(anim.window.minSecs)) ctx.fillRect(end, h - 5, at(anim.window.minSecs) - end, 5);
    ctx.strokeStyle = WINDOW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at(anim.window.minSecs), y);
    ctx.lineTo(at(anim.window.maxSecs), y);
    for (const secs of [anim.window.minSecs, anim.window.maxSecs]) {
      ctx.moveTo(at(secs), y);
      ctx.lineTo(at(secs), y - 5);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(at(anim.window.targetSecs), y + 1);
    ctx.lineTo(at(anim.window.targetSecs), y - 8);
    ctx.stroke();
    // markers: limit lines, targets, the clip's ◆
    const drawn: Record<string, number> = {};
    for (const [name, marker] of Object.entries(anim.markers)) {
      const color = name === 'contact' ? CONTACT : OTHER;
      if (marker.maxSecs !== null) {
        ctx.strokeStyle = LIMIT;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(at(marker.maxSecs), MARKER_ROW - 6);
        ctx.lineTo(at(marker.maxSecs), h - 6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const frame = dragging?.name === name ? dragging.frame : scene.markers[name];
      if (frame === undefined) {
        if (marker.targetSecs !== null) diamond(ctx, at(marker.targetSecs), MARKER_ROW, 4, null, color);
        continue;
      }
      drawn[name] = frame;
      const x = xOf(layout, frame);
      diamond(ctx, x, MARKER_ROW, 5, color, theme.background);
      if (name !== 'contact') {
        ctx.fillStyle = color;
        ctx.fillText(name.replace(/_/g, ' '), x + 7, MARKER_ROW);
      }
    }
    ctx.restore();
    const text = JSON.stringify(drawn);
    if (text !== shown) {
      shown = text;
      canvas.dataset['contractMarkers'] = text;
    }
  };

  const grab = (x: number, y: number, layout: SliderLayout): ((frame: number, done: boolean) => void) | null => {
    if (scene === null || y > MARKER_ROW + 9) return null;
    const { clip } = scene;
    let best: { name: string; distance: number } | null = null;
    for (const [name, frame] of Object.entries(scene.markers)) {
      if (!(name in scene.anim.markers)) continue;
      const distance = Math.abs(xOf(layout, frame) - x);
      if (distance <= HIT_PX && (best === null || distance < best.distance)) best = { name, distance };
    }
    if (best === null) return null;
    const name = best.name;
    const from = scene.markers[name] as number;
    dragging = { name, frame: from };
    return (frame, done) => {
      const clamped = Math.min(Math.max(Math.round(frame), clip.range.start), clip.range.end);
      if (!done) {
        if (dragging !== null) dragging.frame = Number.isFinite(clamped) ? clamped : from;
        return;
      }
      dragging = null;
      if (Number.isFinite(frame) && clamped !== from) {
        void app.run('target.marker.set', { clip: clip.id, marker: name, frame: clamped }, { panel: PANEL.timeline });
      }
      drawnKey = '';
      slider.setLayer(layer);
    };
  };

  const layer: TimeSliderLayer = { paint, grab };
  let drawnKey = '';
  const refresh = (): void => {
    if (kit === null || dragging !== null) return;
    const next = sceneOf(app, kit);
    // repaint only when what the layer draws changed (a key drag changes the document, not the marks)
    const key =
      next === null ? '' : JSON.stringify([next.clip.id, next.clip.range, next.clip.fps, next.anim, next.markers]);
    if (key === drawnKey && (next === null) === (scene === null)) return;
    drawnKey = key;
    scene = next;
    if (scene === null) {
      delete canvas.dataset['contractMarkers'];
      shown = null;
    }
    slider.setLayer(scene === null ? null : layer);
  };
  let active = '';
  const onSession = (): void => {
    const state = app.session.getState();
    const key = `${state.activeCharacter}:${state.activeCharacter === null ? '' : state.activeClip[state.activeCharacter]}`;
    if (key === active) return;
    active = key;
    refresh();
  };
  let live = true;
  loadTargetKit(app).then(
    (loaded) => {
      if (!live) return;
      kit = loaded;
      refresh();
    },
    () => {
      // the target chunk did not load: the slider stays without the contract's marks
    },
  );
  const offSession = app.session.subscribe(onSession);
  const offStore = app.store.subscribe(refresh);
  return () => {
    live = false;
    offSession();
    offStore();
    slider.setLayer(null);
  };
}
