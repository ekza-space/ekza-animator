// `app.components` (M6A-SPEC §9.1: one factory file per editor service; owned by B10 after B0a).
import { createComponentSelectionService } from '../../selection';
import type { ComponentSelectionService, MeshRuntimeRegistry, SessionStore } from '../../types';

export function createComponents(deps: {
  readonly session: SessionStore;
  readonly meshes: () => MeshRuntimeRegistry;
}): ComponentSelectionService {
  return createComponentSelectionService(deps);
}
