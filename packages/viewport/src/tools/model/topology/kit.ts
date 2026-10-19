// The topology kit (M6A-SPEC §4.7, §5.27; B12b), the lazy chunk behind the eager tool definitions of ./index.ts:
// one runtime per viewport (previews, the extrude manipulator, hover, scratch runs) and the tools' behaviour.
import type { EditorApp, ToolInstance } from '@ekza-animator/editor-core';
import { VIEWPORT_TOOL } from '@ekza-animator/editor-core';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { extrudeGrabPoint, worldPerPixel } from '../../../manipulators/extrude/geometry';
import type { ManipHandle } from '../../../types';
import type { ViewportToolHost } from '../../host';
import { ExtrudeTool } from '../extrude/tool';
import { InsertLoopTool } from '../loop/tool';
import { MultiCutTool } from '../multicut/tool';
import { SlideTool } from '../slide/tool';
import { TargetWeldTool } from '../weld/tool';
import { TopologyRuntime } from './runtime';

const runtimes = new WeakMap<ViewportManager, TopologyRuntime>();

/** The viewport's topology runtime (created on first use). */
export function topologyRuntime(app: EditorApp, vm: ViewportManager): TopologyRuntime {
  let runtime = runtimes.get(vm);
  if (runtime === undefined) {
    runtime = new TopologyRuntime(app, vm);
    runtimes.set(vm, runtime);
  }
  return runtime;
}

/** Creates the runtime of a viewport (the first Model entry), so its previews and manipulator are ready. */
export function attachTopology(app: EditorApp, vm: ViewportManager): void {
  topologyRuntime(app, vm);
}

export function detachTopology(_app: EditorApp, vm: ViewportManager): void {
  runtimes.get(vm)?.dispose();
  runtimes.delete(vm);
}

/** A topology tool's behaviour. */
export function createTopologyTool(
  id: string,
  app: EditorApp,
  vm: ViewportManager,
  host: ViewportToolHost,
): ToolInstance {
  const rt = topologyRuntime(app, vm);
  switch (id) {
    case VIEWPORT_TOOL.multiCut:
      return new MultiCutTool(app, rt);
    case VIEWPORT_TOOL.insertLoop:
      return new InsertLoopTool(app, rt);
    case VIEWPORT_TOOL.targetWeld:
      return new TargetWeldTool(app, rt);
    case VIEWPORT_TOOL.slide:
      return new SlideTool(app, rt);
    case VIEWPORT_TOOL.extrude:
      return new ExtrudeTool(app, rt, host);
    default:
      return {};
  }
}

/** Pane CSS px of a handle of the extrude manipulator while it shows, else null. */
export function manipulatorScreenPoint(
  vm: ViewportManager,
  paneId: string,
  handle: ManipHandle,
): { readonly x: number; readonly y: number } | null {
  const rt = runtimes.get(vm);
  rt?.refreshHandles();
  const frame = rt?.manipulator.current ?? null;
  const q = rt?.query(paneId) ?? null;
  if (rt === undefined || frame === null || q === null) return null;
  const s = worldPerPixel(q.camera, q.height, q.projector, [frame.pivot[0], frame.pivot[1], frame.pivot[2]]);
  return extrudeGrabPoint(frame, handle, s * rt.manipulator.size, q.projector);
}
