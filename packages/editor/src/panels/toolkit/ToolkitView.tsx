// The Modeling Toolkit (M6A-SPEC §8.5; B11): the right dock's first tab in Model, a lazy chunk. Sections top to
// bottom: header (target meshes · hilite count · triangles) · mode switcher · Selection · Symmetry · Soft Selection ·
// Components · Tools · Mesh · Active tool · Next. Buttons run operators (`source: 'toolkit'`); a disabled button shows
// the operator's poll reason; `⋯` opens the operator's option box (defaults for its next run). Section collapse is
// remembered in `prefs.modeling.toolkitCollapsed`. Narrow (≤ 260 px): two columns of short labels (no icon set exists
// for the operators yet; wide is two columns of full labels). The Next footer: Mesh Check ✓ or its problem count (the
// kernel's `checkMesh`, B5; the plain button until it lands), triangles / budget (§5.24, `meshBudget`) with the
// budget bar's states, Export model…, Rig & Skin (v0.4). Empty state: "Select a mesh, or create one" with primitive
// buttons.
import type { ParamValue } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import {
  type ComponentMode,
  type EditorApp,
  meshBudget,
  meshKernel,
  type OperatorId,
  type RunContext,
  type SessionState,
  type SymmetryMode,
} from '@ekza-animator/editor-core';
import { cn } from '@ekza-animator/ui';
import {
  type JSX,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { usePrefs, useSession } from '../../hooks';
import { openOptionBox } from '../../overlays/menus/optionBox';
import { useOptionalShell } from '../../shell/context';
import { shortcutFor } from '../../shell/menus';
import { BUTTON, CHECK, INPUT, MUTED_TEXT, SELECT } from '../channel-box/kit/styles';
import type { PanelProps } from '../types';
import { ParamField } from './ParamField';

const TOOLKIT_CTX: RunContext = { source: 'toolkit', panel: 'toolkit' };

/**
 * The Toolkit's number inputs set their value as it is typed; Enter and Esc give the keyboard back to the editor (the
 * input blurs), so the hovered pane's hotkeys work again without a click elsewhere.
 */
function releaseOnEnter(event: ReactKeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter' && event.key !== 'Escape') return;
  event.preventDefault();
  event.currentTarget.blur();
}
/** At or below this width the Toolkit packs its buttons (§8.5 "Narrow"). */
export const NARROW_PX = 260;

const MODES: readonly { readonly mode: ComponentMode; readonly label: string; readonly short: string }[] = [
  { mode: 'object', label: 'Object', short: 'Obj' },
  { mode: 'vertex', label: 'Vertex', short: 'Vtx' },
  { mode: 'edge', label: 'Edge', short: 'Edg' },
  { mode: 'face', label: 'Face', short: 'Face' },
];

const SYMMETRY_MODES: readonly { readonly value: SymmetryMode; readonly label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'object-x', label: 'Object X' },
  { value: 'object-y', label: 'Object Y' },
  { value: 'object-z', label: 'Object Z' },
  { value: 'world-x', label: 'World X' },
  { value: 'world-y', label: 'World Y' },
  { value: 'world-z', label: 'World Z' },
];

const CURVES = ['smooth', 'linear', 'sharp', 'root', 'sphere', 'constant'] as const;

/** Weight at normalised distance t (0 centre … 1 radius) of each falloff preset, for the preview only. */
const PREVIEW: Readonly<Record<(typeof CURVES)[number], (t: number) => number>> = {
  smooth: (t) => 1 - t * t * (3 - 2 * t),
  linear: (t) => 1 - t,
  sharp: (t) => (1 - t) * (1 - t),
  root: (t) => Math.sqrt(1 - t),
  sphere: (t) => Math.sqrt(1 - t * t),
  constant: () => 1,
};

