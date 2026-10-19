// Viewport contributions (MVP-SPEC §4.9 owner 5, §7 WP-5): the `select` / `move` / `rotate` viewport tools and the
// operators view.layout, view.frame, view.display.toggle, view.lookThrough, view.copyViewToShot,
// view.toggleCameraLock and view.cameraRadial (M1-stretch: opens the pane's camera radial; the viewport panel draws
// it and picks on Space release).
// M6a (B9): the `scale` tool (`R`), every boolean display flag in view.display.toggle, and the pane display port of
// editor-core's view.shading / view.display.set.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import { type CameraId, type CameraRecord, fractionalIndex, newId } from '@ekza-animator/doc';
import {
  BOOLEAN_DISPLAY_FLAGS,
  type EditorApp,
  type OperatorArgs,
  type OperatorContext,
  type OperatorDef,
  type OperatorReturn,
  type PollResult,
  providePaneDisplay,
} from '@ekza-animator/editor-core';
import { firstShotCamera } from '../cameras/cameras';
import { LAYOUT_PANES } from '../panes/layout';
import { scaleToolDef } from '../tools/scaleTool';
import { attachModelSelect } from '../tools/model/select';
import { attachModelTransform } from '../tools/model/transform';
import { selectToolDef } from '../tools/selectTool';
import { moveToolDef, rotateToolDef } from '../tools/transformTool';
import type { DisplayFlags, PaneCamera, ViewPreset } from '../types';
import type { ViewportManager } from './ViewportManager';

type Def<K extends Parameters<EditorApp['run']>[0], P = void> = OperatorDef<OperatorArgs<K>, OperatorReturn<K>, P>;

const VIEW_PRESETS: readonly ViewPreset[] = ['persp', 'top', 'front', 'side'];
/** The on/off display flags (M6a: every boolean `DisplayFlags` field; enums go through view.display.set). */
const DISPLAY_FLAGS: readonly (keyof DisplayFlags)[] = BOOLEAN_DISPLAY_FLAGS;
const NO_PANE: PollResult = { ok: false, reason: 'no viewport pane' };

