// Name resolution (MCP-SPEC §5.1): characters, clips (with the user-session rule), controls (template keys, display
// names, VRM humanoid bones, ids and opaque `sec.#…` keys) and bones. Resolution never guesses: an ambiguous name is
// an error with candidates; a miss lists up to 5 candidates by edit distance. D0 lands this working (§3 rule 1a);
// P2 adds the remaining parts and axis hints.
import type { CharacterId, ClipId, ClipRecord, ControlId, ControlRecord, HumanBoneName } from '@ekza-animator/doc';
import { bodyPartOf, type EditorApp } from '@ekza-animator/editor-core';
import { sha256HexSync } from '@ekza-animator/io';
import { AgentToolFailure, type Resolver } from '../types';
import { MAX_CANDIDATES } from '../envelope/envelope';
import { quoteName } from '../sanitize/sanitize';

/** `sec.<node>` keys longer than this (or with other characters) are replaced by an opaque key (§5.1). */
export const SEC_NODE_MAX = 48;
const SEC_NODE_CHARS = /^[A-Za-z0-9_.:-]+$/;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Limb ends that place IK effectors (§5.1: tools that place IK effectors map limb bones to `ik.<limb>`). */
const IK_LIMB_OF_BONE: Readonly<Record<string, string>> = {
  leftHand: 'ik.arm.L',
  rightHand: 'ik.arm.R',
  leftFoot: 'ik.leg.L',
  rightFoot: 'ik.leg.R',
};

/** The opaque key of a control: `sec.#` + 8 base62 characters of a stable hash of its id. */
export function opaqueControlKey(id: string): string {
  const hex = sha256HexSync(new TextEncoder().encode(id));
  let value = BigInt(`0x${hex.slice(0, 16)}`);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += BASE62[Number(value % 62n)];
    value /= 62n;
  }
  return `sec.#${out}`;
}

/** The key an agent passes back for a control: its template key, or the opaque key of an unsafe `sec.` key. */
export function controlKeyOf(control: Pick<ControlRecord, 'id' | 'key'>): string {
  if (!control.key.startsWith('sec.')) return control.key;
  const node = control.key.slice(4);
  return node.length <= SEC_NODE_MAX && SEC_NODE_CHARS.test(node) ? control.key : opaqueControlKey(control.id);
}

/** Levenshtein distance (small strings; candidates only). */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    previous = current;
  }
  return previous[y.length] as number;
}

