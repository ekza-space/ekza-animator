// The target binding in the document (CHARACTER-CONTRACT-SPEC §8.2; decision CC-17): the extension table
// `ekza.targets`, one record per character, partition `char:<id>`, the contract document pinned inline so a project
// reopens offline against the contract it was made for. An extension table keeps `SCHEMA_VERSION` 4: builds without
// this chunk keep the rows untouched (opaque tables survive snapshots verbatim). The binding is keyed by (game,
// character, contract revision); `gameCharacter` is the game's character the Studio character is made for (a hero
// class, or `any`). Registered when the target chunk loads, before anything reads or writes the table.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import {
  type CharacterId,
  getTableDef,
  type Partition,
  type ReadView,
  registerTable,
  type TableDef,
  type Tombstone,
  type Tx,
} from '@ekza-studio/doc';

export const TARGETS_TABLE = 'ekza.targets';

export type TargetId = string;

export interface TargetRecord {
  readonly id: TargetId;
  readonly character: CharacterId;
  /** The game (Hub project id): `omoba`. */
  readonly game: string;
  readonly contract: { readonly schema: string; readonly revision: string };
  /** The canonical JSON of the contract document, pinned. */
  readonly document: string;
  /** The game's character this one is made for (a view id of the contract: `wildspark`, `any`). */
  readonly gameCharacter: string;
  /** slot → the slot whose clip it reuses (*Same clip as…*). */
  readonly aliases: Readonly<Record<string, string>>;
  /** The Hub asset and the last submitted revision (C5 writes them). */
  readonly hub: { readonly assetId: string | null; readonly lastRevisionId: string | null };
  readonly deleted: Tombstone;
}

/** One target per character: its id is derived from the character. */
export const targetIdOf = (character: CharacterId): TargetId => `tgt:${character}`;

const REVISION = /^sha256-[0-9a-f]{64}$/;
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Problems of a target record ([] = valid). */
export function validateTarget(value: unknown): readonly string[] {
  if (!isObject(value)) return ['expected a record object'];
  const problems: string[] = [];
  const text = (key: string): void => {
    const field = value[key];
    if (typeof field !== 'string' || field.length === 0) problems.push(`${key}: expected text`);
  };
  for (const key of ['id', 'character', 'game', 'document', 'gameCharacter']) text(key);
  const contract = value['contract'];
  if (!isObject(contract) || typeof contract['schema'] !== 'string' || !REVISION.test(String(contract['revision']))) {
    problems.push('contract: expected { schema, revision: sha256-… }');
  }
  const aliases = value['aliases'];
  if (!isObject(aliases) || Object.values(aliases).some((to) => typeof to !== 'string')) {
    problems.push('aliases: expected { slot: slot }');
  }
  const hub = value['hub'];
  if (
    !isObject(hub) ||
    !['assetId', 'lastRevisionId'].every((key) => hub[key] === null || typeof hub[key] === 'string')
  ) {
    problems.push('hub: expected { assetId, lastRevisionId }');
  }
  const deleted = value['deleted'];
  if (deleted !== null && !isObject(deleted)) problems.push('deleted: expected null or a tombstone');
  return problems;
}

export const TARGET_TABLE_DEF: TableDef = {
  name: TARGETS_TABLE,
  version: 1,
  mergeUnit: 'field',
  softDelete: true,
  partition: (record): Partition => {
    const character = (record as Partial<TargetRecord>).character;
    return typeof character === 'string' && character.length > 0 ? `char:${character}` : 'scene';
  },
  validate: validateTarget,
  migrations: [],
};

/** Registers `ekza.targets` once (a table registered by another copy of this chunk is kept). */
export function ensureTargetTable(): Disposer {
  if (getTableDef(TARGETS_TABLE) !== undefined) return () => {};
  return registerTable(TARGET_TABLE_DEF);
}

// The store is typed over the built-in tables; extension tables are reached through these few casts.
interface AnyView {
  get(table: string, id: string): unknown;
  list(table: string): readonly unknown[];
}
interface AnyTx extends AnyView {
  getIncludingDeleted(table: string, id: string): unknown;
  restore(table: string, id: string): void;
  put(table: string, record: unknown): void;
  patch(table: string, id: string, fields: unknown): void;
  softDelete(table: string, id: string): void;
}
const asAny = <T>(store: unknown): T => store as T;
const view = (store: ReadView): AnyView => asAny<AnyView>(store);
const write = (tx: Tx): AnyTx => asAny<AnyTx>(tx);

/** Every live target of the document. */
export function targetRecords(store: ReadView): readonly TargetRecord[] {
  return view(store).list(TARGETS_TABLE) as readonly TargetRecord[];
}

/** The live target of a live character, or undefined. */
export function targetOf(store: ReadView, character: CharacterId): TargetRecord | undefined {
  if (store.get('characters', character) === undefined) return undefined;
  const record = view(store).get(TARGETS_TABLE, targetIdOf(character)) as TargetRecord | undefined;
  return record === undefined || record.deleted !== null ? undefined : record;
}

/** Writes the character's target: a new record, or the existing one (restored when it was removed) patched. */
export function putTarget(tx: Tx, record: TargetRecord): void {
  const any = write(tx);
  const existing = any.getIncludingDeleted(TARGETS_TABLE, record.id) as TargetRecord | undefined;
  if (existing === undefined) {
    any.put(TARGETS_TABLE, record);
    return;
  }
  if (existing.deleted !== null) any.restore(TARGETS_TABLE, record.id);
  const { id: _id, deleted: _deleted, ...fields } = record;
  any.patch(TARGETS_TABLE, record.id, fields);
}

export function patchTarget(tx: Tx, character: CharacterId, fields: Partial<Omit<TargetRecord, 'id'>>): void {
  const id = targetIdOf(character);
  if (write(tx).get(TARGETS_TABLE, id) === undefined) {
    throw new EkzaError('internal', 'The character has no target to change');
  }
  write(tx).patch(TARGETS_TABLE, id, fields);
}

export function deleteTarget(tx: Tx, character: CharacterId): void {
  write(tx).softDelete(TARGETS_TABLE, targetIdOf(character));
}
