// The ⑤ checklist (AUTORIG-SPEC §5.6.2; D6): plain sentences over the rows `characterExportRows` and the written file
// give. A pure function of (target, the live rows, the last download's lints and measures):
//
// - Checks: fixed sentences per target ("T-pose rest", "Licence chosen", …), each covering rule ids; a check is ✓ when
//   none of its rules has a row, else it takes the worst severity of its rows (errors gate, warnings do not, info rows
//   never gate — M6B-INT-11). Checks of byte rules only (`vrm.glb-size`, `vrm.node-count`, …) are known once the file
//   is written (C10 has no dry run): before a download they read "checked when you download", after it they show the
//   measured value ("File 0.4 / 50 MiB · JSON 61 KiB").
// - Rows no check covers are listed by the rule-label table (`RULE_LABELS`); a rule id the table does not know shows its
//   own message, so a new lint is never hidden.
// - Live rows (Validation, VRM meta) always come from the document now; the byte rules from the last download.
import type { AutoRigExportTarget } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import './strings';

export type RowSeverity = 'error' | 'warning' | 'info';

/** A row as `characterExportRows` and the artifacts' lints give it. */
export interface ChecklistInputRow {
  readonly code: string;
  readonly severity: RowSeverity;
  readonly message: string;
}

/** What a download measured (`measure.ts`). */
export interface Measured {
  readonly size: string;
  readonly nodes: string | null;
  readonly bones: string | null;
}

export type CheckState = 'ok' | 'pending' | RowSeverity;

export interface ChecklistItem {
  /** The check id, or the rule id of an uncovered row. */
  readonly id: string;
  readonly label: string;
  readonly state: CheckState;
  /** The rows behind a failed or flagged check, worst first (their messages and codes). */
  readonly rows: readonly ChecklistInputRow[];
  /** A check (true) or a row no check covers (false). */
  readonly check: boolean;
}

const t = (): ReturnType<typeof messages>['export'] => messages().export;

/** The rule ids the document gives (C7's Validation families and the VRM meta rows), known before a download. */
const LIVE = /^(skel|skin|xform|rig)\.|^vrm\.(meta-required|licence-unset|thumbnail-square)$/;
export const isLiveRule = (code: string): boolean => LIVE.test(code);

interface CheckDef {
  readonly id: string;
  readonly label: () => string;
  /** Rule ids (exact) or prefixes ending in `.` (every rule of that family, e.g. `validator.`). */
  readonly rules: readonly string[];
  /** The measured text that replaces the label once a file was written. */
  readonly measured?: (m: Measured) => string | null;
}

const covers = (def: CheckDef, code: string): boolean =>
  def.rules.some((rule) => (rule.endsWith('.') ? code.startsWith(rule) : code === rule));

