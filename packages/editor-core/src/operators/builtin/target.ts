// The target operators (CHARACTER-CONTRACT-SPEC §8.2; GAME-PROTOCOL-SPEC §4.7; C1): bind a character to a contract
// target (a hero class, `any`) of a game's contract,
// unbind, update to another revision (never edits clips), and the slot edits — assign a clip to a slot (one clip per
// slot per character: the slot moves off any other clip), clear a slot (its game default plays), and alias a slot to
// another (*Same clip as…*). Each is one undo step. Registered by the lazy target chunk (`workflows/target`) on the
// first run of a `target.*` id (the runner's `lazyOperatorChunk`). Agents get them with the C6 tools.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ClipRecord, DocQueries } from '@ekza-studio/doc';
import { type ContractModel, contractTarget } from '@ekza-studio/io';
import { GLOBAL_SCOPE, type EditorApp, type OperatorAgentPolicy, type PollResult } from '../../types';
import { contractsOf } from '../../workflows/target/service';
import { pinnedModel, type LoadedContract } from '../../workflows/target/contracts';
import {
  deleteTarget,
  patchTarget,
  putTarget,
  type TargetRecord,
  targetIdOf,
  targetOf,
} from '../../workflows/target/table';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';

const AGENT: OperatorAgentPolicy = {
  policy: 'denied',
  reason: 'Targets are set by the person; agent tools arrive later',
};
const CATEGORY = 'target';

function characterArg(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['character'] !== 'string') return fail('expects { character, … }');
  return app.store.get('characters', args['character'] as CharacterId) === undefined
    ? fail('The character does not exist')
    : OK;
}

/** The bound target and its model, or the poll failure. */
function bound(app: EditorApp, character: CharacterId): { target: TargetRecord; model: ContractModel } | string {
  const target = targetOf(app.store, character);
  if (target === undefined) return 'The character has no target';
  const model = pinnedModel(target);
  if (model instanceof EkzaError) return model.message;
  return { target, model };
}

/** Why `slot` cannot take a fill on the bound target, or null. */
function slotProblemOf(model: ContractModel, target: TargetRecord, slot: unknown): string | null {
  if (typeof slot !== 'string') return 'slot must be a slot id';
  const view = contractTarget(model, target.target);
  const spec = model.slots[slot];
  if (view === undefined || spec === undefined || !view.slots.includes(slot)) {
    return `'${slot}' is not a slot of ${view?.name ?? target.target}`;
  }
  if (spec.kind !== 'animation') {
    return `${spec.label} takes ${spec.kind === 'asset' ? 'an object' : 'a socket'}, not a clip (with gear, later)`;
  }
  if (!spec.customizable) {
    return spec.customizableFrom === null
      ? `${spec.label} takes no custom fill`
      : `${spec.label} opens with contract ${spec.customizableFrom}`;
  }
  return null;
}

const liveClips = (view: { readonly query: DocQueries }, character: CharacterId): readonly ClipRecord[] =>
  view.query.clipsOfCharacter(character).filter((clip) => clip.deleted === null);

const withoutAlias = (aliases: Readonly<Record<string, string>>, slot: string): Record<string, string> => {
  const next = { ...aliases };
  delete next[slot];
  return next;
};

// ---------- bind / unbind / update ----------

const bind = defineOperator<'target.bind', LoadedContract>({
  id: 'target.bind',
  label: 'Set Target',
  description: 'Binds the character to a target of a game contract (what the game needs from it).',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Set Target',
  poll({ app }, args) {
    const base = characterArg(app, args);
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    if (typeof raw['game'] !== 'string' || typeof raw['target'] !== 'string') {
      return fail('expects { character, game, target, revision? }');
    }
    if (raw['revision'] !== undefined && typeof raw['revision'] !== 'string') return fail('revision must be text');
    return pollEditable(app);
  },
  async prepare({ app }, args) {
    const service = contractsOf(app);
    const loaded =
      args.revision === undefined ? await service.latest(args.game) : await service.load(args.game, args.revision);
    if (contractTarget(loaded.model, args.target) === undefined) {
      throw new EkzaError('invalid-input', `'${args.target}' is not a target of this contract`);
    }
    return loaded;
  },
  apply({ tx }, args, loaded) {
    if (tx === null) throw new EkzaError('internal', 'target.bind runs in a transaction');
    const existing = targetOf(tx, args.character);
    const view = contractTarget(loaded.model, args.target);
    const kept = Object.fromEntries(
      Object.entries(existing?.aliases ?? {}).filter(
        ([slot, to]) => view?.slots.includes(slot) === true && view.slots.includes(to),
      ),
    );
    putTarget(tx, {
      id: targetIdOf(args.character),
      character: args.character,
      contract: { schema: loaded.model.schema, game: loaded.model.game, revision: loaded.model.revision },
      document: loaded.document,
      target: args.target,
      aliases: kept,
      hub: existing?.hub ?? { assetId: null, lastRevisionId: null },
      deleted: null,
    });
    return { revision: loaded.model.revision };
  },
});

