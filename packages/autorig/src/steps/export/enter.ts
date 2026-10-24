// ⑤'s own start (AUTORIG-SPEC §4.2, §5.6.3; D6), after the frame's entry order (Rig & Skin, Object mode): on the first
// entry per subject character of this wizard, a model character with no thumbnail gets one (`char.renderThumbnail`,
// one undo step) and one with no author gets the remembered author (`char.setVrmMeta`, one undo step) — editor-core's
// `autorigFlow` (T5b, shared with Halo's Share sheet). Every change is an operator run; an undo of either is respected
// (it does not run again for that character in this wizard).
import type { CharacterRecord } from '@ekza-studio/doc';
import { prepareExport } from '@ekza-studio/editor-core';
import { resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';
import { flowHost } from '../model/flowHost';
import { rememberedAuthor } from './author';

/** A live model-sourced character (editor-core's `isModelCharacter`, written out: this chunk stays off the workflow). */
const isModel = (record: CharacterRecord): boolean => record.deleted === null && record.source.kind === 'model';

const prepared = new WeakMap<WizardContext, Set<string>>();

/** The subject's live character (model or asset), or null. */
export function exportCharacter(ctx: Pick<WizardContext, 'app' | 'session'>) {
  return resolveSubject(ctx.app.store, ctx.session.getState().subject).character;
}

export async function enterExport(ctx: WizardContext): Promise<void> {
  const record = exportCharacter(ctx);
  if (record === null || !isModel(record)) return;
  let done = prepared.get(ctx);
  if (done === undefined) {
    done = new Set();
    prepared.set(ctx, done);
  }
  if (done.has(record.id)) return;
  done.add(record.id);
  await prepareExport(flowHost(ctx), record, rememberedAuthor());
}
