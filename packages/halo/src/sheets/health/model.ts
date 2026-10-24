// Health, the model (STUDIO-TOUCH-SPEC §7.2, §7.3, §12.1, §15 rows 3.26, 5.3, 5.14, 6.8; T6b): the one readiness list
// of the destination grouped by stage, each row with Fix, Show me and Why? (the rule id and the profile one layer
// down, for developers); the glyph legend; the checks that ran (Mesh Check, the Rig checks and their profile, the clip
// slots, the model check and the triangle budget); the failing model checks in Auto-Rig's fix order (`autorig.fix`);
// and the Fixes group, poll-gated, so every fix operator the manifest places in Health is reachable even when no row
// asks for it. React-free: the sheet renders it, the unit tests drive it headless. Readiness is read, never stored,
// and never loads a chunk; only a tap runs an operator (through the sheet's `ctx.run`).
import type { MeshId } from '@ekza-studio/doc';
import {
  AUTORIG_FIX_ORDER,
  type AutoRigFix,
  type EditorApp,
  type HaloStage,
  type IntakeReport,
  isRigWorkspaceOperator,
  type RunContext,
  rigValidation,
  transformsUniform,
} from '@ekza-studio/editor-core';
import { PLAIN_LABELS } from '../../manifest/labels';
import { DESTINATIONS, type Destination, type DestinationId, destinationOf } from '../../path/destinations';
import {
  GLYPH_MEANING,
  GLYPH_TEXT,
  type Readiness,
  type ReadinessRow,
  type ReadinessStage,
  readiness,
  type StageGlyph,
} from '../../path/readiness';

/** One operator run of a control. */
export interface OperatorCall {
  readonly op: string;
  readonly args?: unknown;
}

/** The context Health polls with: the canvas, as the sheet's controls run (`ctx.run`). */
export const HEALTH_CONTEXT: RunContext = { panel: 'viewport' };

/** A row's action: a run, or (the Validation fix *Edit VRM Meta…*) the About this character sheet. */
export interface HealthAction extends OperatorCall {
  /** The button's word: *Fix*, *Show me*, *Go fix ▸*. */
  readonly label: string;
  /** What it does, in plain words (*Centre and ground*). */
  readonly plain: string;
  /** Studio Pro's name, in grey. */
  readonly pro: string;
  /** Opens this sheet instead of running (`ui.open {dialog: 'vrmMeta'}` → About this character, §6.7). */
  readonly sheet?: 'about';
}

export interface HealthRow {
  readonly id: string;
  readonly stage: ReadinessStage;
  readonly severity: 'error' | 'warning';
  readonly text: string;
  readonly why: string;
  readonly ids: readonly string[];
  /** One operator that fixes it in place, or null (a hands-on fix: *Go fix ▸*). */
  readonly fix: HealthAction | null;
  /** *Show me*: selects and frames the offending thing, then switches to its stage. */
  readonly show: HealthAction | null;
  /** For developers, one layer down (§6.2 Health dot ⋯): the rule id and the profile it was checked against. */
  readonly rule: string;
  readonly profile: string | null;
}

export interface HealthStageGroup {
  readonly stage: ReadinessStage;
  readonly title: string;
  /** The stage node's glyph with its count (`⚠2`), and its meaning in words (§18: never colour alone). */
  readonly glyph: string;
  readonly meaning: string;
  /** The word under an empty stage. */
  readonly empty: string;
  readonly rows: readonly HealthRow[];
}

export interface LegendEntry {
  readonly glyph: StageGlyph;
  readonly text: string;
  readonly meaning: string;
}

/** A check that ran (or not yet) for the destination: the *checks* section. */
export interface HealthCheck {
  readonly id: 'mesh' | 'rig' | 'animations' | 'model' | 'budget';
  readonly label: string;
  readonly pro: string;
  readonly status: string;
  readonly ran: boolean;
}

/** A poll-gated control (the Fixes group, Check the model, the profile switch). */
export interface HealthControl extends OperatorCall {
  readonly id: string;
  readonly plain: string;
  readonly pro: string;
  readonly enabled: boolean;
  readonly reason: string | null;
  /** Sub-choices (Clean up a mesh: what to clean up), each gated on its own. */
  readonly choices?: readonly HealthControl[];
}

