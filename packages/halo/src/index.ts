// @ekza-studio/halo — Ekza Studio's Simple layout (STUDIO-TOUCH-SPEC, ADR 0023; working name Halo): a third shell over
// the same EditorApp, document, undo history and operators as Studio Pro (`/editor`) and Auto-Rig. It adds no
// modeling, rigging, animation or export logic: every document write is an operator run. Only `/app`'s entry group
// (`apps/web/app/(studio)/app/HaloEntry.tsx`) imports this package; `/editor` and `/autorig` must never load it (the
// `halo-shell` size boundary). Dependency direction (§20.1): anim-core, doc, editor-core, viewport, curve-editor
// (lazy imports only), ui and `@ekza-studio/editor` through its `./host` subpath (and the measured subpaths that
// T5c adds); never the editor root, autorig, mesh-core, rig, io, mesh-view or dockview (oxlint, check-deps).
//
// T2 (this file) freezes the package's contract and ships an empty shell: it mounts in the host as `kind: 'halo'`,
// reports its handoff state and offers the switch to the Pro layout. T6a replaces the shell (`./shell/**`) and
// re-exports it from here.
import type { HaloHandoffState, HaloStage, WorkspaceId } from '@ekza-studio/editor-core';
import { useHost } from '@ekza-studio/editor/host';
import { createElement, type JSX, useEffect } from 'react';

export type { HaloHandoffState, HaloStage };

/** `check-size` marker of the Halo shell's entry (§20.6): initial on `/app`, a banned boundary on `/editor` and `/autorig`. */
export const HALO_SHELL_MARKER = 'ekza-halo-shell' as const;

/** Halo's shell-local state mirror in `sessionStorage` (§16.1; the shape is T6a's, versioned by the key). */
export const HALO_SESSION_KEY = 'ekza-studio:halo:session:v1';

/** The Path's stages in order (§7.1, ST-3). */
export const HALO_STAGES: readonly HaloStage[] = ['make', 'paint', 'rig', 'animate'];

/**
 * The stage a workspace arrives at (§16.1, Pro → Ekza Studio): Model → Make, Rig & Skin → Rig, Animate → Animate;
 * any other workspace (Review, an extension's) → Make. Paint (Model with the Paint Colour tool) is T6a's refinement.
 */
export function stageOfWorkspace(workspace: WorkspaceId): HaloStage {
  return workspace === 'rig' ? 'rig' : workspace === 'animate' ? 'animate' : 'make';
}

/** The workspace a stage runs in (§7.1): Make and Paint in Model, Rig in Rig & Skin, Animate in Animate. */
export function workspaceOfStage(stage: HaloStage): WorkspaceId {
  return stage === 'rig' ? 'rig' : stage === 'animate' ? 'animate' : 'model';
}

/** The `/app` route's shell (T2: empty). */
export function HaloShell(): JSX.Element {
  const host = useHost();
  useEffect(
    () =>
      host.mount({
        kind: 'halo',
        haloState: () => ({ stage: stageOfWorkspace(host.app.session.getState().workspace) }),
      }),
    [host],
  );
  return createElement(
    'div',
    {
      className: 'relative z-(--z-chrome) flex h-full w-full flex-col',
      'data-shell': HALO_SHELL_MARKER,
      'data-testid': 'halo-shell',
    },
    createElement(
      'header',
      { className: 'flex h-11 shrink-0 items-center gap-2 border-b border-line bg-header px-2' },
      createElement('span', { className: 'shrink-0 font-semibold' }, 'Ekza Studio'),
      createElement('span', { className: 'flex-1' }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'min-w-0 truncate rounded-field px-1 text-fg hover:bg-hover pointer-coarse:min-h-11',
          'data-testid': 'halo-pro-layout',
          // From the tap handler itself: a same-page switch, the document and its undo history kept (§16.1).
          onClick: () => void host.navigation.go({ to: 'studio', from: 'halo' }),
        },
        '▤ Pro layout',
      ),
    ),
  );
}
