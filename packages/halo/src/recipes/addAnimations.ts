// *Add animations* (STUDIO-TOUCH-SPEC §9 J1 step 5, §9.11, §7.2's Next chip *Add animations ▸*): the starter set —
// Idle, Walk and Run from the clip library, each in its slot — added to the character as Auto-Rig ④ adds them
// (`autorig.clip.add {character, clip, params}` with identity parameters: Use Clip, one undo step each; the library's
// manifest names the slot). T7's Library sheet offers the same set as *Add starter set*.
import type { CharacterId } from '@ekza-studio/doc';
import { clipAddArgs } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';
import { type Recipe, recipeCharacter } from './recipe';

/** The starter set (§9 J1 step 5, §10.6): the one list Home's recipe and the Library's *Add starter set* add. */
export const STARTER_SET = ['idle', 'walk', 'run'] as const;

/**
 * The starter set's steps for a character: Auto-Rig ④'s `autorig.clip.add` with identity parameters per animation
 * (its slot from the pack), in the set's order; `available` leaves out what the clip library does not ship.
 */
export function starterSteps(
  character: CharacterId,
  available?: ReadonlySet<string>,
): readonly { readonly op: 'autorig.clip.add'; readonly args: ReturnType<typeof clipAddArgs> }[] {
  return STARTER_SET.filter((clip) => available === undefined || available.has(clip)).map((clip) => ({
    op: 'autorig.clip.add',
    args: clipAddArgs(character, clip),
  }));
}

export const addAnimationsRecipe: Recipe<Record<string, never>> = {
  id: 'addAnimations',
  title: () => en.recipes.addAnimations,
  detail: en.recipes.addAnimationsDetail,
  match: (query) => (/\b(starter|idle|walk|run)\b/.test(query) || /\badd animations?\b/.test(query) ? {} : null),
  plan(app) {
    const character = recipeCharacter(app);
    if (character === null) return { problem: en.recipes.needsCharacter };
    return { steps: starterSteps(character as CharacterId) };
  },
};