/** The last model check (`autorig.inspect`'s report and the meshes it measured). */
export interface ModelCheckRun {
  readonly report: IntakeReport;
  readonly meshes: readonly MeshId[];
}

/** One check of the model check (Auto-Rig ①), in Auto-Rig's fix order. */
export interface ModelCheckRow {
  readonly fix: AutoRigFix;
  readonly label: string;
  readonly ok: boolean;
  /** What is wrong, in plain words (failing rows). */
  readonly problem: string;
  /** `autorig.fix {fix, meshes}` (failing rows; poll-gated). */
  readonly action: HealthControl | null;
}

export interface HealthModel {
  readonly destination: Destination;
  readonly readiness: Readiness;
  /** "N to fix · for <destination>", or "Nothing to fix for <destination>" (never "All good" while a row exists). */
  readonly header: string;
  /** The status pill's number for this destination. */
  readonly total: number;
  readonly destinations: readonly { readonly id: DestinationId; readonly name: string }[];
  readonly legend: readonly LegendEntry[];
  readonly groups: readonly HealthStageGroup[];
  /** The model check's failing rows (problems › Before rigging); empty until a check ran. */
  readonly beforeRigging: readonly ModelCheckRow[];
  /** A line under the header when the model check has suggestions (they are not readiness rows). */
  readonly suggestions: string | null;
  readonly checks: readonly HealthCheck[];
  /** *Check the model* / *Check again* (`autorig.inspect`). */
  readonly inspect: HealthControl;
  /** Every row of the last model check (passing ones too). */
  readonly modelCheck: readonly ModelCheckRow[] | null;
  /** The Rig checks' profile: shown, switched only through the destination (`rig.validation.profile`). */
  readonly profile: {
    readonly wanted: string | null;
    readonly current: string | null;
    readonly control: HealthControl;
  };
  readonly fixes: readonly HealthControl[];
}

const STAGE_TITLES: Readonly<Record<ReadinessStage, string>> = {
  make: 'Make',
  paint: 'Paint',
  rig: 'Rig',
  animate: 'Animate',
  share: 'Share',
};

const STAGE_ORDER: readonly ReadinessStage[] = ['make', 'paint', 'rig', 'animate', 'share'];

const HALO_STAGES: ReadonlySet<string> = new Set(['make', 'paint', 'rig', 'animate']);

export const isHaloStage = (stage: string): stage is HaloStage => HALO_STAGES.has(stage);

/** The legend at the top of the sheet (§7.2), in the order of the table. */
export const LEGEND: readonly LegendEntry[] = (['untouched', 'progress', 'ready', 'warn', 'unchecked'] as const).map(
  (glyph) => ({
    glyph,
    text: glyph === 'warn' ? `${GLYPH_TEXT.warn}n` : GLYPH_TEXT[glyph],
    meaning: GLYPH_MEANING[glyph],
  }),
);

/** `mesh.cleanup {fix}` in plain words, with the Cleanup option's Pro name (M6A-SPEC §5.25). */
export const CLEANUP_FIXES: readonly { readonly fix: string; readonly plain: string; readonly pro: string }[] = [
  { fix: 'deleteLamina', plain: 'Remove faces lying on top of each other', pro: 'Delete lamina faces' },
  { fix: 'collapse', plain: 'Remove edges and faces with no size', pro: 'Collapse degenerate' },
  { fix: 'conform', plain: 'Turn every face the same way', pro: 'Conform normals' },
  { fix: 'triangulate', plain: 'Split bent many-sided faces', pro: 'Triangulate' },
  { fix: 'dissolve', plain: 'Remove stray points', pro: 'Dissolve stray vertices' },
  { fix: 'deleteLoose', plain: 'Remove loose points and edges', pro: 'Delete loose geometry' },
];

/** The plain words of an operator run (the manifest's label, with the cases whose arguments change the meaning). */
export function plainOf(app: EditorApp, op: string, args: unknown): string {
  const record = args !== null && typeof args === 'object' ? (args as Readonly<Record<string, unknown>>) : {};
  if (op === 'mesh.cleanup') {
    const fix = CLEANUP_FIXES.find((entry) => entry.fix === record['fix']);
    if (fix !== undefined) return fix.plain;
  }
  if (op === 'skel.pose.applyAsRest' && record['pose'] === 'tStance') return 'Straighten to T-pose';
  if (op === 'ui.open' && record['dialog'] === 'vrmMeta') return 'About this character';
  if (op === 'autorig.fix') {
    const fix = AUTORIG_FIX_WORDS[record['fix'] as AutoRigFix];
    if (fix !== undefined) return fix.action;
  }
  return PLAIN_LABELS[op] ?? app.operators.get(op)?.label ?? op;
}

