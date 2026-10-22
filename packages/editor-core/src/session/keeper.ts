// Session invariants the kernel maintains for every writer (operators, tools, panels, the playback clock):
//
// - Pose overrides belong to one clip frame: when a character's active clip or clip frame changes (scrub, playback,
//   clip switch, clip settings, document load) its overrides are discarded, from the session and from the editor
//   history (MVP-SPEC §4.11.2, ADR 0013 §4).
// - After a committed batch the session points only at live records: an active character and an active clip per
//   character (repaired to the first one when missing), a selection, overrides and feet pins without deleted ids.
// - `dirty` tracks unsaved document changes: set by committed batches, cleared by a document load.
import type { ChangeBatch, CharacterId, ChannelValues, ClipId, ControlId, DocumentStore } from '@ekza-studio/doc';
import type { KernelDeps } from '../app/deps';
import type { KernelEvaluation } from '../evaluation/service';
import { activeClipOf, clipFrameAt, sceneFpsOf } from '../evaluation/time';
import type { KernelHistory } from '../history/history';
import type { SessionState, SessionStore } from '../types';
import { isDocumentLoad } from './loads';
import { repairSession, templateSymmetry } from './repair';

/**
 * The clips a redo brought back, as the active clip of their character (the first in the character's clip order):
 * the operator that made them active (Use Clip, imports, New Clip) does not run again on redo, and the session
 * repair keeps whatever clip is still valid, so without this redo would leave the earlier clip active (M6b acceptance).
 */
function revivedClips(store: DocumentStore, batch: ChangeBatch): Record<CharacterId, ClipId> | null {
  const revived = new Set<string>();
  for (const change of batch.changes) {
    if (change.table !== 'clips' || change.after === undefined || change.after.deleted !== null) continue;
    if (change.before === undefined || change.before.deleted !== null) revived.add(change.id);
  }
  if (revived.size === 0) return null;
  const out: Record<CharacterId, ClipId> = {};
  for (const id of revived) {
    const clip = store.get('clips', id as ClipId);
    if (clip === undefined || out[clip.character] !== undefined) continue;
    const first = store.query.clipsOfCharacter(clip.character).find((other) => revived.has(other.id));
    if (first !== undefined) out[clip.character] = first.id;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export interface SessionKeeper {
  dispose(): void;
}

export function createSessionKeeper(ctx: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly deps: KernelDeps;
  readonly history: KernelHistory;
  readonly evaluation: KernelEvaluation;
  /** The preferences' symmetry tolerance (metres) a reloaded template mesh's Object X takes. */
  readonly symmetryTolerance?: () => number;
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
    const cause = batch.origin !== 'load' ? 'commit' : isDocumentLoad(store, batch) ? 'load' : 'visibility';
    const patch = repairSession(store, session.getState(), cause);
    if (patch !== null) session.setState(patch);
    if (batch.origin === 'redo') {
      const revived = revivedClips(store, batch);
      if (revived !== null) session.setState({ activeClip: { ...session.getState().activeClip, ...revived } });
    }
    if (cause === 'load' && ctx.symmetryTolerance !== undefined) {
      const model = session.getState().model;
      const next = templateSymmetry(store, model, ctx.symmetryTolerance());
      if (next !== model) session.setState({ model: next });
    }
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
