// The recipes of the release that search offers (STUDIO-TOUCH-SPEC §8, §9.11; T11): *Wave* and *Loop it* by phrase,
// *Add animations* and *Fix for OMOBA* by name. T9 adds *Rig it* and *Fix where it bends* to this list.
import { addAnimationsRecipe } from './addAnimations';
import { fixForOmobaRecipe } from './fixForOmoba';
import { loopItRecipe } from './loopIt';
import type { Recipe } from './recipe';
import { waveRecipe } from './wave';

export const SEARCH_RECIPES: readonly Recipe<unknown>[] = [
  waveRecipe as Recipe<unknown>,
  loopItRecipe as Recipe<unknown>,
  addAnimationsRecipe as Recipe<unknown>,
  fixForOmobaRecipe as Recipe<unknown>,
];

export { matchRecipes, type Recipe, type RecipeMatch, runRecipe } from './recipe';
