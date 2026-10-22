// Auto-Rig ④ Animations composition (AUTORIG-SPEC §4.5, §5.5.4; D5): `autorig.clip.add {character, clip, params,
// replace?}` = C12's Use Clip (`library.useClip`) with the clip parameters applied by the §5.5.3 data route (the
// derived VRMA bytes; `params.inPlace` sets the shipped `rootMotion: 'in-place'` inside Use Clip's transaction, as
// `loop` and `slot` are set there). One undo step, Use Clip's; the composition records none of its own. With
// identity parameters it is C12's Use Clip exactly. `replace` (✎ *Update*) deletes that clip in the same step and
// gives the new one its name and slot.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { clipParamsProblem } from '../../../../library/params';
import type { ClipParams } from '../../../../types';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK } from '../../define';

const clipAdd = defineOperator<'autorig.clip.add', { readonly clip: ClipId }>({
  id: 'autorig.clip.add',
  label: 'Add Animation',
  description:
    'Auto-Rig: adds a library clip to the character with its parameters (speed, trim, mirror, in place, arm space) as one Use Clip step.',
  category: 'autorig',
  scope: 'global',
  poll({ app }, args) {
    if (!isRecord(args) || typeof args['character'] !== 'string' || typeof args['clip'] !== 'string') {
      return fail('expects { character, clip, params, replace? }');
    }
    const problem = clipParamsProblem(args['params']);
    if (problem !== null) return fail(problem);
    if (app.store.get('characters', args['character'] as CharacterId) === undefined) {
      return fail('The character does not exist');
    }
    // Only the shape here: the runner polls again after `prepare`, when Use Clip has already replaced the clip
    // (Use Clip's own poll checks that `replace` is a clip of the character).
    const replace = args['replace'];
    if (replace !== undefined && typeof replace !== 'string') return fail('replace must be a clip id');
    return OK;
  },
  async prepare(ctx, args) {
    const params: ClipParams = args.params;
    const value = await forward(ctx, 'library.useClip', {
      character: args.character,
      clip: args.clip,
      params,
      ...(args.replace === undefined ? {} : { replace: args.replace }),
    });
    const clip = isRecord(value) ? value['clip'] : undefined;
    if (typeof clip !== 'string') throw new EkzaError('internal', 'Use Clip returned no clip');
    return { clip: clip as ClipId };
  },
  apply(_ctx, _args, prepared) {
    return prepared;
  },
});

export const WIZARD_CLIP_OPERATORS: readonly AnyOperator[] = [clipAdd];