/** Up to 5 candidates closest to `ref`, by their lookup names. */
function nearest<T>(
  ref: string,
  items: readonly T[],
  names: (item: T) => readonly string[],
  show: (item: T) => string,
): string[] {
  return items
    .map((item) => ({ item, distance: Math.min(...names(item).map((n) => editDistance(ref, n))) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => show(entry.item));
}

export interface ResolverOptions {
  /** The call edits the document (edit and files tools): with a user session `character`/`clip` are required. */
  readonly forEdit: boolean;
  /** The host has a user session (`user` capability: live, or the eval harness's simulated user). */
  readonly userSession: boolean;
}

function boneOfControl(control: ControlRecord): string | null {
  const bone = control.drives?.bone;
  if (bone === undefined) return null;
  return 'humanoid' in bone ? bone.humanoid : bone.name;
}

/** `key (Display Name, bone)` (§5.1 candidates). */
function showControl(control: ControlRecord): string {
  const bone = boneOfControl(control);
  return `${controlKeyOf(control)} (${control.name}${bone === null ? '' : `, ${bone}`})`;
}

export function createResolver(app: EditorApp, opts: ResolverOptions): Resolver {
  const characters = () =>
    [...app.store.list('characters')].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const requireDefaults = opts.forEdit && opts.userSession;

  const controlsOf = (character: CharacterId): readonly ControlRecord[] => {
    const rig = app.store.query.rigOfCharacter(character);
    return rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
  };

  const resolver: Resolver = {
    character(ref) {
      const all = characters();
      if (ref !== undefined) {
        const byId = all.find((c) => c.id === ref);
        if (byId !== undefined) return { id: byId.id, name: byId.name };
        const named = all.filter((c) => c.name.toLowerCase() === ref.toLowerCase());
        if (named.length === 1) {
          const only = named[0] as (typeof named)[number];
          return { id: only.id, name: only.name };
        }
        if (named.length > 1) {
          throw new AgentToolFailure(
            'ambiguous',
            `Several characters are named ${quoteName(ref)}.`,
            'pass the character id',
            {
              candidates: named.map((c) => `${c.name} (${c.id})`),
            },
          );
        }
        throw new AgentToolFailure(
          'not_found',
          `No character ${quoteName(ref)}.`,
          'scene_summary lists the characters',
          {
            candidates: nearest(
              ref,
              all,
              (c) => [c.name],
              (c) => c.name,
            ),
          },
        );
      }
      if (all.length === 0) {
        throw new AgentToolFailure(
          'not_found',
          'The project has no character.',
          'add one with project_import {sample}',
          {
            retryable: true,
          },
        );
      }
      if (all.length === 1) {
        const only = all[0] as (typeof all)[number];
        return { id: only.id, name: only.name };
      }
      const active = app.session.getState().activeCharacter;
      const activeRecord = active === null ? undefined : all.find((c) => c.id === active);
      if (!requireDefaults && activeRecord !== undefined) return { id: activeRecord.id, name: activeRecord.name };
      const ordered = activeRecord === undefined ? all : [activeRecord, ...all.filter((c) => c.id !== active)];
      throw new AgentToolFailure(
        'invalid_args',
        'The project has several characters: pass character.',
        activeRecord === undefined
          ? 'pass character'
          : `pass character; the user is working on ${quoteName(activeRecord.name)}`,
        { candidates: ordered.map((c) => c.name), detail: { path: 'character' } },
      );
    },

    clip(character, ref) {
      const clips: readonly ClipRecord[] = app.store.query.clipsOfCharacter(character);
      if (ref !== undefined) {
        const byId = clips.find((c) => c.id === ref);
        if (byId !== undefined) return { id: byId.id, name: byId.name };
        const exact = clips.filter((c) => c.name === ref);
        const named = exact.length > 0 ? exact : clips.filter((c) => c.name.toLowerCase() === ref.toLowerCase());
        if (named.length === 1) {
          const only = named[0] as ClipRecord;
          return { id: only.id, name: only.name };
        }
        if (named.length > 1) {
          throw new AgentToolFailure('ambiguous', `Several clips are named ${quoteName(ref)}.`, 'pass the clip id', {
            candidates: named.map((c) => `${c.name} (${c.id})`),
          });
        }
        throw new AgentToolFailure(
          'not_found',
          `No clip ${quoteName(ref)} on this character.`,
          'scene_summary lists the clips',
          {
            candidates: nearest(
              ref,
              clips,
              (c) => [c.name],
              (c) => c.name,
            ),
          },
        );
      }
      const activeId: ClipId | undefined = app.session.getState().activeClip[character];
      const active = activeId === undefined ? undefined : clips.find((c) => c.id === activeId);
      if (!requireDefaults) {
        if (active !== undefined) return { id: active.id, name: active.name };
        if (clips.length === 1) {
          const only = clips[0] as ClipRecord;
          return { id: only.id, name: only.name };
        }
      }
      if (clips.length === 0) {
        throw new AgentToolFailure('not_found', 'The character has no clip.', 'create one with clip_create', {
          retryable: true,
        });
      }
      const ordered = active === undefined ? clips : [active, ...clips.filter((c) => c.id !== active.id)];
      throw new AgentToolFailure(
        'invalid_args',
        'Pass clip: an edit never lands on whatever the user has active.',
        active === undefined ? 'pass clip' : `pass clip; the user is looking at ${quoteName(active.name)}`,
        { candidates: ordered.map((c) => c.name), detail: { path: 'clip' } },
      );
    },

    control(character, ref, want) {
      const controls = controlsOf(character);
      const byId = controls.find((c) => c.id === ref);
      if (byId !== undefined) return { id: byId.id, key: controlKeyOf(byId), name: byId.name };
      if (want === 'ik' && Object.hasOwn(IK_LIMB_OF_BONE, ref)) {
        const ik = controls.find((c) => c.key === IK_LIMB_OF_BONE[ref]);
        if (ik !== undefined) return { id: ik.id, key: ik.key, name: ik.name };
      }
      const byKey = controls.find((c) => c.key === ref || controlKeyOf(c) === ref);
      if (byKey !== undefined) return { id: byKey.id, key: controlKeyOf(byKey), name: byKey.name };
      const byBone = controls.filter((c) => boneOfControl(c) === ref);
      const byName = controls.filter((c) => c.name.toLowerCase() === ref.toLowerCase());
      const matches = byBone.length > 0 ? byBone : byName;
      if (matches.length === 1) {
        const only = matches[0] as ControlRecord;
        return { id: only.id, key: controlKeyOf(only), name: only.name };
      }
      if (matches.length > 1) {
        throw new AgentToolFailure('ambiguous', `Several controls match ${quoteName(ref)}.`, 'pass the template key', {
          candidates: matches.map(showControl),
        });
      }
      throw new AgentToolFailure('not_found', `No control ${quoteName(ref)}.`, 'rig_describe lists the controls', {
        candidates: nearest(ref, controls, (c) => [c.key, c.name, boneOfControl(c) ?? ''], showControl),
      });
    },

    bone(character, ref) {
      const runtime = app.characters.get(character);
      if (runtime === undefined) {
        throw new AgentToolFailure('busy', 'The character is still loading.', 'retry in a moment', { retryable: true });
      }
      const { skeleton } = runtime;
      const humanoid = skeleton.humanoid ?? {};
      // Own entries only: `constructor`, `toString` or `__proto__` are not bones (resolution never guesses, §5.1).
      const index = Object.hasOwn(humanoid, ref) ? humanoid[ref as HumanBoneName] : undefined;
      if (index !== undefined) return { name: skeleton.nodes[index]?.name ?? ref, humanoid: ref };
      const node = skeleton.nodes.find((n) => n.name === ref);
      if (node !== undefined) {
        const human = Object.entries(humanoid).find(([, i]) => i === node.index)?.[0] ?? null;
        return { name: node.name, humanoid: human };
      }
      const names = Object.keys(humanoid);
      throw new AgentToolFailure('not_found', `No bone ${quoteName(ref)}.`, 'rig_describe lists the bones', {
        candidates: nearest(
          ref,
          names.length > 0 ? names : skeleton.nodes.map((n) => n.name),
          (n) => [n],
          (n) => n,
        ),
      });
    },

    bodyPartControls(character, parts) {
      const controls = controlsOf(character);
      if (parts.includes('all')) return controls.map((c) => c.id);
      const rig = app.store.query.rigOfCharacter(character);
      if (rig?.generator.name !== 'ekza-autorig-humanoid') {
        throw new AgentToolFailure('humanoid_only', 'Body parts exist on humanoid rigs only.', 'pass controls by key', {
          retryable: false,
        });
      }
      const wanted = new Set(parts);
      const out: ControlId[] = [];
      for (const control of controls) {
        const part = bodyPartOf(app, control.id);
        if (part !== null && wanted.has(part)) out.push(control.id);
      }
      return out;
    },
  };
  return resolver;
}
