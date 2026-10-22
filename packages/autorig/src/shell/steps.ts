// The step registry of the frame (AUTORIG-SPEC §4.2, §5; D3): per step its workspace, its rig mode and its pane
// grid, and where its view comes from. The ① view is D3's own; ②–⑤ come from their packages' `steps/<step>/index.ts`,
// which may export (D4–D6, additive):
//
//   export const stepView: () => Promise<{ default: ComponentType<StepViewProps> }>;   // lazy: its own chunk
//   export const stepPanes: (session: AutoRigSession) => readonly StepPane[];            // the pane grid
//   export const stepEnter: (ctx: WizardContext) => Promise<void> | void;              // the step's own start (§4.2)
//
// Until a package lands its view, the frame shows the step's placeholder (`StepPlaceholder`).
import type { WorkspaceId } from '@ekza-studio/editor-core';
import type { ComponentType } from 'react';
import * as animations from '../steps/animations';
import * as exportStep from '../steps/export';
import * as markers from '../steps/markers';
import * as rig from '../steps/rig';
import type { AutoRigSession, AutoRigStep } from '../types';
import type { WizardContext } from './context';

/** Where a step view renders: the side panel (a bottom sheet below 1024 px) or over the pane grid. */
export type StepSlot = 'panel' | 'overlay';

export interface StepViewProps {
  readonly ctx: WizardContext;
  readonly slot: StepSlot;
}

export interface StepPane {
  readonly id: string;
  /** Relative width in the grid (R-Markers: 40/30/30). */
  readonly size?: number;
}

export interface StepModule {
  readonly stepView?: () => Promise<{ readonly default: ComponentType<StepViewProps> }>;
  readonly stepPanes?: (session: AutoRigSession) => readonly StepPane[];
  readonly stepEnter?: (ctx: WizardContext) => Promise<void> | void;
}

/** §4.2: the workspace of each step (Animations runs in Animate; every other step in Rig & Skin). */
export const STEP_WORKSPACE: Readonly<Record<AutoRigStep, WorkspaceId>> = {
  model: 'rig',
  markers: 'rig',
  rig: 'rig',
  animations: 'animate',
  export: 'rig',
};

/** The Studio workspace *Open in Studio* lands in (§3.4): Animate from ④, Rig & Skin from every other step. */
export const studioWorkspace = (step: AutoRigStep): 'rig' | 'animate' => (step === 'animations' ? 'animate' : 'rig');

/** §4.2: the rig mode a step enters with (③ sets its own after `autorig.rig`; ④ has none). */
export const STEP_MODE: Readonly<Record<AutoRigStep, 'object' | null>> = {
  model: 'object',
  markers: 'object',
  rig: null,
  animations: null,
  export: 'object',
};

/** The single perspective pane of ①, ④, ⑤ and the placeholders: the R-Markers persp pane id (`RIG_MARKER_PANES.persp`,
 *  written out: importing the constant from `/autorig` costs `/editor` bytes, AR-D3-1), so its camera stays. */
export const PERSP_PANE_ID = 'pane-persp';
export const PERSP_PANES: readonly StepPane[] = [{ id: PERSP_PANE_ID }];

const MODULES: Readonly<Partial<Record<AutoRigStep, StepModule>>> = {
  markers: markers as StepModule,
  rig: rig as StepModule,
  animations: animations as StepModule,
  export: exportStep as StepModule,
};

/** The module of a step package (② – ⑤), or an empty one (①'s view is the frame's own). */
export function stepModule(step: AutoRigStep): StepModule {
  return MODULES[step] ?? {};
}

export function stepPanes(step: AutoRigStep, session: AutoRigSession): readonly StepPane[] {
  return stepModule(step).stepPanes?.(session) ?? PERSP_PANES;
}
