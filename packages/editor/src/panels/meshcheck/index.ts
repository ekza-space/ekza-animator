// The Mesh Check panel directory (M6A-SPEC §5.25, §8.2, §8.10; B10): Model's bottom dock tab. Registered by
// panels/index.ts; the body is a lazy chunk.
import type { Disposer } from '@ekza-animator/anim-core';
import { MODEL_PANEL } from '../../shell/layout';
import type { PanelDef, PanelRegistry } from '../types';
import { MeshCheckPanel } from './MeshCheckPanel';

export const MESH_CHECK_PANEL: PanelDef = {
  id: MODEL_PANEL.meshCheck,
  kind: MODEL_PANEL.meshCheck,
  title: 'Mesh Check',
  component: MeshCheckPanel,
  keyScope: MODEL_PANEL.meshCheck,
};

export function registerMeshCheckPanel(registry: PanelRegistry): Disposer {
  return registry.register(MESH_CHECK_PANEL);
}