const proOf = (app: EditorApp, op: string): string => app.operators.get(op)?.label ?? op;

/** A poll in the sheet's context (true, or why not); an unknown operator says so. */
export function pollCall(app: EditorApp, op: string, args: unknown): { enabled: boolean; reason: string | null } {
  if (app.operators.get(op) === undefined) {
    // A rig-workspace id before its chunk loaded: reading never loads it (§7.2); the tap does (the runner's lazy
    // chunk), and a refusal then comes back as the run's toast.
    return isRigWorkspaceOperator(op) && !app.rig.loaded
      ? { enabled: true, reason: null }
      : { enabled: false, reason: 'Not available here yet' };
  }
  try {
    const result = app.operators.poll(op, HEALTH_CONTEXT, args);
    return result === true ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  } catch (error) {
    return { enabled: false, reason: error instanceof Error ? error.message : 'Not available' };
  }
}

function control(app: EditorApp, id: string, op: string, args: unknown, plain?: string): HealthControl {
  const { enabled, reason } = pollCall(app, op, args);
  return {
    id,
    op,
    ...(args === undefined ? {} : { args }),
    plain: plain ?? plainOf(app, op, args),
    pro: proOf(app, op),
    enabled,
    reason,
  };
}

function rowAction(app: EditorApp, label: string, action: ReadinessRow['fix']): HealthAction | null {
  if (action === null) return null;
  const args = action.args as Readonly<Record<string, unknown>> | undefined;
  const opensAbout = action.op === 'ui.open' && args?.['dialog'] === 'vrmMeta';
  return {
    op: action.op,
    ...(action.args === undefined ? {} : { args: action.args }),
    label,
    plain: plainOf(app, action.op, action.args),
    pro: action.label === label ? proOf(app, action.op) : action.label,
    ...(opensAbout ? { sheet: 'about' as const } : {}),
  };
}

/** The profile a destination's Rig checks use (`'source'` and none: the panel's own, as readiness reads them). */
function profileOf(app: EditorApp, destination: Destination): string | null {
  if (destination.profile !== null && destination.profile !== 'source') return destination.profile;
  return app.rig.loaded ? rigValidation(app).profile : null;
}

function healthRow(app: EditorApp, row: ReadinessRow, profile: string | null): HealthRow {
  return {
    id: row.id,
    stage: row.stage,
    severity: row.severity,
    text: row.text,
    why: row.why,
    ids: row.ids,
    fix: rowAction(app, 'Fix', row.fix),
    show: rowAction(app, 'Show me', row.show),
    rule: row.code,
    profile: row.stage === 'make' ? null : profile,
  };
}

function stageGlyph(r: Readiness, stage: ReadinessStage, rows: number): { glyph: string; meaning: string } {
  if (stage === 'share') {
    return rows > 0
      ? { glyph: `${GLYPH_TEXT.warn}${rows}`, meaning: GLYPH_MEANING.warn }
      : { glyph: GLYPH_TEXT.ready, meaning: GLYPH_MEANING.ready };
  }
  const state = r.stages[stage];
  return {
    glyph: state.glyph === 'warn' ? `${GLYPH_TEXT.warn}${state.count}` : GLYPH_TEXT[state.glyph],
    meaning: GLYPH_MEANING[state.glyph],
  };
}

/** The header line (§7.2: never "All good" while any row exists). */
export function headerText(total: number, destination: Destination): string {
  return total > 0 ? `${total} to fix · for ${destination.name}` : `Nothing to fix for ${destination.name}`;
}

// ---------- the model check (Auto-Rig ①, §12.1) ----------

const AUTORIG_FIX_WORDS: Readonly<Record<AutoRigFix, { readonly check: string; readonly action: string }>> = {
  standUp: { check: 'Standing up', action: 'Stand it up' },
  scale: { check: 'A person-sized height', action: 'Set the height' },
  freeze: { check: 'Scaled evenly', action: 'Even out the scale' },
  center: { check: 'In the middle, on the ground', action: 'Centre and ground' },
  face: { check: 'Facing forward', action: 'Face forward' },
};