/** A small drawing of the falloff preset (§8.5 "falloff preset with a preview"). */
function FalloffPreview(props: { readonly curve: string }): JSX.Element {
  const weight = PREVIEW[props.curve as (typeof CURVES)[number]] ?? PREVIEW.smooth;
  const points: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    points.push(`${(t * 48).toFixed(1)},${(16 - Math.max(0, Math.min(1, weight(t))) * 14).toFixed(1)}`);
  }
  return (
    <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true" data-testid="mtk-soft-preview">
      <polyline points={points.join(' ')} fill="none" stroke="var(--soft-2, #ff8a3d)" strokeWidth="1.5" />
    </svg>
  );
}

/** A button of the Toolkit: an operator (with args), its key label, its poll reason when disabled, its option box. */
interface ButtonSpec {
  readonly label: string;
  readonly op: OperatorId;
  readonly args?: unknown;
  /** `data-testid` suffix (`mtk-btn-<id>`); default: the operator id. */
  readonly id?: string;
  /** The operator whose option box `⋯` opens (null: none). */
  readonly options?: OperatorId | null;
}

const tool = (label: string, id: string, toolId: string, options: OperatorId | null = null): ButtonSpec => ({
  label,
  op: 'view.tool',
  args: { panel: 'viewport', tool: toolId },
  id,
  options,
});

const COMPONENTS: readonly ButtonSpec[] = [
  { label: 'Extrude', op: 'mesh.extrude', options: 'mesh.extrude' },
  { label: 'Bevel', op: 'mesh.bevel', options: 'mesh.bevel' },
  { label: 'Bridge', op: 'mesh.bridge', options: 'mesh.bridge' },
  { label: 'Inset', op: 'mesh.inset', options: 'mesh.inset' },
  { label: 'Merge', op: 'mesh.merge', options: 'mesh.merge' },
  tool('Target Weld', 'mesh.targetWeld', 'targetWeld', 'mesh.targetWeld'),
  { label: 'Connect', op: 'mesh.connect', options: 'mesh.connect' },
  { label: 'Collapse', op: 'mesh.collapse' },
  { label: 'Fill Hole', op: 'mesh.fillHole' },
  { label: 'Triangulate', op: 'mesh.triangulate' },
  { label: 'Flip', op: 'mesh.flipTriangleEdge' },
  { label: 'Average', op: 'mesh.averageVertices', options: 'mesh.averageVertices' },
];

const TOOLS: readonly ButtonSpec[] = [
  tool('Multi-Cut', 'mesh.cut', 'multiCut'),
  tool('Insert Edge Loop', 'mesh.insertLoop', 'insertLoop', 'mesh.insertLoop'),
  tool('Slide Edge', 'mesh.slide', 'slide', 'mesh.slide'),
  tool('Paint Colour', 'mesh.paint', 'paint'),
];

const MESH: readonly ButtonSpec[] = [
  { label: 'Combine', op: 'mesh.combine', options: 'mesh.combine' },
  { label: 'Separate', op: 'mesh.separate' },
  { label: 'Mirror', op: 'mesh.mirror', options: 'mesh.mirror' },
  { label: 'Cleanup', op: 'mesh.cleanup', options: 'mesh.cleanup' },
];

const SELECTION_BUTTONS: readonly ButtonSpec[] = [
  { label: 'Grow', op: 'select.mesh.grow' },
  { label: 'Shrink', op: 'select.mesh.shrink' },
  { label: 'Loop', op: 'select.mesh.convert', args: { to: 'edge', mode: 'loop' }, id: 'select.mesh.loop' },
  { label: 'Ring', op: 'select.mesh.convert', args: { to: 'edge', mode: 'ring' }, id: 'select.mesh.ring' },
  { label: 'Shell', op: 'select.mesh.shell' },
];

const PRIMITIVES: readonly ButtonSpec[] = [
  { label: 'Cube', op: 'mesh.create.cube' },
  { label: 'Cylinder', op: 'mesh.create.cylinder' },
  { label: 'Sphere', op: 'mesh.create.sphere' },
  { label: 'Plane', op: 'mesh.create.plane' },
  { label: 'Cone', op: 'mesh.create.cone' },
];

