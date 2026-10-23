// The tool catalogue in `tools/list` order (MCP-SPEC §6: the order of the §6.0 table), core tools 1–39 then the
// stretch tools S1–S4. D0 owns this file (closed after D0): owners change their own `defs.ts`, never the order.
import type { AgentToolDef } from '../types';
import { analyzeContacts, analyzeDiff, analyzeLoop, analyzeMotion } from './analyze/defs';
import { clipCreate, clipDelete, clipMakeLoop, clipUpdate } from './clip/defs';
import { editorConnect, projectClose, projectsList } from './connection/defs';
import { curvesEulerFilter, curvesSetInterpolation, curvesSimplify, curvesSummary } from './curves/defs';
import { projectExport, projectImport, projectOpen, projectSave } from './files/defs';
import { historyCheckpoint, historyRevert } from './history/defs';
import { keysAdjust, keysDelete, keysRead, keysRetime, keysSet, keysTween } from './keys/defs';
import { operatorDescribe, operatorRun, operatorsList } from './operators/defs';
import { poseAim, poseIkTarget, posePlantFeet, poseRead, poseReset, poseSet, poseTransfer } from './pose/defs';
import { recipeApply } from './recipes/defs';
import { rigDescribe } from './rig/defs';
import { sceneSummary } from './scene/defs';
import { registerFileToolHooks } from './files/run';
import { libraryList, libraryUse, modelFix, modelInspect, rigCreate } from './setup/defs';
import { SETUP_EXPORT, SETUP_IMPORT } from './setup/files';
import { viewCapture, viewPlotCurves, viewSetTime } from './view/defs';

const CATALOGUE: readonly AgentToolDef[] = Object.freeze([
  editorConnect, // 1
  projectsList, // 2
  projectClose, // 3
  sceneSummary, // 4
  rigDescribe, // 5
  keysRead, // 6
  curvesSummary, // 7
  poseRead, // 8
  poseSet, // 9
  poseAim, // 10
  poseIkTarget, // 11
  poseTransfer, // 12
  poseReset, // 13
  keysSet, // 14
  keysDelete, // 15
  keysAdjust, // 16
  keysRetime, // 17
  keysTween, // 18
  curvesSetInterpolation, // 19
  curvesEulerFilter, // 20
  curvesSimplify, // 21
  clipCreate, // 22
  clipUpdate, // 23
  clipMakeLoop, // 24
  clipDelete, // 25
  analyzeContacts, // 26
  analyzeLoop, // 27
  analyzeMotion, // 28
  viewCapture, // 29
  viewPlotCurves, // 30
  historyCheckpoint, // 31
  historyRevert, // 32
  projectOpen, // 33
  projectImport, // 34
  projectSave, // 35
  projectExport, // 36
  operatorsList, // 37
  operatorDescribe, // 38
  operatorRun, // 39
  posePlantFeet, // S1
  analyzeDiff, // S2
  viewSetTime, // S3
  recipeApply, // S4
  modelInspect, // B4: character setup (§0.4.4)
  modelFix, // B4
  rigCreate, // B4
  libraryList, // B4
  libraryUse, // B4
]);

/** Number of core tools (§1.1) and stretch tools (§1.2). */
export const CORE_TOOL_COUNT = 39;
export const STRETCH_TOOL_COUNT = 4;
/** The character setup tools of MCP-SPEC §0.4.4 (B4; core tools of the MVP, listed after the stretch tools). */
export const SETUP_TOOL_COUNT = 5;

/** Every definition incl. not-ready ones (manifest generator, lint), in catalogue order. */
export function allTools(): readonly AgentToolDef[] {
  return CATALOGUE;
}

/** The ready tools of a set, in its order (what `tools/list` shows). */
export function readyTools(tools: readonly AgentToolDef[] = CATALOGUE): readonly AgentToolDef[] {
  return tools.filter((tool) => tool.ready);
}

// B1's project_import / project_export hand the character setup kinds to B4's hooks (M-AI-B1-6, M-AI-B4-1; INT).
registerFileToolHooks({ import: SETUP_IMPORT, export: SETUP_EXPORT });