const HUMANOID: CheckDef = {
  id: 'humanoid',
  label: () => t().checkHumanoid,
  rules: ['vrm.spec-version', 'vrm.bone-names', 'skel.unique-human-bone', 'skel.unique-names'],
};
/** The same check for an imported VRM 0.x avatar, whose bake keeps the version (AR-D8-5). */
const HUMANOID_VRM0: CheckDef = { ...HUMANOID, label: () => t().checkHumanoidVrm0 };
const REQUIRED: CheckDef = {
  id: 'required-bones',
  label: () => t().checkRequiredBones,
  rules: ['skel.required-bones', 'vrm.required-bones'],
};
const PARENTS: CheckDef = {
  id: 'parents',
  label: () => t().checkParents,
  rules: ['skel.parent-map', 'vrm.parent-map', 'skel.multiple-roots', 'vrm.node-tree'],
};
const TPOSE: CheckDef = { id: 'tpose', label: () => t().checkTpose, rules: ['skel.tpose'] };
const SKINNED: CheckDef = {
  id: 'skinned',
  label: () => t().checkSkinned,
  rules: [
    'skin.unbound',
    'skin.bind',
    'skin.unweighted-vertex',
    'skin.weight-sum',
    'skin.influences',
    'skin.limb-unweighted',
    'vrm.bones-skinned',
  ],
};
const TRANSFORMS: CheckDef = {
  id: 'transforms',
  label: () => t().checkTransforms,
  rules: [
    'xform.scale',
    'xform.not-frozen',
    'vrm.trs-only',
    'vrm.uniform-scale',
    'vrm.unit-rotation',
    'vrm.translation-range',
  ],
};
const META: CheckDef = { id: 'meta', label: () => t().checkMeta, rules: ['vrm.meta-required'] };
const LICENCE: CheckDef = { id: 'licence', label: () => t().checkLicence, rules: ['vrm.licence-unset'] };
const THUMBNAIL: CheckDef = { id: 'thumbnail', label: () => t().checkThumbnail, rules: ['vrm.thumbnail-square'] };
const SIZE: CheckDef = {
  id: 'size',
  label: () => t().checkSize,
  rules: ['vrm.glb-size', 'vrm.json-size', 'vrm.container'],
  measured: (m) => m.size,
};
const NODES: CheckDef = {
  id: 'nodes',
  label: () => t().checkNodes,
  rules: ['vrm.node-count'],
  measured: (m) => m.nodes,
};
const BONES: CheckDef = {
  id: 'bones',
  label: () => t().checkBones,
  rules: ['vrm.humanoid-bone-count'],
  measured: (m) => m.bones,
};
const EXTENSIONS: CheckDef = {
  id: 'extensions',
  label: () => t().checkExtensions,
  rules: ['vrm.extensions-required'],
};
const READ_BACK: CheckDef = {
  id: 'read-back',
  label: () => t().checkReadBack,
  rules: ['export.read-back', 'validator.'],
};
const SKELETON: CheckDef = {
  id: 'skeleton',
  label: () => t().checkSkeleton,
  rules: [
    'skel.required-bones',
    'skel.parent-map',
    'skel.multiple-roots',
    'skel.unique-names',
    'skel.unique-human-bone',
  ],
};

/** The checks of a target, in the order the column lists them (§5.6 mock). */
export function checksOf(target: AutoRigExportTarget, modelCharacter: boolean, vrm0 = false): readonly CheckDef[] {
  if (target === 'vrma') return [READ_BACK];
  if (!modelCharacter) {
    if (target === 'glb') return [READ_BACK];
    return [vrm0 ? HUMANOID_VRM0 : HUMANOID, REQUIRED, PARENTS, SIZE, NODES, BONES, EXTENSIONS, READ_BACK];
  }
  if (target === 'glb') return [SKELETON, TPOSE, SKINNED, TRANSFORMS, READ_BACK];
  return [
    HUMANOID,
    REQUIRED,
    PARENTS,
    TPOSE,
    SKINNED,
    TRANSFORMS,
    SIZE,
    NODES,
    BONES,
    EXTENSIONS,
    META,
    LICENCE,
    THUMBNAIL,
    READ_BACK,
  ];
}

/** Whether a check is known only from the written file (none of its rules is a live rule). */
const byteOnly = (def: CheckDef): boolean => def.rules.every((rule) => !isLiveRule(rule));

