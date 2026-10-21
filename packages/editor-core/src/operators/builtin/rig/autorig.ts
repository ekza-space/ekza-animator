// C1 (character runtime; M6B-SPEC §5.16, §6.3, §0.6): `rig.autoRig.update {ikLegs, ikArms, character?}` (Update
// Control Rig) regenerates a model-sourced character's control rig from its skeleton (`updateAutoRig`, rig's rules
// 1–7), in one undo step. The same core, `writeAutoRigUpdate`, runs inside **every** skeleton-editing transaction of a
// character that has a control rig or a bound mesh (C2's joint edits, the Quick Rig commit, the first bind), so the
// rig never drifts from the joints. Callers load its libraries first (`prepareAutoRig`, async) and then call it
// synchronously inside their transaction; the SkeletonDesc is built from the transaction's view (read-your-writes).
//
// Writing: the rig record's generator and skeleton fields; controls patched field by field (new ones put, soft-deleted
// ones restored, removed bones' controls soft-deleted; their curves stay); solver records likewise; constraints are the
// user's and stay. The warnings (removed bones, a kind change) and the stale stored offsets are toasted once.
import { EkzaError, type ParamDef } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId, ControlRecord, SolverId, SolverRecord, Tx } from '@ekza-studio/doc';
import { characterVertices, skeletonFromDoc } from '@ekza-studio/io';
import { type AutoRigUpdate, ikOf, readRigDefinition, updateAutoRig } from '@ekza-studio/rig';
import { characterMeshes, characterPalettes, docSkeletonInput, modelParts } from '../../../characters/modelInput';
import { loadMeshKernel, type MeshKernel } from '../../../mesh';
import type { EditorApp, OperatorContext } from '../../../types';
import { loadWritePath } from '../../../workflows/export';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from '../define';

type MeshIo = Awaited<ReturnType<Awaited<ReturnType<typeof loadWritePath>>['loadMeshIo']>>;

/** The libraries `writeAutoRigUpdate` needs synchronously. */
export interface AutoRigLibs {
  readonly kernel: MeshKernel;
  readonly meshIo: MeshIo;
}

let libs: Promise<AutoRigLibs> | null = null;

/** Loads the mesh kernel and io's mesh entry once (call from `prepare`). */
export function prepareAutoRig(): Promise<AutoRigLibs> {
  libs ??= Promise.all([loadMeshKernel(), loadWritePath().then((write) => write.loadMeshIo())]).then(
    ([kernel, meshIo]) => ({ kernel, meshIo }),
  );
  libs.catch(() => {
    libs = null;
  });
  return libs;
}

/** The character a rig operator works on: the argument, the Rig & Skin character, the active one, else the first model one. */
export function rigCharacterOf(app: EditorApp, explicit: unknown): CharacterId | null {
  if (typeof explicit === 'string') return explicit as CharacterId;
  const state = app.session.getState();
  const candidates = [state.rig.character, state.activeCharacter];
  for (const id of candidates) {
    const character = id === null || id === undefined ? undefined : app.store.get('characters', id);
    if (character?.source?.kind === 'model') return character.id;
  }
  return app.store.list('characters').find((character) => character.source?.kind === 'model')?.id ?? null;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The fields of `next` that differ from `prev` (both whole records). */
function diff<T extends object>(prev: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (key === 'id') continue;
    if (!same(prev[key], next[key])) out[key] = next[key];
  }
  return out;
}

/**
 * Regenerates the control rig of a model-sourced character inside `tx` (§5.16) and writes the difference. `ik`
 * defaults to the rig's current limb IK (legs IK on, arms off for a rig without controls yet, Q-RIG-2). Returns the
 * update (its warnings and stale offsets are the caller's to report; the operator toasts them).
 */
export function writeAutoRigUpdate(
  app: EditorApp,
  tx: Tx,
  character: CharacterId,
  loaded: AutoRigLibs,
  ik?: { readonly legs: boolean; readonly arms: boolean },
): AutoRigUpdate {
  const record = tx.get('characters', character);
  if (record === undefined || record.source?.kind !== 'model') {
    throw new EkzaError('unsupported', 'Update Control Rig works on characters made in the editor');
  }
  const parts = modelParts(app, character, tx);
  if (parts === null) throw new EkzaError('unsupported', 'The character has no skeleton');
  if (parts === 'loading') throw new EkzaError('mesh-loading', 'Mesh is loading');
  const meshes = characterMeshes(tx, loaded.kernel, parts).filter((mesh) => mesh.skin !== null);
  const skeleton = skeletonFromDoc(docSkeletonInput(tx, loaded.kernel, parts), {
    vertices: characterVertices(loaded.meshIo, meshes, characterPalettes(tx, meshes)),
  });
  const current = readRigDefinition(tx, record.rig) ?? null;
  const existing = current !== null && current.controls.length > 0 ? current : null;
  const update = updateAutoRig(existing, skeleton, { character, rig: record.rig }, { ik: ik ?? ikOf(existing) });
  const rig = update.rig;
  const rigRecord = tx.getIncludingDeleted('rigs', record.rig);
  if (rigRecord === undefined) tx.put('rigs', rig.rig);
  else {
    if (rigRecord.deleted !== null) tx.restore('rigs', record.rig);
    const fields = diff(rigRecord, { ...rig.rig, deleted: null });
    if (Object.keys(fields).length > 0) tx.patch('rigs', record.rig, fields);
  }
  writeControls(tx, rig.controls, update.softDeleted);
  const kept = new Set<string>(rig.solvers.map((solver) => solver.id));
  writeSolvers(
    tx,
    rig.solvers,
    (current?.solvers ?? []).filter((solver) => !kept.has(solver.id)).map((solver) => solver.id),
  );
  return update;
}

