// The parts of the import workflows that operator polls and other operators need synchronously: the target of a clip
// import and why it cannot receive clips, the animation-only GLB sniff the importer registry uses, and clip-name
// checks. The import pipelines themselves (`importModel.ts`, `importAnimation.ts`) load as one lazy chunk on the first
// import (`importLoader.ts`, M2A-SPEC §5.21.2); keeping these helpers here keeps that chunk off the editor's initial
// route.
import type { CharacterId, ClipId, ReadView } from '@ekza-studio/doc';
import { isHumanoidProgram } from '@ekza-studio/rig';
import type { EditorApp } from '../types';
import { nameKey } from './names';

/** Why `character` cannot receive clips (`humanoid`: VRMA needs a humanoid rig), or null. */
export function animationTargetProblem(
  app: EditorApp,
  character: CharacterId | null,
  humanoid: boolean,
): string | null {
  if (character === null) return humanoid ? 'Load a humanoid character first' : 'Load a character first';
  if (app.store.get('characters', character) === undefined) return 'The character does not exist';
  const runtime = app.characters.get(character);
  if (runtime === undefined) return 'The character is still loading';
  if (humanoid && !isHumanoidProgram(runtime.program)) return 'VRMA clips need a humanoid (VRM) character';
  return null;
}

const sniffed = new WeakMap<Uint8Array, boolean>();

/**
 * True for a GLB that carries animations but no skin (an animation-only file, not a character). Cached per byte
 * array: importer resolution runs in every poll of `file.open`.
 */
export function isAnimationOnlyGlb(bytes: Uint8Array): boolean {
  let result = sniffed.get(bytes);
  if (result === undefined) {
    result = sniffAnimationOnly(bytes);
    sniffed.set(bytes, result);
  }
  return result;
}

function sniffAnimationOnly(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return false;
  const length = view.getUint32(12, true);
  if (length > bytes.byteLength - 20) return false;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    if (typeof json !== 'object' || json === null) return false;
    const { skins, animations } = json as { readonly skins?: unknown; readonly animations?: unknown };
    const hasSkins = Array.isArray(skins) && skins.length > 0;
    return !hasSkins && Array.isArray(animations) && animations.length > 0;
  } catch {
    return false;
  }
}

/** The character a clip import targets: the given one, else the active one. */
export function importTarget(
  view: ReadView,
  explicit: CharacterId | undefined,
  active: CharacterId | null,
): CharacterId | null {
  const id = explicit ?? active;
  return id !== null && view.get('characters', id) !== undefined ? id : null;
}

/** Names of a character's live clips (unique-name checks), in any order. */
export function clipNamesOf(view: ReadView, character: CharacterId): readonly string[] {
  return view.query.clipsOfCharacter(character).map((clip) => clip.name);
}

/** True when another live clip of the character has this name (ignoring case and surrounding spaces). */
export function clipNameTaken(view: ReadView, character: CharacterId, name: string, except?: ClipId): boolean {
  const key = nameKey(name);
  return view.query.clipsOfCharacter(character).some((clip) => clip.id !== except && nameKey(clip.name) === key);
}
