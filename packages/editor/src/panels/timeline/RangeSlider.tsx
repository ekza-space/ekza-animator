// Range slider (research 09 §4.9): [clip start][play start] ━━[ playback range ]━━ [play end][clip end]. The outer
// fields edit the clip's range (`clip.setSettings`, undoable); the inner fields and the bar edit the playback range
// (`time.setPlaybackRange`, session state in scene frames). Dragging the bar's ends moves one end, its middle shifts
// the range; double-click toggles between the whole clip and the last custom range.
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { ClipRecord } from '@ekza-studio/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-studio/editor-core';
import { type JSX, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { useSession } from '../../hooks';
import { FrameInput } from './fields';
import { clipToScene, sceneToClip } from './input';

interface Range {
  readonly start: Frame;
  readonly end: Frame;
}

type DragPart = 'start' | 'end' | 'middle';
interface Drag {
  readonly part: DragPart;
  readonly pointerId: number;
  readonly originX: number;
  readonly range: Range;
  /** Frames per CSS px of the track. */
  readonly framesPerPx: number;
  last: Range;
}

const HANDLE_PX = 6;
const selectPlaybackRange = (s: SessionState): SessionState['time']['playbackRange'] => s.time.playbackRange;

/** The playback range in whole clip frames (the clip range when none is set). */
export function playbackInClip(sceneFps: Fps, clip: ClipRecord, scene: Range | null): Range {
  if (scene === null) return clip.range;
  const a = Math.round(sceneToClip(sceneFps, clip, scene.start));
  const b = Math.round(sceneToClip(sceneFps, clip, scene.end));
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function RangeSlider(props: {
  readonly app: EditorApp;
  readonly clip: ClipRecord | null;
  readonly sceneFps: Fps;
}): JSX.Element {
  const { app, clip, sceneFps } = props;
  const sceneRange = useSession(selectPlaybackRange);
  const [preview, setPreview] = useState<Range | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastCustom = useRef<Range | null>(null);

  if (clip === null) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1 text-fg-3" data-testid="timeline-range">
        <span className="truncate px-1">No active clip</span>
      </div>
    );
  }

  const playback = preview ?? playbackInClip(sceneFps, clip, sceneRange);
  const track: Range = {
    start: Math.min(clip.range.start, playback.start),
    end: Math.max(clip.range.end, playback.end, Math.min(clip.range.start, playback.start) + 1),
  };
  const span = track.end - track.start;
  const percent = (frame: Frame): number => ((frame - track.start) / span) * 100;

  const setPlayback = (range: Range | null): void => {
    const scene =
      range === null
        ? null
        : { start: clipToScene(sceneFps, clip, range.start), end: clipToScene(sceneFps, clip, range.end) };
    void app.run('time.setPlaybackRange', { range: scene }, { panel: PANEL.timeline });
  };
  /** Keeps a playback range inside the clip range and at least one frame long, moving only the edited end. */
  const clampToClip = (range: Range, edited: 'start' | 'end'): Range => {
    const lo = clip.range.start;
    const hi = clip.range.end;
    if (edited === 'start') {
      const end = Math.min(Math.max(range.end, lo + 1), hi);
      return { start: Math.min(Math.max(range.start, lo), end - 1), end };
    }
    const start = Math.min(Math.max(range.start, lo), hi - 1);
    return { start, end: Math.min(Math.max(range.end, start + 1), hi) };
  };
  const commitPlayback = (range: Range): void => {
    if (range.end <= range.start) return;
    const whole = range.start === clip.range.start && range.end === clip.range.end;
    if (!whole) lastCustom.current = range;
    setPlayback(whole ? null : range);
  };
  const commitClipRange = (range: Range): void => {
    const start = Math.round(range.start);
    const end = Math.round(range.end);
    if (end <= start) return;
    void app.run('clip.setSettings', { clip: clip.id, range: { start, end } }, { panel: PANEL.timeline });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const bar = e.currentTarget.getBoundingClientRect();
    if (bar.width <= 0) return;
    const x = e.clientX - bar.left;
    const startX = (percent(playback.start) / 100) * bar.width;
    const endX = (percent(playback.end) / 100) * bar.width;
    let part: DragPart | null = null;
    if (Math.abs(x - startX) <= HANDLE_PX && x <= (startX + endX) / 2) part = 'start';
    else if (Math.abs(x - endX) <= HANDLE_PX) part = 'end';
    else if (x > startX && x < endX) part = 'middle';
    if (part === null) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    drag.current = {
      part,
      pointerId: e.pointerId,
      originX: e.clientX,
      range: playback,
      framesPerPx: span / bar.width,
      last: playback,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || e.pointerId !== current.pointerId) return;
    const { start, end } = current.range;
    const delta = Math.round((e.clientX - current.originX) * current.framesPerPx);
    let next: Range;
    if (current.part === 'start') next = clampToClip({ start: start + delta, end }, 'start');
    else if (current.part === 'end') next = clampToClip({ start, end: end + delta }, 'end');
    else {
      const shift = Math.min(Math.max(delta, clip.range.start - start), clip.range.end - end);
      next = { start: start + shift, end: end + shift };
    }
    if (next.start === current.last.start && next.end === current.last.end) return;
    current.last = next;
    setPreview(next);
    commitPlayback(next);
  };

  const endDrag = (): void => {
    drag.current = null;
    setPreview(null);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" data-testid="timeline-range">
      <FrameInput
        value={clip.range.start}
        label="Clip start"
        testId="timeline-range-clip-start"
        onCommit={(start) => commitClipRange({ start, end: clip.range.end })}
      />
      <FrameInput
        value={playback.start}
        label="Playback start"
        testId="timeline-range-play-start"
        onCommit={(start) => commitPlayback(clampToClip({ start: Math.round(start), end: playback.end }, 'start'))}
      />
      {/* Pointer-only shortcut for the four fields around it, which are the accessible way to edit the ranges. */}
      <div
        aria-hidden="true"
        title={`Playback range ${playback.start}–${playback.end} (drag; double-click: whole clip)`}
        data-testid="timeline-range-bar"
        className="relative h-[18px] min-w-16 flex-1 touch-none rounded-[3px] bg-app"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => {
          if (sceneRange !== null) setPlayback(null);
          else if (lastCustom.current !== null) setPlayback(lastCustom.current);
        }}
      >
        <div
          className="absolute inset-y-[2px] cursor-grab rounded-[2px] border-x-[3px] border-fg-3 bg-header hover:border-fg-2"
          data-testid="timeline-range-thumb"
          style={{
            left: `${percent(playback.start)}%`,
            width: `${Math.max(percent(playback.end) - percent(playback.start), 0)}%`,
          }}
        >
          <span className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden font-mono text-[10px] tabular-nums text-fg-3">
            {playback.start} – {playback.end}
          </span>
        </div>
      </div>
      <FrameInput
        value={playback.end}
        label="Playback end"
        testId="timeline-range-play-end"
        onCommit={(end) => commitPlayback(clampToClip({ start: playback.start, end: Math.round(end) }, 'end'))}
      />
      <FrameInput
        value={clip.range.end}
        label="Clip end"
        testId="timeline-range-clip-end"
        onCommit={(end) => commitClipRange({ start: clip.range.start, end })}
      />
    </div>
  );
}
