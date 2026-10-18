// Graph Editor tools (MVP-SPEC §4.11.18, keymap Q/W/I; M2A-SPEC §5.15.3 R = Scale): registered through the tool
// registry so extensions can add more. The controller owns the press/drag state machine; a tool decides what an LMB press means through the host.
// Navigation (Alt+MMB/RMB, wheel) and MMB moves are tool-independent and never reach a tool.
import {
  type EditorApp,
  GRAPH_TOOL,
  PANEL,
  type ToolDef,
  type ToolInstance,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import type { GraphEditorController } from '../graph/GraphEditorController';
import type { GraphHit } from '../types';

/** What a Graph Editor tool can ask its controller to do. */
export interface GraphToolHost {
  readonly controller: GraphEditorController;
  hitTest(x: number, y: number): GraphHit;
  /**
   * The default press: click selects keys and handles (Shift toggle, Mod remove, Mod+Shift add), a drag on a selected
   * (or just clicked) key/handle moves the selection, a double-click on a curve or key selects all keys of that
   * curve; on empty space a drag draws a marquee (`empty: 'marquee'`) or moves the current selection
   * (`empty: 'move'`).
   */
  press(e: ToolPointerEvent, opts: { readonly empty: 'marquee' | 'move' }): void;
  /** Click (no drag) inserts a shape-preserving key on `curve` at the hit frame (`graph.key.insert`). */
  pressInsert(e: ToolPointerEvent, hit: Extract<GraphHit, { readonly kind: 'curve' }>): void;
  /** M2a §5.15.3: the Scale tool's press (region box edges and corners, inside moves, outside scales). */
  pressScale(e: ToolPointerEvent): void;
}

function pressTool(empty: 'marquee' | 'move', host: GraphToolHost, cursor: string): ToolInstance {
  return {
    pointerDown(e) {
      if (e.button !== 0) return false;
      host.press(e, { empty });
      return true;
    },
    cursor: () => cursor,
  };
}

export const GRAPH_SELECT_TOOL: ToolDef<GraphToolHost> = {
  id: GRAPH_TOOL.select,
  panel: PANEL.graph,
  label: 'Select',
  icon: 'select',
  create: (_app: EditorApp, host: GraphToolHost) => pressTool('marquee', host, 'default'),
};

/**
 * Move tool: Maya's Move Keys tool behaves like Select in the Graph Editor (MVP-SPEC §4.11.18: LMB drag on a
 * selected key or handle moves, on empty space draws a marquee); it differs by its cursor.
 */
export const GRAPH_MOVE_TOOL: ToolDef<GraphToolHost> = {
  id: GRAPH_TOOL.move,
  panel: PANEL.graph,
  label: 'Move Keys',
  icon: 'move',
  create: (_app: EditorApp, host: GraphToolHost) => pressTool('marquee', host, 'move'),
};

/** Insert tool: click on a curve inserts a shape-preserving key; elsewhere it selects like the Select tool. */
export const GRAPH_INSERT_TOOL: ToolDef<GraphToolHost> = {
  id: GRAPH_TOOL.insert,
  panel: PANEL.graph,
  label: 'Insert Keys',
  icon: 'insert',
  create: (_app: EditorApp, host: GraphToolHost): ToolInstance => ({
    pointerDown(e) {
      if (e.button !== 0) return false;
      const hit = host.hitTest(e.x, e.y);
      if (hit.kind === 'curve') host.pressInsert(e, hit);
      else host.press(e, { empty: 'marquee' });
      return true;
    },
    cursor: () => 'crosshair',
  }),
};

/**
 * M2a Scale tool (R, `ge-tool-scale`): with keys selected a region box spans their time and value bounds; dragging an
 * edge or corner scales around the opposite one, the inside moves, outside scales around the press point.
 */
export const GRAPH_SCALE_TOOL: ToolDef<GraphToolHost> = {
  id: GRAPH_TOOL.scale,
  panel: PANEL.graph,
  label: 'Scale Keys',
  icon: 'scale',
  create: (_app: EditorApp, host: GraphToolHost): ToolInstance => ({
    pointerDown(e) {
      if (e.button !== 0) return false;
      host.pressScale(e);
      return true;
    },
    cursor: () => 'ew-resize',
  }),
};

export const GRAPH_TOOLS: readonly ToolDef<GraphToolHost>[] = [
  GRAPH_SELECT_TOOL,
  GRAPH_MOVE_TOOL,
  GRAPH_INSERT_TOOL,
  GRAPH_SCALE_TOOL,
];

export function builtinGraphTool(id: string): ToolDef<GraphToolHost> | undefined {
  return GRAPH_TOOLS.find((tool) => tool.id === id);
}