/** The scene meshes a model check measures and its fixes move (the meshes before a character owns them). */
export function sceneMeshes(app: EditorApp): MeshId[] {
  return app.store
    .list('meshes')
    .filter((mesh) => mesh.deleted === null && 'scene' in mesh.owner)
    .map((mesh) => mesh.id);
}

/** Every check of a model check run, in Auto-Rig's fix order (§5.2, AS-AR-5), with `autorig.fix` on failing ones. */
export function modelCheckRows(app: EditorApp, run: ModelCheckRun): ModelCheckRow[] {
  const live = run.meshes.filter((id) => app.store.get('meshes', id)?.deleted === null);
  const c = run.report.checks;
  const state: Readonly<Record<AutoRigFix, { ok: boolean; problem: string }>> = {
    standUp: { ok: c.upright, problem: 'Lying down' },
    scale: {
      ok: c.scale === 'ok',
      problem: c.scale === 'tiny' ? 'Very small for a character' : 'Very large for a character',
    },
    freeze: { ok: transformsUniform(app, live), problem: 'Stretched unevenly' },
    center: {
      ok: c.centred && c.grounded,
      problem: !c.centred ? 'Not in the middle' : 'Not standing on the ground',
    },
    face: { ok: c.facing, problem: 'Not facing forward' },
  };
  return AUTORIG_FIX_ORDER.map((fix): ModelCheckRow => {
    const { ok, problem } = state[fix];
    return {
      fix,
      label: AUTORIG_FIX_WORDS[fix].check,
      ok,
      problem,
      action:
        ok || live.length === 0
          ? null
          : control(app, `autorig.fix:${fix}`, 'autorig.fix', { fix, meshes: live }, AUTORIG_FIX_WORDS[fix].action),
    };
  });
}

// ---------- the Fixes group ----------

interface CharacterLike {
  readonly id: string;
  readonly deleted: unknown;
  readonly source: { readonly kind: string };
}

function activeCharacter(app: EditorApp): CharacterLike | null {
  const live = (app.store.list('characters') as unknown as readonly CharacterLike[]).filter((c) => c.deleted === null);
  const id = app.session.getState().activeCharacter;
  return live.find((c) => c.id === id) ?? live[0] ?? null;
}

function skeletonOf(app: EditorApp, character: string): string | null {
  const skeleton = app.store
    .list('skeletons')
    .find((record) => record.deleted === null && (record.character as string) === character);
  return skeleton?.id ?? null;
}

/** The meshes a cleanup works on: the selected editable meshes, else every editable mesh. */
export function cleanupMeshes(app: EditorApp): MeshId[] {
  const editable = app.store
    .list('meshes')
    .filter((mesh) => mesh.deleted === null && mesh.data !== null)
    .map((mesh) => mesh.id);
  const selected = new Set<string>([
    ...app.session.getState().selection.objects,
    ...app.session.getState().model.hilite,
  ]);
  const picked = editable.filter((id) => selected.has(id));
  return picked.length > 0 ? picked : editable;
}

/** A Fixes row that cannot build its arguments: greyed with a plain reason. */
function unavailable(app: EditorApp, id: string, op: string, reason: string): HealthControl {
  return { id, op, plain: plainOf(app, op, undefined), pro: proOf(app, op), enabled: false, reason };
}

/**
 * The Fixes group (§12.1, §15 rows 5.3, 5.5, 5.10, 6.8): every fix operator the manifest places in Health, each
 * poll-gated in the sheet's context (greyed with the reason when its poll fails).
 */
