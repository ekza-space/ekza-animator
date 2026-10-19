// `app.components` (M6A-SPEC §9.1: one factory file per editor service; owned by B10 after B0a). M6A-INT-14: the
// service loads with the mesh kernel; the app gets its eager facade (`selection/component/facade.ts`).
import { createComponentSelectionFacade } from '../../selection/component/facade';
import type { ComponentSelectionService, MeshRuntimeRegistry, SessionStore } from '../../types';

export function createComponents(deps: {
  readonly session: SessionStore;
  readonly meshes: () => MeshRuntimeRegistry;
}): ComponentSelectionService {
  return createComponentSelectionFacade(deps);
}
