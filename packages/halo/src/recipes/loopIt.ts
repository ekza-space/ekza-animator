// *Loop it* (STUDIO-TOUCH-SPEC §9.11, §8, §15.15: `clip.makeLoop` gets a surface through its public wrapper,
// `clip.loop`, T5a): the active animation ends where it starts — its ends matched, the root's travel kept. One step.
// The animation chip's petal is T7's; this is the search phrase *loop it* / *make it loop*.
import type { CharacterId } from '@ekza-studio/doc';
import { en } from '../i18n/en';
import { type Recipe, recipeCharacter } from './recipe';

export const loopItRecipe: Recipe<Record<string, never>> = {
  id: 'loopIt',
  title: () => en.recipes.loopIt,
  detail: en.recipes.loopItDetail,
  match: (query) => (/\bloop(s|ed|ing)?\b|\bseamless\b|\bcycle\b/.test(query) ? {} : null),
  plan(app) {
    const character = recipeCharacter(app);
    const clip = character === null ? undefined : app.session.getState().activeClip[character as CharacterId];
    if (clip === undefined) return { problem: en.recipes.needsAnimation };
    return { steps: [{ op: 'clip.loop', args: { clip, method: 'matchEnds', rootTravel: 'cycleOffset' } }] };
  },
};
