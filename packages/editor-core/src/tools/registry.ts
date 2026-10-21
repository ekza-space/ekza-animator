// Tool registry (ADR 0008 §3): per-panel interaction modes keyed by (panel, tool id). The active tool per panel is
// session state (`session.tools`); `view.tool` switches it.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { PanelKind, ToolDef, ToolId, ToolRegistry } from '../types';

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDef>();
  const keyOf = (panel: PanelKind, id: ToolId): string => `${panel}\u0000${id}`;
  return {
    register<H>(def: ToolDef<H>): Disposer {
      const key = keyOf(def.panel, def.id);
      if (tools.has(key)) throw new EkzaError('unsupported', `Tool '${def.panel}/${def.id}' is already registered`);
      // A ToolDef<H> is stored as ToolDef<unknown>: hosts look tools up by panel and pass their own host object.
      const stored = def as unknown as ToolDef;
      tools.set(key, stored);
      return () => {
        if (tools.get(key) === stored) tools.delete(key);
      };
    },
    get: (panel: PanelKind, id: ToolId) => tools.get(keyOf(panel, id)),
    list: (panel: PanelKind) => [...tools.values()].filter((tool) => tool.panel === panel),
  };
}
