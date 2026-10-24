// The Path (STUDIO-TOUCH-SPEC §0, §4.1, §7.1, §7.2, §18; ST-3; T6b): `( Make │ Paint │ Rig │ Animate )` — the stage
// tabs in the top bar (Wide), a second row (Regular) or a bottom tab bar (Compact, the frame's choice), each with its
// readiness glyph from the one readiness list. It never gates: a stage is always one tap away and shows a bridging
// empty state when its prerequisite is missing. Tapping a stage is the frame's `onStage` (T6a commits the tool session,
// runs `edit.escape` and `workspace.set` when the workspace changes, then applies the stage's overlay, tray and default
// tool — `stageSwitch` below lists the operator runs); tapping a ⚠n opens Health scrolled to that stage.
import type { EditorApp } from '@ekza-studio/editor-core';
import { Cluster, Segmented, type SegmentedItem } from '@ekza-studio/ui/touch';
import type { JSX, MouseEvent } from 'react';
import { STAGES, type Stage } from '../manifest/types';
import { STAGE_WORKSPACE } from './destinations';
import { GLYPH_MEANING, GLYPH_TEXT, type Readiness, type StageReadiness } from './readiness';

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  make: 'Make',
  paint: 'Paint',
  rig: 'Rig',
  animate: 'Animate',
};

/** The glyph text of a stage: `○ ◐ ● ·` or `⚠n` (shape and count, never colour alone, §18). */
export function glyphText(stage: StageReadiness): string {
  return stage.glyph === 'warn' ? `${GLYPH_TEXT.warn}${stage.count}` : GLYPH_TEXT[stage.glyph];
}

/** The accessible name of a stage tab ("Rig, 2 things to fix for where it is going"). */
export function stageName(stage: Stage, r: StageReadiness): string {
  const meaning =
    r.glyph === 'warn' ? `${r.count} ${r.count === 1 ? 'thing' : 'things'} to fix` : GLYPH_MEANING[r.glyph];
  return `${STAGE_LABEL[stage]}, ${meaning}`;
}

/** The operator runs of a stage switch (§7.1 steps 1–2): end the tool session, then the workspace when it changes. */
export function stageSwitch(app: EditorApp, to: Stage): readonly { readonly op: string; readonly args?: unknown }[] {
  const workspace = STAGE_WORKSPACE[to];
  const runs: { op: string; args?: unknown }[] = [{ op: 'edit.escape' }];
  if (app.session.getState().workspace !== workspace) runs.push({ op: 'workspace.set', args: { workspace } });
  return runs;
}

export interface PathProps {
  readonly stage: Stage;
  readonly readiness: Readiness;
  readonly onStage: (stage: Stage) => void;
  /** A tap on a stage's ⚠n: Health, scrolled to that stage (§7.2). */
  readonly onProblems?: (stage: Stage) => void;
  readonly className?: string;
}

export function Path({ stage, readiness, onStage, onProblems, className }: PathProps): JSX.Element {
  const items: SegmentedItem<Stage>[] = STAGES.map((id) => {
    const r = readiness.stages[id];
    return {
      value: id,
      label: STAGE_LABEL[id],
      ariaLabel: stageName(id, r),
      badge: (
        <span
          aria-hidden="true"
          data-glyph={r.glyph}
          data-testid={`halo-path-glyph-${id}`}
          className={r.glyph === 'warn' ? 'font-semibold text-warn' : 'text-fg-3'}
        >
          {glyphText(r)}
        </span>
      ),
    };
  });
  // A tap on the selected stage's tab: its ⚠n opens Health at that stage (the segmented control only reports changes).
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const tab = (event.target as Element).closest('[role="tab"]');
    if (tab === null || tab.getAttribute('aria-selected') !== 'true') return;
    const index = [...(tab.parentElement?.children ?? [])].indexOf(tab);
    const tapped = STAGES[index];
    if (tapped !== undefined && readiness.stages[tapped].glyph === 'warn') onProblems?.(tapped);
  };
  return (
    <Cluster className={className ?? 'max-w-full overflow-x-auto p-[3px]'} data-touch-scroll="" onClick={onClick}>
      <Segmented<Stage>
        kind="tablist"
        variant="accent"
        label="Stage"
        data-testid="halo-path"
        value={stage}
        onValueChange={onStage}
        items={items}
      />
    </Cluster>
  );
}
