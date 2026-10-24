// @ekza-studio/halo — Ekza Studio's Simple layout (STUDIO-TOUCH-SPEC, ADR 0023; working name Halo): a third shell over
// the same EditorApp, document, undo history and operators as Studio Pro (`/editor`) and Auto-Rig. It adds no
// modeling, rigging, animation or export logic: every document write is an operator run. Only `/app`'s entry group
// (`apps/web/app/(studio)/app/HaloEntry.tsx`) imports this package; `/editor` and `/autorig` must never load it (the
// `halo-shell` size boundary). Dependency direction (§20.1): anim-core, doc, editor-core, viewport, curve-editor
// (lazy imports only), ui and `@ekza-studio/editor` through its `./host` subpath (and the measured subpaths that
// T5c adds); never the editor root, autorig, mesh-core, rig, io, mesh-view or dockview (oxlint, check-deps).
//
// T2 froze the package's contract; T6a's input grammar is the shell (`./shell/**`): the frame, the arbiter's gestures,
// the Halo, the Thumb key, Echo chips and forms, the session bar, the dialog watcher and search.
import type { HaloHandoffState, HaloStage } from '@ekza-studio/editor-core';

export type { HaloHandoffState, HaloStage };

export { HALO_SHELL_MARKER } from './shell/Frame';
export { HaloShell } from './shell/HaloShell';
export { HALO_SESSION_KEY } from './shell/mirror';
export { HALO_STAGES, stageOfWorkspace, workspaceOfStage } from './shell/stage';
