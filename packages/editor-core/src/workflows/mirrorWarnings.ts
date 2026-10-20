// The summary of a mirror's warnings (Mirror Pose, Mirror Animation; acceptance fix round 1). Its own module so the
// eager Mirror Pose operator does not pull the Mirror Animation workflow, which loads with its run (`prepare`).
const UNPAIRED_SUFFIX = ' has no mirror counterpart and was left unchanged';
/** Names an unpaired-control summary lists before "and N more". */
export const UNPAIRED_NAMES_SHOWN = 3;

/**
 * Collapses the per-control "X has no mirror counterpart and was left unchanged" lines of a mirror (Mirror Pose,
 * Mirror Animation) into one line with the count and at most three names, first; other warnings follow unchanged.
 * A whole-character mirror of a rig with many unpaired secondary controls otherwise raised a toast of ~1,000
 * characters over the panels (acceptance fix round 1). One unpaired control keeps its own line.
 */
export function summarizeMirrorWarnings(warnings: readonly string[]): string[] {
  const names: string[] = [];
  const rest: string[] = [];
  for (const warning of warnings) {
    if (warning.endsWith(UNPAIRED_SUFFIX)) names.push(warning.slice(0, -UNPAIRED_SUFFIX.length));
    else rest.push(warning);
  }
  if (names.length <= 1) return [...names.map((name) => `${name}${UNPAIRED_SUFFIX}`), ...rest];
  const shown = names.slice(0, UNPAIRED_NAMES_SHOWN);
  const more = names.length - shown.length;
  const list =
    more > 0 ? `${shown.join(', ')} and ${more} more` : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return [`${names.length} controls have no mirror counterpart and were left unchanged (${list})`, ...rest];
}
