// Graph Editor toolbar (research 09 §4.7): tools, tangent types, break/unify, weighted, lock weight, pre/post
// infinity, Euler filter, Simplify and framing; M2a (M2A-SPEC §7, A4): the Scale tool, the view mode (absolute,
// normalized, stacked), buffer curves (snapshot, swap), breakdown conversion (in "More ▾") and the Tween bar. Every
// button runs an operator (MVP-SPEC §4.9).
import type { InfinityMode, TangentType } from '@ekza-studio/anim-core';
import type { GraphEditorController } from '@ekza-studio/curve-editor';
import { type EditorApp, GRAPH_TOOL, type GraphViewMode, PANEL } from '@ekza-studio/editor-core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ekza-studio/ui';
import { type JSX, useState } from 'react';
import { useSession } from '../../hooks';
import { TweenBar } from '../shared/TweenBar';
import { BUTTON_CLASS, SelectField, Separator, ToolButton } from './controls';
import type { ToolbarState } from './model';
import { runGraphOperator } from './run';
import { SIMPLIFY_TOLERANCES, type SimplifyFactor, simplifyMessage, simplifyTolerance } from './simplify';

const TOOLS = [
  { id: GRAPH_TOOL.select, label: 'Select', key: 'Q' },
  { id: GRAPH_TOOL.move, label: 'Move', key: 'W' },
  { id: GRAPH_TOOL.insert, label: 'Insert', key: 'I' },
  { id: GRAPH_TOOL.scale, label: 'Scale', key: 'R' },
] as const;

/** M2a §5.15.2 view modes (N toggles normalized, Shift+N stacked). */
const VIEW_MODES: readonly { readonly mode: GraphViewMode; readonly label: string; readonly title: string }[] = [
  { mode: 'absolute', label: 'Abs', title: 'Absolute values' },
  { mode: 'normalized', label: 'Norm', title: 'Normalized: every curve in −1…1 (N)' },
  { mode: 'stacked', label: 'Stack', title: 'Stacked: one lane per curve (Shift+N)' },
];

/** The tangent types of the keymap (1…6) and, in "More", the menu-only ones (MVP-SPEC §4.10). */
const TANGENTS: readonly { readonly type: TangentType; readonly label: string; readonly key: string }[] = [
  { type: 'auto', label: 'Auto', key: '1' },
  { type: 'spline', label: 'Spline', key: '2' },
  { type: 'clamped', label: 'Clamped', key: '3' },
  { type: 'linear', label: 'Linear', key: '4' },
  { type: 'flat', label: 'Flat', key: '5' },
  { type: 'step', label: 'Stepped', key: '6' },
];
const MORE_TANGENTS: readonly { readonly type: TangentType; readonly label: string }[] = [
  { type: 'stepNext', label: 'Stepped Next' },
  { type: 'fixed', label: 'Fixed' },
  { type: 'plateau', label: 'Plateau' },
  { type: 'autoEase', label: 'Auto Ease' },
  { type: 'autoMix', label: 'Auto Mix' },
];

const INFINITY: readonly { readonly value: InfinityMode; readonly label: string }[] = [
  { value: 'constant', label: 'Constant' },
  { value: 'linear', label: 'Linear' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'cycleOffset', label: 'Cycle with offset' },
  { value: 'oscillate', label: 'Oscillate' },
];

