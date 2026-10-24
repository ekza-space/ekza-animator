// *Wave* (STUDIO-TOUCH-SPEC §9.11, §8, ST-25; J3's search shortcut): the deterministic reference script of the agent
// evaluations (`agent-evals/src/scripts/wave.ts`: AE-01, MVP-AC-1), as a recipe of ordinary operator runs — a new
// two-second animation at 30 fps (`clip.new`), then the upper arm raised and the forearm swinging between two aims
// every few frames (`pose.goals`, the posing kernel the agent's `pose_aim` runs, one keyed step each). Once = two
// swings, twice = four (the script's six make three waves); the left hand by default, the right one mirrored in X
// (+X is the character's left). Offered by the search phrases *wave*, *wave twice*, *wave with the right hand*.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { en } from '../i18n/en';
import { type Recipe, recipeCharacter } from './recipe';

export interface WaveParams {
  readonly times: number;
  readonly side: 'left' | 'right';
}

/** The animation's length in frames at 30 fps (2 s, as the script's `clip_create`). */
export const WAVE_FRAMES = 60;

type Vec3 = readonly [number, number, number];

const mirror = (v: Vec3, side: 'left' | 'right'): Vec3 => (side === 'left' ? v : [-v[0], v[1], v[2]]);

/** The script's aims, per swing: the upper arm above the shoulder, the forearm out and up alternately. */
export function waveAims(side: 'left' | 'right', swing: number) {
  return [
    { bone: `${side}UpperArm`, direction: mirror([0.8, 0.6, 0], side), keepTwist: true, weight: 1 },
    {
      bone: `${side}LowerArm`,
      direction: mirror(swing % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1], side),
      keepTwist: true,
      weight: 1,
    },
  ];
}

const NUMBERS: Readonly<Record<string, number>> = { once: 1, one: 1, twice: 2, two: 2, thrice: 3, three: 3 };

export const waveRecipe: Recipe<WaveParams> = {
  id: 'wave',
  title: (p) => en.recipes.wave(p.times, p.side),
  detail: en.recipes.waveDetail,
  match(query) {
    if (!/\bwave\b|\bwaving\b/.test(query)) return null;
    const side = /\bright\b/.test(query) ? 'right' : 'left';
    const word = Object.keys(NUMBERS).find((w) => new RegExp(`\\b${w}\\b`).test(query));
    const digits = /\b([1-5])\s*(?:times|x)\b/.exec(query);
    const times = word !== undefined ? (NUMBERS[word] as number) : digits !== null ? Number(digits[1]) : 1;
    return { times, side };
  },
  plan(app, { times, side }) {
    const character = recipeCharacter(app);
    if (character === null) return { problem: en.recipes.needsCharacter };
    const swings = Math.max(2, times * 2);
    const keys = Array.from({ length: swings + 1 }, (_, i) => i);
    return {
      steps: [
        {
          op: 'clip.new',
          args: {
            character: character as CharacterId,
            name: 'Wave',
            fps: { num: 30, den: 1 },
            range: { start: 0, end: WAVE_FRAMES },
          },
        },
        ...keys.map((i) => ({
          op: 'pose.goals',
          argsFrom: (results: readonly unknown[]) => ({
            clip: (results[0] as { clip: ClipId }).clip,
            frame: Math.round((WAVE_FRAMES / swings) * i),
            aims: waveAims(side, i),
            label: 'Wave',
          }),
        })),
      ],
    };
  },
};