/** Registers the viewport tools and operators; the disposer removes them. */
export function registerViewportContributions(app: EditorApp, vm: ViewportManager): Disposer {
  const paneOf = (ctx: OperatorContext, explicit: string | undefined): string | null => {
    const candidates = [explicit, ctx.paneId, ctx.app.session.getState().hoveredPanel?.paneId, vm.activePaneId()];
    for (const id of candidates) if (id !== undefined && id !== null && vm.paneState(id) !== null) return id;
    return null;
  };

  const layout: Def<'view.layout'> = {
    id: 'view.layout',
    label: 'Viewport Layout',
    category: 'view',
    scope: 'viewport',
    poll: (_ctx, args) =>
      args !== undefined && args.layout in LAYOUT_PANES
        ? true
        : { ok: false, reason: `unknown layout '${String(args?.layout)}'` },
    apply: ({ app: a }, args) => {
      const session = a.session.getState();
      const keepMaximized =
        session.maximizedPane !== null && (LAYOUT_PANES[args.layout] ?? []).includes(session.maximizedPane);
      a.session.setState({ viewportLayout: args.layout, maximizedPane: keepMaximized ? session.maximizedPane : null });
    },
  };

  const frame: Def<'view.frame'> = {
    id: 'view.frame',
    label: 'Frame',
    category: 'view',
    scope: 'viewport',
    poll: (ctx, args) => (paneOf(ctx, args?.paneId) === null ? NO_PANE : true),
    apply: (ctx, args) => {
      const pane = paneOf(ctx, args.paneId);
      if (pane !== null) vm.frame(pane, args.what);
    },
  };

  const displayToggle: Def<'view.display.toggle'> = {
    id: 'view.display.toggle',
    label: 'Toggle Display',
    category: 'view',
    scope: 'viewport',
    poll: (ctx, args) => {
      if (args === undefined || !DISPLAY_FLAGS.includes(args.flag))
        return { ok: false, reason: 'unknown display flag' };
      return paneOf(ctx, args.paneId) === null ? NO_PANE : true;
    },
    apply: (ctx, args) => {
      const pane = paneOf(ctx, args.paneId);
      const state = pane === null ? null : vm.paneState(pane);
      if (pane === null || state === null) return;
      vm.updatePane(pane, { display: { ...state.display, [args.flag]: !state.display[args.flag] } });
    },
  };

  const lookThrough: Def<'view.lookThrough'> = {
    id: 'view.lookThrough',
    label: 'Look Through',
    category: 'view',
    scope: 'viewport',
    poll: (ctx, args) => {
      if (args === undefined || vm.paneState(args.paneId) === null) return NO_PANE;
      return validCamera(ctx.app, args.camera);
    },
    apply: (_ctx, args) => vm.updatePane(args.paneId, { camera: args.camera }),
  };

  const copyViewToShot: Def<'view.copyViewToShot'> = {
    id: 'view.copyViewToShot',
    label: 'Copy View to Shot Camera',
    category: 'view',
    scope: 'viewport',
    flags: { undo: true },
    poll: (ctx, args) => {
      if (args === undefined || vm.paneState(args.paneId) === null) return NO_PANE;
      if (args.cameraId !== undefined && ctx.app.store.get('cameras', args.cameraId) === undefined) {
        return { ok: false, reason: 'no such camera' };
      }
      return true;
    },
    apply: ({ tx }, args) => {
      if (tx === null) throw new EkzaError('internal', 'view.copyViewToShot runs inside a transaction');
      const snapshot = vm.camera(args.paneId);
      const fields: Partial<CameraRecord> = {
        projection: snapshot.projection,
        transform: { t: snapshot.position, q: snapshot.quaternion, s: [1, 1, 1] },
        target: snapshot.target,
        ...(snapshot.projection === 'perspective' ? { fovY: snapshot.fovY } : { orthoHeight: snapshot.orthoHeight }),
      };
      const existing =
        args.cameraId === undefined ? firstShotCamera(tx.list('cameras')) : (tx.get('cameras', args.cameraId) ?? null);
      if (existing !== null) {
        tx.patch('cameras', existing.id, fields);
        return { cameraId: existing.id };
      }
      const cameras = tx.list('cameras');
      const last = cameras.reduce<string | null>((max, c) => (max === null || c.order > max ? c.order : max), null);
      // A seeded ID source (?e2e=1) replays its sequence per session: skip IDs a reopened project already uses.
      let id = newId('camera');
      for (let attempt = 0; attempt < 64 && tx.getIncludingDeleted('cameras', id) !== undefined; attempt++) {
        id = newId('camera');
      }
      const record: CameraRecord = {
        id,
        name: 'shotCam',
        projection: snapshot.projection,
        fovY: snapshot.projection === 'perspective' ? snapshot.fovY : (50 * Math.PI) / 180,
        orthoHeight: snapshot.projection === 'orthographic' ? snapshot.orthoHeight : 2,
        near: 0.01,
        far: 1000,
        transform: { t: snapshot.position, q: snapshot.quaternion, s: [1, 1, 1] },
        target: snapshot.target,
        aspect: null,
        locked: false,
        order: fractionalIndex(last, null),
        deleted: null,
      };
      tx.put('cameras', record);
      return { cameraId: id };
    },
  };

  const shotOf = (ctx: OperatorContext, args: OperatorArgs<'view.toggleCameraLock'>): CameraId | null => {
    if (args?.cameraId !== undefined)
      return ctx.app.store.get('cameras', args.cameraId) === undefined ? null : args.cameraId;
    const pane = paneOf(ctx, args?.paneId);
    return pane === null ? null : (vm.paneState(pane)?.shotCameraId ?? null);
  };

  const toggleLock: Def<'view.toggleCameraLock'> = {
    id: 'view.toggleCameraLock',
    label: 'Toggle Camera Lock',
    category: 'view',
    scope: 'viewport',
    flags: { undo: true },
    undoLabel: () => 'Toggle Camera Lock',
    poll: (ctx, args) =>
      shotOf(ctx, args) === null ? { ok: false, reason: 'the pane does not look through a shot camera' } : true,
    apply: (ctx, args) => {
      const id = shotOf(ctx, args);
      const record = id === null || ctx.tx === null ? undefined : ctx.tx.get('cameras', id);
      if (id === null || ctx.tx === null || record === undefined) return;
      ctx.tx.patch('cameras', id, { locked: !record.locked });
    },
  };

  const cameraRadial: Def<'view.cameraRadial'> = {
    id: 'view.cameraRadial',
    label: 'Camera Radial',
    category: 'view',
    scope: 'viewport',
    flags: { internal: true },
    poll: (ctx, args) => (paneOf(ctx, args?.paneId) === null ? NO_PANE : true),
    apply: (ctx, args) => {
      const pane = paneOf(ctx, args?.paneId);
      if (pane !== null) vm.openRadial(pane);
    },
  };

  const disposers: Disposer[] = [
    app.contribute({ kind: 'tool', def: selectToolDef() }),
    app.contribute({ kind: 'tool', def: moveToolDef() }),
    app.contribute({ kind: 'tool', def: rotateToolDef() }),
    app.contribute({ kind: 'tool', def: scaleToolDef() }),
    // M6a: view.shading and view.display.set (editor-core) change pane display flags through this port.
    providePaneDisplay(app, {
      panes: () => vm.paneIds(),
      activePane: () => vm.activePaneId(),
      display: (paneId) => vm.paneState(paneId)?.display ?? null,
      setDisplay: (paneId, display) => vm.updatePane(paneId, { display }),
    }),
    ...[layout, frame, displayToggle, lookThrough, copyViewToShot, toggleLock, cameraRadial].map((def) =>
      app.contribute({ kind: 'operator', def: def as unknown as OperatorDef<unknown, unknown, unknown> }),
    ),
    // M6a (B10): the mesh display and the Model select runtime (lazy; loaded with the first mesh or Model).
    attachModelSelect(app, vm),
    attachModelTransform(app, vm),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}

function validCamera(app: EditorApp, camera: PaneCamera): PollResult {
  if (camera.kind === 'view')
    return VIEW_PRESETS.includes(camera.preset) ? true : { ok: false, reason: 'unknown view' };
  return app.store.get('cameras', camera.cameraId) === undefined ? { ok: false, reason: 'no such camera' } : true;
}