export function GraphToolbar(props: {
  readonly app: EditorApp;
  readonly state: ToolbarState;
  readonly controller: GraphEditorController | null;
  readonly hasControls: boolean;
  /** M2a: the controller's view mode (the panel follows it and persists it with the layout). */
  readonly viewMode: GraphViewMode;
}): JSX.Element {
  const { app, state, controller } = props;
  const buffered = useSession((s) => s.curveBuffers);
  const hasBuffers = state.curves.some((curve) => buffered.has(curve.id));
  const targetCurves = state.curves.map((curve) => curve.id);
  const tool = useSession((s) => s.tools.graph);
  const noCurves = state.curves.length === 0;
  const tangentTarget = state.hasKeys || !noCurves;
  const run = (id: string, args?: unknown) => () => runGraphOperator(app, id, args);
  const [simplifyFactor, setSimplifyFactor] = useState<SimplifyFactor>('1');
  const simplify = (): void => {
    // The default tolerance runs without arguments (the operator's DEFAULT_REDUCE).
    const tolerance = simplifyFactor === '1' ? undefined : simplifyTolerance(Number(simplifyFactor));
    runGraphOperator(app, 'graph.curves.simplify', tolerance === undefined ? undefined : { tolerance }, (value) => {
      const text = simplifyMessage(value, tolerance);
      if (text !== null) app.services.notify.toast({ kind: 'info', text });
    });
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5" role="toolbar" aria-label="Graph Editor">
      {TOOLS.map(({ id, label, key }) => (
        <ToolButton
          key={id}
          testId={`ge-tool-${id}`}
          label={label}
          title={`${label} tool (${key})`}
          pressed={tool === id}
          onClick={run('view.tool', { panel: PANEL.graph, tool: id })}
        />
      ))}
      <Separator />
      {TANGENTS.map(({ type, label, key }) => (
        <ToolButton
          key={type}
          testId={`ge-tangent-${type}`}
          label={label}
          title={`${label} tangents (${key})`}
          disabled={!tangentTarget}
          onClick={run('graph.tangent.set', { type })}
        />
      ))}
      {/* Menu-only tangent types: a Radix menu closes on choice, Esc and an outside click (acceptance round 1). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!tangentTarget}>
          <button type="button" className={BUTTON_CLASS} data-testid="ge-tangent-more" title="More tangent types">
            More ▾
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-36" data-testid="ge-tangent-more-menu">
          {MORE_TANGENTS.map(({ type, label }) => (
            <DropdownMenuItem
              key={type}
              className="whitespace-nowrap"
              data-testid={`ge-tangent-${type}`}
              title={`${label} tangents`}
              onSelect={() => runGraphOperator(app, 'graph.tangent.set', { type })}
            >
              {label}
            </DropdownMenuItem>
          ))}
          {/* M2a §5.12: breakdown conversion of the selected keys (or the keys at the current frame). */}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="whitespace-nowrap"
            data-testid="ge-convert-breakdown"
            title="Turn the selected keys into breakdowns"
            onSelect={() => runGraphOperator(app, 'key.convert', { to: 'breakdown' })}
          >
            Convert to Breakdown
          </DropdownMenuItem>
          <DropdownMenuItem
            className="whitespace-nowrap"
            data-testid="ge-convert-key"
            title="Turn the selected breakdowns back into keys"
            onSelect={() => runGraphOperator(app, 'key.convert', { to: 'key' })}
          >
            Convert to Key
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator />
      <ToolButton
        testId="ge-break"
        label="Break"
        title="Break tangents (B)"
        disabled={!state.hasKeys}
        onClick={run('graph.tangent.break')}
      />
      <ToolButton
        testId="ge-unify"
        label="Unify"
        title="Unify tangents (U)"
        disabled={!state.hasKeys}
        onClick={run('graph.tangent.unify')}
      />
      <ToolButton
        testId="ge-weighted"
        label="Weighted"
        title="Weighted tangents (curve)"
        pressed={state.weighted === true}
        disabled={noCurves}
        onClick={run('graph.curve.setWeighted', { weighted: state.weighted !== true })}
      />
      <ToolButton
        testId="ge-lock-weight"
        label="Lock W"
        title="Lock tangent weights: handle drags change the angle only"
        pressed={state.weightLocked === true}
        disabled={!state.hasKeys}
        onClick={run('graph.tangent.lockWeight', { locked: state.weightLocked !== true })}
      />
      <Separator />
      <SelectField
        testId="graph-infinity-pre"
        label="Pre"
        value={state.pre}
        options={INFINITY}
        disabled={noCurves}
        onChange={(pre) => runGraphOperator(app, 'graph.infinity.set', { pre })}
      />
      <SelectField
        testId="graph-infinity-post"
        label="Post"
        value={state.post}
        options={INFINITY}
        disabled={noCurves}
        onChange={(post) => runGraphOperator(app, 'graph.infinity.set', { post })}
      />
      <Separator />
      <ToolButton
        testId="ge-euler-filter"
        label="Euler Filter"
        title="Remove rotation flips on the selected controls' rotation curves"
        disabled={!props.hasControls}
        onClick={run('graph.eulerFilter')}
      />
      <ToolButton
        testId="ge-simplify"
        label="Simplify"
        title="Remove keys while the curves stay within the tolerance of their shape"
        disabled={noCurves}
        onClick={simplify}
      />
      <SelectField
        testId="ge-simplify-tolerance"
        label="Tol"
        value={simplifyFactor}
        options={SIMPLIFY_TOLERANCES}
        disabled={noCurves}
        onChange={setSimplifyFactor}
      />
      <Separator />
      {VIEW_MODES.map(({ mode, label, title }) => (
        <ToolButton
          key={mode}
          testId={`ge-view-${mode}`}
          label={label}
          title={title}
          pressed={props.viewMode === mode}
          disabled={controller === null}
          onClick={() => controller?.setViewMode(mode)}
        />
      ))}
      <Separator />
      <ToolButton
        testId="ge-buffer-snapshot"
        label="Snapshot"
        title="Snapshot buffer curves: keep a copy of the curves to compare with or swap back"
        disabled={noCurves}
        onClick={run('graph.buffer.snapshot', { curves: targetCurves })}
      />
      <ToolButton
        testId="ge-buffer-swap"
        label="Swap"
        title="Swap the curves with their buffer curves"
        disabled={!hasBuffers}
        onClick={run('graph.buffer.swap', { curves: targetCurves })}
      />
      <Separator />
      <ToolButton
        testId="ge-frame-all"
        label="Frame All"
        title="Frame all curves (A)"
        disabled={controller === null}
        onClick={() => controller?.frame('all')}
      />
      <ToolButton
        testId="ge-frame-selection"
        label="Frame Sel"
        title="Frame the selected keys (F)"
        disabled={controller === null}
        onClick={() => controller?.frame('selection')}
      />
      <Separator />
      <TweenBar panel="graph" />
    </div>
  );
}
