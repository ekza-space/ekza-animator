// The Dope Sheet panel's body (M2A-SPEC §5.10, §7), loaded lazily by DopeSheetPanel: toolbar (tools, Show, Ripple,
// Snap, Frame, Tween bar), the row labels (DOM, virtualized, scrolled with the canvas) and the canvas driven by a
// DopeSheetController. Show and the rows' expansion persist with the layout (dockview panel parameters).
import {
  DOPE_SHEET_ROW_HEIGHT,
  DOPE_SHEET_ROWS_TOP,
  DopeSheetController,
  type DopeSheetShow,
  selectModeFor,
} from '@ekza-studio/curve-editor';
import type { ChannelRef, EditorApp, ToolPointerEvent } from '@ekza-studio/editor-core';
import { DOPE_TOOL, PANEL } from '@ekza-studio/editor-core';
import {
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSession, useTestProbe } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import type { DopeSheetProbe } from '../../shell/types';
import { TweenBar } from '../shared/TweenBar';
import type { PanelProps } from '../types';
import { attachDopeSheet, type DopeSheetHandle, focusDopeSheet, focusedDopeSheet } from './focus';

/** Two presses within this time and distance count as a double-click. */
const MULTI_CLICK_MS = 400;
const MULTI_CLICK_PX = 4;
const LINE_HEIGHT_PX = 16;
const LABEL_WIDTH = 200;
const INDENT_PX = 12;

const BUTTON =
  'inline-flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[11px] leading-none text-fg-2 ' +
  'hover:bg-[var(--bg-hover,#30323a)] hover:text-fg disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-[var(--bg-pressed,#3a3d46)] aria-pressed:text-fg aria-pressed:shadow-[inset_0_-2px_0_var(--accent)] ' +
  'focus-visible:outline-2 focus-visible:outline-[var(--accent-text)]';

const TOOLS = [
  { id: DOPE_TOOL.select, label: 'Select', key: 'Q' },
  { id: DOPE_TOOL.move, label: 'Move', key: 'W' },
  { id: DOPE_TOOL.scale, label: 'Scale', key: 'R' },
] as const;

/** What the Dope Sheet keeps in its dockview panel parameters (persisted with the layout). */
interface PersistedState {
  readonly show?: DopeSheetShow;
  readonly expanded?: Readonly<Record<string, boolean>>;
}

function Separator(): JSX.Element {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />;
}

export default function DopeSheetView(props: PanelProps): JSX.Element {
  const { app, instanceId } = props;
  const shell = useOptionalShell();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<DopeSheetController | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const sheet = new DopeSheetController({ app, canvas });
    const handle: DopeSheetHandle = { controller: sheet, surface: canvas };
    // Persisted Show and expansion (dockview panel parameters).
    const panel = shell?.workspace.dockview?.getPanel(instanceId);
    const saved = (panel?.params as { readonly dopeSheet?: PersistedState } | undefined)?.dopeSheet;
    if (saved?.show === 'character' || saved?.show === 'selected') sheet.setShow(saved.show);
    if (saved?.expanded !== undefined) sheet.restoreExpansion(saved.expanded);
    const detach = attachDopeSheet(app, handle);
    const unbind = bindInput(app, sheet, handle, canvas);
    setController(sheet);
    return () => {
      unbind();
      detach();
      sheet.dispose();
      setController(null);
    };
  }, [app, shell, instanceId]);

  const persist = useCallback(
    (sheet: DopeSheetController) => {
      const panel = shell?.workspace.dockview?.getPanel(instanceId);
      if (panel === undefined) return;
      const state: PersistedState = { show: sheet.show, expanded: sheet.expansionState() };
      panel.api.updateParameters({ ...panel.params, dopeSheet: state });
    },
    [shell, instanceId],
  );

  const probe = useMemo<DopeSheetProbe>(() => dopeSheetProbe(app), [app]);
  useTestProbe('dopeSheet', probe);

  return (
    <div
      className="bg-panel text-fg"
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}
      data-testid="dopesheet-panel"
    >
      <Toolbar app={app} controller={controller} onPersist={persist} />
      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
        <div
          className="border-r border-line"
          style={{ position: 'relative', width: LABEL_WIDTH, flexShrink: 0, overflow: 'hidden' }}
          data-testid="ds-labels"
        >
          {controller === null ? null : <RowLabels app={app} controller={controller} onPersist={persist} />}
        </div>
        <div
          style={{ position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
          data-testid="ds-view"
        >
          <canvas
            ref={canvasRef}
            className="touch-none select-none"
            style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
            data-testid="ds-canvas"
            aria-label="Dope Sheet keys"
          />
        </div>
      </div>
    </div>
  );
}

