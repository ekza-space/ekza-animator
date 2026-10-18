# Ekza Animator — M2a build specification ("game-clip daily driver")

Status: v0.3 (2026-10-18, integration revision: A0…A5 merged, and with the integration merged into `dev`; the packages' contract PRs ratified into this file and
[DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18), the acceptance rows E2E-M2A-23/24 amended
for the fixtures' leg reach, [§10.4](#104-integration-record) records the result, including the integration's fix
round 1; v0.2 was the review revision, items not applied are listed with reasons in
[§11.1](#111-review-items-not-applied-v02)), the build spec for milestone M2a.
Contract amendments with A0 (2026-10-18): `time.insertTime` takes an optional `at` and Delete Time is its own operator
`time.deleteTime` (§4.5, §4.9, §5.9), so the menu-bar Time items need no frame argument; `ReduceOptions.cycleAwareAuto`
(§4.1, §5.23).
Audience: the integration agent (A0 and the final integration), five parallel implementation agents (A1…A5) and
reviewers. Read [MVP-SPEC.md](MVP-SPEC.md) (v0.3) first: it stays the base contract. This file lists **deltas**;
where the two disagree for M2a work, this file wins.
Requirements: [REQUIREMENTS.md](REQUIREMENTS.md); research: R01 (Maya features), R02 §6.4 (export reduction), R07
(rig math), R09 (UI).

Normative words: **MUST**, **SHOULD**, **MAY**. "Contract" means a type or signature in §4 or a package's *Public API*
block in §8. Changing a contract needs a PR that updates this file first. M1 contracts not mentioned here are
unchanged.

Contents: [1 Scope](#1-scope) · [2 Dependencies and toolchain](#2-dependencies-and-toolchain) ·
[3 Conventions](#3-conventions-deltas-to-mvp-spec-3) · [4 Contract deltas](#4-contract-deltas) ·
[5 Normative behaviours](#5-normative-behaviours) · [6 Keymap additions](#6-keymap-additions-preset-maya) ·
[7 UI placement](#7-ui-placement) · [8 Work packages](#8-work-packages) ·
[9 Acceptance tests](#9-acceptance-tests-and-e2e-scenarios) · [10 Integration and definition of done](#10-integration-plan-and-m2a-definition-of-done) ·
[11 Defaults chosen and review decisions](#11-defaults-chosen-owner-may-override)

---

## 1. Scope

### 1.1 In scope (M2a core)

| # | Area | Content | Requirements |
|---|---|---|---|
| 1 | **Limb IK** | Two-bone IK for legs and arms on the existing solver slot: `ik.leg.L/R`, `pole.leg.L/R`, `ik.arm.L/R`, `pole.arm.L/R` controls; the `ik2` rig op (R07 §9.2 with the rest-exact amendments of §5.3); soft IK; pole twist; per-limb `ikFk` blend with IK/FK control visibility; **match** FK→IK and IK→FK (hyperextension-safe pole, §5.6); **seamless switch**; a simple **foot roll** on leg IK controls (heel, ball and toe pivots placed from the foot mesh, roll and bank about the foot's own axes, heel and toe twist, numeric pivot fields); custom keyable attribute channels (`@name`), which the IK attributes need; imports write IK controls from sampled feet (R07 §15.4) and keep a limb FK when IK cannot reproduce it; Plant Feet also works on IK legs; exports bake IK to bones exactly like FK; an explicit, undoable upgrade of M1 rigs | FR-RIG-11, part of FR-RIG-12 (foot roll, simple variant) |
| 2 | **Time slider extras** | Mod+drag copies a band's keys, **ripple** for band moves and scales, **MMB-drag carries the pose** to another frame, insert and remove time, breakdown ticks in green, keyboard nudge of selected keys | FR-TIME-07 (V1 part), FR-TIME-10 |
| 3 | **Dope Sheet** | Dockable panel with Summary › Character › Body part › Control › Channel rows, key and breakdown glyphs, hold bars, select/move/scale/nudge/delete/copy/paste (paste inserts under ripple), ripple, shared key selection with the Graph Editor and the time slider | FR-DS-01, FR-DS-02 |
| 4 | **Posing tools** | Tween slider family (tween, blend to neighbour, ease, push/pull, blend to default) with overshoot, on the current pose or on runs of selected keys, in the status line and the curve panels; breakdown keys with proportional retiming; mirror animation with a half-cycle offset; **cycle-aware auto tangents on loop clips** | FR-KEY-08, FR-KEY-09, FR-POSE-05, FR-GE-17 |
| 5 | **Graph Editor and productivity** | Buffer curves (snapshot, swap); normalized and stacked views; scale tool with a region box; export-side error-bounded key reduction of sampled tracks; pick-walk; Channel Box virtual slider (also MMB in the viewport); keying by body part; autosave to IndexedDB with crash recovery | FR-GE-18, FR-GE-19, FR-GE-20, FR-EXP-12, FR-OUT-05, FR-CB-05, FR-KEY-10, FR-PROJ-05 |
| 6 | **M1 budget misses** | M-1 drag 1,000 keys ≤ 4 ms; M-2 editor route JS ≤ 900 kB gzip with real headroom (initial route ≤ 800,000 B) through lazy loading and a CI size gate; M-3 anim-core 2,200 curves ≤ 0.3 ms | NFR-01, NFR-14 |

### 1.2 M2a-stretch (implement only if time remains; tests `test.fixme` until done)

| Item | Fallback in M2a core |
|---|---|
| "Ghost" display of the inactive IK/FK set (25 % alpha) | `prefs.ikFkVisibility` accepts only `'hide'`; `'ghost'` poll-fails in Preferences with "not available yet" |
| Dope Sheet "show all keyable channels" (rows for channels without curves) | Only animated channels get rows |
| Mesh-pick → IK control mapping when `ikFk > 0.5` (R07 §6) | Mesh picks keep returning the FK control and say "IK limb: pick the IK control" (an info toast: viewport tools reach the notifier, not the shell's help line; M2A-INT-18) |
| Key hold (R01 KY-08: copy the previous key's value to the current frame) and a stepped preview toggle for blocking | Set a key with the same value; set stepped tangents (`6` in the Graph Editor and on the time slider) |
| Ankle and wrist motion trail (positions sampled once per committed edit, drawn as a polyline with frame ticks) | Judge arcs by scrubbing; onion skin and full motion trails are M2c |
| `rig.ikFk.matchRange` followed by an automatic Simplify of the written curves | Run Graph › Simplify on the written curves |

### 1.3 Out of scope (later milestones)

Space switching and "pole follows foot" (M5), stretch IK, spline/FABRIK chains, full-body IK, constraints (M2c),
the `footRoll` solver type as a separate record (the leg `ik2` op carries the foot roll), separate `ballRoll` and
`toeRoll` attributes, rig editing UI for pivots in the viewport and IK control shapes (M2c Rig workspace; M2a has
numeric pivot fields), onion skin and motion trails (M2c), quaternion curves, animation layers, `K`-drag viewport
time scrub, marking menus, time bookmarks, playblast, collaboration (M3), Ekza upload (M4a), modeling (M6).

### 1.4 What M2a is for (say it plainly)

M2a makes the editor a daily driver for **game clips**: walk and run cycles, attacks, hits and emotes with planted
feet and contacts, retimed in a Dope Sheet and polished with tweens and breakdowns. Acceptance: a walk cycle and an
attack clip with planted feet are authored with leg IK and **without Plant Feet** (E2E-M2A-23, -24). The release is
`v0.2.x` (the tag is the owner's call). README and the first-run card change "Legs are FK" to "Legs are IK by
default; arms are FK with IK one click away".

README's "What M2a is for" also names the known gaps plainly: no onion skin or motion trails yet (arcs are judged by
scrubbing; M2c); knee and elbow poles live in `root` space, so on turn-in-place and pivoting attacks the pole is
animated with the foot (or the knee is aimed with the `twist` attribute) until space switching (M5); an IK limb
cannot hold a hyperextended knee or elbow (the match bends it the other way and says by how much); an imported limb
whose knee or elbow is not a clean hinge stays FK for that clip (§5.8) and says so.

---

## 2. Dependencies and toolchain

**No new runtime or dev dependency.** IndexedDB, Web Locks, Pointer Lock and `requestIdleCallback` are browser APIs;
every use is feature-detected and wrapped in try/catch (NFR-12). The toolchain of MVP-SPEC §2 is unchanged.

`package.json` changes (owned by the integration agent, landed in A0):

| Package | Change | Why |
|---|---|---|
| `@ekza-animator/io` | new subpath export `"./write": "./src/write.ts"` (bake, surgeon, animation-GLB and VRMA writers, export lints) | M-2: glTF Transform loads only when an export runs (§5.21.2) |
| `apps/web` | script `"check:size": "node scripts/check-size.mjs"` | M-2 size gate |
| root | `ci` runs `pnpm --filter web check:size` after `build` | M-2 size gate in CI |

---

## 3. Conventions (deltas to MVP-SPEC §3)

1. **Contract freeze after A0.** A0 lands every §4 type, every new public function as a stub
   (`EkzaError('not-implemented', '<package>.<symbol>')`), every new operator registered as a stub that poll-fails with
   "not available yet", every §6 keymap row, menu item and `data-testid` reservation. **Exception: a function that an M1
   code path or another package's baseline calls is never a throwing stub**; A0 lands a working baseline for it (§8 A0
   lists them: `controlVisibility` rule 1, `bodyPartOf`, `keyTargetControls`, `channelUnit`, `channelDefaultOf`,
   `registerBuiltinRigOps`, the schema rule, …), which the owner later extends. After A0 merges, A1…A5 edit only their
   owned directories and the shared files granted to them (§8.1). A contract change goes through a PR to this file
   reviewed by the integration agent.
2. **New files over shared files.** New operators live in new files (`operators/builtin/{ik,tween,breakdown,
   graphBuffer,mirrorAnimation,autosave}.ts`); A0 creates them with stubs and registers them in
   `operators/builtin/index.ts`, so no two packages edit the index. Operators that act on a focused panel controller
   (`dopeSheet.frame`, `graph.view.setMode`) are registered by the curve-editor contribution functions
   (`registerDopeSheetContributions`, `registerGraphContributions`), whose A0 versions register them as poll-failing
   stubs; operators of existing files (`key.toggleRipple` in `time.ts`, `select.pickWalk` in `select.ts`, …) are
   stubbed by A0 in those files.
3. **Deterministic IDs** for auto-rig solvers: `solverId(rig, templateKey)` = `'slv_'` + 16 base62 characters of
   `sha256(rigId + ':' + templateKey)` (the derivation of `deriveMigratedId`); controls keep `controlId(rig, key)`.
   Two peers adding limb IK to the same rig create identical records.
4. **Test gates.** A package whose tests need another M2a package uses the M1 pattern: `describe.skipIf(!READY.a1)`
   in unit tests and `test.fixme` with the blocking package id in e2e, turned into failures at integration
   (MVP-SPEC INT-55). The `READY` flags live in each package's `test/ready.ts`.
5. **E2E files** are `apps/web/e2e/m2a-NN-<slug>.spec.ts` (one scenario or a serial group per file); helpers are
   `apps/web/e2e/helpers/m2a-<package>.ts`. Bench files are `apps/web/e2e/bench/m2a-<package>.bench.ts`;
   `budgets.bench.ts` stays A5's.
6. **Notes.** Each package records interpretations in `docs/wp-notes/m2a-<id>.md`; the integration agent copies the
   decisions into DECISIONS-OPEN §F "M2a build deviations" (IDs `M2A-<id>-<n>`).
7. Every rule of MVP-SPEC §3 still holds (no allocation in per-frame paths, explicit registration, Node-safe headless
   packages, `EkzaError` for caller errors, repair never reject for document content).
8. **Literal updates are not weakening.** Where a contract change alters a literal that an M1 test encodes (the layout
   storage key and `"schemaVersion":1` in `dev-shell.spec.ts` and `workspace.test.tsx`, the panel count of the
   Animate layout, `SCHEMA_VERSION` 1 in snapshot fixtures), the package that changes the contract updates the literal
   in the same commit and keeps every assertion; the commit message names the test and the contract row.

---

## 4. Contract deltas

Blocks below are additions to the named contract files unless marked *changed*. "Additive" means existing callers
compile and behave as before.

### 4.1 anim-core

One additive option (A0): `ReduceOptions.cycleAwareAuto?: boolean` (default false, the M1 behaviour) compiles the
original and the reduced curve with `CurveOptions.cycleAwareAuto`, so the editor's Simplify (`graph.curves.simplify`)
measures its tolerance on the shape the editor draws (§5.23); it changes nothing for curves whose infinities do not
both cycle. Otherwise no contract change. M-3 work (§5.21.3) is internal: `evaluateAnimCurve` and `compileAnimCurve`
keep their signatures and results (goldens ≤ 1e-9).

### 4.2 doc — attribute definitions, solver IDs, schema version 2

`packages/doc/src/records.ts` (additive optional fields on the nested `AttrDef`; `ControlRecord.attrs` stays one
atomic field):

```ts
export interface AttrDef {
  readonly type: 'float' | 'bool' | 'enum';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly enumLabels?: readonly string[];
  readonly keyable: boolean;
  /** M2a: new keys on this attribute get in 'flat', out 'step' (MVP: stored, unused). */
  readonly stepped?: boolean;
  /** M2a: Channel Box and Graph Editor label; default: the name title-cased ('heelTwist' → 'Heel Twist'). */
  readonly label?: string;
  /** M2a: stored radians or metres, shown in degrees or metres; absent = a plain number (3 decimals). */
  readonly unit?: 'angle' | 'distance';
  /** M2a: how pose and animation mirroring map the value (§5.14); default 'copy'. */
  readonly mirror?: 'copy' | 'negate';
  /**
   * M2a: false = a mode or setting, keyed and reset only when named explicitly (§5.1 rule 4): `S` with 'all' or
   * 'attributes', body-part keying, the tween 'frame' target, the pose clipboard and `pose.resetToRest` skip it unless
   * it is a selected Channel Box channel. Default true.
   */
  readonly keyAll?: boolean;
}
```

`packages/doc/src/ids/` and `index.ts`:

```ts
/** Deterministic auto-rig solver ID (§3 rule 3): 'slv_' + 16 base62 of sha256(`${rig}:${templateKey}`). */
export function solverId(rig: RigId, templateKey: string): SolverId;
```

`packages/doc/src/snapshot/version.ts` and migrations (*changed*; **one atomic change, landed by A0**):

```ts
export const SCHEMA_VERSION: 2;
/**
 * Lowest app schema version that evaluates this content correctly (§5.7): 2 when any live (not soft-deleted) solver
 * record is enabled with type 'ik2', else 1. Pure; Node-safe.
 */
export function requiredWriterVersion(tables: SnapshotTables): number;
```

The schema change lands in one commit of A0, never split across packages, because each part alone breaks M1:

1. `SCHEMA_VERSION` = 2 together with `CORE_MIGRATIONS[0]` (schema 1 → 2), the identity on records (M1 documents
   contain no `ik2` solvers, no attribute curves and no breakdown keys). Without the migration `migrateSnapshot`
   throws "no core migration from schema version 1" and no M1 project opens.
2. **Snapshot rule** (`MemoryDocumentStore.snapshot()`, which `doc-yjs` delegates to, and the test kit's naive
   store `editor-core/src/testing/store/naiveStore.ts`):
   `minWriterVersion = max(requiredWriterVersion(tables), loaded > SCHEMA_VERSION ? loaded : 1)`, where `loaded` is
   the `minWriterVersion` of the last `load()` (1 for a store that never loaded). A future document stays
   read-only and keeps its value (the conformance test "a newer minWriterVersion … loads read-only", which expects
   `SCHEMA_VERSION + 1` preserved, stays unchanged and green); an M2a document drops back to 1 when its last
   `ik2` solver is disabled or deleted.
3. **Writers of fresh documents** write `minWriterVersion: 1` instead of `SCHEMA_VERSION`: `makeProject`
   (`records/factories.ts`), `emptySnapshot` (`snapshot/serialize.ts`), `editor-core/src/workflows/records.ts`, the
   memory store's initial value and the naive store's. `schemaVersion` fields keep `SCHEMA_VERSION`.
4. The project record's own `minWriterVersion` field is not rewritten by `snapshot()` (it stays informational in
   M2a; the loader decides read-only from the top-level `DocSnapshot.minWriterVersion`, M1 rule). M3 revisits it for
   collaboration.

Table versions are **not** bumped (all new fields are optional; M1 apps preserve unknown fields). Validation
(`validateRecord`) accepts the new `AttrDef` fields and rejects wrong types; it never rejects a loaded document
(repair rules of MVP-SPEC §3 rule 6).

### 4.3 rig — attribute slots, limbs, `ik2`, op compile context

`packages/rig/src/types.ts` additions:

```ts
import type { AttrDef, BoneRef, ControlId, SolverId } from '@ekza-animator/doc';
import type { ReadonlyVec3 } from '@ekza-animator/anim-core';

/** A limb that can carry two-bone IK. */
export type LimbId = 'leg.L' | 'leg.R' | 'arm.L' | 'arm.R';
export const LIMB_IDS: readonly LimbId[];                                // ['leg.L', 'leg.R', 'arm.L', 'arm.R']
/** Attribute names on a limb's IK control. Legs carry all seven, arms the first three. */
export const LIMB_ATTR: { readonly ikFk: 'ikFk'; readonly soft: 'soft'; readonly twist: 'twist'; readonly roll: 'roll';
  readonly bank: 'bank'; readonly heelTwist: 'heelTwist'; readonly toeTwist: 'toeTwist' };
export type LimbAttr = keyof typeof LIMB_ATTR;

/** `${ControlId}/@${name}`: key of an attribute slot. */
export type AttrKey = `${string}/@${string}`;
export interface AttrSlot { readonly control: ControlId; readonly name: string; readonly def: AttrDef }

/**
 * Foot-roll pivots of a leg (§5.2.3), in the IK control's REST frame (origin = its rest position, character axes,
 * metres). The pivots lie on the foot line: with f = R_y(yaw)·(0, 0, 1) and l = side·R_y(yaw)·(1, 0, 0) (outward),
 * heel = ground − f·heelBack, ball = ground + f·ballFront, toe tip = ball + f·toeFront,
 * inner = ball − l·innerWidth, outer = ball + l·outerWidth.
 */
export interface FootRollParams {
  readonly side: 1 | -1;                       // +1 left, −1 right
  readonly ground: ReadonlyVec3;               // the ankle projected to the ground plane
  readonly yaw: number;                        // ψ: rotation about +y from +z to the foot's forward direction f
  readonly heelBack: number;                   // metres, ≥ 0
  readonly ballFront: number;
  readonly toeFront: number;
  readonly innerWidth: number;
  readonly outerWidth: number;
  readonly breakAngle: number;                 // β, radians in [0, π/2]; default π/6
}

/** `SolverRecord.params` for `type: 'ik2'` (version 1). Unknown fields are preserved. */
export interface Ik2Params {
  readonly v: 1;
  readonly limb: LimbId;
  readonly bones: { readonly upper: BoneRef; readonly mid: BoneRef; readonly end: BoneRef; readonly toes: BoneRef | null };
  readonly fk: { readonly upper: ControlId; readonly mid: ControlId; readonly end: ControlId; readonly toes: ControlId | null };
  readonly ikControl: ControlId;               // owns the LIMB_ATTR attributes
  readonly pole: ControlId;
  /** Unit hinge axis in canonical character space at rest, + = flexion (§5.2 table). */
  readonly hinge: readonly [number, number, number];
  readonly foot: FootRollParams | null;        // legs; null for arms
}

/** A compiled, enabled `ik2` solver. */
export interface LimbDesc {
  readonly id: LimbId;
  readonly solver: SolverId;
  readonly params: Ik2Params;
  readonly nodes: { readonly upper: number; readonly mid: number; readonly end: number; readonly toes: number };   // toes −1 when absent
  /** ChannelBuffer.attrs slot per limb attribute; −1 when the IK control lacks it. */
  readonly attrSlots: Readonly<Record<LimbAttr, number>>;
  /** l1, l2 (rest, scaled) and d⁰ = rest |end − upper| (§5.3 amendment A). */
  readonly lengths: { readonly upper: number; readonly lower: number; readonly restReach: number };
  readonly fkControls: readonly ControlId[];   // fk.upper, fk.mid, fk.end: hidden in full IK (§5.5)
  readonly ikControls: readonly ControlId[];   // ik control, pole: hidden in full FK
}

/**
 * Compile-time view handed to rig op implementations (§5.4). Everything in it is known before scheduling:
 * attribute slots are ordered schedule-independently, so `attrSlot` answers inside `reads`/`writes` too.
 */
export interface RigOpCompileContext {
  readonly skeleton: SkeletonDesc;
  readonly controls: ReadonlyMap<ControlId, ControlRecord>;
  resolveBone(ref: BoneRef): number;                                     // node index, −1 when absent
  attrSlot(control: ControlId, name: string): number;                    // −1 when absent
  controlChildren(control: ControlId): readonly ControlId[];             // by order, then id
  nodeChildren(node: number): readonly number[];
}
```

*Changed* (additive): `ChannelBuffer.attrs` has one slot per `RigProgram.attrSlots` entry (it was always empty);
`RigProgram` gains

```ts
  /**
   * Custom attribute slots ordered by (control id, attribute name), code-unit order: independent of the schedule,
   * so adding or removing an op never renumbers them, and known before ops declare their reads and writes.
   */
  readonly attrSlots: readonly AttrSlot[];
  readonly attrIndex: ReadonlyMap<AttrKey, number>;
  /** Enabled ik2 solvers that compiled, in solver-id order (§5.4 rule 4). */
  readonly limbs: readonly LimbDesc[];
```

`resetChannels` and `allocChannels` set each attribute slot to its `AttrDef.default`.

`SkeletonDesc` gains (additive, filled by the io skeleton reader from the mesh, A1):

```ts
  /**
   * Per node: the horizontal support function of the rest-pose vertices whose dominant skin weight is that node,
   * relative to the node's rest position p, in character space: 32 values h_k = max over those vertices of
   * ((v − p).x·sin θ_k + (v − p).z·cos θ_k), θ_k = k·11.25°, then 2 values min (v − p).y and max (v − p).y. null for
   * nodes without such vertices; the array is absent without mesh data (§5.2.3). A humanoid lower leg's vertices
   * below its foot's rest position count for the foot (rigs often skin the heel to the shin; A1 notes).
   */
  readonly boneSupport?: readonly (Float32Array | null)[];
```

`TwoBoneIkInput` gains (additive)

```ts
  /** ik2 op only: enables the rest-exact amendments A, B and C of §5.3. Absent = M1 behaviour (Plant Feet). */
  readonly restReach?: number;
```

`RigOpImpl` (*changed*, source-compatible for implementers):

```ts
export interface RigOpImpl {
  reads(record: ConstraintRecord | SolverRecord, ctx: RigOpCompileContext): { readonly controls: readonly ControlId[]; readonly nodes: readonly number[] };
  writes(record: ConstraintRecord | SolverRecord, ctx: RigOpCompileContext): { readonly controls: readonly ControlId[]; readonly nodes: readonly number[] };
  /**
   * Optional, once per compile, AFTER `createProgram` (the ctx carries the finished program, whose `limbs` the
   * compiler built from the records before): precomputed rest data and scratch buffers, handed to `run` as `state`.
   * A throw disables the op for this program (it is skipped at run time and warns).
   */
  compile?(record: ConstraintRecord | SolverRecord, ctx: RigOpCompileContext & { readonly program: RigProgram }): unknown;
  /**
   * Returns `false` when it wrote nothing (e.g. `ik2` at ikFk 0): the kernel then skips the read-back of the op's
   * written worlds and does not mark its nodes overridden, so bone locals stay bit-identical to a program without
   * the op. `true` or `undefined` = wrote (M1 behaviour).
   */
  run(record: ConstraintRecord | SolverRecord,
      ctx: { readonly pose: PoseBuffers; readonly channels: ChannelBuffer; readonly program: RigProgram; readonly state: unknown }): boolean | void;
}
```

The internal `ScheduledRigOp` gains `state: unknown` (the `compile` result, `undefined` without `compile`).

`ImportRawOptions` gains (additive; `ImportHumanoidOptions` inherits them):

```ts
  /** §5.8: 'auto' (default) writes IK controls for limbs whose ikFk default is ≥ 0.5; 'none' writes FK only (M1). */
  readonly ik?: 'auto' | 'none';
  /** §5.8 fidelity check of 'auto'; default { rotationRad: 2° = 0.03490658503988659, positionM: 0.002 }. */
  readonly ikTolerance?: { readonly rotationRad: number; readonly positionM: number };
```

`ImportedClipKeys` gains `readonly limbs?: readonly { readonly limb: LimbId; readonly mode: 'ik' | 'fk';
readonly maxRotationErrorRad: number; readonly maxMidErrorM: number }[]` (one row per limb that `'auto'` considered).

Public API additions (`@ekza-animator/rig`, owner A1; signatures in §8 A1).

### 4.4 io — export reduction, write subpath

`packages/io/src/types.ts` additions:

```ts
/** R02 §6.4 tolerances; position terms scale with the character height H (÷ 1.7 m). */
export interface ExportReduceSpec {
  readonly positionM: number;                  // ε_pos for a 1.7 m character; default 0.0002
  readonly rotationCapRad: number;             // θ_cap; default 0.25° = 0.004363323129985824
  readonly minLeverM: number;                  // L_min; default 0.01
  readonly scaleRel: number;                   // default 1e-4 (relative)
}
export const DEFAULT_EXPORT_REDUCE: ExportReduceSpec;

export interface ReductionStats {
  readonly samplesBefore: number;
  readonly samplesAfter: number;
  readonly maxRotationErrorRad: number;
  readonly maxTranslationErrorM: number;
}
```

*Changed* (additive): `ExportRequest.reduce?: ExportReduceSpec | null` (absent or null = no reduction, the M1
output byte for byte); `BakeOptions.reduce?: { readonly spec: ExportReduceSpec; readonly height: number;
readonly leverArm: ReadonlyMap<number, number>; readonly keep: ReadonlyMap<TrackKey, readonly Frame[]> } | null`;
`BakedClip.reduction?: ReductionStats`; `ExportArtifact.stats.reduction?: ReductionStats`.

The `@ekza-animator/io/write` subpath re-exports `bakeClip`, `bakeIntoModel`, `writeAnimationGlb`, `writeVrma`,
`lintExport`, `readBackCheck`, `ekzaAnimationMeta`, `preexistingTracks` and `reduceBakedClip` (§8 A5). The main entry
keeps exporting them in M2a (headless tests and tooling use it; no breaking change), but `editor-core` and `editor`
obtain them only through a dynamic `import('@ekza-animator/io/write')`; an oxlint `no-restricted-imports` rule in
those two packages forbids importing these names from the main entry, so the bundler can drop glTF Transform from
the initial route.

### 4.5 editor-core — session, prefs, kernel, evaluation, edit kernel

`packages/editor-core/src/types.ts` additions and changes:

```ts
import type { AnimCurve, Frame } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, ChangeBatch, ChannelId, ControlId, ControlRecord, CurveId, KeyId } from '@ekza-animator/doc';
import type { ExportReduceSpec } from '@ekza-animator/io';
import type { LimbId } from '@ekza-animator/rig';

export const PANEL = { …M1, dopeSheet: 'dopeSheet' } as const;                 // changed (additive)
export const GRAPH_TOOL = { select: 'select', move: 'move', insert: 'insert', scale: 'scale' } as const;   // changed
export const DOPE_TOOL = { select: 'select', move: 'move', scale: 'scale' } as const;

export type KeyTarget = 'selected' | 'bodyPart' | 'character';
export type BodyPart = 'root' | 'torso' | 'head' | 'arm.L' | 'arm.R' | 'fingers.L' | 'fingers.R' | 'leg.L' | 'leg.R';
export type GraphViewMode = 'absolute' | 'normalized' | 'stacked';
export type TweenMode = 'tween' | 'neighbor' | 'ease' | 'pushPull' | 'toDefault';
/** 'auto': 'seamless' when the ikFk curve has keys or auto-key is on, else 'none' (§5.6). */
export type IkFkKeyMode = 'auto' | 'none' | 'key' | 'seamless';
export type ControlVisibility = 'visible' | 'ghost' | 'hidden';

export interface ToolState {
  readonly viewport: ToolId;
  readonly graph: ToolId;
  readonly dopeSheet: ToolId;                                     // M2a, default 'select'
  readonly manipulatorSize: number;
  readonly selectionMask: SelectionMask;
  readonly keyTarget: KeyTarget;                                  // changed: + 'bodyPart'
  readonly ripple: boolean;                                       // M2a, default false (Dope Sheet + time slider)
  /** M2a §5.13: 'auto' = 'keys' when keys are selected, else 'frame'; 'frame' forces the pose target. Default 'auto'. */
  readonly tweenTarget: 'auto' | 'frame';
}

/** Graph Editor buffer curve (per user, never in the document). */
export interface CurveBuffer { readonly curve: AnimCurve; readonly capturedAt: number }

export interface AutosaveSlotInfo {
  readonly id: string;                                            // 'as_' + 16 base62, one per page load
  readonly projectName: string;
  readonly savedAt: number;                                       // ms since epoch
  readonly characters: number;
  readonly clips: number;
  readonly bytes: number;                                         // snapshot JSON + new asset bytes
  readonly appVersion: string;
  readonly schemaVersion: number;
  /** Fix round 1: the session's active character and clips at the write; recovery returns to them. Older slots
   *  lack them (recovery then opens each character's first clip). */
  readonly activeCharacter?: CharacterId | null;
  readonly activeClip?: Readonly<Record<CharacterId, ClipId>>;
}
export interface AutosaveStatus {
  readonly enabled: boolean;                                      // false: storage unavailable or prefs off
  readonly slot: string | null;
  readonly lastSavedAt: number | null;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface SessionState {
  …M1 fields…
  readonly curveBuffers: ReadonlyMap<CurveId, CurveBuffer>;       // M2a
  readonly autosave: AutosaveStatus;                              // M2a
  readonly recovery: readonly AutosaveSlotInfo[];                 // M2a: orphaned slots found at start
}
export type UiDialog = …M1 | 'recovery';                          // changed (additive)

export interface Prefs {
  …M1 fields (version stays 1; missing fields take defaults on load)…
  readonly autoRigIk: { readonly legs: boolean; readonly arms: boolean };          // default { legs: true, arms: true }
  readonly ikFkVisibility: 'hide' | 'ghost';                                      // default 'hide' ('ghost' is stretch)
  readonly ikFkSwitchKey: IkFkKeyMode;                                            // default 'auto'
  readonly tweenOvershoot: boolean;                                               // default false
  readonly arrowKeys: 'pickWalk' | 'frames';                                       // default 'pickWalk' (Q-UI-2)
  readonly virtualSlider: { readonly degPerPx: number; readonly metresPerPx: number; readonly unitsPerPx: number;
    readonly viewportMmb: boolean };                                                // 0.5, 0.01, 0.01, true (§5.18)
  readonly exportReduce: { readonly enabled: boolean } & ExportReduceSpec;          // dialog default; enabled true
  readonly autosave: { readonly enabled: boolean; readonly delayMs: number; readonly maxIntervalMs: number };       // true, 2000, 30000
}

export interface EvaluationService {
  …M1…
  /** M2a: value of any channel (TRS or '@attr') at the control's current clip frame, curves ⊕ overrides. */
  channelValue(control: ControlId, channel: ChannelId): number;
  /** M2a: every custom attribute of the control by name (without '@'). */
  attrValues(control: ControlId): Readonly<Record<string, number>>;
  /** M2a: evaluated ikFk of a limb of the character (null without that limb). */
  ikFk(character: CharacterId, limb: LimbId): number | null;
}

/** M2a: content-addressed autosave slots (IndexedDB in the browser; null in Node). */
export interface AutosaveStore {
  /** Claims a slot for this page (Web Lock held until unload); returns its id. */
  open(): Promise<string>;
  write(slot: string, data: { readonly snapshotJson: string; readonly assets: readonly AssetRecord[];
    readonly info: Omit<AutosaveSlotInfo, 'id' | 'bytes'> }, readAsset: (id: AssetId) => Promise<Uint8Array>): Promise<{ readonly bytes: number }>;
  /** Slots whose page is gone (lock not held, or heartbeat older than 20 s without Web Locks). */
  listOrphans(): Promise<readonly AutosaveSlotInfo[]>;
  read(slot: string): Promise<{ readonly snapshot: unknown; readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }> } | null>;
  remove(slot: string): Promise<void>;
}
export interface EditorServices { …M1…; readonly autosave?: AutosaveStore | null }

export interface EditorApp {
  …M1…
  /**
   * M2a (M-1): run `task` once before the next frame's evaluation; a later call with the same key replaces the
   * pending task. Without a frame requester (Node) the task runs synchronously.
   */
  scheduleBeforeFrame(key: string, task: () => void): void;
  /** Runs every pending task now, in scheduling order (the frame loop's first step; pointerup; tests). */
  flushScheduled(): void;
}
```

Edit kernel additions (`@ekza-animator/editor-core`, §4.11.0 of MVP-SPEC extended):

```ts
/** One key-editing drag (Graph Editor, Dope Sheet, time slider): preview, once-per-frame updates, one history step. */
export interface KeyEditGesture {
  readonly active: boolean;
  /** Replaces the pending edit; applied at the next `flushScheduled` on top of committed state. */
  update(edit: (tx: Tx) => void): void;
  /** Applies `final` immediately (callers pass resolveCollisions: true), commits ONE transaction, records ONE step. */
  commit(final: (tx: Tx) => void, meta?: { readonly label?: string }): ChangeBatch | null;
  cancel(): void;
}
export function beginKeyEditGesture(app: EditorApp, label: string): KeyEditGesture;

export interface KeyEditOptions {
  readonly snap: boolean;
  readonly resolveCollisions: boolean;
  readonly ripple?: boolean;                 // M2a §5.11; default false
  readonly retimeBreakdowns?: boolean;       // M2a §5.12; default true
}
/** M2a: value scale of keys around `pivot` (display units); handles' dv scale with the factor. */
export function scaleKeyValues(app: EditorApp, tx: Tx, keys: readonly KeyId[], pivot: number, factor: number): KeyEditResult;
/** M2a: copies of `keys` at t + dFrames (same curves); colliding non-copied keys are replaced. */
export function copyKeys(app: EditorApp, tx: Tx, keys: readonly KeyId[], dFrames: number, opts: KeyEditOptions): { readonly created: readonly KeyId[]; readonly deleted: readonly KeyId[] };
/** M2a §5.9: insert (frames > 0) or remove (frames < 0) time after `at` on the curves. */
export function insertTime(app: EditorApp, tx: Tx, curves: readonly CurveId[], at: Frame, frames: number): KeyEditResult;
/** M2a §5.13: target values of a tween; pure (reads the committed state of `app.store` and the session overrides). */
export function tweenEdits(app: EditorApp, mode: TweenMode, amount: number,
  target: { readonly kind: 'frame'; readonly controls: readonly ControlId[]; readonly channels: readonly ChannelRef[] | null; readonly frame: Frame }
        | { readonly kind: 'keys'; readonly keys: readonly KeyId[] }): readonly { readonly curve: CurveId | null; readonly control: ControlId; readonly channel: ChannelId; readonly t: Frame; readonly value: number }[];
/** M2a §5.5: one rule used by the viewport, the Outliner, picking, key targets and the test API (A0 baseline: rule 1; A2: rules 2–3). */
export function controlVisibility(app: EditorApp, control: ControlId): ControlVisibility;
/** M2a §5.19 (A0, complete: a pure template-key table) */
export function bodyPartOf(app: EditorApp, control: ControlId): BodyPart | null;
export function keyTargetControls(app: EditorApp, target: KeyTarget): readonly ControlId[];

/** M2a §5.1 rule 5 (A0): display unit of a TRS channel or a '@name' attribute of `control`. */
export type ChannelUnit = 'angle' | 'distance' | 'none';
export function channelUnit(control: ControlRecord | null, channel: ChannelId): ChannelUnit;
/** M2a §5.1 rule 6 (A0): default of a TRS channel (M1 `channelDefault`) or of a '@name' attribute (`AttrDef.default`; 0 when unknown). */
export function channelDefaultOf(control: ControlRecord | null, channel: ChannelId): number;
```

`edit/numeric.ts` (*changed*, additive, A0): `toDisplayValue(channel, value, unit?: ChannelUnit)`,
`fromDisplayValue(channel, display, unit?)` and `formatChannelValue(channel, value, unit?)`: a given `unit` wins
(`'angle'` = degrees), absent = the M1 rule (degrees for rotations). Every caller that knows the control passes
`channelUnit(control, channel)`: the Channel Box, Graph Editor fields and value axis, `moveKeys`/`setFields` value
deltas, the virtual slider, tween and numeric typing. The same optional `unit` is added to the curve-editor's
`channelDisplayScale(channel, unit?)` and to rig `channelDefaultValue(channel, def?: AttrDef)`.

`edit/keys.ts` (*changed*, additive, A0): `writeKeyAt(app, tx, curve, frame, value, tangents, opts?: { readonly
breakdown?: boolean; readonly existing?: 'keep' | 'set' })`: `breakdown` is the flag of a new key; `existing: 'set'`
also writes it on a key already at the frame (`key.set {breakdown}`); default `'keep'` (tween patches keep the flag).

`beginChannelEditGesture` keeps its contract; its `update` is coalesced through `scheduleBeforeFrame` like
`beginKeyEditGesture` (M-1). `applyChannelEdits` accepts `'@attr'` channels (§5.1).

`packages/editor-core/src/operators/args.ts` (*changed*, additive; behaviour in §4.9):

```ts
import type { Frame } from '@ekza-animator/anim-core';
import type { CharacterId, ControlId, CurveId } from '@ekza-animator/doc';
import type { FootRollParams, LimbId } from '@ekza-animator/rig';
import type { BodyPart, GraphViewMode, IkFkKeyMode, KeyTarget, TweenMode } from '../types';

export type KeyChannels = 'all' | 'translate' | 'rotate' | 'scale' | 'attributes' | 'selected';   // changed: + 'attributes'

export interface OperatorMap {
  …M1 entries, with these argument changes:…
  'key.set': { args: { readonly channels?: KeyChannels; readonly target?: KeyTarget; readonly breakdown?: boolean } | void; result: CountResult };
  'time.setFrame': { args: { readonly frame: Frame; readonly unit?: 'clip' | 'scene'; readonly carry?: boolean }; result: void };
  /** `ripple` absent: `session.tools.ripple` when the focused panel is the Dope Sheet or the time slider, else false. */
  'graph.keys.move': { args: { readonly dFrames: number; readonly dValue: number; readonly ripple?: boolean }; result: CountResult };
  'graph.keys.scale': { args: { readonly pivot: Frame; readonly factor: number; readonly ripple?: boolean;
    readonly valuePivot?: number; readonly valueFactor?: number }; result: CountResult };
  /** `mode` absent: 'insert' when ripple is on and the focused panel is the Dope Sheet or the time slider, else 'merge' (§5.10). */
  'graph.keys.paste': { args: { readonly mode?: 'merge' | 'replace' | 'insert' } | void; result: CountResult };

  // rig (M2a)
  'rig.addLimbIk': { args: { readonly character?: CharacterId; readonly limbs?: readonly LimbId[] } | void;
    result: { readonly added: readonly LimbId[]; readonly warnings: readonly string[] } };
  'rig.ikFk.switch': { args: { readonly limb: LimbId; readonly to: 'ik' | 'fk'; readonly match?: boolean;
    readonly key?: IkFkKeyMode; readonly character?: CharacterId }; result: ChannelEditResult };
  'rig.ikFk.match': { args: { readonly limb: LimbId; readonly side: 'ik' | 'fk'; readonly key?: boolean;
    readonly character?: CharacterId }; result: ChannelEditResult };
  /** `step` default: 'frames' for side 'fk', 'keys' for side 'ik' (§5.6). */
  'rig.ikFk.matchRange': { args: { readonly limb: LimbId; readonly side: 'ik' | 'fk';
    readonly range?: { readonly start: Frame; readonly end: Frame }; readonly step?: 'keys' | 'frames';
    readonly character?: CharacterId }; result: CountResult };
  'rig.setFootParams': { args: { readonly limb: 'leg.L' | 'leg.R'; readonly character?: CharacterId;
    readonly params: Partial<Pick<FootRollParams, 'heelBack' | 'ballFront' | 'toeFront' | 'innerWidth' | 'outerWidth' | 'breakAngle'>> };
    result: void };
  // select / key / pose (M2a)
  'select.pickWalk': { args: { readonly direction: 'up' | 'down' | 'left' | 'right'; readonly add?: boolean }; result: void };
  'key.setTarget': { args: { readonly target: KeyTarget }; result: void };
  'key.toggleRipple': { args: { readonly ripple?: boolean } | void; result: void };
  'key.tween': { args: { readonly mode: TweenMode; readonly amount: number; readonly target?: 'frame' | 'keys';
    readonly breakdown?: boolean }; result: CountResult };
  'key.convert': { args: { readonly to: 'breakdown' | 'key' }; result: CountResult };
  'pose.mirrorAnimation': { args: { readonly mode: MirrorMode; readonly offset?: 'none' | 'halfCycle';
    readonly controls?: readonly ControlId[] }; result: CountResult };
  // time (M2a)
  /**
   * `at` (default: the active character's current clip frame; the menu-bar items pass none). `removeKeys` (default
   * false): with frames < 0, delete keys in (at, at + |frames|] instead of poll-failing (§5.9).
   */
  'time.insertTime': { args: { readonly at?: Frame; readonly frames: number; readonly target?: 'selected' | 'character';
    readonly removeKeys?: boolean }; result: CountResult };
  /**
   * Delete Time (§5.9): removes the frames of `range` (default: the time-slider band, else the current clip frame) and
   * their keys, as `time.insertTime {at: start − 1, frames: −(end − start + 1), removeKeys: true}`.
   */
  'time.deleteTime': { args: { readonly range?: { readonly start: Frame; readonly end: Frame };
    readonly target?: 'selected' | 'character' } | void; result: CountResult };
  // graph and dope sheet (M2a)
  'graph.keys.copyTo': { args: { readonly dFrames: number }; result: CountResult };
  'graph.buffer.snapshot': { args: { readonly curves?: readonly CurveId[] } | void; result: CountResult };
  'graph.buffer.swap': { args: { readonly curves?: readonly CurveId[] } | void; result: CountResult };
  'graph.buffer.clear': { args: void; result: void };
  'graph.view.setMode': { args: { readonly mode: GraphViewMode | 'toggleNormalized' | 'toggleStacked' }; result: void };
  'dopeSheet.frame': { args: { readonly what: 'selection' | 'all' }; result: void };
  // file (M2a)
  'file.recover': { args: { readonly slot: string }; result: { readonly readOnly: boolean } };
  'file.discardRecovery': { args: { readonly slot: string }; result: void };
  'file.autosaveNow': { args: void; result: { readonly slot: string; readonly bytes: number } | null };   // internal
}
```

`view.tool` accepts `{ panel: 'dopeSheet', tool }` and `{ panel: 'graph', tool: 'scale' }` (A0 widens its poll in
`operators/builtin/view.ts`, which accepted only the viewport and the Graph Editor, and writes `tools.dopeSheet`).

### 4.6 viewport

No type change. `SceneSync`, picking, marquee and the HUD read `controlVisibility` (§5.5); the control renderer gains
the pole annotation line and per-control alpha (§5.5); a plain MMB drag in a pane starts the Channel Box virtual
slider when Channel Box channels are selected (§5.18; plain MMB belongs to the active tool in M1 and no tool uses
it).

### 4.7 curve-editor — Dope Sheet, Graph Editor views

`packages/curve-editor/src/types.ts` additions:

```ts
import type { Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId } from '@ekza-animator/doc';
import type { BodyPart, GraphViewMode } from '@ekza-animator/editor-core';

export type DopeSheetRowKind = 'summary' | 'character' | 'group' | 'control' | 'channel';
export interface DopeSheetRow {
  readonly id: string;                         // 'summary' | `chr:${id}` | `grp:${chr}:${part}` | control id | `${control}/${channel}`
  readonly kind: DopeSheetRowKind;
  readonly label: string;
  readonly depth: number;
  readonly group?: BodyPart;
  readonly control?: ControlId;
  readonly channel?: ChannelId;
  readonly curves: readonly CurveId[];         // curves under the row (active clip, base layer)
  readonly expanded: boolean;
  readonly dimmed: boolean;                    // control hidden by the IK/FK rule (§5.5)
}
export interface DopeSheetViewState { readonly f0: number; readonly sx: number; readonly scrollY: number }
export type DopeSheetHit =
  | { readonly kind: 'glyph'; readonly row: string; readonly frame: Frame }
  | { readonly kind: 'region-start' | 'region-end' | 'region-middle'; readonly frame: Frame }
  | { readonly kind: 'ruler'; readonly frame: Frame }
  | { readonly kind: 'none'; readonly row: string | null; readonly frame: Frame };
export type RegionHandle = 'left' | 'right' | 'top' | 'bottom' | 'tl' | 'tr' | 'bl' | 'br' | 'inside';
export type { GraphViewMode };
```

Public API in §8 A3 (`DopeSheetController`, `buildDopeSheetRows`, `registerDopeSheetContributions`) and §8 A4
(`GraphEditorController` additions). `DopeSheetRow.holds` is not part of the row: the painter and the probe compute
hold intervals with the §5.10 rule.

### 4.8 editor — panels, layout, probes, test API

- `registerDopeSheetPanel(registry)` in `packages/editor/src/panels/dopesheet/` (A0 placeholder, A3 body), called by
  `registerBuiltinPanels`. Key scope `'dopeSheet'` (§6 scope `D`).
- Layout: `LAYOUT_SCHEMA_VERSION` 2; `ANIMATE_SLOTS` adds `{ kind: 'dopeSheet', slot: 'bottom', title: 'Dope Sheet' }`
  as an inactive tab of the Graph Editor's group. The storage key carries the version
  (`ekza-animator:layout:v2:<workspace>`), so the migration reads the old key explicitly: when the v2 key is absent
  and `ekza-animator:layout:v1:<workspace>` holds a valid v1 layout, the Dope Sheet tab is added to the group that
  holds the Graph Editor (or a new bottom group), the rest of the layout is kept, the result is written under the v2
  key, and the v1 key is left in place for M1 apps. Any other v1 problem resets to the default layout (M1 rule).
- Probes (`ProbeMap`) gain `dopeSheet: DopeSheetProbe` (A3), `tween: TweenProbe` per mounted Tween bar (A4, keyed by
  the bar's panel `'graph' | 'dopeSheet' | 'status'`) and the time slider's band handles (A3); `GraphProbe` gains the
  view mode, buffers and region handles (A4); A0 adds the keys and fields. A probe of a panel that is not visible
  (an inactive dock tab) returns null, like M1's `graph()`. The kernel-level test functions (`attrs`, `controlWorld`,
  `curveSlope`, `limbs`, `limbPivots`, `autosave`, `flushAutosave`) are implemented by A0 over the kernel, the rig
  functions and the operators (stubbed until A1 and A5 land); no panel probe is needed for them.
- Panels mounted lazily: the Dope Sheet panel (A3 writes the `React.lazy` boundary in its panel registration; A5
  verifies it in `check:size` and E2E-M2A-22) and every dialog (A5) are `React.lazy` (§5.21.2).

Test API additions (`packages/editor/src/test-api/types.ts`; A0 writes the types and stubs, the owners fill the
probes):

```ts
export interface EkzaAnimatorTestApi {
  …M1…
  state(): { …M1…; keyTarget: string; ripple: boolean; dirty: boolean; recovery: string[] };   // changed (additive)
  curves(clip: string, control?: string): { …M1…; keys: { …M1…; breakdown: boolean }[] }[];   // changed (additive)
  /** M2a: custom attributes by name (without '@') at a clip frame (default: current). */
  attrs(control: string, clipFrame?: number): Record<string, number>;
  /** M2a: control world in canonical character space at a clip frame (default: current). */
  controlWorld(control: string, clipFrame?: number): { t: [number, number, number]; q: [number, number, number, number] };
  /** M2a (A0): one-sided derivative dv/dt of the compiled curve at a clip frame (stored units per frame). */
  curveSlope(curve: string, frame: number, side: 'left' | 'right'): number;
  /** M2a (A0 over RigProgram.limbs): limbs of a character with their evaluated ikFk at the current frame. */
  limbs(character?: string): { id: string; ikFk: number; ikControl: string; pole: string; fk: string[] }[];
  /** M2a (A0 over rig footPivotWorlds): world positions of a leg's foot-roll pivots at the current frame. */
  limbPivots(character: string, limb: string): { heel: number[]; ball: number[]; toe: number[]; inner: number[]; outer: number[] } | null;
  /** M2a (A3) */
  dopeSheet(): { rows: { id: string; kind: string; label: string; depth: number; expanded: boolean; dimmed: boolean;
      keys: number[]; breakdowns: number[]; selected: number[]; holds: [number, number][] }[];
    view: { f0: number; sx: number; scrollY: number }; canvasRect: { x: number; y: number; w: number; h: number } } | null;
  screenOfDopeKey(row: string, frame: number): { x: number; y: number } | null;
  screenOfDopeRegion(part: 'start' | 'middle' | 'end'): { x: number; y: number } | null;
  /** M2a (A3): time-slider ticks of the current key set. */
  timelineTicks(): { frame: number; breakdown: boolean; selected: boolean }[];
  /** M2a (A3): a grab point on the time slider's band handle; null without a band. */
  screenOfBand(part: 'start' | 'middle' | 'end'): { x: number; y: number } | null;
  graph(): { …M1…; viewMode: string; buffers: string[] } | null;                           // changed (additive, A4)
  screenOfRegionHandle(handle: string): { x: number; y: number } | null;                    // A4, scale tool region box
  /** A4: the shared Tween bar mounted in that panel (status line, Graph Editor or Dope Sheet toolbar). */
  screenOfTween(panel: 'graph' | 'dopeSheet' | 'status', amount: number): { x: number; y: number } | null;
  tweenTarget(panel: 'graph' | 'dopeSheet' | 'status'): { kind: 'frame' | 'keys'; label: string } | null;   // A4
  /** M2a (A0 over session.autosave and file.autosaveNow; A5 implements the store) */
  autosave(): { enabled: boolean; slot: string | null; lastSavedAt: number | null; pending: boolean };
  flushAutosave(): Promise<void>;
}
```

URL parameters (e2e builds only), additive: `ns=<string>` names the storage namespace (localStorage prefix and the
IndexedDB database suffix) so a reload of the same URL sees the same storage (default: a fresh namespace per page
load, as in M1); `storage=blocked` makes every storage access throw (NFR-12 e2e); `pointerLock=off` makes the
virtual slider use pointer capture instead of Pointer Lock (§5.18; CDP-synthesised moves under SwiftShader). A0 parses
them and passes them to `createBrowserServices(opts)`, which gains `storageNamespace?: string`,
`storageBlocked?: boolean` and `pointerLock?: boolean` (additive; A0 edits `services/browser.ts` for the options, A5
implements their effect on the autosave store, A2 reads `pointerLock`).

`data-testid` additions (owners in brackets):

| Element | `data-testid` | Owner |
|---|---|---|
| Channel Box attribute rows, IK/FK row and switch | `cb-field-@<attr>`, `cb-name-@<attr>` (e.g. `cb-field-@roll`), `cb-ikfk-row`, `cb-ikfk-field`, `cb-ikfk-switch` | A2 |
| Attributes limb section | `attr-limb-<limb>`, `attr-limb-mode-ik-<limb>`, `attr-limb-mode-fk-<limb>`, `attr-limb-match-ik-<limb>`, `attr-limb-match-fk-<limb>`, `attr-limb-key-mode`, `attr-add-limb-ik`, foot fields `attr-limb-foot-<limb>-<heelBack or ballFront or toeFront or innerWidth or outerWidth or breakAngle>` | A2 |
| Status line key target | `status-keytarget-<selected or bodyPart or character>` | A0 (shell) |
| Dope Sheet | `ds-canvas`, `ds-row-<rowId>`, `ds-show`, `ds-ripple`, `ds-tool-<id>`, `ds-frame-all` | A3 |
| Time slider menu | `timeline-menu-ripple`, `timeline-menu-insert-frame`, `timeline-menu-remove-frame`, `timeline-menu-delete-time` | A3 |
| Tween bar (status line, Graph Editor and Dope Sheet toolbars; `<panel>` = `status`, `graph`, `dopeSheet`) | `tween-slider-<panel>`, `tween-mode-<panel>`, `tween-overshoot-<panel>`, `tween-target-<panel>`, `tween-preset-<panel>-<−100 or −50 or 0 or 50 or 100>` | A4 (A0 reserves the status-line slot) |
| Graph Editor | `ge-view-<absolute or normalized or stacked>`, `ge-buffer-snapshot`, `ge-buffer-swap`, `ge-tool-scale`, `ge-convert-breakdown`, `ge-convert-key` | A4 |
| Export dialog | `export-reduce` | A5 |
| Recovery dialog | `recovery-dialog`, `recovery-row-<slot>`, `recovery-recover-<slot>`, `recovery-discard-<slot>`, `recovery-later` | A5 |

### 4.9 Operator catalog additions

`U` = undoable (one transaction, one history step). Owner = the package that implements it (A0 registers stubs).

| ID | U | Owner | Behaviour |
|---|---|---|---|
| `rig.addLimbIk` | U | A2 (A1 records) | §5.7. Humanoid rigs only (poll). Adds IK controls and `ik2` solvers for the requested limbs (default: every limb without one) with **`ikFk` default 0**, so existing animation is unchanged; `flags.structural`. Label `Add Limb IK`. |
| `rig.ikFk.switch` | U | A2 | §5.6: optional match, then sets `ikFk` to 1 (`to: 'ik'`) or 0 with the key policy. Label `Switch L Leg to FK`. |
| `rig.ikFk.match` | U | A2 | §5.6: sets the `side` controls from the current pose of the other side without changing `ikFk`; `key: true` keys them. |
| `rig.ikFk.matchRange` | U | A2 | §5.6: match at every integer frame of the range (`'frames'`, the default for side `'fk'`) or at every key time of the limb's influencing curves (`'keys'`, the default for side `'ik'`; the curve set of §5.8 "influencing curves"), range default the clip range, keying the `side` controls; Euler filter on the written rotation curves. |
| `rig.setFootParams` | U | A2 (A1 validation) | §5.2.3: writes the leg's `Ik2Params.foot` distances and break angle (each ≥ 0; `breakAngle` ≤ π/2) and rewrites the IK control's footprint shape in the same transaction; `flags.structural`. Label `Edit Foot Pivots`. |
| `select.pickWalk` | — | A2 | §5.17. Not a history step. With `prefs.arrowKeys: 'frames'` it runs the time operator of §6 instead. |
| `key.set` (changed) | U | A2 | `target: 'bodyPart'` (§5.19), `channels: 'attributes'` and `'all'` include keyable attributes except `keyAll: false` ones (§5.1 rule 4), `breakdown: true` creates breakdown keys and turns existing keys at the frame into breakdowns (label `Set Breakdown`). |
| `key.setTarget` | — | A2 | Writes `session.tools.keyTarget`. |
| `key.toggleRipple` | — | A3 | Writes `session.tools.ripple` (registered in `operators/builtin/time.ts`). |
| `key.tween` | U | A4 | §5.13 one-shot (menus, scripts); the toolbar slider uses the gesture form. |
| `key.convert` | U | A4 | Sets `breakdown` on the selected keys (or the keys at the current frame on the target controls). |
| `pose.mirrorAnimation` | U | A4 | §5.14. Humanoid rigs only (poll). |
| `pose.resetToRest` (changed) | U | A2 | Also resets keyable attributes to `AttrDef.default`, except `keyAll: false` ones (`ikFk`, `soft`), which it leaves alone (§5.1 rule 6). |
| `pose.plantFeet` (changed) | U | A2 | §5.8: IK legs get IK control channels, FK legs the M1 solve; one step. |
| `time.setFrame` (changed) | — | A3 | `carry: true` keeps the pose (§5.9). |
| `time.insertTime` | U | A3 | §5.9; `at` defaults to the current clip frame; never retimes breakdowns; poll-fails instead of deleting keys unless `removeKeys`. |
| `time.deleteTime` | U | A3 | §5.9; the band's frames (or `range`, else the current frame) and their keys, through the `time.insertTime` kernel; one step. Label `Delete Time`. |
| `graph.keys.move` / `graph.keys.scale` (changed) | U | A3 | `ripple` (§5.11; default from the focused panel); value scale via `valuePivot`/`valueFactor` (§5.15.3; `valuePivot` in display units, default 0; time and value scale are one step). The arrow-key nudge (§6) is `graph.keys.move {dFrames: ±1, dValue: 0}`. |
| `graph.keys.paste` (changed) | U | A3 | `mode: 'insert'` (§5.10): keys after the paste frame shift to make room. |
| `graph.keys.copyTo` | U | A3 | `copyKeys` on the selected keys (time-slider Mod+drag commit uses the kernel helper directly). |
| `graph.buffer.snapshot` / `.swap` / `.clear` | —/U/— | A4 | §5.15.1. |
| `graph.view.setMode` | — | A4 | §5.15.2, focused Graph Editor. |
| `dopeSheet.frame` | — | A3 | Focused Dope Sheet: frame the selected keys (else all rows) with 8 % padding. |
| `file.recover` / `file.discardRecovery` | —/— | A5 | §5.20. Not undoable (`file.openProject` semantics). |
| `file.autosaveNow` | — | A5 | Internal; writes the slot now (tests, menu "Save recovery point"). |

---

## 5. Normative behaviours

### 5.1 Custom attribute channels (`@name`)

1. A control's `attrs` define its custom channels; the channel id is `'@' + name`. Curves, keys, static values,
   overrides, the clipboards and undo treat them like TRS channels. Attributes cannot be locked in M2a
   (`ControlRecord.locked` covers TRS only): `channel.toggleLock` skips attribute channels and the Channel Box menu
   disables Lock on attribute rows; a Graph Editor curve lock (`CurveRecord.locked`) works as for any curve.
2. **Slots**: `RigProgram.attrSlots` lists every attribute of every control ordered by (control id, attribute name),
   code-unit order, independent of the schedule; `ChannelBuffer.attrs[slot]` holds the value. `resetChannels` writes
   `AttrDef.default`.
3. **Sampling**: a curve with keys evaluates per the curve engine; a key-less curve gives `staticValue ?? default`;
   no curve gives `AttrDef.default`. Overrides (`ChannelValues` keys `'@name'`) are applied after sampling. Values of
   attributes with `min`/`max` are clamped **where they are consumed** (the `ik2` op), never in curves.
4. **Keying**: `key.set {channels: 'all'}` keys keyable TRS channels and keyable attributes; `'attributes'` keys
   attributes only; `'translate'`/`'rotate'`/`'scale'` never key attributes. **`keyAll: false` attributes** (`ikFk`,
   `soft`: modes and settings, not pose values) are skipped by `'all'`, `'attributes'`, body-part keying (§5.19), the
   tween `'frame'` target (§5.13) and the pose clipboard **unless they are selected Channel Box channels** (then
   `'all'`, `'attributes'` and `'selected'` key them); they are also keyed by auto-key when they are edited (MVP-SPEC
   §4.11.2) and by the operators that own them (switch, match, the IK/FK proxy row). Like a Maya rig with a separate
   switch control, a later `S` on the IK foot therefore never re-keys a stale `ikFk`. A new key on an attribute with
   `stepped: true` gets `in: 'flat', out: 'step'`; other attributes use `prefs.defaultTangents`. Auto-key rules of
   MVP-SPEC §4.11.2 apply unchanged.
5. **Display**: Channel Box rows after the TRS rows, in `attrs` key order, label `AttrDef.label` or the title-cased
   name; units come from `channelUnit(control, channel)` (§4.5), never from the channel id alone: `unit: 'angle'`
   shows degrees (typed values are degrees, so `30` on `@roll` is 30°), `'distance'` metres, otherwise 3 decimals;
   `bool` shows 0/1; `enum` shows `enumLabels`. The Graph Editor channel list shows attribute curves after TRS with
   the `other` colour; its value axis, numeric fields and value drags use the same units. The Channel Box hides the
   raw `@ikFk` row of an IK control: the IK/FK proxy row (§5.6) shows and edits that channel instead.
6. **Defaults**: wherever M1 uses a channel's default (key-less curves, `toDefault` tweens, `pose.resetToRest`,
   overrides cleared to default) the value is `channelDefaultOf(control, channel)` = `AttrDef.default` for
   attributes. `pose.resetToRest` resets pose attributes and leaves `keyAll: false` attributes alone, so a reset never
   flips a limb between IK and FK.
7. **Export**: attribute curves never produce glTF tracks; they influence tracks through the ops that read them
   (§5.8 step schedule).

### 5.2 Limb IK rig: controls, solver records, placement

Generated by `limbIkRecords` (A1) for `autoRig(…, { ik })` and `rig.addLimbIk`. Only for humanoid programs, only for
limbs whose three chain bones exist (`leftUpperLeg`/`leftLowerLeg`/`leftFoot`, `leftUpperArm`/`leftLowerArm`/
`leftHand`, mirrored for the right side) and are driven by FK controls; a missing limb is skipped with a warning.

| Template key | Name | Parent | Rest world `W⁰` | Rotate order | Keyable | Shape |
|---|---|---|---|---|---|---|
| `ik.leg.L` / `.R` | `L Leg IK` | `root` | t = foot bone rest position; q = identity (world-aligned) | `zxy` | t, r | `custom` footprint at the ground plane: the quadrilateral through heel and toe, each offset inward by `l·innerWidth` and outward by `l·outerWidth`, from the foot parameters below |
| `pole.leg.L` / `.R` | `L Knee Pole` | `root` | t = §5.2.2; q = identity | `xyz` | t | `diamond`, size 0.015·H |
| `ik.arm.L` / `.R` | `L Arm IK` | `root` | t = hand bone rest position; q = identity | `zxy` | t, r | `cube`, size 1.2 × the `fk.hand` control size |
| `pole.arm.L` / `.R` | `L Elbow Pole` | `root` | t = §5.2.2; q = identity | `xyz` | t | `diamond`, size 0.015·H |

All four kinds: `side` L/R, `group: 'body'`, `drives: null`, `mirror` = the counterpart, `hiddenByDefault: false`,
`order` after the existing children of `root`. IDs `controlId(rig, key)`; solver `solverId(rig, 'ik2.leg.L')`
etc., `type: 'ik2'`, `enabled: true`, `params: Ik2Params`.

**Attributes** on the IK control (`ik.leg.*` all seven, `ik.arm.*` the first three):

| Name | Default | Range | Unit | Keyable | `keyAll` | Stepped | Mirror |
|---|---|---|---|---|---|---|---|
| `ikFk` | legs 1, arms 0 for new rigs; **0 for every limb added by `rig.addLimbIk`** | 0…1 | — | yes | **false** | yes | copy |
| `soft` | 0 | 0…0.25 (fraction of l1 + l2) | — | yes | **false** | no | copy |
| `twist` | 0 | — | angle | yes | true | no | negate |
| `roll` | 0 | — | angle | yes | true | no | copy |
| `bank` | 0 | — | angle | yes | true | no | copy |
| `heelTwist` | 0 | — | angle | yes | true | no | negate |
| `toeTwist` | 0 | — | angle | yes | true | no | negate |

`S` on an IK foot therefore adds five attribute curves (`twist`, `roll`, `bank`, `heelTwist`, `toeTwist`; Maya keys
every keyable attribute too), on an IK hand one (`twist`).

#### 5.2.1 Hinge axis

`x̂⁰` = unit rest direction of the bone that swings: the **lower** leg (mid → end) for legs, the upper arm (upper →
mid) for arms, in canonical space (ratified M2A-A1-1: Polybot's thighs splay 28.6° outward over vertical shins, and
the upper-bone hinge tilted its knee hinge by as much, so knee flexion about x was no hinge motion). Distal swing
direction `s`: legs (0, 0, −1) (the shin swings back), arms (0, 0, 1) (the forearm swings forward).
`hinge = normalize(x̂⁰ × s)`; if `|x̂⁰ × s| < 0.1`, use the R07 §5.2 table (knees (1, 0, 0), left elbow
(0, −1, 0), right elbow (0, 1, 0)). T-pose results equal the table. The compiler converts `hinge` into the mid bone's
rest frame (`hingeLocal = q(W⁰_mid)⁻¹ ⊗ hinge`). A rest bend > 2° that opposes the hinge (hyperextended rest) warns
(`RigWarning 'asymmetric-rest'` reused with a limb message) and keeps the hinge.

#### 5.2.2 Rest pole

`a⁰, b⁰, c⁰` = rest positions of upper, mid, end; `x̂⁰ = normalize(c⁰ − a⁰)`; `m⁰ = (b⁰ − a⁰) − ((b⁰ − a⁰)·x̂⁰)x̂⁰`;
`k⁰ = hinge`, `h⁰ = normalize(x̂⁰ × k⁰)` (the direction the mid joint moves under flexion: knees forward, elbows
back), `m⁰_off` = the part of `m⁰` outside the hinge plane (`m⁰ − (m⁰·h⁰)h⁰`). Rest pole position =
`b⁰ + h⁰·(l1 + l2) − m⁰_off` (ratified M2A-A1-4). For rests bent about the hinge, or straight, this equals the v0.2
rule `b⁰ + p̂⁰·(l1 + l2)`; for off-hinge rests (Polybot) it keeps the pole in front of the knee, not beside it. Either
way the pole twist at rest is exactly zero (§5.3 B).

#### 5.2.3 Foot pivots (legs)

In character space, then expressed in the IK control's rest frame. Ankle `A` = foot rest position; ground
`y_g = 0`, or `A.y − 0.5·r_f` when `A.y < 0.5·r_f` (`r_f` = the `fk.foot` shape size, MVP-SPEC §4.11.15 feet group);
`ground = A_g` = `A` projected to `y_g`. Forward `f` = horizontal unit direction from `A` to the toes bone rest
position when it exists, else (0, 0, 1); `yaw = atan2(f.x, f.z)`; lateral `l = side·(cos yaw, 0, −sin yaw)`
(outward: `l·(1, 0, 0) > 0` on the left foot). `ballFront` = `(toes − A_g)·f` when toes exist, else `1.5·r_f`.

**From the mesh** (R07 §12; preferred whenever `SkeletonDesc.boneSupport` has the foot or toes node; a humanoid
lower leg's vertices below its foot's rest position count for the foot, and the foot's support covers its whole
subtree, helper joints such as Seed-san's `heel.L` included: Polybot skins its heel to the shin, ratified
M2A-A1-5): `s(d)` = the support of the union of the foot and toes nodes' vertices in horizontal direction `d`, in character space (each
node's samples plus `p·d`, the larger of the two nodes), read from the 32-sample support function (linear
interpolation between the two nearest samples; error ≤ 0.5 % of the foot length):
`heelBack = s(−f) + A_g·f`, `toeFront = s(f) − A_g·f − ballFront`, `outerWidth = s(l) − ball·l`,
`innerWidth = s(−l) + ball·l` (`ball = A_g + f·ballFront`); `y_g` = the lowest vertex y of the foot and toes nodes
when that is below `A.y`. A value outside `[0.2·r_f, 6·r_f]` falls back to its guess below and warns.
**Fallback** (no mesh data, or a value out of range): `heelBack = r_f`, `toeFront = 1.2·r_f`,
`innerWidth = outerWidth = r_f`.

**Ball joint** (acceptance fix round 1, M2A-INT-20): on a leg with a toes bone the ball roll's pivot is `ball` raised
to the toes joint's rest height in the IK control's rest frame (`limbFootRoll`, derived at compile time, not a
stored parameter), so with the measured `ballFront` and `yaw` it is the toes joint itself and the foot turns about it
like a reverse foot's ball joint; heel, toe tip and the bank pivots stay on the ground. Without toes the ball pivot is
the ground point `ball`. (v0.3 rolled the ball about the ground point, 3–4 cm below Seed-san's toes joint; the toes
rule then pulled the toes joint 8 mm off the foot at 30°, and bakes wrote a toes translation track.)

`breakAngle = π/6`; `side = +1` left, `−1` right. The parameters are data (`FootRollParams`); until the M2c pivot
editor, the Attributes Limb section shows them as numeric fields (cm, and degrees for the break angle;
`attr-limb-foot-<limb>-<field>`) that run `rig.setFootParams`, which also rewrites the footprint shape. Mirrored
rigs get mirrored parameters (`yaw` → −`yaw`), so `bank` and `roll` mirror with the channel rule of §5.8.

### 5.3 The `ik2` op (evaluation)

Registered by A1 with `registerRigOp('solver', 'ik2', impl)` from the rig package's own registration function
`registerBuiltinRigOps()`, called once by `createEditorApp` and by tests (nothing registers on import).

**Declarations** (`reads`/`writes`, §5.4): reads the IK control and the pole control (their worlds and attribute
slots) and the bone world of the upper bone's parent. Writes every node of `subtree(upper)` (chain bones,
intermediate nodes between them, and every descendant) and every control that is a descendant (by control parent
pointers) of `fk.upper`, `fk.mid` or `fk.end` but is not one of those three (fingers, `fk.toes`, secondary
controls under the chain).

**Per evaluate** (allocation-free; `state` from `compile` holds rest data, slots and scratch):

```
w = clamp(attrs[ikFk], 0, 1);  if w == 0: return false               // FK: nothing written, no kernel read-back
L = l1 + l2;  soft_m = clamp(attrs[soft], 0, 0.25)·L;  τ = attrs[twist]
W_ik = controlWorld(ikControl);  p = t(controlWorld(pole));  Pa = boneWorld(parent(upper))
// 1. Effective end target (legs: foot roll §5.3.1; arms: F = identity)
W_tgt = W_ik · F · K_end                                             // K_end = (W⁰_ik)⁻¹ · W⁰_end
// 2. Solve: solveTwoBoneIk with parentWorld Pa, upperRest = L⁰_upper, midRest = (W⁰_upper)⁻¹·W⁰_mid,
//    endRest = (W⁰_mid)⁻¹·W⁰_end (intermediate nodes rigid at rest, as Plant Feet, WP-3 R-15),
//    hingeLocal, target t(W_tgt), pole p, twist τ, soft soft_m, endWorldRotation q(W_tgt), restReach d⁰
//    → chain-relative rotations q_ik(upper), q_ik(mid), q_ik(end)
// 3. Blend (w < 1) in chain-relative local space, top-down (R07 §10):
//    q_fk(X) = chain-relative rotation of X from the FK worlds already in boneWorld
//    q(X) = slerp(q_fk(X), σ·q_ik(X), w),  σ = sign(q_fk(X) · q_ik(X))
// 4. Compose chain worlds top-down: upper from Pa with its rest local translation and scale; an intermediate node
//    from its parent with its FK local; mid and end: world rotation = (chain parent's world rotation)·q(X),
//    position = actual parent world · rest local translation
// 5. Follow rule: Δ_X = W_X,new · (W_X,fk)⁻¹ for every node X on the chain path (chain bones and the intermediate
//    nodes composed in step 4); every other written node n: W_n = Δ_X(n) · W_n,fk with X(n) its nearest ancestor on
//    the chain path; every written control c: W_c = Δ_X(c) · W_c,fk with X(c) the bone driven by c's nearest
//    chain-control ancestor
// 6. Toes rule (legs with a toes bone): C = K_end⁻¹ · Ball⁻¹ · K_end (ball roll removed, §5.3.1), C_w = slerp(I, C, w)
//    (same pivot); W_toes = W_end,new · C_w · (W_end,fk⁻¹ · W_toes,fk); the toes subtree and `fk.toes` with its
//    descendant controls follow Δ_toes = W_toes,new · W_toes,fk⁻¹ instead of Δ_end. The ball pivot is the toes
//    joint (§5.2.3 ball joint), so C fixes that joint: the toes keep their rest offset from the foot and only rotate
// 7. Write every new world into pose.boneWorld / pose.controlWorld; return true
```

After a run that returns `true` the kernel re-reads op-written worlds (MVP behaviour of custom ops), derives raw
locals from worlds and computes `N_b` and the hips position as before. After `false` (ikFk 0) it skips the read-back
and the `overridden` flags, so every bone local is computed exactly as in a program without the op (bit-identical;
FK limbs also pay no read-back cost per frame). At `w = 1` the end bone's world equals `W_tgt` whenever the target is
reachable.

**Amendments to R07 §9.2 inside `solveTwoBoneIk`, active only when `restReach` is given**:

- **A (reach)**: the upper clamp is `hi = max(L − ε, restReach)` (ε = 1e-5·L), so a limb that is straight at rest is
  reached at rest without bending; soft IK uses `hi` in place of `L` (`d = (hi − s) + s·(1 − e^{−(d_raw − (hi − s))/s})`
  for `d_raw > hi − s`).
- **B (bend plane)**: in step 5, `m` is replaced by `x̂ × k` (the hinge-implied bend direction, `k` the world hinge
  after step 4; `m` only when `x̂ ∥ k`); the pole twist then aligns that direction with the pole. (v0.2 replaced it
  only when `|m| ≤ 1e-3·L`; rests that bend off the hinge, Polybot's, would then swing the knee sideways as the leg
  flexes. Ratified M2A-A1-3.)
- **C (hyperextended rests, continuous)**: measure the bend by `t`, the angle about the hinge from the bend of
  greatest reach (a reach has the two solutions `t = ±s`), and let `T ≥ 0` be the rest's hyperextension (`t⁰ = −T`).
  M1 takes `t = s`; with `T > 0` the solver takes `t = −s` for `s ≤ T` (targets between the rest reach `d⁰` and full
  reach: the hyperextended branch, exact, the rest itself at `s = T`), `t = s − 2T·(1 − y)²` with `y = (s − T)/W`,
  `W = min(2T, π − T)` inside the band `T < s < T + W`, and `t = s` beyond (the flexion branch, exact). Inside the band
  the end passes its target along the reach ray by a little (≤ 0.57 mm on Polybot's arms within 2.1 mm below the rest
  reach, ≤ 0.07 mm within 0.28 mm on Seed-san's); matching places the IK control at the distance for which the solver
  takes the FK bend (`distanceForBend`), so switches, matching and import stay exact; the `asymmetric-rest` warning
  states the band. Rest exactness (1e-7 on every hyperextended rest arm of both fixtures) and "flexion only" cannot
  both hold with a continuous solution; the alternative (flexion only) popped the elbow by 5.7 mm (Seed-san) and
  12.4 mm (Polybot) when an IK hand crossed the rest reach. Ratified M2A-A1-3 (owner-visible trade-off, DECISIONS-OPEN
  §F).

Without `restReach` the function is bit-for-bit the M1 solver (Plant Feet and the M1 IK tests are unaffected).
The `TwoBoneIkInput.restReach` contract comment in rig `types.ts` names amendments A, B and C.

**Rest exactness**: at default channels (IK control, pole and attributes at rest, `ikFk` 1) every bone local equals
the rest local within **1e-7** (rotations in radians, translations in metres) on Seed-san and Polybot, legs and arms.

#### 5.3.1 Foot roll (simple variant, R07 §12)

In the IK control's local frame, rotated into the **foot frame** so that roll turns about the foot's own lateral
axis and bank about its own forward axis on a toed-out foot (Mixamo-style rigs and many VRMs stand 10–15° toed out;
character axes would add a bank of `roll·sin(yaw)` to every toe-off). The IK control itself stays world-aligned, so
the mirror channel rule of §5.8 still holds. With the pivots of §4.3 `FootRollParams`, `Q = R_y(yaw)` and
`P(p, R) = T(p)·Q·R·Q⁻¹·T(−p)`:

```
heelRoll = min(roll, 0);   ballRoll = clamp(roll, 0, β);   toeRoll = max(roll − β, 0)
Bank = P(bank ≥ 0 ? inner : outer, R_z(side·bank))        // pivot by the sign of bank; the rotation sign by side
Heel = P(heel, R_y(heelTwist) · R_x(heelRoll))
Toe  = P(toe,  R_y(toeTwist)  · R_x(toeRoll))
Ball = P(ball_j, R_x(ballRoll))                          // ball_j: the ball joint (§5.2.3), else the ground ball
F    = Bank · Heel · Toe · Ball
```

(`Q·R_y·Q⁻¹ = R_y`, so twists are about the vertical through the pivot as before.) Positive `roll` lifts the heel
(toe-off), negative `roll` lifts the toes (heel strike); positive `bank` lifts the outer edge and negative `bank` the
inner edge, on both feet (on the right foot the outer edge lies at −x of the foot frame, which the `side` factor of
the rotation accounts for; the pivot choice does not depend on `side`). Gates (A1 unit + E2E-M2A-04), each within
1e-6: `roll < 0` keeps the heel pivot's world position; `0 < roll ≤ β` keeps the ball pivot, the toes bone world and
the toes' rest offset from the foot (Seed-san and Polybot, both feet with toes, 10/20/30°; fix round 1);
`roll > β` keeps the toe pivot and turns the toes by `roll − β`; on **both feet** `bank > 0` keeps the inner pivot and
raises the outer pivot's y, `bank < 0` keeps the outer pivot and raises the inner pivot's y; `pose.mirror` of a left
bank (and roll) onto the right foot gives right pivots that mirror the left ones (1e-9 on the symmetric synthetic rig,
1e-3 m on Seed-san's asymmetric rest); on a synthetic rig whose feet stand 15° toed out, `roll` ±30° keeps the inner
and outer pivots at equal heights (the sole does not tilt sideways).

### 5.4 Compile and schedule rules (rig compiler)

Changes to `compileRig` (MVP behaviour is unchanged for programs without enabled custom ops):

1. Attribute slots are assigned first, ordered by (control id, attribute name) and independent of the schedule; then
   `reads`/`writes` receive `RigOpCompileContext` (with a working `attrSlot`) and the schedule is built; the compiler
   builds `LimbDesc` for every enabled `ik2` op that scheduled, from its params and the context; `createProgram`
   runs; then each op's optional `compile` runs with the finished program, and its result becomes the scheduled op's
   `state`.
2. Edges for an op `o`: producer → `o` for every read control or node; for every written node `n`: `bone(n) → o`
   and `o → bone(c)` for each child `c` of `n` **not written by `o`**; for every written control `w`:
   `control(w) → o`, and `o → control(c)` for each child `c` of `w` not written by `o`, and `o → bone(driven(w))`
   when that node is not written by `o`. (M1 added `o → child` for every child, so an op that wrote a parent and its
   child formed a cycle and was disabled.)
3. Two ops writing a common node or control are ordered by `(priority, id)` as in M1.
4. `RigProgram.limbs` lists the enabled `ik2` ops that scheduled; a disabled op (dangling reference or invalid
   params found by `reads`/`writes`, cycle, unsupported params version) is absent and warns. `reads`/`writes` do the
   validation, so a `compile` that throws afterwards is a bug: the op is then skipped at run time and warns, and it
   stays in `limbs` with `ikFk` read as 0 by `evaluation.ikFk`.
5. Rig bench (report): Seed-san with four IK limbs evaluates in ≤ 0.06 ms (the §14 pose budget stays 0.5 ms).

### 5.5 IK/FK visibility and display

`controlVisibility(app, control)` is the single rule (viewport drawing and picking, marquee, Outliner dimming,
`pickWalk`, the test API `controls()[].visible`); key targets (`'character'`, `'bodyPart'`) apply rule 1 only (§5.19).
A0 lands rule 1 as a working baseline (M1 code paths, e.g. `controls()`, call it from the first day); A2 adds rules
2–5:

1. `hidden` when `session.hiddenControls` has it, or it is `hiddenByDefault` and `showSecondary` is off (M1).
2. For a limb control with `w = evaluation.ikFk(character, limb)` at the current frame: the limb's `fkControls` are
   `hidden` when `w ≥ 0.999`; its `ikControls` are `hidden` when `w ≤ 0.001`; with `prefs.ikFkVisibility: 'ghost'`
   (stretch) they are `ghost` instead (25 % alpha, not pickable). `fk.toes` and finger controls follow rule 1 only.
3. A selected control that rule 2 hides is drawn `ghost` (25 % alpha, never pickable) and stays selected; the Channel
   Box keeps showing it.
4. Pole annotation: when a pole control is visible, the viewport draws a dashed line (token `--rig-pole-line`, new in
   `packages/ui/css/tokens.css`, added by A0; 1 px, 60 % alpha) from the mid bone's world position to the pole
   control's world position, in both control passes.
5. Recomputed per pose version; no React render per frame.

### 5.6 Match, switch and keying policy

All matching is at the current clip frame of the active clip, evaluated with overrides.

- **Match FK to IK** (`side: 'fk'`, before switching IK → FK): evaluate the pose with `ikFk = 1` (`ikPose`); FK
  channels for `fk.upper`, `fk.mid`, `fk.end` and `fk.toes` (when present) = `solveBoneChannels` of those bones' worlds
  in `ikPose`, top-down, `eulerNear` against the current channels (`matchFkToIk`).
- **Match IK to FK** (`side: 'ik'`, before switching FK → IK): evaluate with `ikFk = 0` (`fkPose`);
  `W_ik = W_end,fk · K_end⁻¹ · F⁻¹` with `F` at the current foot-roll attributes; `twist` = 0; the pole by the
  **match pole rule** below (`matchIkToFk`).
- **Match pole rule** (used by match, switch, `matchRange` and import, §5.8). With the FK world positions `a, b, c` of
  upper, mid and end, `x̂ = normalize(c − a)`, the bend offset `m = (b − a) − ((b − a)·x̂)x̂`, the FK world hinge
  `k_fk`, the hinge-implied flexion direction `h = normalize(x̂ × k_fk)` (the direction the mid joint moves when the
  hinge flexes: knees forward, elbows back), and the bend angle `θ` = the angle between `b − a` and `c − b`:

  ```
  m̂ = normalize(m) when |m| > 1e-3·L, else none
  β  = m̂ ? smoothstep(2°, 10°, θ) · smoothstep(0, 0.5, m̂·h) : 0
  ω  = the angle about x̂ (from h) of the mid-joint offset the IK itself produces for a chain bent by t, from the
       rest geometry: t = the FK pose's own hinge bend for IK bends up to 10°, the IK's bend for the FK reach from
       20°, smoothstep between
  ψ  = the signed angle about x̂ from R_x̂(ω)·h to m
  p̂  = R_x̂(β·ψ)·h
  pole = b + p̂·D − (m − (m·p̂)p̂),  D = the current pole distance from b when ≥ 0.25·L, else L
  ```

  (Ratified M2A-A1-2. v0.2's `p̂ = normalize((1 − β)·h + β·m̂)` assumed `m̂ = h` for every hinge pose, which holds
  only when the rest bend lies exactly in the hinge plane: Seed-san's knees are 0.7° off it, Polybot's legs and arms
  far off it. ψ cannot wrap while β > 0.) Every hinge pose gives ψ = 0, the exact M1-style pole. Near-straight limbs (`θ` < 2°, where `m`
  is noise) use `h`, and the pole moves continuously with the pose, so imported pole curves do not swing from frame
  to frame. A **hyperextended** knee or elbow (`m̂·h ≤ 0`, the mid joint behind the hip→ankle line) also uses `h`:
  the IK chain bends the normal way by the same amount instead of twisting 180° about the hip→ankle axis to reach a
  pole behind the knee (`solveTwoBoneIk` only bends in flexion). IK cannot reproduce a hyperextension; `matchIkToFk`
  returns `endErrorM` and `midErrorM` (the mid joint's position error), and the switch, match and import report
  them: a warning when the end misses by > 1e-4 m (e.g. inside the soft zone with `soft > 0`) or the mid joint by
  > 1e-3 m ("L Leg: the knee is hyperextended by 5°; IK bends it forward, the knee moves 12 mm"). If
  `|x̂ × k_fk| < 1e-6` (a degenerate hinge), `h` is the current pole direction from `b`.
- Gates (A1): FK → IK → FK leaves the chain bones unchanged within 1e-6 for random hinge poses with a mid bend ≥ 5°;
  on FK poses with the knee hyperextended by −2° and −5° (Seed-san legs) and the elbow by −5°, `matchIkToFk` gives an
  end world equal to FK (1e-6), no chain bone whose world rotation differs from FK by more than `2·|θ| + 1e-3` rad
  (no 180° flip), `midErrorM` > 0, and the operators warn; random non-hinge poses (±10° knee ab/adduction and twist) with a mid bend ≥ 5° give pole directions that change by
  ≤ 1e-3 rad for a 1e-4 rad change of any input rotation (continuity; the bend bound ratified with M2A-A1-2: below 5°
  of bend against 10° of ab/adduction even v0.2's blend turns faster than that).
- **Switch** `rig.ikFk.switch {limb, to, match = true, key}` with `key` resolved from `prefs.ikFkSwitchKey` when
  absent (`'auto'` → `'seamless'` if the `ikFk` curve has keys or auto-key is on, else `'none'`):
  - `'none'`: matched channels and `ikFk` through `applyChannelEdits(key: 'auto')`.
  - `'key'`: force keys at frame `f` on the matched channels and on `ikFk` (step tangent).
  - `'seamless'`: as `'key'`, plus a key on `ikFk` at `f − 1` with its value before the switch (step tangent),
    unless a key exists there, and a key at `f − 1` on every matched channel holding its curve value there (inserted
    shape-preserving, step out tangent; none where a key exists), so the key at `f` cannot reach back (ratified
    M2A-A2-19). The curves a seamless switch puts their first keys on get `constant` infinities, also on loop clips
    (§5.23 would make their two keys cycle with period 1; ratified M2A-A2-24). The pose at `f − 1` and the pose at `f`
    are unchanged (1e-6) whenever the match is exact (not for a hyperextended FK pose; see the warning above). **Ball
    roll exception** (ratified, open issue 1 of A2; narrowed by fix round 1, M2A-INT-20): with `@roll` inside the ball
    range the ik2 toes rule keeps the toes planted, counter-rotating the ball roll. IK → FK is exact: the ball pivot
    is the toes joint, so `fk.toes` reproduces the IK toes. FK → IK keeps the chain exact and warns with the toes'
    turn ("L Leg: IK bends the toes by 20° (foot roll); set Roll to 0 to keep the FK toes", M2A-A2-20); "… FK moves
    the toes by 5.4 mm …" remains only for foot parameters edited so that the ball pivot leaves the toes joint
    (`ballFront`, `yaw`). `f − 1` stays exact.
  - A switch to the mode the limb is already in (evaluated `ikFk` ≥ 0.999 for `to: 'ik'`, ≤ 0.001 for `to: 'fk'`)
    poll-fails "L Leg is IK already" (ratified M2A-A2-23).
  - One transaction, one history step; label `Switch L Leg to IK` / `… to FK`.
- **Match range**: `rig.ikFk.matchRange` matches at every integer frame of the range by default for side `'fk'`
  (matching only at IK key times would leave FK Euler interpolation between them and planted feet would slide) and
  at the key times of the limb's influencing curves (§5.8) for side `'ik'`; it keys the `side` controls (and
  nothing else), runs the Euler filter on the written rotation curves, and is one step.
- **UI**: the Channel Box shows an `IK/FK` proxy row (`cb-ikfk-row`) for any selected control of a limb (FK chain,
  IK control, pole), editing `<ikControl>/@ikFk` (the IK control's own raw `@ikFk` row is hidden, §5.1 rule 5); its
  button `cb-ikfk-switch` runs the switch towards the other mode with `match: true`. Selecting the proxy row's name
  makes `@ikFk` a selected Channel Box channel, so `S` keys it explicitly (§5.1 rule 4). The Attributes panel has a
  Limb section (`attr-limb-<limb>`): IK/FK segmented buttons (switch with match), "Match FK to IK", "Match IK to
  FK", the key-mode select (writes `prefs.ikFkSwitchKey`), for legs the foot fields of §5.2.3, and
  `attr-add-limb-ik` when the humanoid rig has no `ik2` solver. Menu Rig › IK/FK: Switch, Match, Match Range to FK,
  Match Range to IK, Add Limb IK.

### 5.7 M1 rigs, schema version 2, read-only rule

- Projects saved by M1 open unchanged: no IK records are added on open. When the active character is a humanoid rig
  without `ik2` solvers, the editor shows an info toast once per character: "This rig has FK limbs only. Rig › Add
  Limb IK adds IK controls (your animation stays unchanged)." with the action `rig.addLimbIk`.
- `rig.addLimbIk` adds the §5.2 records with `ikFk` default 0 for every added limb; the pose at every frame of every
  clip is unchanged, bit for bit (the op's `run` returns `false` at `w = 0`, so the kernel neither reads back worlds
  nor marks nodes overridden, §4.3), and exports of the upgraded rig are byte-identical to the M1 rig's until a limb
  is switched. Undo removes the records.
- `SCHEMA_VERSION` = 2. `snapshot()` writes `schemaVersion: 2` and `minWriterVersion` by the §4.2 snapshot rule: 2
  when the document has an enabled `ik2` solver, else 1 (a loaded future value is kept). An M1 app opens an IK
  project read-only with its "update the app" banner (M1 rule) instead of evaluating the legs as FK; projects
  without IK stay writable in M1.

### 5.8 Import, Plant Feet, export and mirroring with IK

- **Import** (`importRawClip`, `importHumanoidClip`, R07 §15.4): controls are solved top-down per time as in M1.
  With `ik: 'auto'` (default), for each limb whose `ikFk` default is ≥ 0.5, the importer computes `matchIkToFk` (the
  §5.6 match pole rule) from the solved FK pose at every key time and writes keys on the IK control (t, r) and the
  pole (t) instead of the limb's FK chain curves (`fk.upper`, `fk.mid`, `fk.end` get no curves); `fk.toes` keeps its
  FK curve. Euler filter and reduction run on the written curves. `ik: 'none'` writes FK curves only (M1). Import
  dialogs gain no control for this in M2a (the rig decides).
- **Import fidelity**: mocap and VRMA knees and elbows are not pure hinges (some ab/adduction and twist), and IK
  forces the hinge. Before writing, `'auto'` evaluates the IK result at every key time and compares it with the
  solved FK pose: the largest world-rotation difference of the three chain bones and the largest mid-joint position
  difference. When either exceeds `ikTolerance` (default 2° and 2 mm, M2A-D13), that limb stays **FK for the clip**:
  its FK chain curves are written as in M1, its `@ikFk` gets one stepped key with value 0 at the clip start (an
  explicit key, so the clip plays FK even though the rig's default is IK), and the import result warns: "L Leg kept
  FK in 'Walk_Loop': the knee is not a clean hinge (max 6.3°, 4 mm). Rig › IK/FK › Match Range to IK converts it
  if you accept the difference." `ImportedClipKeys.limbs` reports the per-limb mode and errors. Hyperextended frames
  (§5.6) exceed the tolerance the same way and keep the limb FK.
- **Plant Feet**: per pinned side, a leg with `ikFk ≥ 0.5` at the current frame gets IK control channels that put the
  foot bone on the pin with the current foot-roll attributes (`W_ik = Pin · K_end⁻¹ · F⁻¹`, `solveControlChannels`);
  an FK leg gets the M1 solve. One step. The M1 gates (US-25, ops tests) hold unchanged on IK legs.
- **Export** bakes through `RigProgram.evaluate` exactly as FK. Attribute curves never produce tracks.
- **Influencing curves** (one definition for `computeStepSchedule`, `computeInfluenceKeyTimes`, the §5.16 keep set
  and `matchRange` with `'keys'`): the curves that influence node `n` are the M1 set (its driving control's curves
  and those of its control ancestors) plus, for every op that writes `n`, the curves of every control the op reads
  (with their control ancestors, attribute curves included) and, recursively, the curves influencing every node the
  op reads (for `ik2`: the upper bone's parent, so `cog`, `fk.hips` and spine keys count for the leg tracks). A STEP
  key on `cog` is therefore a step discontinuity of the IK leg tracks too.
- **Mirror pose/animation**: IK controls and poles are world-aligned mirror pairs and use the M1 channel rule
  (`rx, −ry, −rz`; `−tx, ty, tz`); attributes map by `AttrDef.mirror` (`ikFk` copies, so a mirrored pose carries
  the limb mode with it).
- **Pose clipboard** carries attribute values (`'@name'` keys) except `keyAll: false` ones (§5.1 rule 4); paste
  writes them through `applyChannelEdits`.

### 5.9 Time slider extras (A3)

- **Mod+drag** on the band middle copies the band's keys: copies at `t + Δ` (snapped), originals unchanged; on
  release a copy landing on a non-copied key's time replaces it; the band moves to the copies; one step
  `Copy Keys`. Ripple does not apply to copies.
- **Ripple** (`session.tools.ripple`, toggled by `timeline-menu-ripple`, `ds-ripple` or `key.toggleRipple`): band
  moves and scales follow §5.11 on the band's target curves.
- **MMB-drag carry** (FR-TIME-10, R01 TS-03): an MMB drag on the slider scrubs with `time.setFrame {carry: true}`:
  every control of the active character whose channel values at the new frame differ from the values held at the
  drag's start (curves ⊕ overrides, ≥ 1e-12) gets those held values as session overrides; the pose stays visible and
  `S` keys it at the new frame. The carry ends like any override (next frame change, clip switch). The whole drag
  records **one** editor-history step whose override delta sits at the release frame (before: no overrides, after:
  the carried values) — an exception to MVP-SPEC §4.11.0 runner rule 7, which records override deltas only at an
  unchanged frame. `Mod+Z` drops the carried pose and keeps the frame.
- **Insert / remove time** `time.insertTime {at, frames, removeKeys}` on the target controls' curves (selected, all
  when none) is a uniform time warp: every key with `t > at`, breakdowns included, shifts by `frames`, and nothing at
  or before `at` changes (it runs the kernel with `retimeBreakdowns: false`; §5.12 retiming would move a breakdown
  before the playhead whose right anchor shifted, the opposite of what Maya's Add Inbetween is used for). `at`
  defaults to the active character's current clip frame `f`.
  `frames < 0`: when a key lies in `(at, at + |frames|]` the operator poll-fails ("A key at frame 11 would be
  deleted: use Delete Time") unless `removeKeys: true`, which deletes those keys. Menu items (Time menu and the
  time-slider context menu): Insert Frame (`{frames: 1}`, i.e. `at = f`, Maya "Add Inbetween"), Remove Frame
  (`{frames: −1}`: never deletes a one-frame hold or contact key), Delete Time (`time.deleteTime`: the band `[a, b]`,
  or `[f, f]` without a band, runs as `{at: a − 1, frames: −(b − a + 1), removeKeys: true}`). One step.
- **Nudge**: `←`/`→` over the time slider (scope T) move the selected keys by ∓1 frame (§6), one step each, with
  ripple when it is on.
- **Ticks**: breakdown keys draw in `--key-breakdown` (green); a tick with both kinds draws as a key.

### 5.10 Dope Sheet (A3)

- **Rows**: Summary › Character › Body part (humanoid rigs; §5.19 groups in the order Root, Torso, Head, Arm L,
  Fingers L, Arm R, Fingers R, Leg L, Leg R, Other) › Control › Channel. Shown controls: `ds-show` "Selected"
  (default; the active character's controls when nothing is selected) or "Character" (every control of the active
  character). Only controls with at least one keyed curve in the active clip get rows; channel rows exist for keyed
  channels. Rows expand and collapse (panel state, persisted with the layout); a control hidden by §5.5 rule 2 is
  listed dimmed.
- **Glyphs**: a row shows a glyph at each key time of its curves (`|Δt| < 1e-6`): ◆ key (`--key-default`), ◇
  breakdown (`--key-breakdown`) when every key there is a breakdown; yellow (`--key-selected`) when every key there
  is selected, a yellow outline when some are.
- **Hold bars**: on a channel row between consecutive keys `k`, `k+1` when `v_{k+1}` and the span's four Bézier
  ordinates (`segmentControlPoints`) all equal `v_k` within `1e-9·max(1, |v_k|)`. On an aggregate row (control,
  group, character, summary) between two consecutive aggregate key times `t_i < t_{i+1}` when **every** child channel
  curve `c` satisfies both:
  1. `c` is constant on the closed interval `[t_i, t_{i+1}]`: each span of `c` that overlaps it holds by the channel
     rule, and any part outside `c`'s key range lies in a `constant` pre/post infinity (a part covered by a moving
     span, or by a linear or cyclic infinity, is not constant); and
  2. `c` has keys at **both** `t_i` and `t_{i+1}` (`|Δt| < 1e-6`), or **no** key in the closed interval.

  So a child that interpolates through the interval (keys at 0 and 20 while a sibling has keys at 0, 10, 20) breaks
  the hold, and so does a child keyed at `t_i` but not at `t_{i+1}` (it has stopped being keyed, not been held,
  Maya's rule). Stepped spans of channel rows get a hatch.
- **Selection** shares `Selection.keys` with the Graph Editor and the time slider: a glyph click selects every key
  under the row at that time (Shift toggle, Mod remove, Mod+Shift add); a click on empty canvas clears the key
  selection (Graph Editor rule); marquee over rows × time; double-click a row label selects all its keys; a click on
  a control or channel label selects that control/channel (`select.controls`, `selection.channels`).
- **Edit**: LMB drag on a selected glyph (Select or Move tool) or MMB drag anywhere moves the selected keys in time
  (snapped; Alt disables snapping); with keys selected a region bar spans their min…max: dragging its middle moves,
  dragging an end scales around the opposite end (factor ≥ 0.01); the Scale tool (`R`) scales around the press
  frame when the drag starts outside the region. Each drag is one `beginKeyEditGesture` step; Esc cancels. Moves and
  scales apply ripple (§5.11) and breakdown retiming (§5.12). `←`/`→` nudge the selected keys by ∓1 frame (one step
  each, ripple when on). `Delete`, `Mod+C`/`Mod+V` (paste at the current frame onto the same curves; with ripple on
  the paste **inserts**: every key of the §5.11 scope curves with `t ≥` the paste frame first shifts by the
  clipboard span `t_last − t_first + 1`), `Digit1…7` tangent types, `S` key.set, `F`/`A` frame, `Mod+A` select all
  shown keys. `Mod+A`, `select.none`, `edit.copy`/`paste`/`delete` act on keys in scope D (A0 adds `dopeSheet` to
  the key-panel sets of `select.ts` and `edit.ts`).
- **View**: own time axis (`DopeSheetViewState`), ruler strip at the top (click/drag scrubs), playhead, playback and
  clip range shading; Maya profile: wheel zooms time around the cursor, Shift+wheel scrolls rows, Alt+MMB pans,
  Alt+RMB zooms time; trackpad profile: two-finger scroll pans (vertical scrolls rows), pinch zooms time. Rows are
  virtualized; the painter draws visible rows only. While its dock tab is inactive the panel draws nothing and its
  probe returns null; the shared selection lives in the kernel, so the Graph Editor tab shows it after a tab switch.
- **Budgets** (report): redraw of 50 controls × 9 channels × 200 keys ≤ 4 ms; drag of 1,000 selected keys ≤ 4 ms
  per pointer frame (shares the M-1 path).

### 5.11 Ripple rules (Dope Sheet and time slider)

Ripple uses **one global region** for the whole edit, never per-curve bounds: per-curve bounds would shift the later
keys of a curve whose last edited key lies before the region end by a different amount than the others and pull
every later pose apart (scaling 0…10 by 2 with `cog` keys at 0/4/10 and arm keys at 0/6 must move every later key by
+10, not +10 and +6).

- **Scope curves**: every curve (active clip, base layer) of the edit's control set: for a time-slider band, the
  band's target controls; for the Dope Sheet, the controls it shows (`ds-show`: the selection, or the character),
  the set its summary row aggregates. A control with an offset key just after the region (overlap) therefore moves
  with the pose it follows even when it has no key inside the region.
- **Region** `[a, b]`: the time-slider band's start and end, or the Dope Sheet region bar's min…max (the min and max
  time of the edited keys over all curves) before the edit.
- **Move by Δ**: every key of the scope curves with `t ≥ a` moves by Δ (edited or not). With Δ < 0 the whole block
  stops before the latest key with `t < a` over **all** scope curves: the limit is computed once (snap rule of
  MVP-SPEC §4.11.3 applied to the block as a whole), so every moved key on every curve gets the same effective Δ.
- **Scale by factor around pivot**: keys of the scope curves in `[a, b]` scale (edited or not); every key with
  `t > b` shifts by `(pivot + (b − pivot)·factor) − b`, the same amount on every curve.
- Ripple never changes values or tangents; breakdown retiming (§5.12) runs after it.

### 5.12 Breakdown keys and proportional retiming

- A breakdown is a key with `breakdown: true` (stored M1 field). Created by `key.set {breakdown: true}` (`Alt+S`),
  by tween keys (§5.13) and converted by `key.convert`. Displayed green (◇ in Graph Editor and Dope Sheet, green
  ticks).
- **Retiming** (inside `moveKeys` and `scaleKeys`, including ripple and band edits, unless
  `retimeBreakdowns: false`): per curve, for every **non-edited** breakdown `b`, let `a` and `c` be the nearest
  non-breakdown keys before and after `b` in the pre-edit key set. When `a` or `c` moved: `r = (t_b − t_a)/(t_c − t_a)`,
  `t_b' = t_a' + r·(t_c' − t_a')`; with snapping on, `t_b' = floor(t_b' + 0.5)` clamped into
  `[t_a' + 1, t_c' − 1]`, keeping the exact value when no integer fits. A breakdown with no anchor on one side moves
  with the anchor it has (by that anchor's Δ) if that anchor moved. Values and tangents never change; edited
  breakdowns move as directed. Order is preserved because the map is monotonic.

### 5.13 Tween family (A4)

Neighbours: for target `'frame'`, `p` = nearest key with `t_p < t` and `n` = nearest key with `t_n > t` on the
channel's curve. For target `'keys'`, the selected keys of each curve are grouped into **runs** (maximal sequences of
consecutive selected keys in the curve's key order); every key of a run uses the run's neighbours: `p` = the nearest
**unselected** key before the run, `n` = the nearest unselected key after it (Maya's Graph Editor tween and blend
sliders and aTools work on the keys around a selected block, so a block flattens toward a hold or is pushed as a
whole; an isolated selected key is a run of one, with the same result as before). A channel or run without both
neighbours is skipped. `v_c` = value at `t` (curve ⊕ overrides for `'frame'`; the key's own value and time for
`'keys'`), captured when the gesture starts. Amount `a` in slider units: `[−100, 100]`, `[−150, 150]` with overshoot
(`prefs.tweenOvershoot` or the toolbar toggle). With `r = (t − t_p)/(t_n − t_p)`:

```
tween:     w = (a + 100)/200;           v = v_p + w·(v_n − v_p)            (w outside [0, 1] = overshoot)
neighbor:  u = |a|/100;                 v = v_c + u·((a < 0 ? v_p : v_n) − v_c)
ease:      u = min(|a|, 100)/100;  k = 1 + 3u
           e = a < 0 ? r^k : a > 0 ? 1 − (1 − r)^k : r;   v = v_p + e·(v_n − v_p)      (no overshoot)
pushPull:  v_ref = v_p + r·(v_n − v_p);  v = v_c + (a/100)·(v_c − v_ref)   (a = −100 → the in-between line)
toDefault: v = v_c + (a/100)·(d − v_c)                                      (d = channelDefaultOf; a < 0 pushes away)
```

`pushPull` relaxes toward the time-weighted in-between (Blender's push/relax), not the plain average, so relaxing a
key away from the midpoint keeps its spacing; at the midpoint (`r = 0.5`) both are equal.

- **Target**: `'keys'` when `session.tools.tweenTarget` is `'auto'` and keys are selected (`Selection.keys`, shared
  by the Graph Editor, the Dope Sheet and the time slider), else `'frame'`. The Tween bar always shows the resolved
  target (`tween-target-<panel>`: "Pose @ f21" or "12 keys") and clicking it toggles `tweenTarget` between
  `'auto'` and `'frame'`, so leftover selected keys never switch the mode silently. Target `'frame'`: the key-target
  controls' keyable channels (or the Channel Box's selected channels) that have a curve with ≥ 1 key, without
  `keyAll: false` attributes unless they are selected Channel Box channels; a key is set or patched at the current
  frame; new keys are breakdowns unless `breakdown: false`. Target `'keys'`: each selected key's value changes in
  place.
- Rotations tween per Euler curve. Values of attributes are clamped to their range.
- **Tween bar** (one shared component, A4) is mounted in the **status line** (R09 §1/§3: animators tween while posing in
  a maximised viewport) and in the Graph Editor and Dope Sheet toolbars: mode select, slider, overshoot toggle, target
  label, and five preset buttons (−100, −50, 0, 50, 100; tweenMachine's 0/25/50/75/100 %; in the status line they sit in
  the bar's overflow menu), each one `key.tween` step. The thumb's amount is rounded to a whole number (slider step 1).
  A slider drag is one gesture (preview, one history step, label `Tween`); release keeps the result and springs the
  thumb back to 0; Esc cancels. `key.tween` is the one-shot form and is bindable in the keymap preferences.

### 5.14 Mirror animation with half-cycle offset (A4)

`pose.mirrorAnimation {mode, offset, controls}` on the active clip; humanoid rigs; scope = the given or selected
controls expanded to mirror pairs (whole character when none). When the expanded scope holds no L/R control (only
side `C` controls such as `cog` are selected), `leftToRight` and `rightToLeft` act on the whole character instead of
silently doing nothing; `flip` keeps the selected scope.

- Channel rule per curve (world-aligned controls: every humanoid FK, IK and pole control): `rx, ty, tz` copy;
  `ry, rz, tx` negate; attributes by `AttrDef.mirror`. Values, `dv` of fixed handles and static values are mapped;
  tangent types, `dt`, `broken`, `weightLocked`, `breakdown`, `weighted` and infinities are copied. Controls whose
  rest frame is not world-aligned (humanoid secondary controls) cannot be mirrored per key and per curve (M1
  `mirrorPose` composes them non-linearly with the rest frames): they are skipped and the result warns "3 secondary
  controls were not mirrored" (A4 test on Seed-san's secondary controls). Controls without a counterpart are
  summarised in one line, first: "14 controls have no mirror counterpart and were left unchanged (R Toes,
  sec.RightHandIndex2, sec.RightHandIndex3 and 11 more)" (one control keeps its own line); Mirror Pose likewise (fix
  round 1, M2A-INT-24: a whole-character mirror of Polybot listed every one in a ~1,000-character toast).
- `flip`: each pair swaps mirrored curves; side `C` controls get their own mirrored curves. `leftToRight` /
  `rightToLeft`: the target side's curves are replaced by the source side's mirrored curves; side `C` controls are
  unchanged. A channel whose source has no curve loses its target curve (it reads the channel default, as the source
  does), so `flip ∘ flip` is the identity on the curve set too (fix round 1, M2A-INT-25: v0.3 left key-less curves).
- `offset: 'halfCycle'` (poll: `clip.loop`): with `s = start`, `e = end`, `T = e − s`, `m = s + T/2`. Moving keys
  one by one is exact only when every curve has keys at `s`, `m` and `e` and only for tangents that do not depend on
  neighbours, so the operator works on a **working copy** of each source curve (the source curves are not changed):
  1. Insert keys at `s`, `m` and `e` where none exists within 1e-6, with the M1 shape-preserving insert
     (`insertKeyPreservingShape`: inside the key range a Bézier split, outside it the infinity's value and slope;
     neighbours it touches become `fixed`), using the editor's compile options (§5.23).
  2. Remap: every key at `t ∈ [s, e)` lands at `s + ((t − s + T/2) mod T)` with its value and handles; the source
     key at `e` is not written as a key of its own, and keys outside `[s, e]` are not written. The key landing at `m` (from the source key at `s`) takes its value and out-handle from the
     source key at `s` and its in-handle from the source key at `e`; the key landing at `s` (from the source key at
     `m`) gets a copy at `e` with the source key's value and in-handle.
  3. Freeze: the keys landed at `s`, `m` and `e` get their resolved handles as `fixed` (a `step`/`stepNext` out type
     stays: it is the interpolation flag of the span the key starts, which maps with the key, ratified M2A-A4-13;
     weighted curves freeze the handles the engine started from and cyclic infinities reaching into `[s, e]` are
     written out as copies first, M2A-A4-14; `broken` where the in and
     out slopes differ), because their neighbours changed; every other key keeps its tangent types, since its
     neighbours map with it.
  4. Write the mapped curves per curve in time order. A source curve whose working-copy values at `s` and `e` differ
     by more than 1e-9 is not periodic over the clip: it is mirrored anyway and the result warns "2 curves do not
     loop over 0…24"; the gate below does not apply to it.
- Unpaired L/R controls are left unchanged with a warning (M1 rule). One step, label `Mirror Animation`.
- Gate (FR-POSE-05): after `leftToRight` with half cycle, `ik.leg.R` evaluated at `s + ((t − s + T/2) mod T)`
  equals the mirror of `ik.leg.L` at `t` (1e-9 on channel values) at every integer frame `t ∈ [s, e)`, for periodic
  source curves. A4 unit cases: linear keys at 0/6/12/18/24 (E2E-M2A-15); keys at 0, 9, 15, 24 with auto tangents and
  no key at 12 (the old per-key landing held the right curve constant over 21…24 and 0…3 and popped at the seam);
  cycle-aware auto tangents with cyclic infinities; a non-periodic curve (warning).

### 5.15 Graph Editor additions (A4)

#### 5.15.1 Buffer curves

`graph.buffer.snapshot` copies each target curve (curves of the selected keys or selected channels, else every
visible curve) as `AnimCurve` into `session.curveBuffers` (per user, never saved or synced). The painter draws the
buffer of each visible curve as a dashed line (`--curve-buffer`, exact Bézier, behind the curves). `graph.buffer.swap`
replaces each target curve's keys, `weighted`, `pre` and `post` with its buffer (new key IDs; one transaction, label
`Swap Buffer Curves`) and stores the replaced data as the new buffer; swapping twice restores the curve (deep-equal
on values and tangents). Undo restores the document; buffers are U state and are not restored by undo.
`graph.buffer.clear` empties the buffers. Deleting a curve drops its buffer.

#### 5.15.2 Normalized and stacked views

Per Graph Editor instance (`GraphViewMode`, persisted with the layout; `N` toggles normalized, `Shift+N` stacked):

- **normalized**: each curve is drawn as `y' = 2·(v − m_c)/(M_c − m_c) − 1`, where `[m_c, M_c]` is the min and max of
  the curve over its key range (keys plus the extrema of each span's Bézier); a flat curve (`M_c − m_c < 1e-9`)
  draws at 0. The value axis shows −1…1.
- **stacked**: one lane per visible curve (equal height, minimum 40 px, vertical scroll beyond), each normalized
  into its lane; lane separators and curve labels.
- Ranges are computed when the mode or the curve set changes and **frozen during a drag** (recomputed on commit).
- Editing works in every mode: value deltas convert per curve (`Δv = Δy'·(M_c − m_c)/2`), handle drags convert
  slopes per curve, inserts and numeric fields use data values. The data never changes by a mode switch (deep-equal).
- `F`/`A` frame time in stacked mode, time and −1…1 in normalized mode.

#### 5.15.3 Scale tool and region box

Graph tool `scale` (`R`, `ge-tool-scale`): with keys selected, a region box spans their time and display-value
bounds. Dragging an edge scales that axis around the opposite edge; a corner scales both around the opposite corner;
inside moves; outside the box scales around the press point (horizontal = time, vertical = value; Shift locks the
dominant axis after 4 px). Time scaling uses `scaleKeys` (factor ≥ 0.01, snapping, breakdown retiming); value
scaling uses `scaleKeyValues` (fixed handles' `dv` scale with the factor, factor may be negative: a flip). One drag =
one step (`Scale Keys`). `graph.keys.scale {valuePivot, valueFactor}` is the operator form (`valuePivot` in display
units per curve, default 0; with `pivot`/`factor` the time scale runs first in the same step). Lattice deform is V2.

### 5.16 Export-side key reduction (A5, FR-EXP-12)

Implemented on baked tracks after hemisphere continuity and root-motion handling, before writing (R02 §6.4):

- **Tolerances** (character height `H`): `ε_pos = positionM·(H/1.7)`; per node `j`, `θ_tol(j) = min(rotationCapRad,
  ε_pos / max(L_j, minLeverM))` with `L_j` = longest rest distance from `j` to any descendant joint × 1.1; translation
  tolerance `ε_pos`; scale tolerance `scaleRel` relative.
- **Keep set**: first and last sample; the loop-closure sample; the clip's `contact` frame; for each track the key
  times of its influencing curves (§5.8 definition) inside the range (`computeInfluenceKeyTimes`, A1; until A1
  merges, A5's code and unit tests run without this term behind `READY.a1`, which the tolerance bound and
  E2E-M2A-21 do not need); step discontinuities. STEP tracks and 2-key constant tracks are not reduced.
- **Algorithm**: recursive split between kept neighbours `i < j`: reconstruct every sample `k ∈ (i, j)` by slerp
  (rotation) or lerp (translation, scale) at its time; error `2·acos(min(1, |q̂·q|))`, `|p̂ − p|`,
  `max_c |ŝ_c − s_c|/|s_c|`; keep the sample with the largest error (ties: smallest index) while it exceeds the
  tolerance. Deterministic.
- **Bytes** (acceptance fix round 1, M2A-INT-22): writers share one input accessor per identical time array, so a
  reduced track costs its own times unless another track keeps the same ones. Reduced tracks are grouped by their
  times; a group is kept only if `TIME_ACCESSOR_BYTES` (192) + 4·n for its times plus its samples is below its tracks'
  full samples on the shared full time array (charged once when no other track keeps that array); otherwise its
  tracks keep every sample (error 0). The reduced file is therefore never larger than the unreduced one: v0.3 wrote a
  time accessor per reduced track, and a smooth walk's VRMA grew 16,384 → 16,996 B while dropping 40 samples.
- `ExportRequest.reduce` absent or null → no reduction (M1 bytes; E2E-16…18 unchanged). The Export dialog has
  `export-reduce` (checked by default from `prefs.exportReduce.enabled`) and passes `DEFAULT_EXPORT_REDUCE`.
- The read-back check compares the written file with the **reduced** clip (M1 tolerances); `stats.reduction` reports
  the sample counts and the max errors against the unreduced samples; the export toast shows "N → M samples".
- Gate (ratified M2A-A5-3 at integration; the owner may still move it): on Seed-san's hand-keyed `wave` clip (0…30)
  the reduced file never has more samples or bytes than the unreduced one and sampling its tracks at every integer frame stays
  within the per-node tolerances of the unreduced bake; on a clip keyed with linear tangents (blocking: holds and
  linear spans keep only their ends) the total sample count shrinks ≥ 3×. ≥ 3× is out of reach on the wave file (51
  of its 52 tracks are 2-sample constant tracks, 102 of 133 samples, which are not reduced: at best 104 samples,
  1.28×), and smooth hand-keyed motion at 30 fps keeps its samples at R02's tolerances (the wave; E2E-M2A-23's walk,
  where dropping any one sample moves a track by ≥ 2.6e-4 m or 1e-3 rad against Polybot's 9.4e-5 m / ≤ 9e-4 rad).

### 5.17 Pick-walk (A2, FR-OUT-05)

`select.pickWalk {direction, add}` over the control hierarchy of the active character, skipping controls that are
not `visible` (§5.5):

- `up`: the nearest visible ancestor; `down`: the first visible child by `order`, then id; `left` / `right`: the
  previous / next visible sibling by order (no wrap); without one in that direction, the visible mirror counterpart;
  otherwise the control stays.
- Every selected control walks; duplicates collapse; the lead's result stays the lead. `add: true` adds the results
  to the selection instead of replacing it. Not a history step (selection rule of M1).
- Bound to the arrow keys in the viewport and Channel Box scopes (§6). The keymap has no pref-conditional bindings,
  so the arrows always run `select.pickWalk`, and `select.pickWalk` itself dispatches on `prefs.arrowKeys`: with
  `'pickWalk'` it walks; with `'frames'` it runs `time.step {−1/+1}` for ←/→ and `time.nextKey`/`time.prevKey` for
  ↑/↓ (and ignores `add`). The shortcut sheet shows the label of the active behaviour. The Outliner keeps its ARIA
  tree keys (acceptance round 2/3 rule), and a focused Channel Box text field keeps its ↑/↓ value nudge (FR-CB-03):
  keys typed into a focused text field never reach the keymap (M1 input-adapter rule).

### 5.18 Channel Box virtual slider (A2, FR-CB-05)

- **Start**: MMB press on any row, or an LMB drag of ≥ 3 px horizontally that starts on a channel name (an LMB click
  still selects the name). Channels: the Channel Box's selected channels when the pressed row is one of them, else the
  pressed row's channel; applied to every selected control that has the channel.
- **In the viewport** (R01 CB-03, the Maya habit for roll, bank and twist: select the channel name, then MMB-drag in
  the viewport while watching the foot): with Channel Box channels selected and `prefs.virtualSlider.viewportMmb`
  on (default), a plain MMB drag (no Alt) in a pane runs the same gesture on the selected channels, with the same
  rates, modifiers and single history step. Plain MMB belongs to the active tool in M1 and no viewport tool uses it,
  so nothing conflicts; Alt+MMB stays navigation. Without selected channels a plain MMB drag does nothing (M1).
- **Rate** per pixel of horizontal motion: rotation channels and `angle` attributes `prefs.virtualSlider.degPerPx`
  (0.5°); translations and `distance` attributes `metresPerPx` (0.01 m); scale `unitsPerPx` (0.01); attributes with
  `min` and `max`: `(max − min)/200`; other attributes `unitsPerPx`. Shift ×0.1, Mod ×10, read at each move (the
  value integrates increments). Values are relative per control and clamped to an attribute's range.
- Pointer Lock when available (no edge stop), else pointer capture; both modes integrate `PointerEvent.movementX`
  (never `clientX` differences), so the values are identical in both. Chrome uses Esc to leave Pointer Lock and
  does not deliver that keydown to the page, and refuses a new lock for a moment after the user left one, so:
  a `pointerlockchange` to unlocked during an active gesture **cancels** it and restores the values (that is the
  Esc path under lock); a rejected `requestPointerLock()` promise or a `pointerlockerror` falls back to pointer
  capture for that gesture; in pointer capture Esc cancels as usual. The e2e URL switch `pointerLock=off` (§4.8)
  forces pointer capture. Updates go through `beginChannelEditGesture` (coalesced per frame): one history step,
  auto-key per M1 rules on release.

### 5.19 Keying by body part (A2, FR-KEY-10)

`key.set {target: 'bodyPart'}` (or `tools.keyTarget: 'bodyPart'`, status line toggle `status-keytarget-bodyPart`)
keys every control of the body parts of the selected controls that §5.5 rule 1 does not hide; controls hidden only by
the IK/FK rule are keyed too, so a later switch finds keys on both sets. `keyAll: false` attributes (`ikFk`, `soft`)
are not keyed by body part (§5.1 rule 4). `bodyPartOf` and `keyTargetControls` are A0 baselines (a pure template-key
table and rule 1). Humanoid template-key groups:

| Part | Controls |
|---|---|
| `root` | `root` |
| `torso` | `cog`, `fk.hips`, `fk.spine`, `fk.chest`, `fk.upperChest` |
| `head` | `fk.neck`, `fk.head`, `fk.jaw` |
| `arm.L` / `arm.R` | `fk.shoulder`, `fk.upperArm`, `fk.lowerArm`, `fk.hand`, `ik.arm`, `pole.arm` of that side |
| `fingers.L` / `fingers.R` | every finger control of that side |
| `leg.L` / `leg.R` | `fk.upperLeg`, `fk.lowerLeg`, `fk.foot`, `fk.toes`, `ik.leg`, `pole.leg` of that side |

A secondary control belongs to the part of its nearest grouped ancestor. On generic rigs `'bodyPart'` keys the
selected controls and the help line says so. Gate: `S` with `fk.hand.L` selected keys exactly the `arm.L` controls.

### 5.20 Autosave and crash recovery (A5, FR-PROJ-05)

- **Slot**: on start the editor opens one slot per page load (`AutosaveStore.open`, a Web Lock
  `ekza-animator:autosave:<slot>` held until unload; without Web Locks a heartbeat every 5 s). IndexedDB database
  `ekza-animator-autosave-v1` (+ the e2e namespace), stores `slots` (info + snapshot JSON) and `assets` (bytes by
  SHA-256, shared by slots, written once).
- **Cadence**: after a committed batch that makes the document dirty (any origin but `preview` and `load`), write
  `delayMs` (2 s) after the last such batch, but at most `maxIntervalMs` (30 s) after the first unsaved one; never while
  a preview (gesture) is active (deferred to its commit); writes are serialized and run in `requestIdleCallback` (or
  a 0 ms timeout). The snapshot is `serializeSnapshot(store.snapshot())`. Budget (report): ≤ 50 ms main-thread time
  per write for Seed-san with 10 clips.
- **Clean ends**: a successful `file.save`/`saveAs` and `file.new` remove the slot's snapshot (it is rewritten on the
  next dirty batch); `beforeunload` while not dirty removes it (best effort).
- **Recovery**: at start (after the first-run dialog) the editor lists orphaned slots; when any exist the `recovery`
  dialog lists them (project name, relative time, characters, clips, size) with Recover, Discard (asks first) and
  Later (keeps them; no prompt again in this page load). Recover runs `file.recover`: the `file.openProject` path on
  the slot's snapshot and assets (migrations, read-only rule), then `dirty: true`, history empty, toast "Recovered
  '<name>' from <time>. Save it to keep it." The recovered slot is removed after this page's first successful
  autosave. The slot info records the active character and clips of each write (fix round 1, M2A-INT-23), and
  `file.recover` returns to them when they exist (the active character's clip at its start frame, as `clip.setActive`);
  otherwise, and for older slots, each character opens its first clip.
- **Housekeeping**: orphans older than 14 days are removed at start; at most 5 orphans are kept (oldest removed);
  unreferenced assets are deleted. A quota error pauses autosave until the next save and shows one warning toast.
- **Storage unavailable** (private mode, blocked, `storage=blocked`): autosave is off, one info toast "Autosave is
  off: this browser blocks storage.", no dialog; everything else works.
- E2E hooks: `autosave()`, `flushAutosave()` (writes now and resolves after the transaction completes).

### 5.21 Budget fixes (M-1, M-2, M-3)

#### 5.21.1 M-1: drag 1,000 selected keys ≤ 4 ms per pointer frame (A4; A0 provides the scheduler)

The M1 measurement ([wp-10-budgets](wp-notes/wp-10-budgets.md)) splits the 5.1 ms median per move into ≈ 2.9 ms in
the pointermove handler (store preview update 2.2 ms, the rest `moveKeys` and the transaction) and ≈ 2.5 ms in the
frame it renders (Graph Editor and viewport redraw). The bench sends one move per animation frame, so coalescing
moves (mechanism 1) only moves the store update from the handler into the frame and saves nothing in the bench, and
the store mechanisms (2, 3) alone reach about 3.9 ms. The frame needs its own mechanism.

- **First deliverable** (A4, recorded in `docs/wp-notes/m2a-a4.md` before any optimisation): a frame profile of the
  bench drag that splits the frame into Graph Editor redraw, curve recompile and viewport evaluation and redraw.
- **Target** on the measuring machine (Apple M4 Pro, real Chrome, DPR 2, load average < 8 recorded): bench `Graph
  Editor drag` **p95 ≤ 4.0 ms** (the budget itself; it is the gate for "Met"), median recorded; doc bench preview
  update of 1,000 keys ≤ 1.0 ms (was 2.20 ms). The 1.5–2× slower §14 reference machine is reported, not gated; a
  tighter median target (headroom for that machine) is set from the profile and recorded, not assumed.
- **Required mechanisms**: (1) pointer moves coalesce to one preview update per animation frame
  (`beginKeyEditGesture`, `beginChannelEditGesture`, A0's `scheduleBeforeFrame`; this matters for real mice that
  send several moves per frame); (2) the memory store's preview update avoids re-reverting and deep-comparing records
  whose new value is the same object (reference check first) and journals in place; (3) the query engine drops each
  curve's key group once per batch, not once per changed key; (4) only curves touched by the batch recompile; only
  characters whose curves changed re-evaluate; (5) **Graph Editor redraw**: curves not touched by the gesture are
  painted once into a cached layer (an offscreen canvas per view state), and each frame of the drag repaints only
  the dragged curves, keys and handles over it; (6) **viewport**: the frame loop skips the viewport's evaluation and
  render when the evaluated pose version at the current frame did not change (a drag of keys that leaves the current
  frame's values unchanged costs no viewport frame).
- **Files**: mechanisms 2–3 in `doc/src/{store,queries}/**`; 4 in `rig/src/sampler/cache.ts` and
  `editor-core/src/evaluation/**`; 5 in `curve-editor/src/{graph,painters}/**`; 6 in `editor-core/src/app/kernel.ts`
  (pose version) and the viewport's render entry (`viewport/src/manager/**`, the skip only). A4 owns them for M-1
  after A0 (§8.1); A2 owns the rest of `viewport/**` and rebases on A4's change.
- The store contract, the conformance suite (memory and `doc-yjs`), undo semantics and every M1 drag test are
  unchanged and green.

#### 5.21.2 M-2: editor route JS ≤ 900 kB gzip with headroom (A5)

- **First deliverable** (A5, recorded in `docs/wp-notes/m2a-platform-perf.md`): a chunk attribution report of the
  current initial route from the production build's source maps (bytes per package and per top-level module, gzip
  -9), so every cut is planned against measured numbers; no attribution exists in wp-10-budgets.md.
- **Target**: the scripts loaded by `/editor` until the empty state is visible and the network is idle total
  ≤ **800,000 B** gzip -9 (decimal kB, the stricter unit). The 800,000 B figure is provisional until the attribution:
  A5 may set it to the attributed reachable value with the reason recorded (contract PR to this file), but never
  above 850,000 B (≥ 50 kB headroom under the budget). **Set at integration to 850,000 B for M2a**: A5's branch
  measured 785,248 B, the merged route 843,270 B (A1…A4 add ≈ 58 kB of eager code: IK rig, IK, tween, mirror and
  ripple operators, Dope Sheet contributions, Channel Box attribute rows, the Tween bar); attribution and the next
  cuts in `docs/wp-notes/m2a-integration.md` (M2A-INT-4). **CI gate** `pnpm --filter web check:size` fails above
  900,000 B and prints every lazy chunk group with its size.
- **One measurement**: `check:size` derives the initial script set from the same definition as the bench (the
  scripts the `/editor` route requests until the empty state, read from the Next build manifest and the route's
  `<script>` and preload tags, not from a static guess), and A5 cross-checks it once against the bench's network
  capture (the two totals within 1 %), recording both numbers.
- **Required lazy boundaries** (dynamic `import()`, prefetched on intent, never at idle): (1) the model loader
  (`io/three`, `@pixiv/three-vrm`, three's GLTF/Draco/KTX2/meshopt loaders) on the first file drop, Open, sample
  hover/click or `file.openProject`; (2) the export path (`@ekza-animator/io/write`, glTF Transform) when the Export
  dialog opens or `file.export` runs; (3) every dialog (`React.lazy`); (4) the Dope Sheet panel until its tab is
  first shown; (5) `fflate` and the project archive code on the first save or open.
- `Open Seed-san to interactive` (report) must not regress by more than 100 ms median; the first export's extra
  chunk load is reported in the bench.

#### 5.21.3 M-3: anim-core 2,200 curves ≤ 0.3 ms (A5)

- First re-measure on an idle machine (load < 4, single worker) and record it. Target: mean ≤ 0.20 ms, p75 ≤ 0.25 ms.
- Allowed mechanisms, results unchanged (AnimX goldens ≤ 1e-9, property tests unchanged): a per-compiled-curve
  segment hint for monotonic playback (a cache, not state: any frame order returns the same values); coefficients
  stored on the compiled object at compile time (no side-table lookup per call); constant-infinity and single-span
  fast paths.

### 5.22 New and re-measured budgets (report only, ARCHITECTURE §14 extended)

| Scenario | Budget | Owner |
|---|---|---|
| Pose evaluation, 1 humanoid with 4 IK limbs | ≤ 0.5 ms (target ≤ 0.06 ms) | A1 |
| Dope Sheet redraw, 50 controls × 9 channels × 200 keys | ≤ 4 ms | A3 |
| Dope Sheet drag, 1,000 selected keys | ≤ 4 ms per pointer frame | A3 |
| Tween slider drag on 60 channels | ≤ 4 ms per pointer frame | A4 |
| Autosave write, Seed-san × 10 clips | ≤ 50 ms main thread | A5 |
| M-1 (gate p95 ≤ 4.0 ms), M-2, M-3 | §5.21 | A4, A5 |

### 5.23 Loop clips: cyclic curves and cycle-aware auto tangents (A0, FR-GE-17)

M2a sells walk cycles, so the seam must not hitch. Before M2a the first and last keys of a loop clip evaluated their
`auto` tangents flat (MVP-SPEC §4.11.4 end-key rule), so a channel that crosses the seam with velocity (`cog` sway,
arm swing, spine twist) eased in and out at the loop point every cycle. The engine already implements
`cycleAwareAuto` (anim-core `resolve.ts`, M1-stretch, off).

- **Compile**: the editor's `deps.curves.engine` (`editor-core/src/app/deps.ts`) becomes a cycle-aware wrapper,
  `{ compile: (c) => compileAnimCurve(c, { cycleAwareAuto: true }), evaluate: curveEngine.evaluate }`, with no
  anim-core contract change. The kernel already hands that engine to the rig sampler's curve cache
  (`createCurveCache(store, deps.curves.engine)`), which the evaluation, the Graph Editor painters (through
  `evaluation.compiledCurve`), graph handle resolution, Plant Feet and the export bake use, so drawn, evaluated and
  exported curves agree; the test kit's naive evaluator uses the same option. The shape-preserving insert, Simplify
  (`reduceKeys` with `cycleAwareAuto`, §4.1) and the rotate-order conversion (rig `convertRotateOrderKeysWith` with the
  editor's engine) work on the same shape. The engine applies it only to curves
  whose pre and post infinities are both cyclic (`cycle` or `cycleOffset`), so curves with a `constant` infinity,
  i.e. every curve M1 created (E2E-07 sets only the post infinity), evaluate exactly as before. anim-core's
  `curveEngine` and the rig's default cache engine stay non-cycle-aware (goldens and headless tests unchanged).
- **New curves on loop clips**: a curve created by keying (`key.set`, auto-key, tween keys, pastes; the shared
  curve-creation helper in `edit/keys.ts`) in a clip with `loop: true` gets `pre` and `post` `'cycle'`; mirrored curves
  copy their source's infinities (§5.14); imports keep `'constant'` (their keys span the clip). Turning `loop` on later
  does not rewrite existing curves; the Graph Editor's infinity menu changes them as in M1.
- Gate: E2E-M2A-23 asserts C¹ continuity of `cog` tx at the seam: `curveSlope(cog tx, 24, 'left')` equals
  `curveSlope(cog tx, 0, 'right')` within 1e-9; the `stretch.spec.ts` FR-GE-17 entry becomes a passing test.

---

## 6. Keymap additions (preset `maya`)

Scopes as MVP-SPEC §4.10 plus `D` = Dope Sheet. Maya has no default chord for breakdowns, tweens, buffer curves or
IK/FK switching; they stay menu/toolbar items except where noted.

| Chord | Operator (args) | Scope | Origin |
|---|---|---|---|
| `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` | `select.pickWalk {direction: 'up'/'down'/'left'/'right'}` (which itself runs `time.nextKey`/`time.prevKey`/`time.step {−1}`/`time.step {+1}` when `prefs.arrowKeys` is `'frames'`, §5.17) | V, C | Maya pickWalk |
| `Shift+Arrow…` | `select.pickWalk {…, add: true}` | V, C | Maya |
| `ArrowLeft` / `ArrowRight` | `graph.keys.move {dFrames: −1 / +1, dValue: 0}` (nudge the selected keys; ripple from the panel in D and T, never in G) | G, D, T | R01 GE-05 |
| `Alt+KeyS` | `key.set {breakdown: true}` | V, O, C, T, D | R09 §7.2 (E) |
| `KeyQ` / `KeyW` / `KeyR` | `view.tool {panel: 'dopeSheet', tool: 'select'/'move'/'scale'}` | D | Maya |
| `KeyR` | `view.tool {panel: 'graph', tool: 'scale'}` | G | Maya |
| `KeyN` / `Shift+KeyN` | `graph.view.setMode {mode: 'toggleNormalized'/'toggleStacked'}` | G | R09 §7.2 (E) |
| `KeyS` | `key.set {channels: 'all'}` | D | Maya |
| `Delete`, `Backspace` | `graph.keys.delete` | D | M1 rule |
| `Mod+KeyC` / `Mod+KeyV` | `graph.keys.copy` / `graph.keys.paste` (inserts when ripple is on, §5.10) | D | M1 rule |
| `Mod+KeyA` | `select.all` (all keys of the shown rows) | D | M1 rule |
| `Digit1`…`Digit7` | `graph.tangent.set {type: …}` | D | M1 rule |
| `KeyF` / `KeyA` | `dopeSheet.frame {what: 'selection'/'all'}` | D | Maya |

Not bound (menu or toolbar): `rig.*`, `key.tween` (bindable through `prefs.keymapOverrides`, e.g. a preset
amount), `key.convert`, `key.setTarget`, `key.toggleRipple`, `pose.mirrorAnimation`, `time.insertTime`,
`time.deleteTime`, `graph.buffer.*`, `file.recover`. The shortcut sheet lists every new binding.

---

## 7. UI placement

```
┌ Menu: File Edit Select Key Pose Rig Time Graph View Window Help ───────────────────────────────────────────┐
│ Status: [Q][W][E] │ space │ mask │ Key: [Sel│Part│Char] │ Tween ◀━●━▶ Pose@f21 │ Auto-key │ Layout     │
├──────────┬───────────────────────────────────────────────────────────────────────┬─────────────────────┤
│ Outliner │                       Viewport panel (panes)                          │ Channel Box         │
│ | Clips  │   IK foot (footprint), pole diamonds + dashed knee lines              │  TRS rows           │
│          │   FK leg circles hidden while the leg is IK                           │  attribute rows     │
│          │                                                                        │  IK/FK row  [⇄]     │
│          │                                                                        │ | Attributes        │
│          │                                                                        │  Limb: [IK|FK] Match│
├──────────┴──────────────────────────────────────────────────────────┬────────────┴─────────────────────┤
│ [Graph Editor | Dope Sheet]  toolbar … Tween [mode▾] ◀━━━●━━━▶ [±]  │ (bottom dock, tabs)              │
├─────────────────────────────────────────────────────────────────────┴──────────────────────────────────┤
│ Time slider (ticks: red keys, green breakdowns; band; MMB carry; RMB: Ripple ✓, Insert/Remove Frame…)  │
│ Range slider │ Clip ▾ │ fps ▾ │ transport │ loop │ speed │ auto-key                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Dope Sheet**: a tab beside the Graph Editor in the bottom dock (inactive by default, lazy-loaded); toolbar: tools
  (Select/Move/Scale), Show (Selected/Character), Ripple, Snap, Frame, Tween bar.
- **Graph Editor toolbar**: + Scale tool, View (Absolute/Normalized/Stacked), Buffer (Snapshot/Swap), Convert
  (Breakdown/Key) in "More ▾", Tween bar.
- **Channel Box**: attribute rows (no raw `@ikFk` row) and the IK/FK proxy row with the switch button; virtual
  slider on rows and, with channels selected, MMB in the viewport.
- **Attributes**: Limb section for the lead control's limb (mode, match, key mode, and for legs the foot fields:
  heel back, ball front, toe front, inner and outer width in cm, break angle in degrees); "Add Limb IK" on IK-less
  humanoid rigs.
- **Status line**: key target toggle group; the compact Tween bar (mode, slider, target label, presets in its
  overflow menu); A0 reserves the slot, A4 mounts the bar.
- **Menus**: Key › Set Breakdown, Convert to Breakdown/Key, Tween ▸ (modes at ±50), Ripple Edit ✓, Key Target ▸;
  Pose › Mirror Animation ▸ (Flip, Left → Right, Right → Left, each also "(half cycle)"); Rig › IK/FK ▸, Add Limb IK;
  Time › Insert Frame, Remove Frame, Delete Time; Graph › Buffer ▸, View ▸; File › Recover…, Save Recovery Point.
- **Dialogs**: Recovery (A5). Export dialog: "Reduce keys" checkbox.

---

## 8. Work packages

Parallel build in separate git worktrees. A0 lands first (contracts, stubs, working baselines, the shared foundation
and the atomic schema change), then A1…A5 **start together** and build in parallel. Every cross-package test is gated
(`describe.skipIf(!READY.<id>)` in unit tests, `test.fixme('<ids>')` in e2e, §3 rule 4), so a package can merge as
soon as it is green, in any order; §10.1 gives the preferred order. Sizes are agent-days.

```mermaid
flowchart LR
  A0["A0 contracts + foundation + schema v2"] --> A1["A1 rig IK"]
  A0 --> A2["A2 IK editor integration"]
  A0 --> A3["A3 Dope Sheet + timing"]
  A0 --> A4["A4 Graph + posing + M-1"]
  A0 --> A5["A5 platform: M-2, M-3, autosave, export reduction"]
  A1 -. IK unit tests and E2E turn on .-> A2
  A1 -. keep-set influence times, READY.a1 .-> A5
  A1 & A2 -. E2E-M2A-15 fixme .-> A4
  A2 -. Alt+S E2E-M2A-14, dimmed rows fixme .-> A3
  A4 -. scaleKeyValues, Tween bar mount .-> A3
  A1 & A2 & A3 & A4 & A5 --> INT["Integration: E2E-M2A-23/24, budgets, docs"]
```

Solid edges are start dependencies; dotted edges are test or feature gates that turn on when the source merges.

| ID | Slug (`m2a/<slug>`) | Owner | Size | Starts after | Gated on (READY / `test.fixme` until merged) |
|---|---|---|---|---|---|
| A0 | `contracts-foundation` | Integration agent | 3.5 | — | — |
| A1 | `rig-ik` | Agent 1 | 6.5 | A0 | — |
| A2 | `ik-editor` | Agent 2 | 6 | A0 | A1: IK unit tests, E2E-M2A-01…07, 25 |
| A3 | `dopesheet-timing` | Agent 3 | 5.5 | A0 | A2: E2E-M2A-14 (`Alt+S` is `key.set {breakdown}`), the dimmed-row test (IK rule 2); A4: `valueFactor ≠ 1` (poll-fails until `scaleKeyValues` lands; turned on at integration, M2A-INT-17), Tween bar mount |
| A4 | `graph-posing` | Agent 4 | 5.5 | A0 | A1 + A2: E2E-M2A-15 (`ik.leg.*` controls on imported characters) |
| A5 | `platform-perf` | Agent 5 | 5 | A0 | A1: the keep set's influence key times (unit gate only; E2E-M2A-21 does not need them) |
| INT | `integration` | Integration agent | 3 | A1…A5 | — |

Total ≈ 35 agent-days (ROADMAP's 20–25 plus the three budget fixes, the attribute-channel foundation and the v0.2
review additions); critical path ≈ A0 (3.5) + A1 (6.5) + A2's IK tail after A1 merges (≈ 1) + INT (3) ≈ 14 working
days.

### 8.1 Shared files

A file in two packages' scope has one owner at a time: A0 first (it merges before anyone else starts), then the
listed owner. Another package that needs a change in such a file sends a contract PR to this table or asks the
owner. Every other path belongs to exactly one package's **Dirs** below.

| File(s) | A0 lands | Then owned by |
|---|---|---|
| `doc/src/snapshot/**`, `doc/src/migrations/**`, `doc/src/records.ts`, `doc/src/records/{factories,validate}.ts`, `doc/src/ids/**` | the whole schema change of §4.2 in one commit (`SCHEMA_VERSION` 2, `CORE_MIGRATIONS[0]`, `requiredWriterVersion`, fresh writers at 1), `AttrDef` fields and validation, `solverId` | A0 (closed after A0) |
| `doc/src/store/memory.ts` | `snapshot()` rule and initial `minWriterVersion` 1 (§4.2 items 2–3) | A4 (M-1 preview path; rebases on A0) |
| `editor-core/src/testing/**` (naive store and program), `editor-core/src/workflows/records.ts` | snapshot rule, `minWriterVersion` 1, attribute slots, cycle-aware option | A0 |
| `rig/src/types.ts`, `rig/src/compile/{compileRig,build}.ts`, `rig/src/kernel/**`, `rig/src/sampler/channels.ts` | schedule-independent attribute slots, `RigOpImpl` signature, `run` returning `false`, `ScheduledRigOp.state`, the §5.4 rule 1 compile order, attribute sampling and defaults, `SkeletonDesc.boneSupport` field | A1 |
| `rig/src/sampler/cache.ts` | — | A4 (M-1 mechanism 4; A1 does not edit it) |
| `editor-core/src/app/{kernel.ts,deps.ts}`, `editor-core/src/evaluation/**` | `scheduleBeforeFrame`/`flushScheduled`, attribute reads, `evaluation.ikFk`, the cycle-aware engine (§5.23) | A4 (M-1 mechanisms 4 and 6); `app/autosave.ts` is A5's |
| `editor-core/src/edit/gesture.ts` (new) | `beginKeyEditGesture` | A4 |
| `editor-core/src/edit/{channels.ts,channelMeta.ts,numeric.ts}` | coalesced `beginChannelEditGesture`, `channelUnit`, `channelDefaultOf`, unit-aware display helpers | A2 |
| `editor-core/src/edit/keys.ts` | `writeKeyAt(…, opts)`, loop-clip curve infinities (§5.23) | A3 |
| `editor-core/src/workflows/{targets.ts,bodyParts.ts,visibility.ts}` | baselines `keyTargetControls`, `bodyPartOf` (complete table), `controlVisibility` rule 1 | A2 |
| `editor-core/src/operators/builtin/select.ts` | `dopeSheet` in the key-panel set, `select.pickWalk` stub | A2 |
| `editor-core/src/operators/builtin/edit.ts` | `dopeSheet` in the key-panel set | A3 |
| `editor-core/src/operators/builtin/{time.ts,graph.ts}` | stubs (`key.toggleRipple`, `graph.keys.copyTo`, argument shapes) | A3 |
| `editor-core/src/operators/builtin/view.ts`, `{index.ts,menus.ts}`, `editor-core/src/keymap/**` | `view.tool` widening, registration, menus, §6 rows | A0 (closed after A0) |
| `curve-editor/src/view/transform.ts` | `channelDisplayScale(channel, unit?)` | A4 |
| `editor/src/gl/{frameLoop.ts,GLHost.tsx}` | `flushScheduled` as the frame loop's first step | A5 |
| `editor/src/services/browser.ts` | `createBrowserServices` options `storageNamespace`, `storageBlocked`, `pointerLock` | A5 |
| `editor/src/shell/{layout.ts,StatusLine.tsx,menuItems.ts,types.ts}` | layout v2 and the v1-key migration, key-target toggle, the Tween bar slot, menus, probe map | A5 (shell); A4 mounts the bar through the slot |
| `editor/src/panels/shared/TweenBar.tsx` (new) | stub component and `tween` probe key | A4 |
| `editor/src/panels/{index.ts,dopesheet/**}` | registration and placeholder | A3 (writes the `React.lazy` boundary; A5 verifies it) |
| `editor/src/test-api/**` | types, kernel-level functions, stubs | the probe owners fill their slices (A2, A3, A4, A5); A0 keeps `index.ts` |
| `viewport/src/manager/**` | — | A2, except the M-1 render skip (A4, mechanism 6; A2 rebases) |
| `io/src/skeleton/**` | — | A1 (`boneSupport`) |
| `packages/ui/css/tokens.css` | `--rig-pole-line` | A0 (closed after A0) |
| `apps/web/e2e/dev-shell.spec.ts`, `packages/editor/test/workspace.test.tsx` | the layout v2 literals (§3 rule 8) | unchanged owners (M1 tests) |

### A0 — Contracts, stubs, baselines, shared foundation and schema v2 (integration agent; first)

- **Dirs**: every §4 contract file (`doc/src/records.ts`, `rig/src/types.ts`, `io/src/types.ts`,
  `editor-core/src/types.ts`, `editor-core/src/operators/args.ts`, `curve-editor/src/types.ts`,
  `editor/src/test-api/types.ts`, `editor/src/shell/types.ts` probe map); every file of §8.1 in its A0 role;
  `editor-core/src/{app,keymap}/**` (except `app/autosave.ts`, A5); `editor-core/src/operators/builtin/` new stub files
  (`ik.ts`, `tween.ts`, `breakdown.ts`, `graphBuffer.ts`, `mirrorAnimation.ts`, `autosave.ts`); `editor/src/test-api/`;
  `package.json` files; `apps/web/scripts/check-size.mjs` (stub that reports only); `docs/wp-notes/m2a-a0.md`.
- **Responsibilities**: (1) all §4 types verbatim, stubs for every new symbol, `index.ts` exports; (2) the atomic schema
  change of §4.2 (version, identity migration, `requiredWriterVersion`, the snapshot rule in the memory and naive
  stores, fresh writers at 1, `AttrDef` validation, `solverId`); (3) attribute channels end to end in the compiler,
  kernel and sampler (§5.1 rules 1–3, schedule-independent slots, `run` returning `false`, `ScheduledRigOp.state`, the
  §5.4 rule 1 compile order), overrides, `evaluation.channelValue`/`attrValues`/`ikFk`, the test kit's naive program
  with attribute slots; (4) the **working baselines** that M1 paths or other packages call (§3 rule 1):
  `controlVisibility` rule 1, `bodyPartOf` (the complete §5.19 table), `keyTargetControls`, `channelUnit`,
  `channelDefaultOf`, unit-aware `to/fromDisplayValue`/`formatChannelValue`/`channelDisplayScale`/
  `channelDefaultValue`, `writeKeyAt` opts, `dopeSheet` in the key-panel sets of `select.ts` and `edit.ts`, `view.tool`
  widening, `readAttr`/`writeAttr` (complete: slot plumbing), and `registerBuiltinRigOps` (a working function that
  `createEditorApp` calls from A0 on; it registers nothing until A1 adds `solver:ik2`); (5)
  `scheduleBeforeFrame`/`flushScheduled` in the kernel and the frame loop (first step of `addEffect`),
  `beginKeyEditGesture`, coalesced `beginChannelEditGesture`; (6) §5.23 loop clips (the cycle-aware engine in `deps.ts`,
  loop-clip curve infinities in `edit/keys.ts`); (7) operator stubs registered from the new files (poll-fail "not
  available yet"), §6 keymap rows, §7 menu items, the status-line key-target toggle (wired to `key.setTarget`) and the
  Tween bar slot, layout v2 with the Dope Sheet tab and its v1-key migration, the probe map keys, the `--rig-pole-line`
  token; (8) the §4.8 test API: types, the kernel-level functions (`attrs`, `controlWorld`, `curveSlope`, `limbs`,
  `limbPivots` (null until A1), `autosave`, `flushAutosave`, the `state()`/`curves()` additions) and stubs for the panel
  slices; URL parameters `ns`, `storage` and `pointerLock` passed to `createBrowserServices`; (9) `io/write` subpath and
  `check:size` script entries.
- **Tests**: schema: an M1 snapshot migrates (identity) and reopens writable; `requiredWriterVersion` with enabled,
  disabled and soft-deleted `ik2` solvers; the snapshot rule (fresh document 1, enabled IK 2, IK removed → 1, loaded
  future value preserved); the conformance suite (memory + `doc-yjs`) unchanged and green; attribute slot order is
  independent of the ops (adding or removing an op renumbers no slot), defaults, sampling and overrides (rig unit);
  an op whose `run` returns `false` leaves every bone local bit-identical to the program without it; scheduler
  coalescing (editor-core: two updates in one frame → one preview update; Node: synchronous); unit-aware display
  (typing 30 on `@roll` stores π/6; `@soft` shows 3 decimals); baselines (`bodyPartOf` tables on Seed-san and
  Polybot, visibility rule 1, `controls()` works on M1 rigs); cycle-aware engine (C¹ seam within 1e-9 on a curve
  with cyclic infinities; curves with a constant infinity bit-identical to M1); layout v1 → v2 migration from the v1
  key, and the v1 key kept (editor browser test); keymap table includes every §6 row.
- **DoD**: `pnpm run ci` green with E2E-00…27 unchanged except the §3 rule 8 literals; each new operator resolves and
  poll-fails cleanly; the §4 blocks compile together; an M1 project opens writable and saves with `schemaVersion: 2`
  and `minWriterVersion: 1`.

### A1 — Rig IK (`packages/rig`, the io skeleton reader)

- **Dirs**: `packages/rig/**` (after A0; except `sampler/cache.ts`, §8.1); `packages/io/src/skeleton/**`
  (`boneSupport`); `packages/headless-tests/test/rig.ik.*.test.ts`; `docs/wp-notes/m2a-a1.md`. A1 does not edit
  `packages/doc` (the schema change is A0's).
- **Responsibilities**: §5.2 records (`limbIkRecords`, `autoRig` `ik` option, `AUTORIG_VERSION` '0.3.0' when IK is
  added); §5.2.3 foot parameters from the mesh support function (the io skeleton reader fills
  `SkeletonDesc.boneSupport`) with the fallback, and `validateFootParams` for `rig.setFootParams`; §5.3 `ik2` op with
  foot roll in the foot frame, follow and toes rules, rest-exact amendments in `solveTwoBoneIk`, `run` returning
  `false` at `ikFk` 0; §5.4 compiler rules and `RigProgram.limbs`; §5.6 matching functions with the match pole rule
  and `endErrorM`/`midErrorM`; §5.8 import to IK with the fidelity check and the per-limb FK fallback, Plant Feet IK
  solve, the influencing-curve definition in `computeStepSchedule` and `computeInfluenceKeyTimes`;
  `registerBuiltinRigOps`.
- **Public API** (`@ekza-animator/rig`, additions):

```ts
import type { Disposer, Frame, Mat4, SplineSet } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, ControlRecord, SolverRecord } from '@ekza-animator/doc';
import type { ChannelBuffer, ClipSampler, FootRollParams, LimbDesc, LimbId, PoseBuffers, RigDefinition, RigProgram,
  SkeletonDesc, TrackKey } from '@ekza-animator/rig';

export function registerBuiltinRigOps(): Disposer;                                    // registers 'solver:ik2'
export function limbIkRecords(def: RigDefinition, skeleton: SkeletonDesc, opts: { readonly limbs: readonly LimbId[];
  readonly ikFkDefault: 'by-limb' | 0 }): { readonly controls: readonly ControlRecord[]; readonly solvers: readonly SolverRecord[];
  readonly warnings: readonly string[] };
// autoRig(skeleton, ids, opts?: { …M1; readonly ik?: { readonly legs: boolean; readonly arms: boolean } }) — absent ik = M1 output
/** §5.2.3: checks a rig.setFootParams patch; returns the merged params or the reason it is refused. */
export function validateFootParams(current: FootRollParams, patch: Partial<FootRollParams>): FootRollParams | { readonly error: string };
/** The IK control's `custom` footprint shape for the given params (rewritten by rig.setFootParams). */
export function footprintShape(params: FootRollParams): SplineSet;
// readAttr / writeAttr / registerBuiltinRigOps: implemented by A0 (attribute slot plumbing, §8 A0 item 4)
export function readAttr(program: RigProgram, ch: ChannelBuffer, control: ControlId, name: string): number | undefined;
export function writeAttr(program: RigProgram, ch: ChannelBuffer, control: ControlId, name: string, value: number): void;
export function limbOfControl(program: RigProgram, control: ControlId): LimbDesc | null;
/** Copies `ch`, sets the limb's ikFk to `ikFk`, evaluates into `out` (side buffers for matching). */
export function evaluateWithLimbMode(program: RigProgram, ch: ChannelBuffer, limb: LimbId, ikFk: number, scratch: ChannelBuffer, out: PoseBuffers): void;
export function matchFkToIk(program: RigProgram, ikPose: PoseBuffers, limb: LimbId,
  reference: ReadonlyMap<ControlId, ChannelValues>): Map<ControlId, ChannelValues>;
/** §5.6 match pole rule; endErrorM / midErrorM: end and mid joint position errors of the IK result vs `fkPose`. */
export function matchIkToFk(program: RigProgram, fkPose: PoseBuffers, ch: ChannelBuffer, limb: LimbId,
  reference: ReadonlyMap<ControlId, ChannelValues>): { readonly values: Map<ControlId, ChannelValues>;
  readonly endErrorM: number; readonly midErrorM: number; readonly maxRotationErrorRad: number };
export function ikControlForEndWorld(program: RigProgram, pose: PoseBuffers, ch: ChannelBuffer, limb: LimbId, endWorld: Mat4,
  reference: ChannelValues): ChannelValues;
export function footPivotWorlds(program: RigProgram, pose: PoseBuffers, ch: ChannelBuffer, limb: LimbId):
  { readonly heel: Float64Array; readonly ball: Float64Array; readonly toe: Float64Array; readonly inner: Float64Array; readonly outer: Float64Array } | null;
/** Key times of every track's influencing curves (§5.8 definition) inside the range. */
export function computeInfluenceKeyTimes(program: RigProgram, sampler: ClipSampler, range: { readonly start: Frame; readonly end: Frame },
  target: 'raw' | 'humanoid'): ReadonlyMap<TrackKey, readonly Frame[]>;
```

- **Tests**: rest exactness 1e-7 on Seed-san and Polybot with four IK limbs (`headless-tests`); FR-RIG-11 (cog
  −0.05 m → foot world unchanged 1e-6); reach/soft monotonicity; pole plane (1e-6 rad) and twist; foot-roll gates of
  §5.3.1 (both feet, both bank signs, mirrored bank, the 15° toed-out synthetic rig); foot parameters from the mesh
  on Seed-san and Polybot (the heel pivot within 3 mm behind the rearmost foot vertex, the toe tip within 3 mm of the
  frontmost toes vertex) and the fallback without mesh data; follow rule (finger worlds relative to the hand
  unchanged 1e-6 under arm IK); toes rule; blend at `w = 0.5` lies between FK and IK per bone; `run` returns `false`
  at `ikFk` 0 and exports of an upgraded M1 rig are byte-identical; the §5.6 match gates (round trip 1e-6,
  hyperextension −2° and −5° on knees and −5° on an elbow, pole continuity on non-hinge poses); compile: no cycle for
  chain writes, schedule determinism under shuffled records, dangling refs disable with warnings; import to IK:
  `importHumanoidClip(bake)` with IK legs reproduces bone worlds ≤ 1e-5 rad / 1e-6 m at key times on Seed-san; a
  synthetic source with a −5° knee and `quaternius-ual.glb` `Walk_Loop` either stay IK within `ikTolerance` or fall
  back to FK per limb with the reported errors (`ImportedClipKeys.limbs`), and per frame the pole's direction
  from the mid joint turns by no more than the upper and lower bones do, + 0.05 rad (ratified M2A-A1-13: the v0.2
  gate "the pole moves ≤ 0.05·L per frame" cannot hold with the pole L in front of the knee on a 24 fps walk; UAL
  `Walk_Loop` moves it 0.16·L per frame, smoothly; the synthetic 30 fps unit walk keeps 0.05·L); Plant Feet on IK legs (US-25 numbers); the step schedule and influence key
  times include IK control, attribute and `cog` curves (a STEP key on `cog` is a leg-track discontinuity); M1 rig
  gates unchanged (they call `autoRig` without `ik`); bench with IK (report).
- **DoD**: all gates green; no allocation in `run` after `compile` (bench asserts zero growth with `--expose-gc` heap
  sampling or a counting allocator shim); notes recorded.

### A2 — IK editor integration, pick-walk, virtual slider, body parts

- **Dirs**: `packages/editor-core/src/edit/{channels.ts,channelMeta.ts,numeric.ts,virtualSlider.ts}` (after A0),
  `editor-core/src/operators/builtin/{ik.ts,key.ts,pose.ts,select.ts,rig.ts}`, `editor-core/src/workflows/
  {importModel.ts,importAnimation.ts,pose.ts,targets.ts,bodyParts.ts,ik.ts,visibility.ts}`; `packages/viewport/**`
  (except the M-1 render skip, §8.1); `packages/editor/src/panels/{channel-box,attributes,outliner,viewport}/**`;
  e2e `m2a-01…07`, `m2a-18`, `m2a-19`, `m2a-25`; `docs/wp-notes/m2a-a2.md`.
- **Responsibilities**: `controlVisibility` rules 2–5 on A0's baseline (§5.5), used by viewport, Outliner, targets
  and the test API; viewport pole lines, alpha, footprint and diamond shapes, hidden-control picking rules;
  `applyChannelEdits` and channel states for attributes, unit-aware everywhere it edits (§5.1 rule 5);
  `key.set` changes (attributes with the `keyAll` rule, body part, breakdown flag), `key.setTarget`,
  `pose.resetToRest` attribute rule; IK operators (§4.9) incl. `rig.setFootParams`, their warnings (§5.6) and their
  menus' poll reasons; import workflow passing `prefs.autoRigIk`, `ik: 'auto'` and the import result's limb
  warnings; Plant Feet IK path; the one-time "FK limbs only" toast (§5.7); `select.pickWalk` with the
  `prefs.arrowKeys` dispatch (§5.17); Channel Box attribute rows (no raw `@ikFk` row), IK/FK proxy row and switch
  button, virtual slider on rows and through viewport MMB with the Pointer Lock rules (§5.18); Attributes Limb
  section with the foot fields.
- **Public API**: the operators; no new package exports beyond §4 (the §4.5 functions it extends were landed by A0).
- **Tests**: headless operator tests (poll, apply, undo/redo exact) for every A2 operator incl. seamless switch keys,
  pose continuity, the hyperextension warning and `rig.setFootParams` (footprint rewritten, undo exact); `keyAll`
  rules (`S` on an IK foot keys five attributes and no `@ikFk`; with the proxy row's name selected `S` keys
  `@ikFk`; `pose.resetToRest` leaves `ikFk` and `soft`); pick-walk order and the `'frames'` dispatch; visibility rule
  with `ikFk` 0, 0.5, 1; browser tests: Channel Box attribute display units, proxy row writes the owner's curve,
  virtual slider rate and one history step on a row and through viewport MMB, `pointerlockchange` during a gesture
  cancels it, a rejected `requestPointerLock()` falls back to capture (mocked lock); viewport hidden controls are not
  pickable and not marquee-selected; M1 E2E-01…27 unchanged.
- **DoD**: E2E-M2A-01…07, 18, 19, 25 green (IK ones after A1 merges); M1 suite green.

### A3 — Dope Sheet, time-slider extras, ripple, breakdown retiming

- **Dirs**: `packages/curve-editor/src/{timeline,dopesheet}/**`; `packages/editor/src/panels/{timeline,dopesheet}/**`;
  `packages/editor-core/src/edit/keys.ts` (after A0); `editor-core/src/operators/builtin/{time.ts,graph.ts,edit.ts}`;
  e2e `m2a-08…12`, `m2a-14` (with A4's display), bench `m2a-a3.bench.ts`; `docs/wp-notes/m2a-a3.md`.
- **Responsibilities**: §5.9 (Mod+drag copy, ripple, MMB carry, insert/remove/delete time with the uniform-warp and
  no-silent-delete rules, nudge, breakdown ticks); §5.10 Dope Sheet controller, painter, rows, the aggregate hold
  rule, hit-testing, interactions (nudge, paste insert), panel with toolbar (mounting A4's Tween bar once it lands)
  and its `React.lazy` boundary, `dopeSheet.frame`, probes `dopeSheet` (null while hidden), `screenOfDopeKey`,
  `screenOfDopeRegion`, `timelineTicks`, `screenOfBand`; `key.toggleRipple` (in `time.ts`); §5.11 global-region
  ripple and §5.12 retiming inside `moveKeys`/`scaleKeys`; `copyKeys`, `insertTime` (`time.insertTime`,
  `time.deleteTime`); `graph.keys.move`/`scale`
  arguments (`ripple` and its panel default, value scale via A4's `scaleKeyValues` once merged — until then
  `valueFactor` ≠ 1 poll-fails; turned on at integration, M2A-INT-17); `graph.keys.paste` `'insert'`;
  `graph.keys.copyTo`.
- **Public API** (`@ekza-animator/curve-editor`, additions):

```ts
import type { Disposer, Frame } from '@ekza-animator/anim-core';
import type { ClipId, ControlId, CurveId } from '@ekza-animator/doc';
import type { EditorApp, ToolKeyEvent, ToolPointerEvent, ToolWheelEvent } from '@ekza-animator/editor-core';
import type { DopeSheetHit, DopeSheetRow, DopeSheetViewState } from '@ekza-animator/curve-editor';

export function buildDopeSheetRows(app: EditorApp, opts: { readonly clip: ClipId | null; readonly controls: readonly ControlId[];
  readonly expanded: ReadonlySet<string>; readonly show: 'selected' | 'character' }): DopeSheetRow[];
/** §5.10 aggregate hold rule over the given curves; intervals [t_i, t_{i+1}] in clip frames. */
export function holdIntervals(app: EditorApp, curves: readonly CurveId[], keyTimes: readonly Frame[]): readonly (readonly [Frame, Frame])[];
export class DopeSheetController {
  constructor(opts: { readonly app: EditorApp; readonly canvas: HTMLCanvasElement });
  readonly view: DopeSheetViewState;
  setView(view: DopeSheetViewState): void;
  rows(): readonly DopeSheetRow[];
  setExpanded(row: string, expanded: boolean): void;
  setShow(show: 'selected' | 'character'): void;
  frame(what: 'all' | 'selection'): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  hitTest(x: number, y: number): DopeSheetHit;
  glyphPoint(row: string, frame: Frame): { readonly x: number; readonly y: number } | null;
  regionPoint(part: 'start' | 'middle' | 'end'): { readonly x: number; readonly y: number } | null;
  pointerDown(e: ToolPointerEvent): void;
  pointerMove(e: ToolPointerEvent): void;
  pointerUp(e: ToolPointerEvent): void;
  wheel(e: ToolWheelEvent): void;
  key(e: ToolKeyEvent): boolean;
  redraw(force?: boolean): void;
  cancel(): void;
  readonly dragging: boolean;
  dispose(): void;
}
/** Registers the Dope Sheet tools and dopeSheet.frame (acting on the focused controller). */
export function registerDopeSheetContributions(app: EditorApp, focused: () => DopeSheetController | null): Disposer;
```

  The panel directory exports `registerDopeSheetPanel(registry: PanelRegistry): Disposer` (A0 placeholder; A3 makes
  its body `React.lazy`).
- **Tests**: browser: rows for Seed-san groups, glyph aggregation, hold bars (equal values with auto tangents; not
  with spline overshoot; the aggregate rule's cases: a sibling-keyed interval where a child interpolates through it
  (no hold), a child keyed at `t_i` only (no hold), a child with no key in the interval and a constant infinity
  (hold)), marquee and modifiers, move/scale/ripple through the kernel (one history step each), region handles, MMB
  move, nudge, paste insert, wheel per profile, painter smoke DPR 1/2; kernel: ripple with mixed per-curve bounds
  (`cog` keys at 0/4/10 and arm keys at 0/6, region 0…10 scaled by 2: every later key +10) and the global Δ < 0
  stop, retiming rules (fast-check: order preserved, values unchanged), `insertTime` (a breakdown before the insert
  point stays put; a key in the removed frame makes Remove Frame poll-fail; `removeKeys` deletes it), `copyKeys`
  collisions; time slider: Mod+drag copy, ripple band, MMB carry override step; redraw and drag benches (report).
- **DoD**: E2E-M2A-08…12 green, 14 green after A2 merges (`test.fixme('A2')` before); E2E-23 (M1) unchanged; Dope
  Sheet budgets recorded.

### A4 — Graph Editor features, tween, breakdown display, mirror animation, M-1

- **Dirs**: `packages/curve-editor/src/{graph,painters,hit,tools,channel-tree,view}/**`;
  `packages/editor/src/panels/{graph,shared}/**` (`shared/TweenBar.tsx`); `editor-core/src/operators/builtin/
  {tween.ts,breakdown.ts,graphBuffer.ts,mirrorAnimation.ts}`, `editor-core/src/edit/{tween.ts,valueScale.ts,
  gesture.ts}`, `editor-core/src/workflows/mirrorAnimation.ts`; for M-1 (after A0, §8.1): `packages/doc/src/
  {store,queries}/**`, `rig/src/sampler/cache.ts`, `editor-core/src/{app/kernel.ts,app/deps.ts,evaluation/**}`, the
  render skip in `viewport/src/manager/**`; e2e `m2a-13`, `m2a-15…17`; bench `m2a-a4.bench.ts`;
  `docs/wp-notes/m2a-a4.md`.
- **Responsibilities**: §5.13 tween math (`tweenEdits`: runs of selected keys, the time-weighted `pushPull`,
  `keyAll` exclusion), gesture, the shared Tween bar (status line, Graph Editor, Dope Sheet; target label and
  toggle, presets, `tween` probe), `key.tween`, `key.convert`, breakdown glyphs in the Graph Editor (◇,
  `--key-breakdown`); §5.14 `pose.mirrorAnimation` (working-copy half-cycle procedure, side-C scope rule,
  non-aligned skip) and its menu items; §5.15 buffers, view modes, scale tool and region, `scaleKeyValues`, probes
  `graph().viewMode/buffers`, `screenOfRegionHandle`, `screenOfTween`, `tweenTarget`; §5.21.1 M-1 (the frame profile
  first; Graph Editor on `beginKeyEditGesture`; store preview and query engine fast paths; scoped recompile and
  re-evaluation; cached static-curve layer; viewport render skip).
- **Public API** (`GraphEditorController` additions; the tween probe moved to the shared bar):

```ts
  setViewMode(mode: GraphViewMode): void;
  readonly viewMode: GraphViewMode;
  regionHandlePoint(handle: RegionHandle): { readonly x: number; readonly y: number } | null;
```

  `packages/editor/src/panels/shared/TweenBar.tsx` exports `TweenBar({ panel }: { panel: 'graph' | 'dopeSheet' |
  'status' })`, which registers the `tween` probe slice for its panel (`screenOfTween`, `tweenTarget`) while mounted.
- **Tests**: tween formulas (unit, every mode, overshoot bounds, skipped channels; runs: a block of three selected
  keys tweens toward the unselected keys around it, an isolated key equals the per-key result; `pushPull` at
  `r ≠ 0.5` relaxes toward the in-between line); gesture = one step, Esc cancels; target resolution and the toggle;
  mirror animation channel rule, the half-cycle cases of §5.14 (incl. keys 0/9/15/24 with auto tangents and no key
  at 12: exact at every integer frame 1e-9, no seam pop), the closing key, `flip` involution (`flip(flip) = id`),
  side-C-only scope, secondary controls skipped with a warning; buffer swap twice = identity; normalized/stacked
  mapping round trip (display → data → display 1e-12), edits in normalized mode change only the dragged curve by the
  converted delta; region scale numbers; conformance suite (memory + `doc-yjs`) green after the store changes; doc
  bench preview update ≤ 1.0 ms; bench `Graph Editor drag` (report) with the frame split.
- **DoD**: E2E-M2A-13, 16, 17 green, 15 green after A1 and A2 merge (`test.fixme('A1,A2')` before); M-1 gate
  (p95 ≤ 4.0 ms) met and recorded with the frame profile; E2E-08…13 (M1) unchanged.

### A5 — Platform: bundle (M-2), anim-core (M-3), autosave, export reduction

- **Dirs**: `packages/anim-core/src/curve/**`; `packages/io/src/{bake,writers,surgeon,validate,write.ts,index.ts}`;
  `editor-core/src/workflows/{export.ts,project.ts,autosave.ts}`, `editor-core/src/operators/builtin/{file.ts,
  autosave.ts}`, `editor-core/src/app/autosave.ts`; `packages/editor/src/{shell,dialogs,services,gl}/**` and
  `Editor.tsx` (after A0; §8.1); `apps/web/{scripts,app}/**`; bench `e2e/bench/budgets.bench.ts`; e2e `m2a-20…22`;
  `docs/wp-notes/m2a-platform-perf.md`.
- **Responsibilities**: §5.21.2 chunk attribution first, then lazy boundaries, intent prefetch and the `check:size`
  gate measuring the bench's script set; §5.21.3 anim-core fast paths; §5.20 autosave store (IndexedDB, Web
  Locks/heartbeat), scheduler, recovery dialog, `file.recover`, `file.discardRecovery`, `file.autosaveNow`,
  storage-blocked behaviour; the browser services honour the storage namespace and the blocked-storage switch that
  A0 parses from the URL; §5.16 reduction (`reduceBakedClip`, `ExportRequest.reduce`, Export dialog checkbox, stats,
  read-back against the reduced clip; influence key times behind `READY.a1`); re-measure the full §14 table with the
  bench.
- **Public API** (`@ekza-animator/io` and `/write`, additions):

```ts
import type { BakedClip, ExportReduceSpec, ReductionStats } from '@ekza-animator/io';
import type { Frame } from '@ekza-animator/anim-core';
import type { SkeletonDesc, TrackKey } from '@ekza-animator/rig';
export const DEFAULT_EXPORT_REDUCE: ExportReduceSpec;
export function reduceBakedClip(clip: BakedClip, opts: { readonly spec: ExportReduceSpec; readonly height: number;
  readonly leverArm: ReadonlyMap<number, number>; readonly keep: ReadonlyMap<TrackKey, readonly Frame[]> }): { readonly clip: BakedClip; readonly stats: ReductionStats };
/** L_j of R02 §6.4 per SkeletonDesc node (raw) or HUMAN_BONE_NAMES index (humanoid). */
export function trackLeverArms(skeleton: SkeletonDesc, target: 'raw' | 'humanoid'): ReadonlyMap<number, number>;
```

  Browser services: `createBrowserServices` returns `autosave` (IndexedDB) or `null` when storage is unavailable.
- **Tests**: anim-core goldens and property tests unchanged, bench recorded; reduction: tolerance bound at every
  sample, keep set honoured, determinism (byte-identical re-export), STEP and constant tracks untouched; export
  workflow with and without `reduce` (without = M1 bytes); autosave scheduler (fake timers: debounce, max interval,
  deferred during a preview, serialized writes), the IndexedDB store against the real browser IndexedDB in a
  namespaced database (browser mode; no new dependency), orphan detection with and without Web Locks, quota error
  path; recovery dialog component; size gate script on a fixture manifest, and the one-time cross-check of
  `check:size` against the bench's network capture (within 1 %).
- **DoD**: E2E-M2A-20…22 green; `check:size` within the §5.21.2 target and wired into CI; M-3 target met or the idle
  re-measurement recorded as Met; `budgets.bench.ts` updated and ROADMAP budget table re-recorded.

### Integration (after A1…A5)

Merge in the order of §10.1; turn every `READY`/`test.fixme` gate into a failure; write and stabilize the acceptance
scenarios E2E-M2A-23 and -24 (`apps/web/e2e/m2a-23-24-acceptance.spec.ts`); re-run the full budget bench; update
README (feature table, "What M2a is for" with the known gaps of §1.4, GIFs of IK walk, Dope Sheet retime and tween
recorded from the e2e build), ROADMAP status and budgets, REQUIREMENTS milestone columns, DECISIONS-OPEN §F; owner
demo script (§10.3).

---

## 9. Acceptance tests and e2e scenarios

Playwright setup and rules: MVP-SPEC §6.1 (real input at test-API coordinates, assertions through the test API,
independent scenarios, `chrome` and `chromium-swiftshader` projects). New scenarios start with `?e2e=1`. "Seed X"
means the M1 `seed.ts` helpers (`loadSample`). Angles in steps are degrees; tolerances are radians or metres.

### 9.1 Scenarios

| ID | Name | Steps | Assertions |
|---|---|---|---|
| E2E-M2A-01 | Leg IK holds the feet (FR-RIG-11) | seed Polybot; record `boneWorld(polybot, leftFoot)` and `leftLowerLeg`; select `cog` (Outliner row); `cb-field-ty` type `-0.05`, Enter; then click `screenOfControl(ik.leg.L, 'pane-right')`, `W`, drag `screenOfManipulator('pane-right', 'ty')` 40 px up | `limbs()`: leg.L/R `ikFk` 1, arm.L/R 0; `controls()`: `fk.upperLeg.L` not visible, `ik.leg.L` and `pole.leg.L` visible, `ik.arm.L` not visible; after the cog edit: left foot world t and q unchanged (1e-6), hips y −0.05 (1e-9), knee z increased by > 1e-3 (bends forward); after the drag: foot y increased, foot rotation unchanged (1e-6); `Mod+Z` twice restores the rest worlds (1e-7, §5.3 rest exactness) |
| E2E-M2A-02 | Pole, twist, soft | seed Polybot; select `pole.leg.L`; `cb-field-tx` `+=0.3`; select `ik.leg.L`; `cb-field-@twist` `30`; then `cb-field-@soft` `0.1` and move `ik.leg.L` ty down in 20 steps of 0.01·L via `channel.setValues` | pole: the knee's offset from the hip→foot line turns about that line by the pole's turn (1e-6 rad), the knee moves by > 5e-3 m, foot world unchanged (1e-6); twist: knee offset ⊥ hip→foot rotates by 30° (1e-6 rad) about that axis; soft: hip→foot distance never decreases across the steps and stays < l1 + l2; the foot misses the target inside the soft zone |
| E2E-M2A-03 | Seamless IK→FK switch | seed Seed-san; key `ik.leg.L` at 0 (rest) and at 10 (tx 0.1, ty 0.05, tz 0.15, rx 20) with `channel.setValues` + `key.set` (default `'all'`, which skips `@ikFk`, §5.1 rule 4); record chain bone worlds at 9 and 10; frame 10; select `ik.leg.L`; Attributes `attr-limb-key-mode` = seamless; click `attr-limb-mode-fk-leg.L`; then frame 15, `attr-limb-mode-ik-leg.L` with key mode `key` | before the switch `ik.leg.L` has no `@ikFk` keys; at 9 and 10: upper/lower leg, foot and toes worlds equal the recorded ones (1e-6); after the first switch the `@ikFk` keys are exactly {t 9, v 1, out step}, {t 10, v 0, out step}; after the second exactly those plus {t 15, v 1, out step}; at 10 `fk.upperLeg.L` visible and `ik.leg.L` not; at 9 the reverse; switching back at 15 keeps the pose (1e-6); one `Mod+Z` per switch restores the curves (deep-equal) |
| E2E-M2A-04 | Foot roll | seed Seed-san; select `ik.leg.L`; `cb-field-@roll` `20`, then `-15`, then `50`; then `cb-field-@roll` `0`, `cb-field-@bank` `10`, then `-10`; select `ik.leg.R`; `cb-field-@bank` `10`; `Mod+Z`; select `ik.leg.L`; `cb-field-@bank` `10`, `cb-field-@roll` `20`; `pose.mirror {mode: 'leftToRight'}` | `limbPivots(seed-san, leg.L)` and bone worlds: roll 20 → toes world and ball pivot unchanged vs roll 0 (1e-6), foot rotated by 20° (1e-6 rad); roll −15 → heel pivot unchanged; roll 50 → toe pivot unchanged and the toes turned by 20° vs roll 0 (1e-6 rad); left bank 10 → inner pivot unchanged (1e-6), outer pivot y increased; left bank −10 → outer pivot unchanged, inner pivot y increased; right bank 10 → right inner pivot unchanged (1e-6), right outer pivot y increased, no right pivot below its rest height (−1e-6); after the mirror the right pivots equal the left ones mirrored (x negated; 1e-3 m, rest asymmetry) |
| E2E-M2A-05 | Arm IK with fingers | seed Seed-san; `fk.lowerArm.L` ry −30° (`channel.setValues`); select `fk.hand.L`; `attr-limb-mode-ik-arm.L` (match); record hand and `leftIndexProximal` worlds; select `cog`; `cb-field-ty` `-0.05` | the switch kept the hand and finger worlds (1e-6); after the cog edit the hand world is unchanged (1e-6) and `controlWorld(fk.indexProximal.L)` relative to the hand bone is unchanged (1e-6); `ik.arm.L` visible, `fk.upperArm.L` hidden |
| E2E-M2A-06 | Import writes IK | seed Seed-san; `clip.new {name: 'steps'}` (active); `rig.ikFk.switch {to: 'fk', key: 'none'}` for `leg.L` and `leg.R` (static `ikFk` 0 in this clip); key `fk.upperLeg.L` rx 30/−20/30 at 0/10/20 and `fk.lowerLeg.L` rx 0/40/0; key `fk.upperLeg.R` rx 10 and `fk.lowerLeg.R` rx −5 at 0 (a 5° hyperextended right knee); `file.export {kind: 'vrma', clips: [steps]}`; load Polybot; `loadFile('steps.vrma', bytes, {auto: true, importOptions: {reduce: null}})` onto it (no import reduction, so both characters sample the same data); `prefs.set {patch: {autoRigIk: {legs: false, arms: false}}}`; load Polybot again (`Polybot 2`, an FK-only rig) and import the same VRMA with `importOptions: {reduce: null}` | Polybot: `ik.leg.L` has t and r curves with keys, `pole.leg.L` t curves, `fk.upperLeg.L`/`fk.lowerLeg.L`/`fk.foot.L` none; the right leg stayed FK (the knee cannot be matched in IK): FK curves on `fk.upperLeg.R`/`fk.lowerLeg.R`, one `ik.leg.R` `@ikFk` key with value 0, and the import toast names "R Leg kept FK"; Polybot 2: FK leg curves only; hips-relative foot and knee positions of the two characters agree at frames 0, 5, 10, 15, 20 (1e-4 m) and foot rotations (1e-3 rad), on both legs; no right-leg bone of Polybot is twisted (its world rotations equal Polybot 2's within 1e-3 rad) |
| E2E-M2A-07 | Export bakes IK | seed Seed-san; new clip `crouch`; key `cog` ty 0/−0.1/0 at 0/10/20 and `ik.leg.L` tx 0/0.05/0; `file.export {kind: 'animation-glb'}` and `{kind: 'vrma'}` | 0 validator errors; re-read raw locals of the leg bones at frame 10 match the editor's `boneWorld`-derived locals (1e-4 rad, E2E-18 method); `/e2e/vrma-check` normalized rotations vs the editor (1e-3 rad, E2E-17 method) |
| E2E-M2A-08 | Time-slider copy and ripple | seed Polybot; key `fk.upperArm.L`, `fk.lowerArm.L`, `fk.hand.L` rz at 0/10/20 (0/30/60); select the three; Shift+click `screenOfTick(10)`; Mod+drag the band to `screenOfFrame(14)`; `Mod+Z`; RMB → `timeline-menu-ripple`; Shift+click tick 10; drag the band to 12; `Mod+Z`; key `fk.shoulder.L` rz 0/10/0 at 0/6/16 (its last key inside the coming band is at 6); select the four controls; Shift-drag 0…10; drag `screenOfBand('end')` to `screenOfFrame(15)`; `Mod+Z` | copy: keys at 10 unchanged plus keys at 14 with the values of 10, one `Mod+Z` restores (deep-equal); ripple move: 10 → 12 and 20 → 22, 0 unchanged, one undo restores; ripple scale (one global region, §5.11): 0 stays, 10 → 15, 20 → 25, and `fk.shoulder.L` 6 → 9 and 16 → 21 (every later key shifts by the same +5, not +3); one undo restores (deep-equal) |
| E2E-M2A-09 | MMB carry (FR-TIME-10) | seed Polybot; key `fk.lowerArm.L` rz 30 at 0 and −30 at 20; frame 0; MMB-drag on the slider from `screenOfFrame(0)` to `screenOfFrame(10)`; press `S` (viewport hovered); `time.setFrame 11`, then 10 | after the drag: `clipFrame` 10, `channelValues(fk.lowerArm.L).rz` = 30° (1e-9), `overrides(fk.lowerArm.L)` non-empty; after `S`: a key at 10 with 30°; after the frame changes: no overrides and the value at 10 is 30° |
| E2E-M2A-10 | Dope Sheet basics | seed Polybot with E2E-M2A-08's first keys (the three arm controls); select the three controls; `workspace.showPanel {panel: 'dopeSheet'}`; click `screenOfDopeKey('summary', 10)`; drag it to frame 13; `Mod+Z`; `Mod+A` over the Dope Sheet; drag `screenOfDopeRegion('end')` from 20 to 40; select `fk.hand.L` only, frame 50, `S` (same values as at 40); select the three controls again | rows: summary, character, group `Arm L`, three control rows; summary keys [0, 10, 20]; the click selects the 9 keys at 10 (`state().selection.keys`); the drag moves them to 13, undo restores; the region scale gives times 0, 20, 40; after the hold key, `rows[fk.hand.L].holds` contains [40, 50] and the summary row's holds do not (`fk.upperArm.L` and `fk.lowerArm.L` are keyed at 40 but not at 50: §5.10 aggregate rule 2) |
| E2E-M2A-11 | Dope Sheet ripple (FR-DS-02) | as E2E-M2A-10 setup plus `fk.shoulder.L` rz 0/10/0 at 0/6/16; select the four controls; `workspace.showPanel {panel: 'dopeSheet'}`; click `ds-ripple`; click summary glyph at 10; drag to 15; `Mod+Z`; click the summary glyph at 0, Shift+click the summary glyphs at 6 and 10; drag `screenOfDopeRegion('end')` from 10 to 20; `Mod+Z` | move: keys at 10 → 15 and 20 → 25 on the three arm controls and `fk.shoulder.L` 16 → 21 (same Δ; its 6 stays); keys at 0 unchanged; scale ×2 around 0: 10 → 20, 20 → 30, `fk.shoulder.L` 6 → 12 and 16 → 26 (every later key +10); each undo restores (deep-equal) |
| E2E-M2A-12 | Shared selection DS ↔ GE (FR-DS-01) | as E2E-M2A-10 setup; `workspace.showPanel {panel: 'dopeSheet'}`; click summary glyph at 20 in the Dope Sheet; `workspace.showPanel {panel: 'graph'}` (the tab switch hides the Dope Sheet); hover the Graph Editor; `Delete`; `workspace.showPanel {panel: 'dopeSheet'}` | after the click `state().selection.keys` holds the 9 keys at 20; after the tab switch `dopeSheet()` is null, `graph()` is visible and `screenOfKey` returns a point inside the Graph Editor canvas for each of the 9 selected keys (drawn selected there); after Delete and the switch back the Dope Sheet summary keys are [0, 10] |
| E2E-M2A-13 | Tween slider (FR-KEY-09) | seed Polybot; key `fk.lowerArm.L` rz 0 at 0 and 60 at 20 (linear tangents); select it; frame 10; drag the Graph Editor tween thumb from `screenOfTween('graph', 0)` to `screenOfTween('graph', 50)`; `Mod+Z`; then from fresh setups at frame 10: `key.tween` tween 125 (overshoot on); neighbor −50; ease −50; toDefault 50; and pushPull 100 after a tween 50 | drag: a key at 10 with 45° (1e-9), `breakdown: true`, one history step (undo removes it and the pose returns to 30°); tween 125 → 67.5°; neighbor −50 → 15°; ease −50 → 60·0.5^2.5° (1e-9); toDefault 50 → 15°; pushPull 100 on 45° → 60° |
| E2E-M2A-14 | Breakdowns retime (FR-KEY-08) | seed Polybot; key rz 0 at 0, 60 at 20; frame 10, `Alt+S` over the viewport (breakdown with the current value); select the key at 20 in the Graph Editor and drag it to frame 30 | `timelineTicks()` frame 10 `breakdown: true`; after the drag the rz curve's breakdown is at 15 with its value unchanged (the rx/ry breakdowns stay at 10: their anchors did not move); in a fresh setup a breakdown at 7 between keys at 0 and 20, with 20 dragged to 30, lands at 11 (10.5 rounded half up); after `key.convert {to: 'key'}` the key no longer moves with its neighbours |
| E2E-M2A-15 | Mirror animation, half cycle (FR-POSE-05) | seed Seed-san; `clip.setSettings {range: 0…24, loop: true}`; key `ik.leg.L` tz 0.1/0/−0.1/0/0.1 and tx 0.02/0/−0.02/0/0.02 at 0/6/12/18/24 (linear); menu Pose › Mirror Animation › Left → Right (half cycle) | `ik.leg.R` tz keys {12: 0.1, 18: 0, 0: −0.1, 6: 0, 24: −0.1}, tx negated; `channelValues(ik.leg.R, (t + 12) mod 24)` equals the mirror of `ik.leg.L` at t (1e-9) for t = 0…23; right foot world at t + 12 = mirror of the left foot at t (1e-3 m, rest asymmetry) |
| E2E-M2A-16 | Buffer curves and views (FR-GE-18, -19) | `seedWaveClip` (Polybot); `ge-buffer-snapshot`; `ge-field-value` `-45` on key@15; `ge-buffer-swap`; `ge-buffer-swap`; `ge-view-normalized`; `ge-view-stacked`; `ge-view-absolute` | after the edit `graph().buffers` has the rz curve; first swap: curve deep-equals the snapshot (values and tangents); second swap: the edited curve; view switches leave `curves()` deep-equal; in stacked mode `screenOfKey` of every key lies inside the canvas |
| E2E-M2A-17 | Scale tool and region (FR-GE-20) | `seedWaveClip`; double-click the curve (all keys); `R`; drag `screenOfRegionHandle('right')` to the x of frame 60; then drag `screenOfRegionHandle('top')` down by half the box height | first drag: times 0, 30, 60 with values unchanged (one step); second drag: times unchanged, values `v' = v_bottom + (v − v_bottom)·f` with `f` from the delivered pointer coordinates (Chrome delivers float32; `f` = 0.5 to ~1e-7): every value equals the formula at 1e-9, −30° stays (1e-9), 30° becomes 0° to the float32 pointer precision (1e-5; ratified M2A-A4-10), one step |
| E2E-M2A-18 | Pick-walk and body-part keying (FR-OUT-05, FR-KEY-10) | seed Seed-san; select `fk.lowerArm.L`; `ArrowUp`, `ArrowDown`, `ArrowRight`; select `fk.hand.L`; click `status-keytarget-bodyPart`; `S` | ↑ → `fk.upperArm.L`; ↓ → `fk.lowerArm.L`; → with no sibling → `fk.lowerArm.R`; `S` keys exactly `fk.shoulder.L`, `fk.upperArm.L`, `fk.lowerArm.L`, `fk.hand.L`, `ik.arm.L`, `pole.arm.L` (curves with a key at the frame) and no finger or other control |
| E2E-M2A-19 | Virtual slider (FR-CB-05) | `/editor?e2e=1&pointerLock=off`; seed Polybot; select `fk.lowerArm.L`; MMB-drag on `cb-name-rz` 40 px right; `Mod+Z`; Shift+MMB-drag 40 px; `Mod+Z`; click `cb-name-rz` (selects the channel); MMB-drag 40 px right in `pane-right`, starting 80 px left of `screenOfControl(fk.lowerArm.L, 'pane-right')` (away from every manipulator handle) | rz = +20° (1e-9) after the drag; one history step; with Shift +2°; the viewport MMB drag gives +20° (1e-9) in one history step and changes no other channel |
| E2E-M2A-20 | Autosave and recovery (FR-PROJ-05) | `/editor?e2e=1&ns=r1`; `seedWaveClip`; `flushAutosave()`; `page.reload()` (same URL); click `recovery-recover-<slot>`; then `/editor?e2e=1&ns=r2&storage=blocked` | after reload `recovery-dialog` lists one slot; after Recover: `counts()` and `curves()` deep-equal the pre-reload ones, `state().dialog` null, dirty; blocked storage: no dialog, one info toast, `autosave().enabled` false, seeding still works |
| E2E-M2A-21 | Export key reduction (FR-EXP-12) | seed Seed-san; clip `wave` (E2E-16 keys); Export dialog: VRMA, `export-reduce` checked; confirm; then the same export unchecked | 0 validator errors for both; reduced file total samples ≤ the unreduced (§5.16 gate, M2A-A5-3; ≥ 3× on linear blocking: E2E-M2A-21b); sampling both files' tracks in Node at every integer frame differs by ≤ the per-node tolerances (§5.16) |
| E2E-M2A-22 | Lazy loading | fresh production-like e2e page: record script responses until `ready` and the empty state; then click `sample-polybot` | no `three-vrm`/GLTFLoader chunk before the click; the sample loads and `controls()` is non-empty; (size gate runs separately in CI) |
| E2E-M2A-23 | **Acceptance: walk cycle with leg IK** | seed Polybot; `clip.new {name: 'walk'}`; `clip.setSettings {range: 0…24, loop: true, slot: 'walk', rootMotion: 'in-place'}`; select `ik.leg.L` by clicking it in the viewport; with Channel Box typing and `S` key it at 0 (tz 0.15, ty 0), 12 (tz −0.15, ty 0), 18 (tz 0, ty 0.06), 24 (tz 0.15, ty 0); Shift-drag a time-slider band over 0…12 and press `4` (linear tangents on the keys at 0 and 12); select `cog` (Outliner row) and key ty −0.05/−0.02/−0.05/−0.02/−0.05 and tx 0/0.02/0/−0.02/0 at 0/6/12/18/24 (Channel Box typing and `S`); select `ik.leg.L` (Outliner row); Pose › Mirror Animation › Left → Right (half cycle); select `cog`; in the Dope Sheet (`workspace.showPanel {panel: 'dopeSheet'}`) Shift-select the `cog` row glyphs at 6 and 18 and drag them to 5 and 17; click an empty area of the Dope Sheet canvas (clears the key selection); select `ik.leg.L`, click `cb-name-ty`; frame 21; status-line Tween bar: check `tweenTarget('status')` and drag `screenOfTween('status', 0)` to `screenOfTween('status', 50)`; export VRMA with `export-reduce` checked | left foot during 0…12 and right foot during 12…24: world x and y vary ≤ 1e-6 m and z changes linearly (second differences ≤ 1e-6 m) — the planted foot slides only with the treadmill; the `ik.leg.R` keys are the half-cycle mirror (E2E-M2A-15 rule) and `ik.leg.L`'s curves are unchanged by the mirror; the tween target reads "Pose @ f21" before the drag; `ik.leg.L` ty at 21 = 0.015 (breakdown) and no other curve gained a key at 21; `curves()` of every new curve has `pre` and `post` `cycle` (§5.23) and `curveSlope(cog tx, 24, 'left')` = `curveSlope(cog tx, 0, 'right')` (1e-9, C¹ at the seam); pose at 24 equals pose at 0 (1e-6); the history labels contain no `Plant Feet` (an undo walk back to the clip setup, then redo); the VRMA has 0 validator errors, no more samples than an unreduced export and stays within its §5.16 per-node tolerances |
| E2E-M2A-24 | **Acceptance: attack clip with planted feet** | seed Seed-san; `clip.new {name: 'attack'}`; `clip.setSettings {range: 0…20, slot: 'attack', contact: 12}`; key `ik.leg.L` at 0 with tz 0.2 and `ik.leg.R` at 0 with tz −0.1 (Channel Box typing, `S`); key `cog` at 0 (ready stance: ty −0.05), 12 (ty −0.08, tz 0.12, ry 25) and 20 (ready stance); key `fk.upperArm.R` and `fk.lowerArm.R` rotations at 0/8/12/20 (windup at 8, strike at 12); in the Dope Sheet drag the arm keys at 8 to 9; export VRMA and bake into the model | both foot bone worlds identical at every integer frame 0…20 (1e-6) while the hips move; `contactSeconds` = 12/30 in `ekza_animation_v1`; VRMA 0 validator errors, bake no new validator errors; the history labels contain no `Plant Feet` |
| E2E-M2A-25 | Upgrade an M1 rig | `prefs.set {patch: {autoRigIk: {legs: false, arms: false}}}`; seed Polybot; key `fk.upperLeg.L` rx 0/30 at 0/10; record leg worlds at 0, 5, 10; `prefs.set` back to defaults; click `attr-add-limb-ik` (select `fk.upperLeg.L` first); `Mod+Z`; `Shift+Z` | before: `limbs()` empty and a "FK limbs only" toast once; after Add: four limbs with `ikFk` 0, worlds at 0/5/10 unchanged (1e-9), FK controls visible; undo removes the limbs (`counts().controls` and `solvers` back), redo restores |

E2E-M2A-23, -24 (amended at integration, 2026-10-18, fixture geometry; M2A-INT-1…3): Polybot's legs are 0.32 m long
and nearly straight at rest, so with the hips at rest an IK foot 0.15 m forward or back is 3 cm out of reach and
lifts off its target; v0.2's `cog` ty 0 at the contacts (and the dip at the passing poses) could not plant the feet,
so the hips are lowest at the contacts and higher at the passing poses (a walk's usual down/up). Seed-san's legs are
straight at rest, so the attack's front foot 0.2 m forward is out of reach with the hips at rest: the clip starts and
ends in a ready stance 5 cm lower. A smooth 30 fps walk keeps its samples at R02's tolerances, so the reduced VRMA
cannot have fewer samples (§5.16 gate, M2A-A5-3); it is asserted never larger (samples and bytes) and within the
tolerances. With root motion `in-place` the walk does not travel, so the file's hips follow the editor's at every
frame (fix round 1, M2A-INT-21).

E2E-M2A-02, -05 (amended with A2, 2026-10-18, fixture geometry; A2 notes M2A-A2-12, -13; ratified at integration): Polybot's rest knee sits
3.7 cm outward of its hip→foot line, so a pole moved +x turns that offset backwards and the knee's world x can drop;
the pole step asserts the turn instead. Seed-san's arms are straight in the rest T-pose, so the IK hand would be 3 mm
out of reach after the cog edit; the elbow is bent first.

E2E-M2A-17: the top-edge drag scales values about the bottom edge with `factor = (y_bottom − y_release)/(y_bottom −
y_top)` in display units; the spec computes the expected values from the pre-drag keys. E2E-M2A-23: the contact span
is linear because both keys at 0 and 12 have linear tangents (MVP-SPEC §4.11.4); the half-cycle mirror freezes the
handles of the keys it lands at 0, 12 and 24 with those linear slopes (§5.14), so the right foot's contact span
12…24 is linear too. The mirror step selects `ik.leg.L` first because a mirror with only `cog` selected would act on
the whole character by the side-C rule of §5.14, which is also correct but not what this step tests. E2E-M2A-15 and
the IK scenarios used `test.fixme('A1,A2')` until those packages merged (§8); since integration every gate is a
failure and the only `test.fixme` tests are the stretch items of `stretch.spec.ts`.

### 9.2 Unit and headless gates (additions)

| Package | Gate |
|---|---|
| doc (A0; A4 for the store) | `AttrDef` validation; `solverId` determinism; `requiredWriterVersion`; the snapshot rule (§4.2: fresh 1, enabled IK 2, IK removed 1, future value kept); migration 1 → 2 idempotent; an M1 snapshot opens writable; an IK project opens read-only under a simulated `SCHEMA_VERSION` 1 (M1 reader test double); conformance suite (memory + `doc-yjs`) unchanged and green after A0's change and after the M-1 store changes; preview-update bench (report) |
| rig | §8 A1 tests; M1 rig gates unchanged |
| io | §8 A5 reduction tests; writers unchanged without `reduce` (byte-identical to M1 outputs on the three fixtures) |
| editor-core | every new or changed operator: poll, prepare/apply, undo, redo exact (Node, fixtures); scheduler; key gesture; unit-aware display and defaults (`channelUnit`, `channelDefaultOf`); the `keyAll` rules; the cycle-aware engine (§5.23); ripple/retime/tween/mirror kernels with fast-check properties (order preserved, values unchanged by retiming, `mirror ∘ mirror = id`, ripple shifts every later key of the scope by one amount); autosave scheduler |
| curve-editor, editor, viewport | browser tests listed per package in §8 |
| apps/web | E2E-00…27 unchanged; E2E-M2A-01…25; the M1 acceptance-round specs |

---

## 10. Integration plan and M2a definition of done

### 10.1 Merge order

Every gate of §8's table is a `READY` flag or a `test.fixme` naming the package, so any order keeps `dev` green; the
preferred order lands shared hot paths early and turns gates on as soon as possible:

1. A0 → `dev`. **Contract checkpoint**: §4 compiles; every M1 gate green; M1 projects open writable under schema 2.
2. A4 (Graph Editor, store and frame perf) and A5 (platform) as they finish — they change shared hot paths
   (`memory.ts`, the curve cache, the kernel, lazy loading), so later packages rebase on them. A4 merges with
   E2E-M2A-15 as `test.fixme('A1,A2')`; A5 with the keep set's influence term behind `READY.a1`.
3. A1 (rig IK). **Operator freeze for IK**: `rig.*` argument shapes change only by a contract PR after this point.
   A5's `READY.a1` gate turns on.
4. A2 (IK editor) — its IK tests and E2E-M2A-01…07, 25 turn on; E2E-M2A-15 (A4) turns on.
5. A3 (Dope Sheet and timing), rebased on A4 (`scaleKeyValues`, the Tween bar) and A2 (`Alt+S`, dimmed rows) when
   they merged first; otherwise it merges with those cases as `test.fixme('A2')`/poll-fails and they turn on later.
6. Integration: E2E-M2A-23/24, budgets, docs.

Each merge: `pnpm run ci` green, with scenarios that depend on unmerged packages as `test.fixme` naming the package.

### 10.2 M2a definition of done

- All §9 gates green in `chromium-swiftshader` (CI) and locally in real Chrome; M1's E2E-00…27 and acceptance-round
  specs unchanged and green; stretch items listed as `test.fixme` in `apps/web/e2e/stretch.spec.ts`.
- Budgets re-measured (ROADMAP "M2a budgets"): M-1 (p95 ≤ 4.0 ms), M-2, M-3 **Met**; the §5.22 rows recorded;
  `check:size` gating CI at 900,000 B with the initial route within the §5.21.2 target (≤ 800,000 B, or the
  attributed value ≤ 850,000 B recorded with its reason).
- Conformance suite green on the memory store and `doc-yjs`; export policy (MVP-SPEC §4.11.13) holds for every
  exported file, reduced or not.
- README (feature table, status, GIFs), ROADMAP (status, budgets), REQUIREMENTS (milestone columns of the shipped
  items), DECISIONS-OPEN §F and this spec consistent with the code; `v0.2.0` tag is the owner's call.

### 10.3 Owner demo script (10 minutes)

1. Load Polybot: legs show IK feet and knee poles; FK leg circles are hidden.
2. Lower `cog` with `W`: the feet stay; drag the left IK foot; move the knee pole; type a roll of 20° and −15°.
3. Switch the left leg to FK at frame 10 (seamless) and back: no pop; switch the left arm to IK and lower `cog`:
   the hand stays.
4. Block a 24-frame walk with the IK feet and `cog`; mirror left → right with half-cycle offset; play.
5. Open the Dope Sheet: retime the passing pose with ripple on; undo; scale a block with the region bar.
6. Tween a breakdown at frame 3 with the slider; set a breakdown with `Alt+S`, move a neighbour key: the breakdown
   keeps its ratio.
7. In the Graph Editor: snapshot the buffer, edit, swap back; normalized and stacked views; scale keys with `R`.
8. MMB-drag the time slider to carry a pose and press `S`; Shift-drag a band and Mod-drag it to copy.
9. Pick-walk with the arrows; key a hand by body part; scrub a channel with MMB in the Channel Box.
10. Export VRMA with key reduction (size shown); reload the page with unsaved work and recover it.

### 10.4 Integration record

2026-10-18, branch `m2a/integration` ([notes](wp-notes/m2a-integration.md)):

- **Merge**: A0, A4, A5, A1, A2, A3 in the §10.1 order, then the integration. Every `READY` flag, every package
  `test.fixme` and every package gate is a failure now; the integration's fix round 1 turned on the last one it had
  missed (`graph.keys.scale` with `valueFactor` ≠ 1, §5.15.3, through A4's `scaleKeyValues`). The only `test.fixme`
  tests are the stretch items of `apps/web/e2e/stretch.spec.ts`: three M1-stretch entries and the six M2a-stretch
  items of §1.2, each with its fallback and acceptance line; an ordinary test there checks the fallbacks the test
  API reaches.
- **Hand-offs** (M2A-A4-12, resolved in fix round 1): the value scale above; the Graph Editor's key fields,
  `graph.keys.setFields` and the handle metrics in the channel's unit (§5.1 rule 5: an angle attribute such as `@roll`
  reads and takes degrees like the Channel Box and the curve axis); the Dope Sheet's Tween bar mount (A3, done); the
  time slider's per-batch tick set (value-only batches and breakdown flags handled, M2A-A4-16 and M2A-INT-6; batches
  that move keys in time still rebuild it, part of M-4). The §1.2 mesh-pick fallback hint was built (M2A-INT-18).
- **Acceptance**: E2E-M2A-23 (walk) and -24 (attack) in `apps/web/e2e/m2a-23-24-acceptance.spec.ts`, authored with
  real input and leg IK; their undo history holds no Plant Feet. The rows were amended for the fixtures' leg reach and
  for what reduction can do on smooth motion (M2A-INT-1…3, §9.1 note).
- **Owner demo script** (§10.3): run once by the integration in sequence on one page in real Chrome as a scripted
  walkthrough (`apps/web/e2e/m2a-demo-walkthrough.spec.ts`, kept in the suite); all ten steps pass. It found one
  defect, fixed: frozen tangent handles carried −0 into documents, which recovery (JSON) returned as +0
  (M2A-INT-16). Deviations from the script's wording are listed in the notes (M2A-INT-15). The owner's own run stays
  open for the release.
- **Gates**: E2E-00…27, E2E-M2A-01…25, the walkthrough and the M1 acceptance-round specs green in real Chrome and in
  `chromium-swiftshader`; unit, browser-mode and headless tests green; the conformance suites (memory, `doc-yjs`)
  unchanged and green; export policy (MVP-SPEC §4.11.13) asserted for every exported file of the scenarios.
- **Budgets** (ROADMAP "M2a budgets"): M-1 met (p95 3.1–3.4 ms), M-2 met under the gate with the target set to
  850,000 B (843,270 B, §5.21.2), M-3 met (mean 0.154 ms); §5.22 rows recorded, the Dope Sheet drag of 1,000 keys
  missed (M-4, report only). Re-measured after fix round 1: see the notes.
- **Contract PRs ratified** in this revision (v0.3); deviations and owner review items in
  [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18).
- **Merged into `dev`** (2026-10-18, M2A-INT-19): A0, A1, A2, A3, A4, A5, then `m2a/integration`, each `--no-ff` and
  signed off; the result is the integration branch's tree byte for byte. `pnpm run ci`, the e2e suite in
  `chromium-swiftshader` and the budget bench re-run on `dev` (ROADMAP "M2a budgets").
- Open for the release: the owner's review of §F (FR-EXP-12's "3–10×" criterion among them, M2A-A5-3/INT-3), the
  owner's run of the demo script; `v0.2.0` is the owner's call.

---

## 11. Defaults chosen (owner may override)

| ID | Question | Default | Impact if changed |
|---|---|---|---|
| M2A-D1 | IK on new rigs | Legs IK (`ikFk` 1), arms FK with IK controls present (`ikFk` 0) — Q-RIG-2 | `prefs.autoRigIk` per user |
| M2A-D2 | M1 projects | Not upgraded on open; an explicit, undoable `rig.addLimbIk` with `ikFk` 0 (animation unchanged, bit for bit) | An automatic upgrade would change rigs silently |
| M2A-D3 | Where `ikFk` lives | Attribute on the IK control, shown as a proxy row on every limb control (the raw row is hidden), with `keyAll: false` so that `S`, body-part keying, tweens, the pose clipboard and reset never key or reset it implicitly (§5.1 rule 4) — the behaviour of a separate switch control without needing constraints | A real switch control can be added with constraints (M2c) |
| M2A-D4 | IK control space | `root` only (space switching is M5); README states the turn-in-place workaround (§1.4) | Arms in `world`/`chest` and "pole follows foot" need M5 |
| M2A-D5 | Foot roll | Simple variant on the leg `ik2` op: one `roll` with a break angle (heel, ball, toe), bank, heel and toe twist, in the foot frame; pivots from the foot mesh (bone fallback), editable as numeric fields including the break angle | No separate `ballRoll`/`toeRoll`: more than β of ball roll is a larger break angle, an independent toe lift is a rotation of `fk.toes` (visible under IK, §5.5 rule 2); a viewport pivot editor is M2c |
| M2A-D6 | Fingers and toes under IK | Follow the IK hand/foot (follow rule); toes keep their FK rotation and stay planted under ball roll | A "toe tap" attribute could replace `fk.toes` in IK mode |
| M2A-D7 | Schema | `SCHEMA_VERSION` 2; `minWriterVersion` 2 only when an `ik2` solver is enabled (M1 apps then open read-only); fresh documents write 1 | Bumping table versions would make every M2a project read-only in M1 |
| M2A-D8 | Export reduction | Off in the API (M1 bytes), on by default in the Export dialog with R02 §6.4 tolerances | A different default changes exported bytes |
| M2A-D9 | Ripple scope | Dope Sheet and time slider, one global region per edit over the shown or target controls; the Graph Editor never ripples (Maya) | Per-curve bounds were rejected (§5.11) |
| M2A-D10 | Breakdown rounding | Retimed breakdowns snap to whole frames inside their anchors when snapping is on; Insert/Remove Frame never retime breakdowns | Sub-frame breakdowns (Maya-exact) by turning snapping off |
| M2A-D11 | Arrow keys | Pick-walk in viewport and Channel Box; key nudge in Graph Editor, Dope Sheet and time slider; Outliner keeps ARIA arrows (Q-UI-2) | `prefs.arrowKeys: 'frames'` |
| M2A-D12 | Autosave | On, 2 s debounce, 30 s max interval, one slot per tab, recovery prompt at start | `prefs.autosave` |
| M2A-D13 | Import to IK fidelity | `ikTolerance` 2° (chain bone world rotation) and 2 mm (mid joint); a limb over it stays FK for the clip with a warning. 2° admits FK-authored bends on legs splayed up to about 5° at 40° of bend (the twist difference grows to about 0.36 × the splay there) and rejects hyperextended or clearly non-hinge knees | A tighter tolerance keeps more limbs FK; a looser one hides twist differences |
| M2A-D14 | Loop clips | Cycle-aware auto tangents wherever both infinities cycle; curves created by keying in a loop clip default to `cycle` infinities; imports and existing curves unchanged | Constant infinities by default (Maya) would bring the seam hitch back |
| M2A-D15 | Tween target | `'auto'`: selected keys if any, else the pose at the current frame, always shown in the bar and one click to force the pose | Always the pose (tweenMachine) or always keys |

### 11.1 Review items not applied (v0.2)

The v0.2 review raised 45 items (2 blockers, 22 majors, 21 minors; four were reported twice: the right-foot bank
pivot, the E2E-M2A-23 mirror scope, the aggregate hold rule and the E2E-M2A-12 layout). Every blocker and major is
applied above, and so are the minors except the parts below, which are **not** applied, with the reason:

| Item | Decision | Reason |
|---|---|---|
| `poleFollow` 0…1 attribute blending the pole's frame between `root` and the IK control's yaw | Rejected for M2a; README workaround (§1.4) | The pole would be evaluated somewhere other than where its control is drawn and picked (the op cannot move a control that the kernel already evaluated without becoming the general space switch of M5); match, mirror and Plant Feet would all need the inverse. Space switching with matching is M5 (FR-RIG-12) |
| Additive `ballRoll` / `toeRoll` attributes | Rejected; break angle exposed instead (M2A-D5) | Two more keyed attributes per foot for cases the break angle and `fk.toes` already cover |
| The project record's `minWriterVersion` rewritten by `snapshot()` (part of the schema blocker's fix) | Not done; the top-level `DocSnapshot.minWriterVersion` decides (§4.2 item 4) | Rewriting a record in snapshot output would make `snapshot()` differ from the stored records and risk conformance deep-equality; nothing reads the record field in M1/M2a. M3 revisits it |
| Automatic Simplify after `rig.ikFk.matchRange` | M2a-stretch (§1.2) | Optional in the review; Graph › Simplify does it in one step |
| Key hold (KY-08) and a stepped preview toggle | M2a-stretch (§1.2) | The review itself classed them as stretch; workarounds exist |
| Ankle/wrist motion trail | M2a-stretch (§1.2), gap named in README (§1.4) | Onion skin and full trails are M2c; the cheap trail only if time remains |
| A layout preset that docks the Dope Sheet beside the Graph Editor (E2E-M2A-12) | Not done; the scenario switches tabs and asserts through probes (§9) | The shared selection lives in the kernel; both panels need not be visible to test it, and a layout preset is UI scope M2a does not need |
| A pref that turns the viewport MMB virtual slider off "if it conflicts with a manipulator" | Added as `prefs.virtualSlider.viewportMmb` (default on), not tied to the maya preset | No M1 tool uses plain MMB, so there is no conflict to gate on a preset |
| Matching IK→FK "using the previous frame's pole" for near-straight frames | Replaced by the continuous blend of the §5.6 match pole rule | A frame-order dependency would make match results depend on evaluation order; the blend is stable and order-free |
| Import fidelity tolerance "1° or 1 mm" | 2° and 2 mm (M2A-D13) | 1° would keep FK-authored bends on slightly splayed legs FK in our own round trips (twist difference ≈ 0.36 × splay at 40° bend) |