/** The rule-label table (§5.6.2): rule id → a plain sentence. */
export function ruleLabel(code: string): string | null {
  const m = t();
  const table: Readonly<Record<string, string>> = {
    'vrm.meta-required': m.checkMeta,
    'vrm.licence-unset': m.checkLicence,
    'vrm.thumbnail-square': m.checkThumbnail,
    'vrm.spec-version': m.checkHumanoid,
    'vrm.container': m.checkSize,
    'vrm.glb-size': m.checkSize,
    'vrm.json-size': m.checkSize,
    'vrm.node-count': m.checkNodes,
    'vrm.humanoid-bone-count': m.checkBones,
    'vrm.bone-names': m.checkHumanoid,
    'vrm.required-bones': m.checkRequiredBones,
    'vrm.parent-map': m.checkParents,
    'vrm.node-tree': m.checkParents,
    'vrm.trs-only': m.checkTransforms,
    'vrm.unit-rotation': m.checkTransforms,
    'vrm.translation-range': m.checkTransforms,
    'vrm.uniform-scale': m.checkTransforms,
    'vrm.extensions-required': m.checkExtensions,
    'vrm.bones-skinned': m.checkSkinned,
    'skel.tpose': m.checkTpose,
    'skel.required-bones': m.checkRequiredBones,
    'skel.parent-map': m.checkParents,
    'skel.unique-human-bone': m.checkHumanoid,
    'skel.unique-names': m.checkHumanoid,
    'skel.multiple-roots': m.checkParents,
    'skel.hinge-bend': m.ruleHinge,
    'skel.symmetry': m.ruleSymmetry,
    'skel.facing': m.ruleFacing,
    'skel.grounded': m.ruleGrounded,
    'skel.orientation-mixed': m.ruleOrientation,
    'skin.unbound': m.checkSkinned,
    'skin.bind': m.checkSkinned,
    'skin.cross-side': m.ruleCrossSide,
    'skin.dangling-joint': m.ruleDangling,
    'skin.influences': m.checkSkinned,
    'skin.joint-without-weights': m.ruleJointWithoutWeights,
    'skin.non-deforming-weighted': m.ruleNonDeforming,
    'skin.unreachable-island': m.ruleIsland,
    'skin.unweighted-vertex': m.checkSkinned,
    'skin.weight-sum': m.checkSkinned,
    'skin.limb-unweighted': m.checkSkinned,
    'skin.review': m.ruleReview,
    'xform.scale': m.checkTransforms,
    'xform.not-frozen': m.checkTransforms,
    'rig.out-of-sync': m.ruleRigSync,
    'rig.mode': m.ruleRigMode,
    'export.read-back': m.checkReadBack,
  };
  return table[code] ?? null;
}

const RANK: Readonly<Record<RowSeverity, number>> = { error: 0, warning: 1, info: 2 };
const worst = (rows: readonly ChecklistInputRow[]): RowSeverity | null =>
  rows.reduce<RowSeverity | null>(
    (acc, row) => (acc === null || RANK[row.severity] < RANK[acc] ? row.severity : acc),
    null,
  );

/**
 * The rows the column shows: the live rows (the document now) and, after a download, the written file's byte rows
 * (one row per code and message).
 */
export function mergeRows(
  live: readonly ChecklistInputRow[],
  written: readonly ChecklistInputRow[] | null,
): readonly ChecklistInputRow[] {
  const seen = new Set<string>();
  const out: ChecklistInputRow[] = [];
  for (const row of [...live, ...(written ?? []).filter((row) => !isLiveRule(row.code))]) {
    const key = `${row.code}\u0000${row.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** The checklist of a target (§5.6.2). `written` and `measured` are the last download's (null before one). */
export function checklistOf(input: {
  readonly target: AutoRigExportTarget;
  readonly modelCharacter: boolean;
  /** An imported VRM 0.x avatar (its humanoid check names the kept version, AR-D8-5). */
  readonly vrm0?: boolean;
  readonly live: readonly ChecklistInputRow[];
  readonly written: readonly ChecklistInputRow[] | null;
  readonly measured: Measured | null;
}): readonly ChecklistItem[] {
  const rows = mergeRows(input.live, input.written);
  const defs = checksOf(input.target, input.modelCharacter, input.vrm0 === true);
  const sortRows = (list: readonly ChecklistInputRow[]) =>
    [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const items: ChecklistItem[] = defs.map((def) => {
    const mine = sortRows(rows.filter((row) => covers(def, row.code)));
    const severity = worst(mine);
    // an imported avatar has no live rows: every check waits for the written file
    const pending = input.written === null && severity === null && (byteOnly(def) || !input.modelCharacter);
    const measured = input.measured === null || def.measured === undefined ? null : def.measured(input.measured);
    return {
      id: def.id,
      label: measured ?? def.label(),
      state: severity ?? (pending ? 'pending' : 'ok'),
      rows: mine,
      check: true,
    };
  });
  const extra = sortRows(rows.filter((row) => !defs.some((def) => covers(def, row.code))));
  for (const row of extra) {
    items.push({
      id: row.code,
      label: ruleLabel(row.code) ?? row.message,
      state: row.severity,
      rows: [row],
      check: false,
    });
  }
  return items;
}

/** The first error of a checklist (it gates *Download*), or null. */
export function firstError(items: readonly ChecklistItem[]): ChecklistItem | null {
  return items.find((item) => item.state === 'error') ?? null;
}