function Toolbar(props: {
  readonly app: EditorApp;
  readonly controller: DopeSheetController | null;
  readonly onPersist: (sheet: DopeSheetController) => void;
}): JSX.Element {
  const { app, controller, onPersist } = props;
  const tool = useSession((s) => s.tools.dopeSheet);
  const ripple = useSession((s) => s.tools.ripple);
  const snap = useSession((s) => s.time.snapToFrames);
  const subscribe = useMemo(
    () => (controller === null ? noSubscribe : controller.subscribe.bind(controller)),
    [controller],
  );
  const show = useSyncExternalStore(subscribe, () => controller?.show ?? 'selected');
  const run = (op: string, args?: unknown): void => {
    void app.runUntyped(op, args, { panel: PANEL.dopeSheet }).then((result) => {
      if (result.status === 'failed') {
        app.services.notify.toast({ kind: 'error', text: `${op} failed: ${result.error.message}` });
      }
    });
  };
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line bg-header px-1.5 py-1"
      role="toolbar"
      aria-label="Dope Sheet"
    >
      {TOOLS.map(({ id, label, key }) => (
        <button
          key={id}
          type="button"
          className={BUTTON}
          data-testid={`ds-tool-${id}`}
          title={`${label} tool (${key})`}
          aria-pressed={tool === id}
          onClick={() => run('view.tool', { panel: PANEL.dopeSheet, tool: id })}
        >
          {label}
        </button>
      ))}
      <Separator />
      <label className="flex items-center gap-1 text-[11px] text-fg-2">
        Show
        <select
          className="h-6 rounded-[3px] border border-transparent bg-[var(--bg-field,#17181b)] px-1 text-[11px] text-fg"
          data-testid="ds-show"
          value={show}
          disabled={controller === null}
          onChange={(e) => {
            if (controller === null) return;
            controller.setShow(e.currentTarget.value === 'character' ? 'character' : 'selected');
            onPersist(controller);
          }}
        >
          <option value="selected">Selected</option>
          <option value="character">Character</option>
        </select>
      </label>
      <Separator />
      <button
        type="button"
        className={BUTTON}
        data-testid="ds-ripple"
        title="Ripple edit: moving or scaling keys shifts the later keys with them"
        aria-pressed={ripple}
        onClick={() => run('key.toggleRipple')}
      >
        Ripple
      </button>
      <button
        type="button"
        className={BUTTON}
        data-testid="ds-snap"
        title="Snap keys to whole frames (Alt while dragging: no snapping)"
        aria-pressed={snap}
        onClick={() => {
          const state = app.session.getState();
          app.session.setState({ time: { ...state.time, snapToFrames: !state.time.snapToFrames } });
        }}
      >
        Snap
      </button>
      <button
        type="button"
        className={BUTTON}
        data-testid="ds-frame-all"
        title="Frame all keys (A)"
        disabled={controller === null}
        onClick={() => run('dopeSheet.frame', { what: 'all' })}
      >
        Frame
      </button>
      <Separator />
      <TweenBar panel="dopeSheet" />
    </div>
  );
}

const noSubscribe = (): (() => void) => () => {};

/** Kinds of rows that have children (an expand/collapse toggle). */
const PARENT_KINDS: ReadonlySet<string> = new Set(['summary', 'character', 'group', 'control']);