const unbind = defineOperator<'target.unbind'>({
  id: 'target.unbind',
  label: 'Clear Target',
  description: 'Removes the character’s target; its clips and their slots stay.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Clear Target',
  poll({ app }, args) {
    const base = characterArg(app, args);
    if (base !== true) return base;
    if (targetOf(app.store, (args as { character: CharacterId }).character) === undefined) {
      return fail('The character has no target');
    }
    return pollEditable(app);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'target.unbind runs in a transaction');
    deleteTarget(tx, args.character);
  },
});

const update = defineOperator<'target.update', LoadedContract>({
  id: 'target.update',
  label: 'Update Target Contract',
  description:
    'Moves the target to another contract revision (the latest bundled one by default); clips are untouched.',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Update Target Contract',
  poll({ app }, args) {
    const base = characterArg(app, args);
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    if (raw['revision'] !== undefined && typeof raw['revision'] !== 'string') return fail('revision must be text');
    if (targetOf(app.store, raw['character'] as CharacterId) === undefined) return fail('The character has no target');
    return pollEditable(app);
  },
  async prepare({ app }, args) {
    const target = targetOf(app.store, args.character);
    if (target === undefined) throw new EkzaError('unsupported', 'The character has no target');
    const service = contractsOf(app);
    const loaded =
      args.revision === undefined
        ? await service.latest(target.contract.game)
        : await service.load(target.contract.game, args.revision);
    if (loaded.model.revision === target.contract.revision) {
      throw new EkzaError('unsupported', 'The target already uses that contract');
    }
    if (contractTarget(loaded.model, target.target) === undefined) {
      throw new EkzaError('unsupported', `That contract has no '${target.target}'`);
    }
    return loaded;
  },
  apply({ tx }, args, loaded) {
    if (tx === null) throw new EkzaError('internal', 'target.update runs in a transaction');
    const target = targetOf(tx, args.character);
    if (target === undefined) throw new EkzaError('unsupported', 'The character has no target');
    const view = contractTarget(loaded.model, target.target);
    patchTarget(tx, args.character, {
      contract: { schema: loaded.model.schema, game: loaded.model.game, revision: loaded.model.revision },
      document: loaded.document,
      aliases: Object.fromEntries(
        Object.entries(target.aliases).filter(([slot, to]) => view?.slots.includes(slot) && view.slots.includes(to)),
      ),
    });
    return { revision: loaded.model.revision };
  },
});

// ---------- slots ----------

function pollSlot(app: EditorApp, args: unknown): PollResult {
  const base = characterArg(app, args);
  if (base !== true) return base;
  const raw = args as Readonly<Record<string, unknown>>;
  const binding = bound(app, raw['character'] as CharacterId);
  if (typeof binding === 'string') return fail(binding);
  const problem = slotProblemOf(binding.model, binding.target, raw['slot']);
  return problem === null ? pollEditable(app) : fail(problem);
}

const slotLabel = (app: EditorApp, character: CharacterId, slot: string): string => {
  const binding = bound(app, character);
  return typeof binding === 'string' ? slot : (binding.model.slots[slot]?.label ?? slot);
};

