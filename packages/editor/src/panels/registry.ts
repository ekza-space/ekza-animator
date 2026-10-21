import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { PanelDef, PanelRegistry } from './types';

/**
 * Registration-ordered panel registry (MVP-SPEC §3 convention 10). A duplicate id throws; a disposer removes only
 * the definition it registered.
 */
export function createPanelRegistry(): PanelRegistry {
  const panels = new Map<string, PanelDef>();
  return {
    register(def: PanelDef): Disposer {
      if (panels.has(def.id)) throw new EkzaError('unsupported', `Panel '${def.id}' is already registered`);
      panels.set(def.id, def);
      return () => {
        if (panels.get(def.id) === def) panels.delete(def.id);
      };
    },
    get: (id: string) => panels.get(id),
    list: () => [...panels.values()],
  };
}