function RowLabels(props: {
  readonly app: EditorApp;
  readonly controller: DopeSheetController;
  readonly onPersist: (sheet: DopeSheetController) => void;
}): JSX.Element {
  const { app, controller, onPersist } = props;
  const subscribe = useMemo(() => controller.subscribe.bind(controller), [controller]);
  const rows = useSyncExternalStore(subscribe, () => controller.rows());
  const view = useSyncExternalStore(subscribe, () => controller.view);
  const [height, setHeight] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  const mac = app.keymap.platform === 'mac';
  const modifiers = (e: ReactMouseEvent) => ({ shift: e.shiftKey, mod: mac ? e.metaKey : e.ctrlKey });
  const first = Math.max(0, Math.floor(view.scrollY / DOPE_SHEET_ROW_HEIGHT));
  const last = Math.min(rows.length - 1, Math.ceil((view.scrollY + height) / DOPE_SHEET_ROW_HEIGHT));

  const selectLabel = (rowIndex: number, e: ReactMouseEvent): void => {
    const row = rows[rowIndex];
    if (row?.control === undefined) return;
    const mode = selectModeFor(modifiers(e));
    void app.runUntyped('select.controls', { ids: [row.control], mode }, { panel: PANEL.dopeSheet });
    if (row.kind === 'channel' && row.channel !== undefined) {
      const ref: ChannelRef = { control: row.control, channel: row.channel };
      const state = app.session.getState();
      app.session.setState({ selection: { ...state.selection, channels: [ref] } });
    }
  };

  const labels: JSX.Element[] = [];
  for (let i = first; i <= last; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const top = DOPE_SHEET_ROWS_TOP + i * DOPE_SHEET_ROW_HEIGHT - view.scrollY;
    const parent = PARENT_KINDS.has(row.kind);
    labels.push(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the rows are pointer shortcuts; selection has keyboard paths (Outliner, operators)
      <div
        key={row.id}
        data-testid={`ds-row-${row.id}`}
        data-kind={row.kind}
        className={`flex items-center gap-1 truncate pr-1 text-[11px] select-none hover:bg-[var(--bg-hover,#30323a)] ${
          row.kind === 'summary' ? 'bg-[var(--bg-header,#2a2b30)] font-semibold text-fg' : 'text-fg-2'
        } ${row.dimmed ? 'opacity-50' : ''}`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top,
          height: DOPE_SHEET_ROW_HEIGHT,
          paddingLeft: 4 + row.depth * INDENT_PX,
        }}
        title={row.label}
        onClick={(e) => selectLabel(i, e)}
        onDoubleClick={(e) => controller.selectRowKeys(row.id, selectModeFor(modifiers(e)))}
      >
        {parent ? (
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-3 hover:text-fg"
            aria-label={row.expanded ? `Collapse ${row.label}` : `Expand ${row.label}`}
            aria-expanded={row.expanded}
            data-testid={`ds-expand-${row.id}`}
            onClick={(e) => {
              e.stopPropagation();
              controller.setExpanded(row.id, !row.expanded);
              onPersist(controller);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {row.expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="inline-block w-4 shrink-0" />
        )}
        <span className="truncate">{row.label}</span>
      </div>,
    );
  }

  return (
    <div
      ref={box}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      onWheel={(e) => {
        controller.setView({ ...controller.view, scrollY: controller.view.scrollY + e.deltaY });
      }}
    >
      {labels}
      {/* Covers the rows scrolled above the first one, beside the canvas's ruler and region strips. */}
      <div
        className="border-b border-line bg-header"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, height: DOPE_SHEET_ROWS_TOP }}
      />
    </div>
  );
}

interface ClickTracker {
  time: number;
  x: number;
  y: number;
  button: number;
  count: number;
}

