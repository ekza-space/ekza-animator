// The component selection service and its B10 helpers (M6A-SPEC §4.6, §5.6).
export { type ModelPointerProbe, modelPointer, provideModelPointer } from './probes';
export {
  type ClickRecord,
  type ComponentSelectionDeps,
  type ComponentServiceInternals,
  componentInternals,
  createComponentSelectionService,
} from './service';
export { type Frozen, KINDS, type Sizes } from './state';
export { facesTouching, forEachEdgeFace, forEachFaceCorner, forEachVertEdge, hiddenClosure } from './topology';