export function healthFixes(app: EditorApp): HealthControl[] {
  const meshes = sceneMeshes(app);
  const placed = meshes.length === 0 ? {} : { meshes };
  const character = activeCharacter(app);
  const skeleton = character === null ? null : skeletonOf(app, character.id);
  const cleanup = cleanupMeshes(app);
  const cleanupChoices = CLEANUP_FIXES.map((entry) =>
    cleanup.length === 0
      ? {
          ...unavailable(app, `mesh.cleanup:${entry.fix}`, 'mesh.cleanup', 'Make or bring a mesh first'),
          plain: entry.plain,
          pro: entry.pro,
        }
      : {
          ...control(app, `mesh.cleanup:${entry.fix}`, 'mesh.cleanup', {
            meshes: cleanup,
            fix: entry.fix,
            selectOnly: false,
          }),
          pro: entry.pro,
        },
  );
  const cleanupRow: HealthControl = {
    id: 'mesh.cleanup',
    op: 'mesh.cleanup',
    plain: 'Clean up a mesh',
    pro: proOf(app, 'mesh.cleanup'),
    enabled: cleanupChoices.some((choice) => choice.enabled),
    reason: cleanupChoices.some((choice) => choice.enabled)
      ? null
      : (cleanupChoices.find((choice) => choice.reason !== null)?.reason ?? 'Nothing to clean up'),
    choices: cleanupChoices,
  };
  return [
    control(app, 'skel.quickRig.center', 'skel.quickRig.center', placed),
    control(app, 'skel.quickRig.faceForward', 'skel.quickRig.faceForward', placed),
    skeleton === null
      ? unavailable(app, 'skel.template.addMissing', 'skel.template.addMissing', 'Needs a character with a skeleton')
      : control(app, 'skel.template.addMissing', 'skel.template.addMissing', { skeleton }),
    character === null
      ? unavailable(app, 'skel.pose.applyAsRest', 'skel.pose.applyAsRest', 'Needs a character with a skeleton')
      : control(app, 'skel.pose.applyAsRest', 'skel.pose.applyAsRest', { character: character.id }),
    control(app, 'skin.weights.normalize', 'skin.weights.normalize', undefined),
    control(app, 'skin.palette.compact', 'skin.palette.compact', undefined),
    cleanupRow,
  ];
}

// ---------- the checks that ran ----------

function checksOf(app: EditorApp, r: Readiness, profile: string | null, run: ModelCheckRun | null): HealthCheck[] {
  const destination = r.destination;
  const meshes = app.store.list('meshes').filter((mesh) => mesh.deleted === null && mesh.data !== null).length;
  const character = activeCharacter(app);
  const checks: HealthCheck[] = [];
  checks.push({
    id: 'mesh',
    label: 'Shape check',
    pro: 'Mesh Check',
    ran: r.stages.make.glyph !== 'unchecked',
    status:
      r.stages.make.glyph === 'unchecked'
        ? 'Not checked yet: the shape tools are not loaded'
        : meshes === 0
          ? 'No shapes to check'
          : `Checked ${meshes} shape${meshes === 1 ? '' : 's'}${destination.id === 'exploring' ? ' (errors only while exploring)' : ''}`,
  });
  checks.push({
    id: 'rig',
    label: 'Rig checks',
    pro: profile === null ? 'Validation' : `Validation · ${profile}`,
    ran: r.stages.rig.glyph !== 'unchecked' && character !== null && destination.id !== 'exploring',
    status:
      destination.id === 'exploring'
        ? `Not checked while ${destination.name.toLowerCase()}`
        : character === null
          ? 'No character yet'
          : r.stages.rig.glyph === 'unchecked'
            ? 'Not checked yet: the rig tools are not loaded'
            : `Checked for ${destination.name}`,
  });
  const required =
    destination.profile === null || destination.profile === 'source'
      ? []
      : (app.exportProfiles.get(destination.profile)?.requiredClips ?? []);
  checks.push({
    id: 'animations',
    label: 'Animations needed',
    pro: 'Required clip slots',
    ran: required.length > 0 && character !== null,
    status:
      required.length === 0
        ? `None needed for ${destination.name}`
        : character === null
          ? `Needs ${required.join(', ')}: no character yet`
          : `Needs ${required.join(', ')}`,
  });
  const rows = run === null ? null : modelCheckRows(app, run);
  checks.push({
    id: 'model',
    label: 'Model check',
    pro: proOf(app, 'autorig.inspect'),
    ran: rows !== null,
    status:
      rows === null
        ? 'Not run yet: stance, size, centre and facing before rigging'
        : `${rows.filter((row) => row.ok).length} of ${rows.length} fine`,
  });
  if (r.budget !== null) {
    checks.push({
      id: 'budget',
      label: 'Size budget',
      pro: 'Triangle budget',
      ran: true,
      status: `${r.budget.tris} of ${r.budget.limit} triangles`,
    });
  }
  return checks;
}

