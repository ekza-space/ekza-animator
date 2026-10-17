// Session invariants the kernel maintains for every writer (operators, tools, panels, the playback clock):
//
// - Pose overrides belong to one clip frame: when a character's active clip or clip frame changes (scrub, playback,
//   clip switch, clip settings, document load) its overrides are discarded, from the session and from the editor
//   history (MVP-SPEC §4.11.2, ADR 0013 §4).
// - After a committed batch the session points only at live records: an active character and an active clip per
//   character (repaired to the first one when missing), a selection, overrides and feet pins without deleted ids.
// - `dirty` tracks unsaved document changes: set by committed batches, cleared by a document load.
import type { CharacterId, ChannelValues, ControlId, DocumentStore } from '@ekza-animator/doc';
import type { KernelDeps } from '../app/deps';
import type { KernelEvaluation } from '../evaluation/service';
import { activeClipOf, clipFrameAt, sceneFpsOf } from '../evaluation/time';
import type { KernelHistory } from '../history/history';
import type { SessionState, SessionStore } from '../types';
import { repairSession } from './repair';

export interface SessionKeeper {
  dispose(): void;
}

export function createSessionKeeper(ctx: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly deps: KernelDeps;
  readonly history: KernelHistory;
  readonly evaluation: KernelEvaluation;
}): SessionKeeper {
  const { store, session, deps, history, evaluation } = ctx;
  /** `clip@frame` per character with an active clip. */
  let locations = new Map<CharacterId, string>();

  const locate = (state: SessionState): Map<CharacterId, string> => {
    const next = new Map<CharacterId, string>();
    const sceneFps = sceneFpsOf(store);
    for (const character of Object.keys(state.activeClip) as CharacterId[]) {
      const clip = activeClipOf(store, state, character);
      if (clip !== undefined)
        next.set(character, `${clip.id}@${clipFrameAt(deps, sceneFps, clip, state.time.sceneFrame)}`);
    }
    return next;
  };

  /** Drops the overrides of characters whose clip or clip frame changed since the last check. */
  const checkLocations = (): void => {
    const state = session.getState();
    const next = locate(state);
    const moved = new Set<CharacterId>();
    for (const character of new Set([...locations.keys(), ...next.keys()])) {
      if (locations.get(character) !== next.get(character)) moved.add(character);
    }
    locations = next;
    if (moved.size === 0) return;
    if (state.overrides.size > 0) {
      const kept = new Map<ControlId, ChannelValues>();
      for (const [control, values] of state.overrides) {
        const owner = evaluation.characterOf(control);
        if (owner === null || !moved.has(owner)) kept.set(control, values);
      }
      if (kept.size !== state.overrides.size) session.setState({ overrides: kept });
    }
    for (const character of moved) history.dropOverrides({ character });
  };

  locations = locate(session.getState());
  const unsubscribeSession = session.subscribe((state, previous) => {
    if (state.time.sceneFrame !== previous.time.sceneFrame || state.activeClip !== previous.activeClip)
      checkLocations();
  });
  const unsubscribeStore = store.subscribe((batch) => {
    if (batch.origin === 'preview') return;
    const patch = repairSession(store, session.getState(), batch.origin);
    if (patch !== null) session.setState(patch);
    // Clip fps, range, scene start or loop may have moved a clip frame without a session change.
    if (
      batch.origin === 'load' ||
      batch.changes.some((change) => change.table === 'clips' || change.table === 'project')
    ) {
      checkLocations();
    }
  });

  return {
    dispose(): void {
      unsubscribeSession();
      unsubscribeStore();
    },
  };
}