/** A render tick for what the buttons' polls read: selection, mode, tools, settings, the document (rAF-throttled). */
function usePollTick(app: EditorApp): number {
  const tick = useRef(0);
  const subscribe = useMemo(
    () => (listener: () => void) => {
      let frame: number | null = null;
      const bump = (): void => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          tick.current += 1;
          listener();
        });
      };
      const relevant = (s: SessionState, p: SessionState): boolean =>
        s.selection !== p.selection ||
        s.workspace !== p.workspace ||
        s.tools !== p.tools ||
        s.lastRun !== p.lastRun ||
        s.model.componentMode !== p.model.componentMode ||
        s.model.hilite !== p.model.hilite ||
        s.model.symmetry !== p.model.symmetry ||
        s.model.softSelect !== p.model.softSelect ||
        s.model.components !== p.model.components;
      const offs = [
        app.session.subscribe((s, p) => relevant(s, p) && bump()),
        app.store.subscribe(() => bump()),
        app.meshes.subscribe(() => bump()),
        app.components.subscribe(() => bump()),
      ];
      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        for (const off of offs) off();
      };
    },
    [app],
  );
  return useSyncExternalStore(subscribe, () => tick.current);
}

function useNarrow(ref: { readonly current: HTMLElement | null }): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width;
      setNarrow(width > 0 && width <= NARROW_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

/** The target meshes' triangle budget (§5.24: a mesh's own, else its nearest parent's): their sum when each has one. */
function budgetOf(app: EditorApp, ids: readonly MeshId[]): number | null {
  if (ids.length === 0) return null;
  let total = 0;
  for (const id of ids) {
    const record = app.store.get('meshes', id);
    const budget = record === undefined ? null : meshBudget(app, record);
    if (budget === null) return null;
    total += budget.tris;
  }
  return total;
}

/** §5.24's budget bar states: ok below 90 %, warn up to 100 %, danger above. */
function budgetState(tris: number, budget: number): 'ok' | 'warn' | 'danger' {
  if (tris > budget) return 'danger';
  return tris >= 0.9 * budget ? 'warn' : 'ok';
}

const BUDGET_TEXT: Readonly<Record<'ok' | 'warn' | 'danger', string>> = {
  ok: 'text-[var(--ok,#65a878)]',
  warn: 'text-[var(--warn,#e3b34a)]',
  danger: 'text-[var(--danger,#ef6b6b)]',
};

/** Mesh Check counts per runtime version (the kernel's `checkMesh`, B5), recomputed only when a mesh changes. */
const checkCounts = new WeakMap<object, Map<MeshId, { readonly version: number; readonly count: number | null }>>();

/**
 * Mesh Check problems of the target meshes (§5.25: "clean" = no code but `open-border`, the rule of Model's tab
 * glyph); null while the check is not available (B5's `checkMesh` not landed, a mesh not ready).
 */
function problemsOf(app: EditorApp, ids: readonly MeshId[]): number | null {
  const kernel = meshKernel();
  if (kernel === null || ids.length === 0) return null;
  let cache = checkCounts.get(app.meshes);
  if (cache === undefined) {
    cache = new Map();
    checkCounts.set(app.meshes, cache);
  }
  let total = 0;
  for (const id of ids) {
    const runtime = app.meshes.get(id);
    if (runtime === undefined || runtime.state !== 'ready') return null;
    let hit = cache.get(id);
    if (hit === undefined || hit.version !== runtime.version) {
      let count: number | null = null;
      try {
        const data = runtime.data();
        count = data === null ? null : kernel.checkMesh(data).filter((p) => p.code !== 'open-border').length;
      } catch {
        count = null; // Mesh Check has not landed (B5): nothing to report.
      }
      hit = { version: runtime.version, count };
      cache.set(id, hit);
    }
    if (hit.count === null) return null;
    total += hit.count;
  }
  return total;
}

function trianglesOf(app: EditorApp, ids: readonly MeshId[]): number {
  let total = 0;
  for (const id of ids) {
    const runtime = app.meshes.get(id);
    if (runtime === undefined || runtime.state !== 'ready') continue;
    try {
      total += runtime.triangulation().triFace.length;
    } catch {
      // A runtime without data counts nothing.
    }
  }
  return total;
}

function Section(props: {
  readonly id: string;
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: (id: string) => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-line" data-testid={`mtk-section-${props.id}`}>
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1 px-2 text-left font-semibold text-fg-2 hover:text-fg"
        aria-expanded={!props.collapsed}
        data-testid={`mtk-toggle-${props.id}`}
        onClick={() => props.onToggle(props.id)}
      >
        <span aria-hidden="true">{props.collapsed ? '▸' : '▾'}</span>
        {props.title}
      </button>
      {props.collapsed ? null : <div className="flex flex-col gap-1 px-2 pb-2">{props.children}</div>}
    </section>
  );
}

export default function ToolkitView({ app, instanceId }: PanelProps): JSX.Element {
  const shell = useOptionalShell();
  usePollTick(app);
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const mode = useSession((s) => s.model.componentMode);
  const hilite = useSession((s) => s.model.hilite);
  const objects = useSession((s) => s.selection.objects);
  const symmetryMap = useSession((s) => s.model.symmetry);
  const soft = useSession((s) => s.model.softSelect);
  const style = useSession((s) => s.model.selectionStyle);
  const cameraBased = useSession((s) => s.model.cameraBased);
  const backfaces = useSession((s) => s.model.backfaces);
  const constraint = useSession((s) => s.model.constraint);
  const activeTool = useSession((s) => s.tools.viewport);
  const collapsed = usePrefs((p) => p.modeling.toolkitCollapsed);
  const tolerance = usePrefs((p) => p.modeling.symmetryTolerance);
  const snapStep = usePrefs((p) => p.modeling.multiCutSnapStep);
  const optionDefaults = usePrefs((p) => p.modeling.optionDefaults);

  const meshIds = useMemo(
    (): MeshId[] => (mode === 'object' ? objects.filter((id): id is MeshId => id.startsWith('msh_')) : [...hilite]),
    [mode, objects, hilite],
  );
  const lead = meshIds.at(-1) ?? null;
  const symmetry = (lead === null ? undefined : symmetryMap.get(lead)) ?? {
    mode: 'off' as const,
    tolerance,
    preserveSeam: true,
  };

  const run = (op: OperatorId, args?: unknown): void => {
    if (shell !== null) void shell.runFromUi(op, args, TOOLKIT_CTX);
    else void app.runUntyped(op, args, TOOLKIT_CTX);
  };
  const poll = (op: OperatorId, args?: unknown): string | null => {
    const result = app.operators.poll(op, TOOLKIT_CTX, args);
    return result === true ? null : result.reason;
  };
  const toggleSection = (id: string): void => {
    const modeling = app.prefs.getState().modeling;
    const next = modeling.toolkitCollapsed.includes(id)
      ? modeling.toolkitCollapsed.filter((other) => other !== id)
      : [...modeling.toolkitCollapsed, id];
    app.prefs.setState({ modeling: { ...modeling, toolkitCollapsed: next } });
  };

  const button = (spec: ButtonSpec): JSX.Element => {
    const id = spec.id ?? spec.op;
    const reason = poll(spec.op, spec.args);
    const key = shortcutFor(app.keymap, spec.op, spec.args);
    const title = reason ?? (key === null || key === '' ? spec.label : `${spec.label} (${key})`);
    const options = spec.options ?? null;
    const openOptions = (event: MouseEvent<HTMLButtonElement>): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      openOptionBox(app, options as string, { x: rect.left - 296, y: rect.top });
    };
    return (
      <div key={id} className="flex min-w-0 items-stretch">
        <button
          type="button"
          className={cn(BUTTON, 'min-w-0 flex-1 justify-start border border-line', narrow && 'px-1 text-ui-dense')}
          data-testid={`mtk-btn-${id}`}
          aria-disabled={reason !== null}
          title={title}
          onClick={() => (reason === null ? run(spec.op, spec.args) : shell?.help(reason, 'warning'))}
        >
          <span className="truncate">{spec.label}</span>
        </button>
        {options === null ? null : (
          <button
            type="button"
            className={cn(BUTTON, 'ml-0.5 border border-line px-1')}
            data-testid={`mtk-opt-${options}`}
            title={`${spec.label} options`}
            aria-label={`${spec.label} options`}
            onClick={openOptions}
          >
            ⋯
          </button>
        )}
      </div>
    );
  };
  const grid = (specs: readonly ButtonSpec[]): JSX.Element => (
    <div className="grid grid-cols-2 gap-1">{specs.map(button)}</div>
  );
  const isCollapsed = (id: string): boolean => collapsed.includes(id);
  const section = (id: string, title: string, children: ReactNode): JSX.Element => (
    <Section key={id} id={id} title={title} collapsed={isCollapsed(id)} onToggle={toggleSection}>
      {children}
    </Section>
  );

  const triangles = trianglesOf(app, meshIds);
  const budget = budgetOf(app, meshIds);
  const budgetLevel = budget === null ? null : budgetState(triangles, budget);
  const problems = problemsOf(app, meshIds);
  const empty = meshIds.length === 0 && app.store.list('meshes').length === 0;

  const activeToolSettings = (): JSX.Element | null => {
    if (activeTool === 'multiCut') {
      return (
        <label className="flex items-center justify-between gap-2" data-testid="mtk-active-multiCut">
          <span>Snap step</span>
          <input
            type="number"
            className={cn(INPUT, 'w-20')}
            min={0.01}
            max={1}
            step={0.05}
            data-testid="mtk-multicut-snap"
            onKeyDown={releaseOnEnter}
            value={snapStep}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (!Number.isFinite(value) || value <= 0) return;
              const modeling = app.prefs.getState().modeling;
              app.prefs.setState({ modeling: { ...modeling, multiCutSnapStep: value } });
            }}
          />
        </label>
      );
    }
    const op = activeTool === 'insertLoop' ? 'mesh.insertLoop' : activeTool === 'targetWeld' ? 'mesh.targetWeld' : null;
    if (op === null) return <p className={MUTED_TEXT}>The active tool has no settings.</p>;
    const def = app.operators.get(op)?.params?.find((param) => param.name === 'mode');
    if (def === undefined) return null;
    const value: ParamValue = optionDefaults[op]?.['mode'] ?? def.default;
    return (
      <ParamField
        app={app}
        def={def}
        value={value}
        fieldTestId={`mtk-active-${activeTool}-mode`}
        nameTestId={`mtk-active-${activeTool}-mode-name`}
        onCommit={(next) => {
          const modeling = app.prefs.getState().modeling;
          app.prefs.setState({
            modeling: {
              ...modeling,
              optionDefaults: {
                ...modeling.optionDefaults,
                [op]: { ...modeling.optionDefaults[op], mode: next },
              },
            },
          });
        }}
      />
    );
  };

  return (
    <div
      ref={root}
      className="flex h-full min-h-0 flex-col overflow-auto bg-panel text-ui-dense text-fg select-none"
      data-testid="mtk-panel"
      data-instance={instanceId}
      data-narrow={narrow ? 'true' : 'false'}
    >
      <header
        className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-header px-2"
        data-testid="mtk-header"
      >
        <span className="min-w-0 flex-1 truncate">
          {meshIds.length === 0
            ? 'No mesh'
            : meshIds.length === 1
              ? (app.store.get('meshes', meshIds[0] as MeshId)?.name ?? meshIds[0])
              : `${meshIds.length} meshes`}
        </span>
        <span className={MUTED_TEXT} title="Hilited meshes">
          {hilite.length} hilited
        </span>
        <span className={MUTED_TEXT} data-testid="mtk-tris">
          {triangles.toLocaleString('en')} tris
        </span>
      </header>
      {empty ? (
        <div className="flex flex-col items-center gap-2 p-4 text-center" data-testid="mtk-empty">
          <p className={MUTED_TEXT}>Select a mesh, or create one</p>
          {grid(PRIMITIVES)}
        </div>
      ) : null}
      <fieldset className="flex gap-0.5 border-b border-line p-1.5" aria-label="Component mode" data-testid="mtk-modes">
        {MODES.map(({ mode: m, label, short }) => {
          const reason = poll('select.mode', { mode: m });
          return (
            <label
              key={m}
              className={cn(
                BUTTON,
                'flex-1 cursor-pointer border border-line',
                mode === m && 'bg-[var(--bg-selected,#3b3270)] text-fg',
                reason !== null && 'text-[var(--text-disabled,#5d616b)]',
              )}
              data-testid={`mtk-mode-${m}`}
              data-disabled={reason === null ? 'false' : 'true'}
              title={reason ?? `${label} mode`}
            >
              <input
                type="radio"
                className="sr-only"
                name={`mtk-mode-${instanceId}`}
                value={m}
                checked={mode === m}
                onChange={() => (reason === null ? run('select.mode', { mode: m }) : shell?.help(reason, 'warning'))}
              />
              {narrow ? short : label}
            </label>
          );
        })}
        <label
          className={cn(BUTTON, 'flex-1 border border-line text-[var(--text-disabled,#5d616b)]')}
          data-testid="mtk-mode-uv"
          title="UV editor arrives later"
        >
          <input type="radio" className="sr-only" name={`mtk-mode-${instanceId}`} value="uv" checked={false} disabled />
          UV
        </label>
      </fieldset>
      {section(
        'selection',
        'Selection',
        <>
          <div className="flex items-center gap-1">
            <span className="w-20 shrink-0">Style</span>
            {(['marquee', 'tweak'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={cn(BUTTON, 'flex-1 border border-line', style === s && 'bg-[var(--bg-selected,#3b3270)]')}
                data-testid={`mtk-style-${s}`}
                title={poll('model.selectionStyle.set', { style: s }) ?? undefined}
                onClick={() => run('model.selectionStyle.set', { style: s })}
              >
                {s === 'marquee' ? 'Marquee' : 'Tweak'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={CHECK}
              data-testid="mtk-camera-based"
              checked={cameraBased !== 'off'}
              onChange={(event) =>
                run('model.cameraBased.set', { value: event.currentTarget.checked ? 'auto' : 'off' })
              }
            />
            Camera-based selection
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={CHECK}
              data-testid="mtk-backfaces"
              checked={backfaces}
              onChange={() => run('model.backfaces.toggle')}
            />
            Backfaces
          </label>
          <label className="flex items-center gap-2" title="Highlight nearest arrives later">
            <input type="checkbox" className={CHECK} data-testid="mtk-highlight-nearest" checked={false} disabled />
            Highlight nearest
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Constraint</span>
            <select
              className={cn(SELECT, 'w-28')}
              data-testid="mtk-constraint"
              value={constraint}
              onChange={(event) => run('model.constraint.set', { constraint: event.currentTarget.value })}
            >
              <option value="off">Off</option>
              {(['angle', 'border', 'loop', 'ring', 'shell'] as const).map((c) => (
                <option key={c} value={c} disabled>
                  {c.charAt(0).toUpperCase() + c.slice(1)} (later)
                </option>
              ))}
            </select>
          </label>
          {grid(SELECTION_BUTTONS)}
        </>,
      )}
      {section(
        'symmetry',
        'Symmetry',
        <>
          <label className="flex items-center justify-between gap-2">
            <span>Symmetry</span>
            <select
              className={cn(SELECT, 'w-28')}
              data-testid="mtk-sym-mode"
              value={symmetry.mode}
              title={poll('model.symmetry.set', { mode: symmetry.mode }) ?? undefined}
              onChange={(event) => run('model.symmetry.set', { mode: event.currentTarget.value })}
            >
              {SYMMETRY_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span>Tolerance (m)</span>
            <input
              type="number"
              className={cn(INPUT, 'w-28')}
              step={0.001}
              min={0}
              data-testid="mtk-sym-tol"
              onKeyDown={releaseOnEnter}
              value={symmetry.tolerance}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value) && value >= 0) run('model.symmetry.set', { tolerance: value });
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={CHECK}
              data-testid="mtk-sym-seam"
              checked={symmetry.preserveSeam}
              onChange={(event) => run('model.symmetry.set', { preserveSeam: event.currentTarget.checked })}
            />
            Preserve Seam
          </label>
        </>,
      )}
      {section(
        'soft',
        'Soft Selection',
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={CHECK}
              data-testid="mtk-soft-on"
              checked={soft.on}
              title={poll('model.softSelect.toggle') ?? 'Soft selection (B)'}
              onChange={() => run('model.softSelect.toggle')}
            />
            Soft Select (B)
          </label>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mtk-soft-radius">Radius (m)</label>
            <RadiusField
              radius={soft.radius}
              onKeyDown={releaseOnEnter}
              onValue={(value) => run('model.softSelect.set', { radius: value })}
            />
          </div>
          <div className="flex items-center gap-1">
            {(['volume', 'surface'] as const).map((falloff) => (
              <button
                key={falloff}
                type="button"
                className={cn(
                  BUTTON,
                  'flex-1 border border-line',
                  soft.falloff === falloff && 'bg-[var(--bg-selected,#3b3270)]',
                )}
                data-testid={`mtk-soft-${falloff}`}
                onClick={() => run('model.softSelect.set', { falloff })}
              >
                {falloff === 'volume' ? 'Volume' : 'Surface'}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1">
              Falloff <FalloffPreview curve={soft.curve} />
            </span>
            <select
              className={cn(SELECT, 'w-28')}
              data-testid="mtk-soft-curve"
              value={soft.curve}
              onChange={(event) => run('model.softSelect.set', { curve: event.currentTarget.value })}
            >
              {CURVES.map((curve) => (
                <option key={curve} value={curve}>
                  {curve.charAt(0).toUpperCase() + curve.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </>,
      )}
      {section('components', 'Components', grid(COMPONENTS))}
      {section('tools', 'Tools', grid(TOOLS))}
      {section('mesh', 'Mesh', grid(MESH))}
      {section('active', 'Active tool', activeToolSettings())}
      <footer className="flex flex-col gap-1 p-2" data-testid="mtk-next">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={cn(BUTTON, 'border border-line')}
            data-testid="mtk-mesh-check"
            data-problems={problems ?? undefined}
            title={
              problems === null
                ? 'Open Mesh Check'
                : problems === 0
                  ? 'Mesh Check: clean'
                  : `Mesh Check found ${problems} problem${problems === 1 ? '' : 's'}`
            }
            onClick={() => run('workspace.showPanel', { panel: 'meshCheck' })}
          >
            Mesh Check
            {problems === null ? null : problems === 0 ? ' ✓' : ` · ${problems.toLocaleString('en')}`}
          </button>
          <span
            className={cn(MUTED_TEXT, budgetLevel !== null && BUDGET_TEXT[budgetLevel])}
            data-testid="mtk-next-tris"
            data-state={budgetLevel ?? 'none'}
            title={budget === null ? 'No triangle budget set' : 'Triangles / budget (§5.24, advisory)'}
          >
            {triangles.toLocaleString('en')}
            {budget === null ? '' : ` / ${budget.toLocaleString('en')}`} tris
          </span>
        </div>
        <button
          type="button"
          className={cn(BUTTON, 'border border-line')}
          data-testid="mtk-export"
          onClick={() => run('ui.open', { dialog: 'export' })}
        >
          Export model…
        </button>
        <button
          type="button"
          className={cn(BUTTON, 'border border-line')}
          data-testid="mtk-rig-skin"
          aria-disabled={true}
          title="Rig & Skin arrives in v0.4"
        >
          Rig &amp; Skin ▸
        </button>
      </footer>
    </div>
  );
}

/**
 * The soft-selection radius: shown rounded to centimetres like the status line (a `B` drag sets an unrounded radius);
 * while focused it keeps what is typed, and each valid value applies at once.
 */
function RadiusField({
  radius,
  onKeyDown,
  onValue,
}: {
  readonly radius: number;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  readonly onValue: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      className={cn(INPUT, 'w-28')}
      step={0.05}
      min={0}
      id="mtk-soft-radius"
      data-testid="mtk-soft-radius"
      onKeyDown={onKeyDown}
      value={draft ?? String(Math.round(radius * 100) / 100)}
      onFocus={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        const value = Number(event.currentTarget.value);
        if (Number.isFinite(value) && value > 0) onValue(value);
      }}
    />
  );
}
