// The Path's stages as the shell needs them (STUDIO-TOUCH-SPEC §7.1, ST-3): the workspace each runs in, its default
// viewport tool and its stage lighting (§4.7, a non-persisted display overlay). The stage packages (T7–T11) add the
// tray, verb overrides and readiness in `stages/*/stage.ts`; this table is the part the grammar needs to switch.
import type { HaloStage, ToolId, WorkspaceId } from '@ekza-studio/editor-core';
import { VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { DisplayOverlay } from '@ekza-studio/viewport';

/** The Path's stages in order (§7.1, ST-3). */
export const HALO_STAGES: readonly HaloStage[] = ['make', 'paint', 'rig', 'animate'];

/** The single pane's id: Studio Pro's, so the camera memory is shared (§4.1, §16.1). */
export const PANE = 'pane-single';

export interface StageBasics {
  readonly workspace: WorkspaceId;
  /** The viewport tool a stage starts with (Paint: the Paint Colour tool). */
  readonly tool: ToolId;
  /** §4.7 stage lighting: Make clay with wire on the selection, Paint lit colours, Rig x-ray at 40 %, Animate shaded. */
  readonly overlay: DisplayOverlay;
}

export const STAGE_BASICS: Readonly<Record<HaloStage, StageBasics>> = {
  make: { workspace: 'model', tool: VIEWPORT_TOOL.select, overlay: { shading: 'shaded', wireOnShaded: false } },
  paint: { workspace: 'model', tool: VIEWPORT_TOOL.paint, overlay: { shading: 'colours' } },
  rig: { workspace: 'rig', tool: VIEWPORT_TOOL.select, overlay: { xray: true, xrayOpacity: 0.4 } },
  animate: { workspace: 'animate', tool: VIEWPORT_TOOL.select, overlay: { shading: 'lit' } },
};

/**
 * The stage a workspace arrives at (§16.1, Pro → Ekza Studio): Model → Make, Rig & Skin → Rig, Animate → Animate;
 * any other workspace (Review, an extension's) → Make. The finer arrival (Paint while the Paint Colour tool is active)
 * is `arrivalStage`.
 */
export function stageOfWorkspace(workspace: WorkspaceId): HaloStage {
  return workspace === 'rig' ? 'rig' : workspace === 'animate' ? 'animate' : 'make';
}

/** The workspace a stage runs in (§7.1): Make and Paint in Model, Rig in Rig & Skin, Animate in Animate. */
export function workspaceOfStage(stage: HaloStage): WorkspaceId {
  return STAGE_BASICS[stage].workspace;
}

/** P-T3-4: the arrival picks the finer stage — Paint when Model's active tool is the Paint Colour tool. */
export function arrivalStage(workspace: WorkspaceId, tool: ToolId): HaloStage {
  const stage = stageOfWorkspace(workspace);
  return stage === 'make' && workspace === 'model' && tool === VIEWPORT_TOOL.paint ? 'paint' : stage;
}

/** A `?stage=` value, or null. */
export function parseStage(value: string | null): HaloStage | null {
  return (HALO_STAGES as readonly (string | null)[]).includes(value) ? (value as HaloStage) : null;
}