/** Puts new controls, restores and patches existing ones, soft-deletes `gone` (their curves stay). */
function writeControls(tx: Tx, records: readonly ControlRecord[], gone: readonly ControlId[]): void {
  for (const next of records) {
    const prev = tx.getIncludingDeleted('controls', next.id);
    if (prev === undefined) {
      tx.put('controls', next);
      continue;
    }
    if (prev.deleted !== null) tx.restore('controls', next.id);
    const { deleted: _deleted, ...fields } = diff(prev, next);
    if (Object.keys(fields).length > 0) tx.patch('controls', next.id, fields);
  }
  for (const id of gone) if (tx.get('controls', id) !== undefined) tx.softDelete('controls', id);
}

/** The same for solver records. */
function writeSolvers(tx: Tx, records: readonly SolverRecord[], gone: readonly SolverId[]): void {
  for (const next of records) {
    const prev = tx.getIncludingDeleted('solvers', next.id);
    if (prev === undefined) {
      tx.put('solvers', next);
      continue;
    }
    if (prev.deleted !== null) tx.restore('solvers', next.id);
    const { deleted: _deleted, ...fields } = diff(prev, next);
    if (Object.keys(fields).length > 0) tx.patch('solvers', next.id, fields);
  }
  for (const id of gone) if (tx.get('solvers', id) !== undefined) tx.softDelete('solvers', id);
}

/** Toasts an update's warnings and stale offsets once (§5.16 rules 2, 6, 7). */
export function reportAutoRigUpdate(app: EditorApp, update: AutoRigUpdate): void {
  const kind = update.warnings.find((warning) => warning.startsWith('The control rig became'));
  if (kind !== undefined) app.services.notify.toast({ kind: 'warning', text: kind });
  else if (update.softDeleted.length > 0) {
    app.services.notify.toast({
      kind: 'warning',
      text: `${update.softDeleted.length} controls lost their bones; their curves are kept but unused`,
    });
  }
  if (update.staleOffsets.length > 0) {
    app.services.notify.toast({
      kind: 'warning',
      text: `${update.staleOffsets.length} constraints keep offsets from the old rest: re-capture with Update Offset`,
    });
  }
}

const IK_PARAMS: readonly ParamDef[] = [
  { name: 'ikLegs', label: 'IK Legs', kind: 'bool', bound: 'value', default: true },
  { name: 'ikArms', label: 'IK Arms', kind: 'bool', bound: 'value', default: false },
];

function pollUpdate(app: EditorApp, raw: unknown) {
  const args = optionalArgs(raw);
  if (args === null) return fail('expects { ikLegs?, ikArms?, character? }');
  const id = rigCharacterOf(app, args['character']);
  if (id === null) return fail('Make a character from your model first');
  const character = app.store.get('characters', id);
  if (character === undefined) return fail(`Unknown character ${id}`);
  if (character.source?.kind !== 'model') return fail('Update Control Rig works on characters made in the editor');
  const parts = modelParts(app, id);
  if (parts === null) return fail('The character has no skeleton');
  if (parts === 'loading') return fail('Mesh is loading');
  if (parts.joints.length === 0) return fail('Create a skeleton first');
  return OK;
}

const update = defineOperator<'rig.autoRig.update', AutoRigLibs>({
  id: 'rig.autoRig.update',
  label: 'Update Control Rig',
  description: "Regenerates the character's controls from its skeleton (curves, edited shapes and visibility kept).",
  category: 'rig',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  params: IK_PARAMS,
  extraArgs: ['character'],
  poll: ({ app }, raw) => pollUpdate(app, raw),
  prepare: (_ctx: OperatorContext) => prepareAutoRig(),
  apply(ctx, raw, loaded) {
    if (ctx.tx === null) throw new EkzaError('unsupported', 'rig.autoRig.update needs a transaction');
    const args = optionalArgs(raw) ?? {};
    const id = rigCharacterOf(ctx.app, args['character']);
    if (id === null) throw new EkzaError('unsupported', 'Make a character from your model first');
    const given = isRecord(raw) && (typeof raw['ikLegs'] === 'boolean' || typeof raw['ikArms'] === 'boolean');
    const record = ctx.tx.get('characters', id);
    const current = record === undefined ? null : (readRigDefinition(ctx.tx, record.rig) ?? null);
    const now = ikOf(current !== null && current.controls.length > 0 ? current : null);
    const ik = given
      ? {
          legs: typeof args['ikLegs'] === 'boolean' ? args['ikLegs'] : now.legs,
          arms: typeof args['ikArms'] === 'boolean' ? args['ikArms'] : now.arms,
        }
      : now;
    const result = writeAutoRigUpdate(ctx.app, ctx.tx, id, loaded, ik);
    ctx.tx.annotate({ label: 'Update Control Rig' });
    reportAutoRigUpdate(ctx.app, result);
  },
});

export const AUTORIG_OPERATORS: readonly AnyOperator[] = [update];
