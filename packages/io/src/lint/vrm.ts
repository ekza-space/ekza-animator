// The `vrm.*` lints (M6B-SPEC §0.4.6, §4.4; C10): OMOBA's runtime rules check for check, plus vrm.meta-required,
// vrm.licence-unset and vrm.thumbnail-square. C0 stub: no rule yet (C10 fills the list and wires it into the Space
// profile and `LINT_RULES`).
import type { LintRuleDef } from './rules';

export const VRM_LINT_RULES: readonly LintRuleDef[] = Object.freeze([]);
