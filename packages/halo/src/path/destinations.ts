// Destinations and stages (STUDIO-TOUCH-SPEC §7.1, §7.3, ST-3, ST-4; T6b). The destination is asked where it matters
// (the Rig-it card's first line, Share's header) and maps to an existing export profile; *Just exploring* (the default)
// shows only Mesh Check errors and no destination nagging. Pure data and small helpers: no React, no kernel imports.
import type { WorkspaceId } from '@ekza-studio/editor-core';
import type { Stage } from '../manifest/types';

export type DestinationId = 'omoba' | 'engine' | 'animations' | 'prop' | 'original' | 'exploring';

export interface Destination {
  readonly id: DestinationId;
  /** The plain name (Share's `For:` chips, the Rig-it card, the badge on `Share ⤴`). */
  readonly name: string;
  /** A short badge for `Share ⤴` (null: no badge). */
  readonly badge: string | null;
  /** The export profile it maps to; `'source'`: the source file's own profile; null: none (Just exploring). */
  readonly profile: string | null;
  /** Triangle budget of the destination's profile, when it has one (the status corner's budget ring). */
  readonly triangleBudget: number | null;
  /** Does the destination need a rigged character (Rig's readiness)? */
  readonly needsRig: boolean;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: 'omoba',
    name: 'OMOBA & Ekza Space',
    badge: 'OMOBA',
    profile: 'ekza/space-avatar-v1',
    triangleBudget: null,
    needsRig: true,
  },
  {
    id: 'engine',
    name: 'Game engine',
    badge: 'GLB',
    profile: 'local/generic',
    triangleBudget: null,
    needsRig: false,
  },
  {
    id: 'animations',
    name: 'Just the animations',
    badge: 'VRMA',
    profile: 'ekza/vrma-humanoid-v1',
    triangleBudget: null,
    needsRig: true,
  },
  {
    id: 'prop',
    name: 'Prop for OMOBA',
    badge: 'Prop',
    profile: 'ekza/omoba-handheld-v1',
    // The hand-held prop budget (editor-core `BUDGET_TRIS.handheld`); a mesh's own budget wins when larger.
    triangleBudget: 600,
    needsRig: false,
  },
  {
    id: 'original',
    name: 'Into the original file',
    badge: 'Bake',
    profile: 'source',
    triangleBudget: null,
    needsRig: false,
  },
  {
    id: 'exploring',
    name: 'Just exploring',
    badge: null,
    profile: null,
    triangleBudget: null,
    needsRig: false,
  },
];

/** ST-4: a new session's destination. */
export const DEFAULT_DESTINATION: DestinationId = 'exploring';

export function destinationOf(id: DestinationId | string | null | undefined): Destination {
  return DESTINATIONS.find((d) => d.id === id) ?? (DESTINATIONS.at(-1) as Destination);
}

/** §7.1: Make and Paint run in Model, Rig in Rig & Skin, Animate in Animate. */
export const STAGE_WORKSPACE: Readonly<Record<Stage, WorkspaceId>> = {
  make: 'model',
  paint: 'model',
  rig: 'rig',
  animate: 'animate',
};

/** The stages that show an operator listed for these workspaces (Review shows in none). */
export function stagesOfWorkspaces(workspaces: readonly string[]): readonly Stage[] {
  const out: Stage[] = [];
  if (workspaces.includes('model')) out.push('make', 'paint');
  if (workspaces.includes('rig')) out.push('rig');
  if (workspaces.includes('animate')) out.push('animate');
  return out;
}
