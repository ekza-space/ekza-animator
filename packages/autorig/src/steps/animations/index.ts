// ④ Animations step (AUTORIG-SPEC §5.5; D0 stub, D5 owns it): the clip grid, search, preview, parameters, the clips
// on the character, the `animations` slice and its reducers. D0 lands only the slice's default and the identity
// parameters (`applyClipParams` returns its input unchanged for them, §5.5.3).
import type { AutoRigAnimationsSlice, ClipParams } from '../../types';

export const IDENTITY_CLIP_PARAMS: ClipParams = { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 };

export const ANIMATIONS_SLICE: AutoRigAnimationsSlice = { draft: {}, skipped: false, editing: null };
