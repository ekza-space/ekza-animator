// The Thread's layer 2, Curves (STUDIO-TOUCH-SPEC §10.5, §5.2.1, §4.2 wireframe D; T10): Studio Pro's own
// `GraphEditorController` behind the curve editor's touch adapter (`attachGraphEditorTouch`, §20.3 item 8), drawn at
// its own size and shown 1.8× larger (the Keys layer's scale), registered in the shared focus registry
// (`attachGraphEditor`, §20.3 item 18) so `graph.frame`, `select.curveKeys` and `graph.view.setMode` act on it as on
// Pro's Graph Editor. A lazy chunk: the curve editor never loads with `/app`'s first scripts (§20.6).
// - The header: the active animation, the listed parts and their channel chips (*Move Y* alone in one tap; the
//   Thumb key's *Select more* adds one), *Only keyed* and a filter when several parts are listed, and ⇆ Before (hold:
//   the curves as they were when Curves opened — a buffer snapshot taken automatically, Snapshot · Swap · Clear in
//   More). Then *Select · Move · Insert · Scale* (`view.tool {panel: 'graph'}`), the ⟨Axis⟩ chip and the key Halo,
//   docked here (§4.1: in Keys and Curves the Halo docks in the layer header, never over the keys it edits).
// - The curves: one finger or the Pencil — a drag on empty space is a marquee, on a key or handle it moves it (one
//   axis by default, §10.5); two fingers pan, pinch time and values; a double-tap frames; a long-press on a key docks
//   its Halo. The time axis under them reads frames by default and seconds under Settings › Time (ST-T7-UNIT), drawn
//   like the Thread's ruler (ST-T10-RULER); tap or drag it to move the playhead.
// - The foot: the selected keys' ⟨Time⟩ ⟨Value⟩ ⟨In⟩ ⟨Out⟩ chips and the curve's Halo (*Ease all ▾ · Fewer keys · Fix
//   flips · Cycle ▾ · Insert key · ⋯*).
import {
  attachGraphEditor,
  attachGraphEditorTouch,
  focusGraphEditor,
  type GraphAxis,
  GraphEditorController,
} from '@ekza-studio/curve-editor';
import type { CurveId } from '@ekza-studio/doc';
import { GRAPH_TOOL, PANEL } from '@ekza-studio/editor-core';
import { ActionChip, Cluster, Segmented, ToggleChip, thumbReduce } from '@ekza-studio/ui/touch';
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { useDocumentVersion, useSessionValue } from '../../shell/hooks';
import { DockedHalo } from '../../stages/animate/DockedHalo';
import { AnimateGlyph } from '../../stages/animate/icons';
import { type AnimateUiStore, useAnimateUi } from '../../stages/animate/ui';
import { currentFrame, rulerMarks, secondsLabel, type StripLayout, threadContext } from '../strip/model';
import { type TimeUnit, useTimeUnit } from '../units';
import { CurveHalo } from './CurveHalo';
import { KeyChips } from './KeyChips';
import {
  channelChips,
  chipSelection,
  curveRows,
  filteredRows,
  firstKeyFrame,
  keyNumbers,
  listedControls,
  selectedKeyCount,
  shownCurves,
} from './model';
import { provideCurvesProbe } from './probe';

const w = animateWords.curves;

/** The controller's canvas is shown this much larger (the Keys layer's 36 pt rows of 20 px, §10.4). */
export const CURVES_SCALE = 1.8;
const AXIS_HEIGHT = 24;
const AXES: readonly GraphAxis[] = ['auto', 'time', 'value', 'free'];

type GraphTool = (typeof GRAPH_TOOL)[keyof typeof GRAPH_TOOL];
const TOOLS: readonly { readonly value: GraphTool; readonly label: string }[] = [
  { value: GRAPH_TOOL.select, label: w.tools.select },
  { value: GRAPH_TOOL.move, label: w.tools.move },
  { value: GRAPH_TOOL.insert, label: w.tools.insert },
  { value: GRAPH_TOOL.scale, label: w.tools.scale },
];

const chipClass =
  'inline-flex h-(--touch-hit) min-w-(--touch-hit) shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 text-touch font-medium text-fg-2 shadow-touch hover:text-fg active:bg-pressed aria-pressed:border-accent/60 aria-pressed:bg-accent-soft aria-pressed:text-fg';

function cssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** The time axis's mapping from the controller's view (shown px). */
function axisLayout(graph: GraphEditorController, width: number): StripLayout {
  const { f0, sx } = graph.view;
  const perFrame = Math.max(1e-6, sx * CURVES_SCALE);
  return { x0: 0, x1: width, start: f0, end: f0 + width / perFrame };
}

export default function CurvesLayer({
  controller,
  ui,
  height,
  compact = false,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly height: number;
  /** A phone-sized frame: rows scroll sideways and the docked Halo takes its own row. */
  readonly compact?: boolean;
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const version = useDocumentVersion(app);
  const selection = useSessionValue(app, (s) => s.selection);
  const tool = useSessionValue(app, (s) => s.tools.graph) as GraphTool;
  const sceneFrame = useSessionValue(app, (s) => s.time.sceneFrame);
  const units = useTimeUnit(controller);
  const docked = useAnimateUi(ui, (s) => s.docked);
  const [axis, setAxis] = useState<GraphAxis>('auto');
  const [compare, setCompare] = useState(false);
  const [onlyAnimated, setOnlyAnimated] = useState(false);
  const [filter, setFilter] = useState('');
  const [focus, setFocus] = useState<CurveId | null>(null);
  const [graph, setGraph] = useState<GraphEditorController | null>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const axisRef = useRef<HTMLCanvasElement>(null);
  const axisMode = useRef<GraphAxis>(axis);
  axisMode.current = axis;
  const unitsRef = useRef<TimeUnit>(units);
  unitsRef.current = units;
  const count = useCallback((): void => store.set((s) => ({ touches: s.touches + 1 })), [store]);
  /** The Thumb key's one-shot meaning is used up by the gesture that used it (§5.5). */
  const consumeThumb = useCallback((): void => {
    const thumb = store.get().thumb;
    if (thumb.latch === 'once') store.set({ thumb: thumbReduce(thumb, { type: 'consume' }) });
  }, [store]);

  const thread = threadContext(app);
  // the document and the selection decide what is listed (re-read on every change)
  const listed = useMemo(
    () => {
      if (thread === null) return { controls: [] as const, rows: [] as const };
      const controls = listedControls(app, thread);
      return { controls, rows: filteredRows(app, curveRows(app, thread, controls), { onlyAnimated, filter }) };
    },
    // oxlint-disable-next-line react/exhaustive-deps -- `version` and the selection stand for the document's changes
    [app, thread?.clip.id, version, selection.controls, onlyAnimated, filter],
  );
  const chips = channelChips(app, listed.rows, selection.channels);
  const shown = shownCurves(listed.rows, selection.channels);
  const shownKey = shown.join(',');
  const numbers = useMemo(
    () => keyNumbers(app),
    // oxlint-disable-next-line react/exhaustive-deps -- the selection and the document decide the numbers
    [app, selection.keys, version],
  );

  // ---------- the time axis (drawn like the Thread's ruler, in Settings › Time's unit) ----------
  const drawAxis = useRef<() => void>(() => undefined);
  const kick = useRef<() => void>(() => undefined);
  useEffect(() => {
    const canvas = axisRef.current;
    const g = canvas?.getContext('2d') ?? null;
    if (canvas === null || g === null || graph === null) return undefined;
    let last = '';
    let frames = 0;
    let raf = 0;
    const draw = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const h = rect.height;
      const dpr = window.devicePixelRatio || 1;
      const t = threadContext(app);
      const frame = Math.round(currentFrame(app, t));
      const signature = `${width}|${h}|${dpr}|${JSON.stringify(graph.view)}|${frame}|${unitsRef.current}|${t?.clip.id}`;
      if (signature === last) return;
      last = signature;
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.max(1, Math.round(width * dpr));
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, h);
      if (t === null || width <= 0) return;
      const layout = axisLayout(graph, width);
      g.font = `500 11px ${cssVar(canvas, '--font-mono', 'ui-monospace, monospace')}`;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      const marks = rulerMarks(layout, width, t.range, t.fps, unitsRef.current, (text) => g.measureText(text).width);
      const toX = (f: number): number => ((f - layout.start) / (layout.end - layout.start)) * width;
      const tick = cssVar(canvas, '--text-3', '#969ba6');
      const minor = cssVar(canvas, '--grid-major', '#4b4e58');
      for (const level of [0, 1, 2] as const) {
        g.fillStyle = level === 0 ? minor : tick;
        g.beginPath();
        for (const m of marks.ticks)
          if (m.level === level) g.rect(Math.round(toX(m.frame) * dpr) / dpr, 0, 1, [4, 7, 10][level] as number);
        g.fill();
      }
      const px = toX(frame);
      const headText = unitsRef.current === 'frames' ? String(frame) : secondsLabel(frame, t.fps);
      const box = Math.ceil(g.measureText(headText).width) + 8;
      const bx = Math.min(Math.max(px - box / 2, 0), Math.max(width - box, 0));
      g.fillStyle = tick;
      for (const label of marks.labels) {
        if (label.left + label.width + 2 > bx && bx + box + 2 > label.left && px >= 0 && px <= width) continue;
        g.fillText(label.text, label.left, h - 4);
      }
      if (px >= 0 && px <= width) {
        g.fillStyle = cssVar(canvas, '--playhead', '#ff8a3d');
        g.fillRect(Math.round(px) - 1, 0, 2, h);
        g.beginPath();
        g.roundRect(bx, h - 16, box, 16, 3);
        g.fill();
        g.fillStyle = cssVar(canvas, '--bg-app', '#1b1c1f');
        g.textAlign = 'center';
        g.fillText(headText, bx + box / 2, h - 4);
      }
      canvas.dataset['labels'] = JSON.stringify(marks.labels.map((l) => [l.frame, l.text]));
    };
    drawAxis.current = draw;
    // a change can reach the controller's view on its next frames (it frames newly shown curves): look a few times
    const loop = (): void => {
      raf = 0;
      draw();
      if (frames-- > 0) raf = requestAnimationFrame(loop);
    };
    kick.current = () => {
      frames = 4;
      if (raf === 0) raf = requestAnimationFrame(loop);
    };
    kick.current();
    const offSession = app.session.subscribe(() => kick.current());
    const offStore = app.store.subscribe(() => kick.current());
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => kick.current());
    observer?.observe(canvas);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      offSession();
      offStore();
      observer?.disconnect();
      drawAxis.current = () => undefined;
      kick.current = () => undefined;
    };
  }, [app, graph]);
  useEffect(() => kick.current(), [units, sceneFrame]);

  // ---------- the controller, the focus registry and the touch adapter ----------
  useEffect(() => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (base === null || overlay === null) return undefined;
    const next = new GraphEditorController({ app, base, overlay });
    next.setFrameLabels(false);
    next.setShowBuffers(false);
    const handle = { controller: next, surface: overlay, scale: CURVES_SCALE };
    const detachFocus = attachGraphEditor(app, handle);
    const resize = (): void => {
      const rect = overlay.getBoundingClientRect();
      next.resize(rect.width / CURVES_SCALE, rect.height / CURVES_SCALE, (window.devicePixelRatio || 1) * CURVES_SCALE);
      next.redraw(true);
      kick.current();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(overlay);
    resize();
    const tap = (): void => {
      store.set((s) => ({ touches: s.touches + 1 }));
      consumeThumb();
    };
    const detach = attachGraphEditorTouch(next, overlay, {
      scale: CURVES_SCALE,
      modifiers: () => ({ shift: store.get().thumb.latch !== 'off', mod: false, alt: false }),
      axis: () => axisMode.current,
      onView: () => kick.current(),
      onPress: () => focusGraphEditor(app, handle),
      onTap: (hit) => {
        tap();
        setFocus(hit.kind === 'curve' || hit.kind === 'key' || hit.kind === 'handle' ? hit.curve : null);
      },
      onLongPress: (hit) => {
        tap();
        if (hit.kind === 'key') {
          setFocus(hit.curve);
          void ctx.run('select.keys', {
            items: [{ key: hit.key, parts: { key: true, in: false, out: false } }],
            mode: 'replace',
          });
        } else if (hit.kind === 'curve') setFocus(hit.curve);
      },
      onDrag: tap,
      // `graph.frame` on this layer's controller (the operator Pro's F / A run)
      frame: (what) => void ctx.run('graph.frame', { what }),
      onFrame: tap,
    });
    setGraph(next);
    return () => {
      detach();
      observer?.disconnect();
      detachFocus();
      next.dispose();
      setGraph(null);
    };
  }, [app, ctx, store, consumeThumb]);

  const framedKey = useRef<string | null>(null);
  useEffect(() => {
    if (graph === null) return;
    graph.setCurves(shown);
    // a new set of curves (a channel chip, another part) is framed whole, as a fresh Graph Editor frames its first set
    if (framedKey.current !== null && framedKey.current !== shownKey && shown.length > 0) graph.frame('all');
    framedKey.current = shownKey;
    kick.current();
    // oxlint-disable-next-line react/exhaustive-deps -- `shownKey` stands for `shown`
  }, [graph, shownKey]);

  useEffect(() => {
    graph?.setShowBuffers(compare);
  }, [graph, compare]);

  // ---------- ⇆ Before: the curves as they were when Curves opened (a session-only snapshot, §10.5) ----------
  const snapped = useRef<{ readonly ids: Set<string>; readonly at: Set<number> }>({ ids: new Set(), at: new Set() });
  useEffect(() => {
    if (graph === null || shown.length === 0) return;
    const missing = shown.filter((id) => !snapped.current.ids.has(id));
    if (missing.length === 0) return;
    for (const id of missing) snapped.current.ids.add(id);
    void app.runUntyped('graph.buffer.snapshot', { curves: missing }, { panel: PANEL.graph }).then(() => {
      for (const id of missing) {
        const buffer = app.session.getState().curveBuffers.get(id);
        if (buffer !== undefined) snapped.current.at.add(buffer.capturedAt);
      }
    });
    // oxlint-disable-next-line react/exhaustive-deps -- `shownKey` stands for `shown`
  }, [app, graph, shownKey]);
  useEffect(
    () => () => {
      // leaving Curves forgets the automatic snapshots (Pro's Graph Editor would draw them dashed), never the user's
      const buffers = app.session.getState().curveBuffers;
      const at = snapped.current.at;
      if (buffers.size > 0 && [...buffers.values()].every((buffer) => at.has(buffer.capturedAt))) {
        void app.runUntyped('graph.buffer.clear', undefined, { panel: PANEL.graph });
      }
    },
    [app],
  );

  // ---------- the key Halo docks in the header while keys are selected (§4.1) ----------
  useEffect(() => {
    const dock = (): void => {
      const n = selectedKeyCount(app);
      const docked = ui.get().docked;
      if (n > 0) {
        const frame = firstKeyFrame(app) ?? 0;
        if (docked?.kind !== 'keyDot' || docked.frame !== frame || docked.count !== n) {
          ui.set({ docked: { kind: 'keyDot', frame, count: n }, more: null });
        }
      } else if (docked?.kind === 'keyDot') ui.set({ docked: null, menu: null });
    };
    dock();
    return app.session.subscribe((next, previous) => {
      if (next.selection.keys !== previous.selection.keys) dock();
    });
  }, [app, ui]);

  // ---------- the test API's probe ----------
  const latest = useRef({ shown, chips, controls: listed.controls, numbers, compare });
  latest.current = { shown, chips, controls: listed.controls, numbers, compare };
  useEffect(() => {
    if (graph === null) return undefined;
    return provideCurvesProbe(controller, () => {
      const overlay = overlayRef.current;
      if (overlay === null) return null;
      graph.redraw();
      const rect = overlay.getBoundingClientRect();
      const page = (p: { readonly x: number; readonly y: number } | null) =>
        p === null ? null : { x: rect.left + p.x * CURVES_SCALE, y: rect.top + p.y * CURVES_SCALE };
      const now = latest.current;
      const keys: {
        id: string;
        curve: string;
        frame: number;
        value: number;
        x: number;
        y: number;
        selected: boolean;
      }[] = [];
      const picked = app.session.getState().selection.keys;
      for (const curve of now.shown) {
        for (const key of app.store.query.keysOfCurve(curve)) {
          if (keys.length >= 400) break;
          const at = page(graph.keyPoint(key.id));
          if (at === null) continue;
          keys.push({
            id: key.id,
            curve,
            frame: key.t,
            value: key.v,
            ...at,
            selected: picked.get(key.id)?.key === true,
          });
        }
      }
      // empty space: a grid search for a point with nothing under it
      let empty: { x: number; y: number } | null = null;
      const size = graph.size;
      for (let gy = 0.15; gy < 0.9 && empty === null; gy += 0.1) {
        for (let gx = 0.08; gx < 0.95 && empty === null; gx += 0.07) {
          const hit = graph.hitTest(size.width * gx, size.height * gy);
          if (hit.kind === 'none') empty = page({ x: size.width * gx, y: size.height * gy });
        }
      }
      const labels = JSON.parse(axisRef.current?.dataset['labels'] ?? '[]') as [number, string][];
      return {
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        scale: CURVES_SCALE,
        view: { ...graph.view },
        tool: app.session.getState().tools.graph,
        axis: axisMode.current,
        compare: now.compare,
        controls: now.controls.map((id) => app.store.get('controls', id)?.name ?? id),
        chips: now.chips.map((chip) => ({ channel: chip.channel, label: chip.label, chosen: chip.chosen })),
        curves: [...graph.curves],
        keys,
        empty,
        axisLabels: labels.map(([frame, text]) => ({ frame, text })),
        units: unitsRef.current,
        fields: {
          count: now.numbers.count,
          frame: now.numbers.frame,
          value: now.numbers.value,
          inAngle: now.numbers.inAngle,
          outAngle: now.numbers.outAngle,
          weighted: now.numbers.weighted,
        },
        buffered: [...app.session.getState().curveBuffers.keys()],
      };
    });
  }, [app, controller, graph]);

  // ---------- the time axis's own gestures: tap or drag moves the playhead ----------
  const scrub = useRef<{ id: number; moved: boolean } | null>(null);
  const axisFrame = (e: ReactPointerEvent<HTMLCanvasElement>): number | null => {
    const t = threadContext(app);
    if (graph === null || t === null) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const layout = axisLayout(graph, rect.width);
    const frame = layout.start + ((e.clientX - rect.left) / rect.width) * (layout.end - layout.start);
    return Math.min(t.range.end, Math.max(t.range.start, Math.round(frame)));
  };

  const character = thread?.character ?? null;
  const clip = thread?.clip ?? null;
  const partName =
    listed.controls.length === 1
      ? (app.store.get('controls', listed.controls[0] as never)?.name ?? '')
      : w.parts(listed.controls.length);
  const pickChip = (index: number): void => {
    const chip = chips[index];
    if (chip === undefined) return;
    count();
    // the Thumb key's *Select more* as it is at the tap
    const next = chipSelection(selection.channels, chip, chips, store.get().thumb.latch !== 'off');
    consumeThumb();
    void ctx.run('select.channels', { refs: next.refs, mode: next.mode });
  };
  const frame = thread === null ? 0 : currentFrame(app, thread);

  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-thread-curves"
      className="pointer-events-auto flex flex-col items-stretch gap-1.5 overflow-hidden p-[5px]"
      style={{ height }}
    >
      <div
        className={
          compact
            ? 'flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto'
            : 'flex min-w-0 shrink-0 flex-wrap items-center gap-1.5'
        }
        data-testid="halo-curves-header"
      >
        {clip !== null && character !== null ? (
          <button
            type="button"
            className={chipClass}
            aria-pressed
            aria-haspopup="menu"
            data-testid="halo-curves-clip"
            onClick={() => {
              count();
              ui.set({ docked: { kind: 'clip', clip: clip.id }, menu: null, more: null });
            }}
          >
            <span className="max-w-[140px] truncate">{clip.name}</span>
            <AnimateGlyph name="down" size={16} />
          </button>
        ) : null}
        <span className="max-w-[160px] truncate px-1 font-medium text-fg" data-testid="halo-curves-parts">
          {partName}
        </span>
        <fieldset
          className={`m-0 flex items-center gap-1.5 border-0 p-0 ${compact ? 'shrink-0 flex-nowrap' : 'min-w-0 flex-wrap'}`}
          aria-label={animateWords.curves.channels}
          data-testid="halo-curves-chips"
        >
          {chips.map((chip, index) => (
            <button
              key={chip.channel}
              type="button"
              className={chipClass}
              aria-pressed={chip.chosen}
              title={chip.pro}
              data-testid={`halo-curves-chip-${chip.label}`}
              onClick={() => pickChip(index)}
            >
              {chip.label}
            </button>
          ))}
        </fieldset>
        {listed.controls.length > 1 ? (
          <>
            <input
              type="search"
              aria-label={w.filter}
              placeholder={w.filterPlaceholder}
              value={filter}
              data-testid="halo-curves-filter"
              className="h-(--touch-hit) w-[150px] rounded-touch-inner border border-line bg-field px-3 text-(length:--touch-input-text) text-fg"
              onChange={(e) => setFilter(e.target.value)}
            />
            <ToggleChip
              label={w.onlyAnimated}
              pressed={onlyAnimated}
              data-testid="halo-curves-only-keyed"
              onPressedChange={(next) => {
                count();
                setOnlyAnimated(next);
              }}
            />
          </>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          className={chipClass}
          aria-pressed={compare}
          title={w.beforeHint}
          data-testid="halo-curves-before"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            count();
            setCompare(true);
          }}
          onPointerUp={() => setCompare(false)}
          onPointerCancel={() => setCompare(false)}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) setCompare(true);
          }}
          onKeyUp={() => setCompare(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {w.before}
        </button>
      </div>
      <div
        className={
          compact
            ? 'flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto'
            : 'flex min-w-0 shrink-0 flex-wrap items-center gap-1.5'
        }
        data-testid="halo-curves-tools"
      >
        <Segmented<GraphTool>
          label={w.toolLabel}
          data-testid="halo-curves-tool"
          value={TOOLS.some((t) => t.value === tool) ? tool : GRAPH_TOOL.select}
          onValueChange={(next) => {
            count();
            void ctx.run('view.tool', { panel: PANEL.graph, tool: next });
          }}
          items={TOOLS}
        />
        <ActionChip
          aria-label={`${w.axisLabel}: ${w.axes[axis]}`}
          data-testid="halo-curves-axis"
          onClick={() => {
            count();
            setAxis(AXES[(AXES.indexOf(axis) + 1) % AXES.length] as GraphAxis);
          }}
        >
          {w.axes[axis]}
        </ActionChip>
        {compact ? null : (
          <div className="min-w-0 flex-1" data-testid="halo-curves-docked">
            <DockedHalo controller={controller} ui={ui} />
            {docked === null ? <span className="px-2 text-fg-3">{w.keyHint}</span> : null}
          </div>
        )}
      </div>
      {compact && docked !== null ? (
        <div className="min-w-0 shrink-0" data-testid="halo-curves-docked">
          <DockedHalo controller={controller} ui={ui} compact />
        </div>
      ) : null}
      <div className="relative min-h-[72px] min-w-0 flex-1 overflow-hidden rounded-touch-inner">
        <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />
        <canvas
          ref={overlayRef}
          aria-label={w.canvas}
          data-testid="halo-curves-canvas"
          className="absolute inset-0 block h-full w-full touch-none select-none"
        />
        {shown.length === 0 ? (
          <p className="pointer-events-none absolute inset-0 m-0 flex items-center justify-center px-6 text-center text-fg-3">
            {w.none}
          </p>
        ) : null}
      </div>
      <canvas
        ref={axisRef}
        aria-label={w.timeAxis}
        data-testid="halo-curves-axis-strip"
        className="block w-full shrink-0 cursor-pointer touch-none select-none"
        style={{ height: AXIS_HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { id: e.pointerId, moved: false };
          const f = axisFrame(e);
          if (f !== null) void ctx.run('time.setFrame', { frame: f, unit: 'clip' });
        }}
        onPointerMove={(e) => {
          if (scrub.current?.id !== e.pointerId) return;
          scrub.current.moved = true;
          const f = axisFrame(e);
          if (f !== null) void ctx.run('time.setFrame', { frame: f, unit: 'clip' });
        }}
        onPointerUp={(e) => {
          if (scrub.current?.id !== e.pointerId) return;
          scrub.current = null;
          count();
        }}
        onPointerCancel={() => {
          scrub.current = null;
        }}
      />
      <div
        className={
          compact
            ? 'flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto'
            : 'flex min-w-0 shrink-0 flex-wrap items-center gap-1.5'
        }
        data-testid="halo-curves-foot"
      >
        <KeyChips controller={controller} numbers={numbers} units={units} />
        {compact && numbers.count > 0 ? null : (
          // with keys selected the key Halo's Ease applies, so the bar leaves *Ease all* to More (wireframe D)
          <CurveHalo controller={controller} shown={shown} focus={focus} frame={frame} keys={numbers.count > 0} />
        )}
      </div>
      {compact && numbers.count > 0 ? (
        <div className="flex min-w-0 shrink-0" data-testid="halo-curves-foot-verbs">
          <CurveHalo controller={controller} shown={shown} focus={focus} frame={frame} keys />
        </div>
      ) : null}
    </Cluster>
  );
}
