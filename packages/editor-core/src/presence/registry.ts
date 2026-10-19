// Presence registry (MCP-SPEC §4.1, §5.11): who else is working in this editor and on what. M-AI fills it with the
// paired agent (its focus controls and frame, its activity); M3 collaboration adds remote users. Pure state with
// listeners: drawing (viewport outline, time-slider flag, status pill) subscribes; nothing here touches the session.
import type { Disposer } from '@ekza-animator/anim-core';
import { EkzaError } from '@ekza-animator/anim-core';
import type { PresenceFocus, PresencePeer, PresenceRegistry } from '../types';

/** At most this many focus controls are kept per peer (§4.1: "≤ 64"). */
export const PRESENCE_MAX_CONTROLS = 64;

function sameFocus(a: PresenceFocus | null, b: PresenceFocus | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.character !== b.character || a.clip !== b.clip || a.frame !== b.frame) return false;
  if (a.controls.length !== b.controls.length) return false;
  for (let i = 0; i < a.controls.length; i++) if (a.controls[i] !== b.controls[i]) return false;
  return true;
}

function samePeer(a: PresencePeer, b: Omit<PresencePeer, 'since'>): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.color === b.color &&
    a.activity === b.activity &&
    sameFocus(a.focus, b.focus)
  );
}

function frozenFocus(focus: PresenceFocus | null): PresenceFocus | null {
  if (focus === null) return null;
  return Object.freeze({
    character: focus.character,
    clip: focus.clip,
    controls: Object.freeze(focus.controls.slice(0, PRESENCE_MAX_CONTROLS)),
    frame: focus.frame,
  });
}

/** A registry of presence peers; `now` stamps `since` (default `Date.now`). */
export function createPresenceRegistry(opts?: { readonly now?: () => number }): PresenceRegistry {
  const now = opts?.now ?? Date.now;
  const peers = new Map<string, PresencePeer>();
  const listeners = new Set<() => void>();
  let version = 0;
  let cache: readonly PresencePeer[] | null = null;

  const changed = (): void => {
    version++;
    cache = null;
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    get version() {
      return version;
    },
    list(): readonly PresencePeer[] {
      cache ??= Object.freeze([...peers.values()]);
      return cache;
    },
    get: (id: string) => peers.get(id),
    upsert(peer: Omit<PresencePeer, 'since'>): void {
      if (typeof peer.id !== 'string' || peer.id.length === 0) {
        throw new EkzaError('invalid-record', 'presence.upsert: a peer needs a non-empty id');
      }
      const existing = peers.get(peer.id);
      if (existing !== undefined && samePeer(existing, peer)) return;
      peers.set(
        peer.id,
        Object.freeze({
          id: peer.id,
          kind: peer.kind,
          name: peer.name,
          color: peer.color,
          focus: frozenFocus(peer.focus),
          activity: peer.activity,
          since: now(),
        }),
      );
      changed();
    },
    remove(id: string): void {
      if (peers.delete(id)) changed();
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
