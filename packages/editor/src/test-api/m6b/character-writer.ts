// M6b test API, C10 group (M6B-SPEC §4.8, §0.5). C10 adds no function of its own: `lastExport()` reports character
// exports (the shell records `file.exportCharacter` artifacts; their `readBack` is io's `CharacterReadBack` with kind
// 'character', joints, humanoid, tris, fingerprintEqual and vrmaPlayed null), and the e2e route
// `/e2e/character-check` reports the three-vrm load and the VRMA playback.
import type { M6bTestApiContext } from './support';

export type CharacterWriterTestApi = Record<never, never>;

export function characterWriterTestApi(_ctx: M6bTestApiContext): CharacterWriterTestApi {
  return {};
}
