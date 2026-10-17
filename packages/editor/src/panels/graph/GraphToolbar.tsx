// Graph Editor toolbar (research 09 §4.7): tools, tangent types, break/unify, weighted, lock weight, pre/post
// infinity, Euler filter, Simplify and framing. Every button runs an operator (MVP-SPEC §4.9).
import type { InfinityMode, TangentType } from '@ekza-animator/anim-core';
import type { GraphEditorController } from '@ekza-animator/curve-editor';
import { type EditorApp, GRAPH_TOOL, PANEL } from '@ekza-animator/editor-core';
import type { JSX } from 'react';
import { useSession } from '../../hooks';
import { SelectField, Separator, ToolButton } from './controls';
import type { ToolbarState } from './model';
import { runGraphOperator } from './run';

const TOOLS = [
  { id: GRAPH_TOOL.select, label: 'Select', key: 'Q' },
  { id: GRAPH_TOOL.move, label: 'Move', key: 'W' },
  { id: GRAPH_TOOL.insert, label: 'Insert', key: 'I' },
] as const;

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
}): JSX.Element {
  const { app, state, controller } = props;
  const tool = useSession((s) => s.tools.graph);
  const noCurves = state.curves.length === 0;
  const tangentTarget = state.hasKeys || !noCurves;
  const run = (id: string, args?: unknown) => () => runGraphOperator(app, id, args);
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
      <details className="relative">
        <summary
          className="flex h-6 cursor-default list-none items-center rounded-[4px] px-1.5 text-[11px] text-fg-2 hover:bg-[var(--bg-hover,#30323a)]"
          data-testid="ge-tangent-more"
        >
          More ▾
        </summary>
        <div className="absolute left-0 top-7 z-10 flex flex-col rounded-[6px] bg-[var(--bg-popover,#2c2e34)] p-1 shadow-lg">
          {MORE_TANGENTS.map(({ type, label }) => (
            <ToolButton
              key={type}
              testId={`ge-tangent-${type}`}
              label={label}
              title={`${label} tangents`}
              disabled={!tangentTarget}
              onClick={run('graph.tangent.set', { type })}
            />
          ))}
        </div>
      </details>
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
        title="Remove keys within the reduction tolerance"
        disabled={noCurves}
        onClick={run('graph.curves.simplify')}
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
    </div>
  );
}