const assign = defineOperator<'target.slot.assign'>({
  id: 'target.slot.assign',
  label: 'Use Clip for Slot',
  description: 'Fills a slot of the target with a clip of the character (the slot moves off any other clip).',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Use Clip for Slot',
  poll({ app }, args) {
    const base = pollSlot(app, args);
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const clip = typeof raw['clip'] === 'string' ? app.store.get('clips', raw['clip'] as ClipId) : undefined;
    if (clip === undefined || clip.character !== raw['character']) return fail('clip must be a clip of the character');
    if (clip.source.kind === 'test') return fail('The test clip never fills a slot');
    return OK;
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'target.slot.assign runs in a transaction');
    for (const other of liveClips(tx, args.character)) {
      if (other.slot === args.slot && other.id !== args.clip) tx.patch('clips', other.id, { slot: null });
    }
    tx.patch('clips', args.clip, { slot: args.slot });
    const target = targetOf(tx, args.character);
    if (target !== undefined && args.slot in target.aliases) {
      patchTarget(tx, args.character, { aliases: withoutAlias(target.aliases, args.slot) });
    }
    tx.annotate({ label: `Use Clip for ${slotLabel(app, args.character, args.slot)}` });
  },
});

const clear = defineOperator<'target.slot.clear'>({
  id: 'target.slot.clear',
  label: 'Use Game Default',
  description: 'Empties a slot of the target: the game plays its own default there (the clip stays, without the slot).',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Use Game Default',
  poll({ app }, args) {
    const base = characterArg(app, args);
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const binding = bound(app, raw['character'] as CharacterId);
    if (typeof binding === 'string') return fail(binding);
    if (typeof raw['slot'] !== 'string') return fail('slot must be a slot id');
    const slot = raw['slot'];
    const filled =
      liveClips(app.store, raw['character'] as CharacterId).some((clip) => clip.slot === slot) ||
      slot in binding.target.aliases;
    return filled ? pollEditable(app) : fail('The slot already uses the game default');
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'target.slot.clear runs in a transaction');
    for (const clip of liveClips(tx, args.character)) {
      if (clip.slot === args.slot) tx.patch('clips', clip.id, { slot: null });
    }
    const target = targetOf(tx, args.character);
    if (target !== undefined && args.slot in target.aliases) {
      patchTarget(tx, args.character, { aliases: withoutAlias(target.aliases, args.slot) });
    }
    tx.annotate({ label: `Use Game Default for ${slotLabel(app, args.character, args.slot)}` });
  },
});

const alias = defineOperator<'target.slot.alias'>({
  id: 'target.slot.alias',
  label: 'Same Clip As…',
  description: 'Makes a slot reuse the clip of another slot of the target (null: stop reusing it).',
  category: CATEGORY,
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  agent: AGENT,
  undoLabel: () => 'Same Clip As',
  poll({ app }, args) {
    const base = pollSlot(app, args);
    if (base !== true) return base;
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const binding = bound(app, raw['character'] as CharacterId);
    if (typeof binding === 'string') return fail(binding);
    const to = raw['to'];
    if (to === null) return (raw['slot'] as string) in binding.target.aliases ? OK : fail('The slot reuses no clip');
    if (to === raw['slot']) return fail('A slot cannot reuse itself');
    const problem = slotProblemOf(binding.model, binding.target, to);
    if (problem !== null) return fail(problem);
    if (binding.target.aliases[to as string] !== undefined) return fail('That slot reuses another slot itself');
    return OK;
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'target.slot.alias runs in a transaction');
    const target = targetOf(tx, args.character);
    if (target === undefined) throw new EkzaError('unsupported', 'The character has no target');
    if (args.to === null) {
      patchTarget(tx, args.character, { aliases: withoutAlias(target.aliases, args.slot) });
      tx.annotate({ label: `Own Clip for ${slotLabel(app, args.character, args.slot)}` });
      return;
    }
    // The slot's own clip gives the slot up (the clip stays); slots that reused this one follow it to `to`.
    for (const clip of liveClips(tx, args.character)) {
      if (clip.slot === args.slot) tx.patch('clips', clip.id, { slot: null });
    }
    const aliases: Record<string, string> = {};
    for (const [slot, to] of Object.entries(target.aliases)) aliases[slot] = to === args.slot ? args.to : to;
    aliases[args.slot] = args.to;
    patchTarget(tx, args.character, { aliases });
    tx.annotate({ label: `Same Clip for ${slotLabel(app, args.character, args.slot)}` });
  },
});

export const TARGET_OPERATORS: readonly AnyOperator[] = [bind, unbind, update, assign, clear, alias];