/** Wires DOM input on the canvas to the controller; returns the cleanup. */
function bindInput(
  app: EditorApp,
  sheet: DopeSheetController,
  handle: DopeSheetHandle,
  surface: HTMLCanvasElement,
): () => void {
  const clicks: ClickTracker = { time: Number.NEGATIVE_INFINITY, x: 0, y: 0, button: -1, count: 0 };
  let hovered = false;
  const mac = app.keymap.platform === 'mac';

  const toTool = (e: PointerEvent, detail: number): ToolPointerEvent => {
    const rect = surface.getBoundingClientRect();
    return {
      panel: PANEL.dopeSheet,
      paneId: null,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: e.button,
      buttons: e.buttons,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
      pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse',
      timeStamp: e.timeStamp,
      detail,
    };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1 || e.button === 2) e.preventDefault(); // no autoscroll / paste / context menu
    const near = Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) <= MULTI_CLICK_PX;
    const count =
      e.button === clicks.button && near && e.timeStamp - clicks.time <= MULTI_CLICK_MS ? clicks.count + 1 : 1;
    Object.assign(clicks, { time: e.timeStamp, x: e.clientX, y: e.clientY, button: e.button, count });
    focusDopeSheet(app, handle);
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already released pointer cannot be captured; the drag still works inside the canvas.
    }
    sheet.pointerDown(toTool(e, count));
    surface.style.cursor = sheet.cursor();
  };
  const onPointerMove = (e: PointerEvent): void => {
    sheet.pointerMove(toTool(e, 0));
    surface.style.cursor = sheet.cursor();
  };
  const onPointerUp = (e: PointerEvent): void => {
    sheet.pointerUp(toTool(e, clicks.count));
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    surface.style.cursor = sheet.cursor();
  };
  const onPointerCancel = (): void => sheet.cancel();
  const onPointerEnter = (): void => {
    hovered = true;
    focusDopeSheet(app, handle);
  };
  const onPointerLeave = (): void => {
    hovered = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // page zoom on pinch, page scroll on wheel
    const rect = surface.getBoundingClientRect();
    const scale = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? rect.height : 1;
    sheet.wheel({
      panel: PANEL.dopeSheet,
      paneId: null,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      deltaX: e.deltaX * scale,
      deltaY: e.deltaY * scale,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
    });
  };
  const suppress = (e: Event): void => e.preventDefault();
  // Esc (cancel a drag) and Mod+A (every shown key) reach the Dope Sheet before the shell's keymap (capture).
  const onKey = (e: KeyboardEvent): void => {
    if (!hovered && !sheet.dragging) return;
    const consumed = sheet.key({
      type: e.type === 'keyup' ? 'up' : 'down',
      code: e.code,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
      repeat: e.repeat,
    });
    if (consumed) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onBlur = (): void => sheet.cancel();

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined) return;
    const width = entry.contentRect.width;
    const height = entry.contentRect.height;
    const device = entry.devicePixelContentBoxSize?.[0];
    const dpr = device !== undefined && width > 0 ? device.inlineSize / width : window.devicePixelRatio || 1;
    sheet.resize(width, height, dpr);
  });
  try {
    observer.observe(surface, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(surface); // Safari: no device-pixel-content-box
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('pointerenter', onPointerEnter);
  surface.addEventListener('pointerleave', onPointerLeave);
  surface.addEventListener('wheel', onWheel, { passive: false });
  surface.addEventListener('contextmenu', suppress);
  surface.addEventListener('auxclick', suppress);
  window.addEventListener('keydown', onKey, { capture: true });
  window.addEventListener('keyup', onKey, { capture: true });
  window.addEventListener('blur', onBlur);
  return () => {
    observer.disconnect();
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerCancel);
    surface.removeEventListener('pointerenter', onPointerEnter);
    surface.removeEventListener('pointerleave', onPointerLeave);
    surface.removeEventListener('wheel', onWheel);
    surface.removeEventListener('contextmenu', suppress);
    surface.removeEventListener('auxclick', suppress);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('keyup', onKey, { capture: true });
    window.removeEventListener('blur', onBlur);
  };
}

/** The Dope Sheet slice of the e2e test API (M2A-SPEC §4.8), in page CSS px, for the focused Dope Sheet. */
export function dopeSheetProbe(app: EditorApp): DopeSheetProbe {
  const withSheet = <T,>(fn: (handle: DopeSheetHandle) => T): T | null => {
    const handle = focusedDopeSheet(app);
    if (handle === null) return null;
    // Draw pending changes first, so what a test clicks is what is on screen.
    handle.controller.redraw();
    return fn(handle);
  };
  const toPage = (handle: DopeSheetHandle, point: { readonly x: number; readonly y: number } | null) => {
    if (point === null) return null;
    const rect = handle.surface.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  };
  return {
    dopeSheet: () =>
      withSheet((handle) => {
        const sheet = handle.controller;
        const rect = handle.surface.getBoundingClientRect();
        const { f0, sx, scrollY } = sheet.view;
        return {
          rows: sheet.rows().map((row) => ({
            id: row.id,
            kind: row.kind,
            label: row.label,
            depth: row.depth,
            expanded: row.expanded,
            dimmed: row.dimmed,
            ...sheet.rowState(row),
          })),
          view: { f0, sx, scrollY },
          canvasRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        };
      }),
    screenOfDopeKey: (row, frame) =>
      withSheet((handle) => toPage(handle, handle.controller.glyphPoint(row, frame))) ?? null,
    screenOfDopeRegion: (part) => withSheet((handle) => toPage(handle, handle.controller.regionPoint(part))) ?? null,
  };
}
