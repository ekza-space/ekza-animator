// Humanoid proportion guides (M6A-SPEC §5.16 `humanoid`; B13): the heights of the guide lines of a "Humanoid" template
// group, as fractions of its `height`, per proportion preset. `stylized` matches the humanoid body generator at its
// 1.6 m base (chin 1.46 m, shoulder ring 1.33 m, hip ring 0.82 m, knees 0.44–0.50 m, ankle 0.10 m); `chibi` is a
// three-heads figure, `blocky` a five-heads one. Plain data: the drawing (lazy) and the tests read it.

export type GuidePreset = 'stylized' | 'chibi' | 'blocky';

/** The named guide lines, ground first, as fractions of the height. */
export const GUIDE_LEVELS: Readonly<Record<GuidePreset, Readonly<Record<GuideLine, number>>>> = {
  stylized: { ground: 0, ankle: 0.0625, knee: 0.2925, hip: 0.5125, shoulder: 0.83125, chin: 0.9125, head: 1 },
  chibi: { ground: 0, ankle: 0.04, knee: 0.18, hip: 0.36, shoulder: 0.62, chin: 0.67, head: 1 },
  blocky: { ground: 0, ankle: 0.05, knee: 0.26, hip: 0.48, shoulder: 0.78, chin: 0.85, head: 1 },
};

export type GuideLine = 'ground' | 'ankle' | 'knee' | 'hip' | 'shoulder' | 'chin' | 'head';

export const GUIDE_LINES: readonly GuideLine[] = ['ground', 'ankle', 'knee', 'hip', 'shoulder', 'chin', 'head'];

/** Half width of the guide lines (and the facing arrow's length) relative to the height. */
export const GUIDE_HALF_WIDTH = 0.3;

const isPreset = (value: unknown): value is GuidePreset =>
  value === 'stylized' || value === 'chibi' || value === 'blocky';

/** The guide lines of a template's params (height 0.5…3 m, default 1.6; unknown presets read as `stylized`). */
export function humanoidGuideLevels(params: Readonly<Record<string, unknown>>): {
  readonly height: number;
  readonly preset: GuidePreset;
  readonly levels: Readonly<Record<GuideLine, number>>;
} {
  const raw = params['height'];
  const height = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(3, Math.max(0.5, raw)) : 1.6;
  const preset = isPreset(params['preset']) ? params['preset'] : 'stylized';
  const fractions = GUIDE_LEVELS[preset];
  const levels = {} as Record<GuideLine, number>;
  for (const line of GUIDE_LINES) levels[line] = fractions[line] * height;
  return { height, preset, levels };
}