/** The whole sheet's model for a destination and the last model check run (null: none ran in this sheet). */
export function healthModel(app: EditorApp, destinationId: string, run: ModelCheckRun | null = null): HealthModel {
  const r = readiness(app, destinationId);
  const destination = r.destination;
  const profile = profileOf(app, destination);
  const rows = r.rows.map((row) => healthRow(app, row, profile));
  const groups = STAGE_ORDER.filter((stage) => stage !== 'share' || rows.some((row) => row.stage === 'share')).map(
    (stage): HealthStageGroup => {
      const own = rows.filter((row) => row.stage === stage);
      const { glyph, meaning } = stageGlyph(r, stage, own.length);
      const unchecked = stage !== 'share' && r.stages[stage].glyph === 'unchecked';
      return {
        stage,
        title: STAGE_TITLES[stage],
        glyph,
        meaning,
        empty: unchecked ? 'Not checked yet: its tools are not loaded' : `Nothing to fix for ${destination.name}`,
        rows: own,
      };
    },
  );
  const modelCheck = run === null ? null : modelCheckRows(app, run);
  const beforeRigging = (modelCheck ?? []).filter((row) => !row.ok);
  const meshes = sceneMeshes(app);
  const inspect =
    meshes.length === 0
      ? unavailable(app, 'autorig.inspect', 'autorig.inspect', 'Works on shapes before they become a character')
      : control(app, 'autorig.inspect', 'autorig.inspect', { meshes });
  const wanted = destination.profile === null || destination.profile === 'source' ? null : destination.profile;
  const current = app.rig.loaded ? rigValidation(app).profile : null;
  const profileControl: HealthControl =
    wanted === null
      ? unavailable(
          app,
          'rig.validation.profile',
          'rig.validation.profile',
          `${destination.name} has no Rig checks of its own`,
        )
      : !app.rig.loaded
        ? unavailable(app, 'rig.validation.profile', 'rig.validation.profile', 'The rig tools are not loaded yet')
        : current === wanted
          ? {
              ...control(app, 'rig.validation.profile', 'rig.validation.profile', { profile: wanted }),
              enabled: false,
              reason: `Already checking for ${destination.name}`,
            }
          : control(app, 'rig.validation.profile', 'rig.validation.profile', { profile: wanted });
  return {
    destination,
    readiness: r,
    header: headerText(r.total, destination),
    total: r.total,
    destinations: DESTINATIONS.map((d) => ({ id: d.id, name: d.name })),
    legend: LEGEND,
    groups,
    beforeRigging,
    suggestions:
      beforeRigging.length === 0
        ? null
        : `${beforeRigging.length} suggestion${beforeRigging.length === 1 ? '' : 's'} before rigging, from the model check`,
    checks: checksOf(app, r, profile, run),
    inspect: { ...inspect, plain: run === null ? 'Check the model' : 'Check again' },
    modelCheck,
    profile: { wanted, current, control: profileControl },
    fixes: healthFixes(app),
  };
}

/** The `rig.validation.profile` run a destination switch makes (it follows the destination), or null. */
export function profileSwitch(app: EditorApp, destinationId: DestinationId): OperatorCall | null {
  const destination = destinationOf(destinationId);
  if (destination.profile === null || destination.profile === 'source' || !app.rig.loaded) return null;
  if (rigValidation(app).profile === destination.profile) return null;
  return { op: 'rig.validation.profile', args: { profile: destination.profile } };
}

/** Where `args.section` points: a section of the sheet, or a stage's rows (the Path's ⚠n, §7.2). */
export function sectionTarget(section: string | undefined): string | null {
  if (section === undefined || section === '') return null;
  if (STAGE_ORDER.includes(section as ReadinessStage)) return `stage-${section}`;
  return section === 'problems' || section === 'checks' || section === 'legend' ? section : null;
}

/** Resolves once the session's workspace is `workspace` (or after `timeoutMs`): *Show me* after a stage switch. */
export function whenWorkspace(app: EditorApp, workspace: string, timeoutMs = 4000): Promise<boolean> {
  if (app.session.getState().workspace === workspace) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve(ok);
    };
    const off = app.session.subscribe(() => {
      if (app.session.getState().workspace === workspace) finish(true);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}
