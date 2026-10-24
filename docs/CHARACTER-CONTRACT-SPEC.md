# Character Contract — Ekza Studio ↔ Ekza Hub ↔ OMOBA

Status: **v0.1 (2026-10-24), draft for the owner.** Normative once the owner accepts it and
[ADR 0024](adr/0024-character-contract.md) moves to Accepted. The contract format (§3, Appendix A), the package format
(§4, Appendix C) and the rule table (§5) freeze when work package C0 merges into `omoba-bevy` `dev`; after that a change
needs a PR that updates this file first and bumps the contract schema if it breaks a reader. Defaults and owner
questions: [DECISIONS-OPEN §Q](DECISIONS-OPEN.md#q-character-contract-defaults-chosen-2026-10-24) (`CC-*`).

Owner request (2026-10-24, translated): *"OMOBA exports the specifications of its existing heroes — which animations
each one needs. Ekza Studio reads them and gives the user a convenient UI to fill in the missing ones with their own
animations, or leave the defaults, and it must be visible which slots are custom and which are default. Defaults may
not even need shipping, because OMOBA substitutes its own library clips. In the end a user makes a model and
animations and submits it to OMOBA as a turnkey package: people just make the animation and submit, and don't bother
at all; easy and convenient."* Context: collab characters (for example a licensed artist's character) brought into
OMOBA. Out of scope here: new heroes with new game mechanics.

Inputs (read-only research of 2026-10-24; line references are to the branches named):
- OMOBA motion model: `omoba-bevy` `origin/dev` @ `6d34f98` (protocol 11, motion library schema 1, 57 clips,
  `skills.skillfx` schema 2, skill catalogue `standard-kits-8`, 17 hero classes). `main` @ `0c0585c` is behind on motion
  (no PR #106).
- Ekza Hub / registry: `ekza-registry` `origin/dev` @ `82715fa`; the Bevy SDK at `a9a253c`.
- Ekza Studio: `dev` @ `959c587b` (v0.6.0 + the TM-1 scrub); the touch shell draft
  [STUDIO-TOUCH-SPEC](STUDIO-TOUCH-SPEC.md) v0.2 on `design/studio-touch` (Halo, being implemented).
- ADR 0010 (Ekza integration tiers; this spec realizes its tier **T2**, *avatar-owned animation sets*
  `asset.extras.ekza_animation_set_v1` in `desktop / humanoid-glb-v2`, and replaces its tier **T3** plan), ADRs 0020,
  0021, 0022, 0023 (on its branch).
- A prototype of the contract exporter run on OMOBA `dev` data (§3.10, Appendix B): 107 slots, 101 of them
  custom-able in v1; every default row satisfies the contact rule; the longest default action plays 0.944 s.

Audience: the owner (§0, §9, §10, §11, §13), the OMOBA, Hub and Studio implementation agents (§3–§8, appendices),
reviewers.

The rule this spec follows: **OMOBA owns what a character must be; Hub owns who may publish it; Studio owns how a
person makes it.** The contract is OMOBA's data, generated from the same files the game plays; the same rule table
drives Studio's lints, OMOBA's passport and the Hub builder; Studio adds no game logic of its own and writes the
document only through operators (ADR 0021 rule 2).

---

## 0. Summary

**The turnkey flow** — one path for everybody, from "rig it and submit" to a full hero kit:

```
 Hub hero page / Studio "For: OMOBA ▾"
        │  pick game + hero  (Wildspark, or "Any hero")
        ▼
 ┌──────────────── Ekza Studio (Pro · Auto-Rig · Halo) ────────────────┐
 │ slot checklist  ● custom   ○ game default   ⚠ invalid   ⊘ missing   │
 │ fill a slot:  own animation · library clip · file (.vrma/.glb) · AI │
 │ check:        the contract's rules, per slot, with one-tap fixes     │
 │ package:      one VRM 1.0 = model + custom clips + slot map         │
 └──────────────────────────────┬──────────────────────────────────────┘
                                │  Submit to OMOBA (Hub tab, postMessage)
                                ▼
 Ekza Hub: upload → check_animation_set → curator → builder humanoid-glb-v2
          (Rust passport per slot) → rights holder countersign (collab)
          → OMOBA owner approves into TEST channel (OMOBA Dev builds, dev lobby)
          → Promote to LIVE → every client downloads the content-addressed file
                                │
                                ▼
 OMOBA client: per slot, the pack's clip if it passes, else OMOBA's own default
```

Empty slots are never an error in v1: every slot has an OMOBA default, so **the shortest path is rig → Submit**. The
package does not carry defaults; OMOBA plays its own library clip, tuned by its own row, for every slot marked
`default`.

**Decisions** (ADR 0024 is the record; `CC-*` rows in DECISIONS-OPEN §Q):

| # | Decision |
|---|---|
| D1 | **OMOBA owns the contract** `omoba.character-contract.v1`, generated from its live data (Rust generator in the client crate, committed snapshot `shared/assets/catalog/character-contract.json`, `--check` in OMOBA's gate). Identity = `revision: sha256-<canonical JSON>`, as `omoba.asset-catalog.v1`. Data licence CC0-1.0. Hub serves it; Studio bundles a snapshot. |
| D2 | **Slots are keyed by gameplay identity, not by keys**: `base.<state>`, `basic.<class>.<n>` (`basic.wildspark.rockets.0` for the launcher mode), `skill.<skillId>.release\|recast\|windup`. Slot ids are stable; a retired id is never reused. 107 slots today. |
| D3 | **Custom-able in v1: 101 of 107 slots** — `base.idle`, `base.run`, `base.death`, every basic attack, every skill `release` and `recast`. The 5 wind-up holds become custom-able in v1.1; `base.walk` is reserved (the game never selects it). Studio vocabulary slots that OMOBA has no state for (`walk`, `attack`, `cast`, `hit`, `jump`, `dance`, …) are ignored by OMOBA and left out of the package. |
| D4 | **Defaults are not shipped.** The package's slot map lists every slot of the target hero as `custom` or `default`; `default` plays OMOBA's library clip with its tuned rate and start. Studio shows which is which everywhere. |
| D5 | **A custom clip plays as authored** (rate 1, start 0). Studio shows the default's *effective* play and contact time as the target and offers *Fit timing*. The engine reads duration, loop and contact from the resolved clip, never from the default it replaced. |
| D6 | **The package is one VRM 1.0** (VRM 0.x accepted) with the custom clips embedded, each named by its slot id, plus `asset.extras.ekza_animation_set_v1` {contract revision, target hero, mode per slot, contact}. One file, content-addressed, inside Hub's one-source-per-revision model; **no protocol change**. A dev zip (VRM + one `.vrma` per slot + manifest) is secondary, for local tests. |
| D7 | **One rule table, checked in three places, implemented twice.** Rule ids and parameters live in the contract; TypeScript (Studio) and Rust (OMOBA passport, also run by the builder in its sandbox) implement them; Hub's registry checks only the structural subset. OMOBA owns conformance fixtures that every implementation runs; an unknown rule id fails closed. **Strict at the gates** (Studio export error, builder rejects), **lenient at runtime** (a failing slot falls back to its default, never a partial clip). |
| D8 | **Avatars stay hero-independent.** `base.*` slots apply on any hero, `basic.<class>.*` when the avatar is played as that class, `skill.<id>.*` whenever the avatar casts that skill (borrowed skills and the lab included). The target hero is a label ("Made for Wildspark") and the default pick when equipping. A hero lock for collab characters is an owner question. |
| D9 | **Hub adds a contract registry and a v2 profile**: `project_contracts` + channels, per-hero requirements `character.<hero>`, profile `desktop/humanoid-glb-v2` with builder `omoba-humanoid-glb-v2` (keeps custom clips, runs the Rust passport, writes a per-slot report). The v1 rendition is still built for old clients. OMOBA's owner approves into a **test** channel, then promotes to **live**. |
| D10 | **Submit = a Hub page driven by `postMessage`** (`ekza-studio-submit/v1`) for the MVP: no tokens in the editor, no CORS on write routes, consent captured on Hub. OAuth code + PKCE with a scoped token and CORS write routes follows later (agents, status in the editor). |
| D11 | **Rights per revision.** Licence and attribution are snapshotted per revision; a collab character names its rights holder, who countersigns that exact revision on Hub before OMOBA's owner can approve it (SQL gate). |
| D12 | **Studio: one binding, one status function, three shells.** The target lives in an extension table `ekza.targets` (no schema bump); one pure `slotStatuses()` feeds the Pro *Target* panel, Auto-Rig ④/⑤, Halo's slot chips and readiness, Validation rows and the agent tools. Everything is lazy (≤ 512 B eager per route). |

**Delivery**: eight work packages C0–C7 across three repositories, about **55 agent-days**; critical path
C0 → C3 → C4 → C5 → C7, about **34 agent-days** (§10). Pre-existing problems the owner must clear for hosted runs (§11): P-1
the prod worker builds without PR #106 (VRM 1.0 renditions fail), P-2 pending hosted migrations, P-3 the Hub origin
mismatch (prod sign-in link hidden), P-7 the dev contour's builder pin and Hub name.

---

## 1. Terms, scope, non-goals

| Term | Meaning |
|---|---|
| **Contract** | `omoba.character-contract.v1`: OMOBA's machine-readable description of the clips its heroes play, the rules a custom clip must pass and the per-hero views. One JSON document per revision. |
| **Revision** | `sha256-` + SHA-256 of the canonical JSON of the document without `revision`. Changes with any data change. |
| **Schema version** | `schemaVersion` (1). Changes only for a breaking change to readers. |
| **Slot** | A place where the game plays one clip, with a stable id (`skill.wild_zap.release`). |
| **Default** | The clip OMOBA plays in a slot when the package has none: a motion of OMOBA's library, with the row's rate and start. |
| **Custom clip** | A clip in the package assigned to a slot. |
| **View** | `heroes[]` entry: the ordered slots of one hero class, or `any` (base slots only). |
| **Target** | In a Studio project: the binding of one character to (project, contract revision, view). |
| **Package** | The file Studio exports for a target and Hub ingests: one VRM with custom clips and the slot map. |
| **Rendition** | What Hub's builder makes from the package for a profile (`desktop/humanoid-glb-v2`): content-addressed, what clients download. |
| **Channel** | `test` or `live`: which approved renditions a client build sees. |

**In scope (v1)**: existing heroes and skills; a model + custom clips for any subset of the 101 custom-able slots;
Studio's three shells; Hub submission, review, test and live; OMOBA playback with per-slot fallback; collab rights.

**Non-goals (v1)**: new heroes or mechanics; custom wind-ups (v1.1); declared playback rate/start per slot; one package
covering several heroes' kits (v1.1, `CC-Q10`); motion-only packs reusable across avatars (VRMA packs, later); new engine
states (hit reactions, emotes, jumps); custom weapons in the same package (the handheld pipeline stays separate); Ekza
Space reading the slot map (later; §12 R7); paid collab sales (commerce consent pattern exists; `CC-Q9`).

---

## 2. What exists today (digest)

**OMOBA** (`omoba-bevy@dev`):
- Two playback paths (`client/src/player/animation.rs:416-683`). Every VRM avatar takes the *runtime humanoid* path:
  the shared library (`client/assets/animations/humanoid-motion-v1.json`, 57 clips, 52 semantic bones) is retargeted
  onto the rig (`client/src/humanoid.rs:48-103`, `humanoid/retarget.rs`) into a `CharacterAnimationSet` of six base
  nodes plus named motion nodes. Non-VRM GLBs (and a VRM whose rig is rejected) take the legacy path: embedded clips by
  name substrings; every skill then falls back to *Cast*.
- What a hero plays comes from `client/assets/config/skills.skillfx` (schema 2): 68 skill rows `{release, windup,
  motion{rate, start, phase, fit_windup, recast, recast_rate}}` keyed by **skill id**, and 17 basic-attack rows
  `{motions[1..2], rate, start, rockets}` keyed by class (`client/src/skill_presentation/schema.rs:43-122, 330-352`).
- The contact rule (`schema.rs:27, 416-456`): an edge-released clip (instant release, recast, basic) must show its
  contact pose within `(contact − start·duration)/rate ≤ 0.15 s` of the accepted cast; a violation is a parse error.
  Base states `idle | walk | run | death` cannot be picked by rows; a loop may only be a wind-up.
- Timing is client-side cosmetic: the server sends `PlayerCosmeticAction{sequence, kind, slot, yaw}` and never waits
  for a clip; a new action restarts playback; movement does not interrupt an action; death cuts at once; blend 120 ms;
  facing holds 0.45 s after a basic and 0.7 s after a skill.
- **Why an avatar's own clips never play** (research §1): the runtime path always builds from the shared library; the
  only per-avatar hook (`combat_visuals.json.animation_aliases`) covers six base states and is packaged-only; the
  `humanoid-glb-v1` rendition builder appends the same five generic clips; rows select a library motion by name;
  timing metadata is read from the shared library (`skill_presentation.rs:254-283`). The building block exists:
  `remap_embedded_clip` (`humanoid.rs:115-138`) maps a clip authored on that exact rig into runtime targets, and the
  collection preview already plays embedded clips this way (`frontend/preview.rs:540-563`).
- Avatar choice is independent of class: the join packet carries `hero_class`, `avatar` and `handheld` separately
  (`shared/src/protocol/wire.rs:152-165`); handhelds are cosmetic and class-defaulted (`shared/src/handheld.rs:17-39`).
- Precedent exporter: `scripts/export_asset_catalog.py` → `omoba.asset-catalog.v1` (canonical JSON, `sha256-`
  revision, `inputsSha256`, `gameplayRevision`; `docs/asset-catalog.md:49-95`).

**Ekza Hub** (`ekza-registry@dev`): upload → curator review → renditions bound to `(platform, profile, version)`
(`supabase/migrations/202609190001_game_integration.sql:28-65`; builder column limited to
`none | omoba-humanoid-glb | arkit-usdz`) → submission to a project → the project owner approves once → a pinned
release per `(avatar, project, platform, profile)` (`202609210001_project_releases.sql`) → public `/v2/avatars` and
`/v2/assets` (CORS `*`) → the SDK verifies size and SHA and the passport checks the profile. Project requirements exist
(`202610110002_project_requirements.sql`, ids `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$`). Accounts are Supabase email +
password; the Hub web BFF keeps tokens in HttpOnly cookies and rejects cross-site writes. Licence and attribution are
free text per asset, not per revision; there are no co-authors or rights holders.

**Ekza Studio** (`dev`): `ClipRecord` has `slot`, `loop`, `rootMotion`, `contact` (frames), tags and provenance
(`packages/doc/src/records.ts:276-292`); the slot vocabulary is closed (`editor-core/src/workflows/names.ts:9-26`);
the VRM 1.0 writer embeds any number of clips named by slot and writes `asset.extras.ekza_animation_v1`
(`io/src/character/index.ts`, `io/src/types.ts:96-121`); import restores only `loop` and provenance; export profiles
are data (`io/src/profiles/builtin.ts`); model characters may only use `ekza/space-avatar-v1` or `local/generic`, with
the banner "OMOBA plays its own motion library on your VRM" (`io/src/profiles/character.ts:3-48`). The OMOBA local test
kit is a zip with the VRM and a manifest entry (`io/src/omoba/kit.ts:59-71`). No Hub code (`publishToHub()` returns
false). The agent bridge has 37 tools, `library_use` without a slot argument.

---

## 3. The contract `omoba.character-contract.v1`

### 3.1 Ownership, file, identity

- **Owner**: OMOBA. Generated, never hand-edited. Canonical file in `omoba-bevy`:
  `shared/assets/catalog/character-contract.json` (committed, checked).
- **Identity**: `schema: "omoba.character-contract.v1"`, `schemaVersion: 1`, `projectId: "omoba"`, `revision:
  "sha256-<hex>"` over canonical JSON (recursively sorted keys, compact separators, integer-valued floats as integers,
  other numbers in ordinary decimal notation, magnitude ≥ 0.000001) without the `revision` key — the exact rule of
  `omoba.asset-catalog.v1` (`docs/asset-catalog.md:51-58`), so the same browser code reproduces both. Readers
  **recompute and reject a mismatch**.
- **Licence**: `license: "CC0-1.0"`. The document is a description of game behaviour plus metadata of CC0-derived
  motions; CC0 lets Studio (MIT) bundle snapshots and Hub serve them without a licence boundary (`CC-Q3`).
- **Size**: about 100 kB canonical today (107 slots, 18 views); readers cap at 1 MiB.
- **Strict parsing**: unknown keys are errors at every level (`additionalProperties: false`), as Studio's library
  manifest parser and OMOBA's `deny_unknown_fields` already do. A reader that meets a higher `schemaVersion` says
  "This contract needs a newer Ekza Studio" and keeps the pinned copy.

### 3.2 Header and provenance

| Field | Meaning |
|---|---|
| `source.commit` | `omoba-bevy` HEAD the exporter ran on |
| `source.exporter` | `scripts/export_character_contract.py` |
| `source.inputsSha256` | SHA-256 over the sorted map of every consumed path → byte hash (skills.skillfx, heroes.json, skills.json, the motion library, the exporter itself, the rule table source) |
| `source.gameplayRevision` | the skill catalogue revision (`standard-kits-8`) |
| `source.presentationSha256` | SHA-256 of `skills.skillfx` |
| `source.motionLibrary` | `{schemaVersion, sha256, clips}` of `humanoid-motion-v1.json` |
| `source.protocolVersion` | the game protocol the snapshot was cut from (11) |
| `previousRevision` | the revision this one replaced on `dev`, or null; lets readers show a diff (§8.12) |

### 3.3 `package`

`extrasKey: "ekza_animation_set_v1"`, `sourceFormats: ["vrm1", "vrm0"]`, `rendition: {platform: "desktop", profile:
"humanoid-glb-v2", version: 1}`, `slotNaming: "animation-name-equals-slot-id"`, `customPlayback: {rate: 1, start: 0}`
(D5; a later schema may open it, `CC-Q11`).

### 3.4 `rig` — the "any humanoid" rules

The rig section restates, as data, what the passport's runtime humanoid check already enforces
(`passport/src/humanoid.rs`; Studio mirrors it in its `vrm.*` lints), plus what the retargeter assumes:

| Field | Value | Source |
|---|---|---|
| `kind` | `vrm-humanoid` (exactly one of VRM 0.x / `VRMC_vrm`) | passport |
| `restPose` | `t-pose` (the retarget math assumes it; Studio's `skel.tpose` lint) | `retarget.rs:45-74` |
| `facing` | `as-vrm-spec`: VRM 0.x rests facing −Z, VRM 1.0 facing +Z; the builder turns VRM 1.0 roots 180° about Y (`normalize_vrm1_rest_facing`, `asset.extras.omoba_rest_yaw180`) | `docs/humanoid-motion.md:89-94` |
| `requiredBones` | the 15 VRM-required bones; `requiredBonesVrm0` adds `chest`, `neck` | passport |
| `drivenBones` | the 52 semantic bones the library drives (fingers included) — also the only bones a custom clip may rotate | motion library `bones` |
| `maxHumanoidBones` / `maxNodes` | 64 / 4096 | passport |
| `uniformScale` | `humanoid-bones-and-ancestors` (within 1e-5) | passport (dev) |
| `fingers` / `thumbsRecommended` | optional / true (held weapons grip with the right hand) | `humanoid/sockets.rs` |
| `legLengthFrom` / `referenceLegLengthM` | `hips-to-feet` / 0.813 — the unit for in-place limits | `retarget.rs:70-74` |

### 3.5 `timing` — what the engine does with clips

`blendSecs 0.12`, `idleGraceSecs 0.25`, `facingHoldSecs {basic 0.45, skill 0.7}`, `contactLimitSecs 0.15`,
`rowRate [0.5, 2]`, `rowStart [0, 0.8]`, `fitRate [0.5, 2]`, `unseenHoldSecs 1.2`, `freshSecs 0.15`, `maxGapSecs 0.25`,
`deathCut: immediate`, `movementInterruptsAction: false`, `newActionRestarts: true`. These are informative for
creators (Studio shows them in *Why?* texts) and normative for Studio's preview emulation; the server's own timings
(wind-up seconds, cooldowns) appear per slot and per view.

### 3.6 The slot model

**Grammar** (≤ 64 characters):

```
slotId   = base | basic | skill
base     = "base." ("idle" | "run" | "walk" | "death")
basic    = "basic." classId "." ( digit | mode "." digit )        ; basic.warden.1, basic.wildspark.rockets.0
skill    = "skill." skillId "." ("release" | "recast" | "windup")
classId  = [a-z][a-z0-9_]{0,31}      skillId = [a-z][a-z0-9_]{0,47}      mode = [a-z][a-z0-9_]{0,15}
```

**Groups, kinds, phases**:

| Group | Slots (today) | `kind` | `phase` | Edge-released | v1 |
|---|---|---|---|---|---|
| base | `base.idle`, `base.run` | loop | locomotion | — | **custom-able** |
| base | `base.death` | hold (plays once, holds the last pose until respawn; cut in at once) | state | — | **custom-able** |
| base | `base.walk` | loop | locomotion | — | **reserved** (never selected, `animation.rs:237`) |
| basic | 22 = 17 classes, 4 with an alternating second swing (`warden`, `dawnweaver`, `stormfist`, `veilstalker`), plus `basic.wildspark.rockets.0` | action | instant | yes | **custom-able** |
| skill | 68 `skill.<id>.release` | action | instant, or the skill's held phase (`warn_fire`: dawn_ray, horizon_wave; `fuse`: furnace_breath, orbital_collapse; `parry`: mirror_guard) | only when instant | **custom-able** |
| skill | 8 `skill.<id>.recast` | action | instant | yes | **custom-able** |
| skill | 5 `skill.<id>.windup` (`dawn_ray`, `horizon_wave`, `furnace_breath`, `orbital_collapse`, `mirror_guard`) | loop, or hold fitted to the telegraph (dawn_ray) | the skill's phase | no | **v1.1** (shown as fixed defaults) |

Not slots: the library's generic `attack` and `cast` clips are engine fallbacks for the legacy path, not places a
creator fills; rows that *use* `cast` as their release (frost_lance, patient_curse, …) are ordinary `skill.*.release`
slots whose default motion is `cast`. **Ignored by OMOBA**: Studio's vocabulary-v1 slots (`walk` maps to the reserved
`base.walk`; `attack`, `cast`, `jump`, `hit`, `stagger`, `crouch`, `fly`, `climb`, `swim`, `dance`, `wave`, `emote`,
`celebrate` have no engine state). Studio lists such clips as *Not used by OMOBA* and leaves them out of the package
(§8.10); it suggests a mapping where one is obvious (`idle → base.idle`, `run → base.run`, `death → base.death`,
`attack → basic.<class>.0`).

### 3.7 Per-slot fields

| Field | Type | Meaning |
|---|---|---|
| `group`, `role` | enum | `base\|basic\|skill`; `idle\|run\|walk\|death\|basic\|release\|recast\|windup` |
| `label` | string ≤ 80 | display text from the catalogue: "Shockline (W) — release" |
| `kind` | `loop\|action\|hold` | how the engine plays it (§3.6) |
| `phase` | `locomotion\|state\|instant\|warn_fire\|fuse\|parry` | what starts and ends it |
| `edgeReleased` | bool | the contact rule applies (instant release, recast, basic) |
| `customizable`, `customizableFrom` | bool, `"1"`/`"1.1"` | whether a package may fill it in this schema; when it opens |
| `reserved` | bool | slot exists for a future engine state; never played |
| `required` | bool | a package must fill it; **false for every slot in v1** (each has a default) |
| `default` | object | `{motion, durationSecs, looping, contactSecs, rate, start, playSecs, effectiveContactSecs, standInFor}` — the library motion, its row playback, and the derived `playSecs = duration·(1−start)/rate` and `effectiveContactSecs = (contact − start·duration)/rate` (negative when the row seeks past the contact: quick_shot, rift_seal, furnace_breath) |
| `window` | `{minSecs, targetSecs, maxSecs}` | allowed duration of a custom clip; `targetSecs` = the default's `playSecs` (loops: its cycle) |
| `inPlace` | bool | hips may not travel (§5 `clip.in-place`) |
| `loop` | bool | the clip must loop and close (§5 `clip.loop-closure`) |
| `contact` | `{required, maxSecs, targetSecs}` or null | contact time required; `maxSecs` 0.15 when edge-released, else null; `targetSecs` = max(0, the default's effective contact) |
| `telegraph` | `{secs, serverWindupSecs, fitWindup}` or null | the skill's own telegraph (dawn_ray 0.8, horizon_wave 0.7, furnace_breath 0.8, orbital_collapse 0.7, mirror_guard 0.75 s) and the server wind-up |
| `handheld` | `{item, byMode, bone, muzzleWindowSecs}` or null | the class-default handheld held during the slot (rightHand); Wildspark's muzzle flash window 0.08–0.25 s |
| `sharesDefaultWith` | slot ids | slots whose default plays the same library motion (one custom clip may serve all, §4.2) |
| `alternatesWith` | slot id | the other swing of an alternating basic attack |
| `usedBy` | class ids or `*` | the views whose default kit contains the slot |
| `skill` / `class`, `minIntervalSecs`, `weaponMode` | | basic slots: class, `cooldown ÷ attack-rate cap` (the shortest time between two basics: a longer clip is cut by the next), weapon mode |

### 3.8 `heroes[]` — views

One entry per class in catalogue order, plus `any` first:
`{id, kind: "class"|"any", name, role, requirementId: "character.<id>", basicAttack: {rangeM, cooldownSecs,
attackRateCap, minIntervalSecs, slots}, kit: [{key: q|w|e|r, skill, name, slots}], handheld: {default, byMode, bone},
slots: [ordered slot ids]}`. `any` has only `base.idle`, `base.run`, `base.death`: a character for **any hero**.
Views are the checklist order Studio shows: base, basic, then Q, W, E, R (each with its recast and, in v1.1, wind-up).
Q/W/E/R placement belongs to the view, not to the slot — a slot is keyed by skill id, so a borrowed skill resolves
whichever key it sits on.

### 3.9 Versioning and compatibility

- `schemaVersion` changes only when a reader written for the old one would misread the new one.
- `revision` changes with any data change (a re-tuned row rate changes a default's `playSecs`). Slot ids are stable;
  removing a slot retires its id for good.
- The exporter classifies each new revision against `previousRevision`: **compatible** (defaults' metadata changed,
  slots added, a slot became custom-able, a rule loosened) or **breaking** (a slot removed or no longer custom-able, a
  rule tightened). The publish CLI refuses to move `live` to a breaking revision without `--breaking` and an owner
  note.
- A package names the revision it was made against. Hub accepts any **non-retired** revision; OMOBA's engine judges
  each slot against the contract it was built with (it accepts a package whose slot exists and passes its current
  rules, and logs a revision mismatch at info level). An approved release is never silently migrated to a new
  revision (registry ADR 0002, approved-revision continuity).

### 3.10 Worked example: Wildspark (full JSON in Appendix B)

Effective values are computed from `dev` data by the prototype exporter.

| Slot | Default motion | Row rate / start | Plays | Contact after the cast | Window | Notes |
|---|---|---|---|---|---|---|
| `base.idle` | idle | 1 / 0 | 2.5 s loop | — | 1.0–4.0 s | any hero |
| `base.run` | run (sprint cycle) | 1 / 0 | 0.667 s loop | — | 0.4–1.2 s | all movement |
| `base.death` | death | 1 / 0 | 2.375 s, holds | — | 0.5–3.0 s | drift ≤ 0.75 leg length |
| `basic.wildspark.0` | burst_fire | 1.65 / 0 | 0.273 s | 0.045 s | 0.15–1.2 s | repeater; muzzle flash 0.08–0.25 s; next basic after ≥ 0.4375 s |
| `basic.wildspark.rockets.0` | shot_heavy | 1.15 / 0 | 0.696 s | 0.148 s | 0.15–1.2 s | launcher mode; shares its default with R |
| `skill.wild_switch.release` (Q Switchfire) | reload_snap | 1.5 / 0.25 | 0.300 s | 0.127 s | 0.15–1.2 s | |
| `skill.wild_zap.release` (W Shockline) | pistol_shoot | 1.1 / 0 | 0.568 s | 0.038 s | 0.15–1.2 s | muzzle flash |
| `skill.wild_traps.release` (E Snapline) | toss_underhand | 1.3 / 0 | 0.308 s | 0.100 s | 0.15–1.2 s | |
| `skill.wild_rocket.release` (R Last Spark) | shot_heavy | 1 / 0.05 | 0.760 s | 0.130 s | 0.15–1.2 s | muzzle flash |

Wildspark: 9 slots, all custom-able. Across the roster the views hold 8–12 slots (stormfist 12; dawnweaver 11 with one
v1.1 wind-up). An alternating basic, for example Warden's `basic.warden.0` (slash_down) and `basic.warden.1`
(slash_down_m, its mirror), carries `alternatesWith`; Studio offers *Mirror for the second swing* or *Same clip for
both* (§8.7).

---

## 4. Package format

### 4.1 Primary: one VRM with embedded custom clips

- **Container**: a VRM 1.0 (`VRMC_vrm`) GLB as Studio's `writeCharacter` writes it today; a VRM 0.x is accepted
  (`sourceFormats`). Self-contained, ≤ 50 MiB, JSON chunk ≤ 4 MiB (passport limits).
- **Animations**: one glTF animation per **custom** clip. Its `name` is the slot id of its primary slot
  (`base.run`, `skill.wild_zap.release`). No other animations: Studio never writes extras into a package, and the
  builder drops unreferenced ones (`pack.unreferenced`, warning).
- **Slot map**: `asset.extras.ekza_animation_set_v1` (the key ADR 0010 reserved for tier T2), covered by the content
  hash:

```jsonc
"ekza_animation_set_v1": {
  "schema": 1,
  "contract": { "schema": "omoba.character-contract.v1", "projectId": "omoba", "revision": "sha256-…" },
  "target": { "hero": "wildspark", "requirementId": "character.wildspark" },
  "slots": {
    "base.idle": { "mode": "default" },
    "base.run": { "mode": "custom", "animation": 0, "contactSecs": null },
    "basic.wildspark.0": { "mode": "custom", "animation": 1, "contactSecs": 0.067 },
    "basic.wildspark.rockets.0": { "mode": "custom", "animation": 2, "contactSecs": 0.133 },
    "skill.wild_rocket.release": { "mode": "custom", "animation": 2, "contactSecs": 0.133 }
    // … every other slot of the view, { "mode": "default" } (full example: Appendix C)
  },
  "provenance": { "tool": "ekza-studio", "toolVersion": "0.7.0" }
}
```

  Rules: every **custom-able slot of the target view appears exactly once** (custom or default — this is what makes
  "which slots are mine" visible on Hub and in the owner's queue); `target.hero` is a view id of that revision; a custom
  slot names an animation index; several slots may share one animation (`sharesDefaultWith`, alternation); the
  animation's name equals one of the slot ids that reference it; `contactSecs` is required where the slot's `contact`
  is required and must equal the clip's `contactSeconds` in `ekza_animation_v1` when both are present. No `uri` keys,
  lowercase hex, deterministic key order, no timestamps (ADR 0010 §2 rules). JSON Schema: Appendix C.
- **Per-clip metadata**: the existing `ekza_animation_v1` (ADR 0010 §2), with the additive `label` (§8.14).
- **What is not in the package**: default clips, rates and starts of defaults, rights-holder data (Hub holds it), the
  Studio project.

### 4.2 Secondary: the dev zip (local tests)

`<name>-omoba-dev.zip` (deterministic, `zipFiles`): `<slug>.glb` (the package VRM turned to rest facing −Z exactly as
`normalize_vrm1_rest_facing` does, `asset.extras.omoba_rest_yaw180` set; fixes P-4), `animations/<slotId>.vrma` (one
per custom slot, for other tools), `manifest-entry.json` (as today), `slot-map.json` (a copy of the slot map),
`README.txt` (run `validate-runtime-vrm` and `validate-motion-pack`, copy into `avatars/`, set
`OMOBA_AVATAR_MANIFEST`). It replaces the OMOBA local test kit for contract targets; the old kit stays for untargeted
characters.

---

## 5. Rules a custom clip must pass

### 5.1 The rule table (v1)

Parameters are data in `contract.rules[]`; the logic of each rule id is code in each implementation. `S` = Studio
(TypeScript, on the document before export and on the written bytes after), `P` = OMOBA passport (Rust; the client
at load, the builder in its sandbox, the CLI), `H` = Hub registry (Python, structural only).

| Rule id | Severity | Check | Params (v1) | S | P | H |
|---|---|---|---|---|---|---|
| `pack.extras` | error | `asset.extras.ekza_animation_set_v1` present, `schema` 1, parses strictly | key, schema | ✓ | ✓ | ✓ |
| `pack.contract` | error | `contract.schema`/`projectId` match; `revision` known and not retired (Hub); known to the build or logged (engine) | — | ✓ | ✓ | ✓ |
| `pack.slot-known` | error | every slot id is in the target view and `customizable` (custom) or in the view (default); every custom-able slot of the view listed once | — | ✓ | ✓ | ✓ |
| `pack.animation-ref` | error | custom slot → existing animation index; the animation's name is one of its referencing slot ids; no two animations share a name | nameEqualsSlot | ✓ | ✓ | ✓ |
| `pack.unreferenced` | warning | animations not referenced by any slot (the builder drops them) | — | ✓ | ✓ | ✓ |
| `pack.bytes` | error | file ≤ 50 MiB, JSON ≤ 4 MiB, accessor bytes of custom clips ≤ 4 MiB, ≤ 48 custom slots | caps | ✓ | ✓ | ✓ |
| `clip.channels` | error | rotation channels only on `drivenBones` mapped by the VRM humanoid; translation only on `hips`; no scale, no morph weights, no channels on any other node (root, spring bones, accessories) | — | ✓ | ✓ | — |
| `clip.sampler` | error | `LINEAR` or `STEP`; times finite, strictly increasing, first key at 0 (±1e-4); values finite; quaternions unit (±1e-3) | eps | ✓ | ✓ | — |
| `clip.keys` | error | ≤ 4096 keys per channel; sample rate ≤ 60 Hz | caps | ✓ | ✓ | — |
| `clip.duration` | error | `minSecs ≤ duration ≤ maxSecs` of the slot's `window` | from slot | ✓ | ✓ | — |
| `clip.in-place` | error | horizontal hips offset from the first key ≤ 0.15 × leg length (`hold`: 0.75); vertical ≤ 0.6 × leg length | units of `legLengthFrom` | ✓ | ✓ | — |
| `clip.loop-closure` | error | loop slots: last pose equals the first within 2° per bone and 0.01 × leg length at the hips | eps | ✓ | ✓ | — |
| `clip.contact` | error | where `contact.required`: `0 ≤ contact ≤ duration`; where edge-released: `(contact − start·duration)/rate ≤ 0.15 s` (+1e-4), with rate 1 and start 0 for custom clips | limit | ✓ | ✓ | — |
| `clip.basic-interval` | warning | a basic clip longer than its `minIntervalSecs` is cut at the fastest attack speed | from slot | ✓ | ✓ | — |
| `rig.*` | error | the existing runtime humanoid rules (passport `humanoid.rs`; Studio `vrm.*`), unchanged | — | ✓ | ✓ | (source check) |

Leg length = the rig's hips-to-feet height, so the limits do not depend on the model's scale. The suggested caps
(0.15 leg length, 1.2 s, 4 MiB) are proposals from the research and are tuned in C0 against the shipped clips. By the
numbers known today every default passes them: default actions play 0.21–0.94 s and every edge-released default
reaches its contact within 0.15 s (prototype run); full-rate clips sway ≤ 0.09 m ≈ 0.11 leg length and the death clip
drifts 0.51 m ≈ 0.63 leg length (research). C0 measures the drift of all 57 clips before freezing the caps.

### 5.2 Verdicts

- **Studio**: an error row blocks *Export package* and *Submit* (the existing Validation gate), with the slot named
  and a fix offered (§8.9). Warnings show and do not block.
- **Builder / Hub**: any custom slot failing an error rule rejects the rendition (exit 2) with a per-slot report; the
  submission shows the reasons. Nothing is silently downgraded at the gate.
- **Engine**: judges each slot independently at load; a failing slot plays its default, logged once with the rule id.
  Never a partial clip, never a whole-avatar rejection for a motion problem (defence in depth: revision drift, a newer
  rule).

### 5.3 Keeping the implementations in sync

1. **One table.** Rule ids and parameters ship inside the contract; implementations read parameters from it and
   never hard-code a number.
2. **Fail closed.** Each implementation declares the rule ids it implements; a contract that lists an id it does not
   know is refused ("needs a newer Studio / OMOBA build"). Adding a rule therefore forces both implementations to
   update before the contract can be published to `live`.
3. **Conformance fixtures owned by OMOBA**: `omoba-bevy/shared/assets/catalog/character-contract-fixtures/v1/`
   holds small synthetic packages (a 15-bone rig, a few clips each) and an `expected/<case>.json` verdict per slot
   (`pass` or the rule ids that fail). At least one case per rule and per boundary (contact 0.149 / 0.151 s, scale
   channel, morph channel, root channel, NaN key, unsorted times, 4097 keys, non-closing loop, hips drift at the cap,
   hips as a scene root with the 180° turn, VRM 0.x and 1.0, shared animation, alias with mismatched contact, unknown
   slot, missing listed slot, retired revision). The Rust passport tests, Studio's `io` tests (copied by
   `tooling/sync-contract.mjs`, with SHA-256 pinning) and the registry's pytest (structural subset) all run them.
4. **Cross-checks**: OMOBA's gate validates the committed contract against its JSON Schema (Appendix A; the schema
   file lives next to the contract) and runs `validate-motion-pack` on a Studio-written package fixture committed by
   C2; Studio's local gate (`pnpm run ci`) validates its bundled snapshot against the same schema.
5. **Licence boundary**: the passport is MPL-2.0 and Studio is MIT; Studio does not compile the passport to WASM. Two
   independent implementations of a small, data-driven table plus shared fixtures are cheaper than the licence and
   bundle cost (≈ 9 kB headroom on `/editor`).

---

## 6. OMOBA side (`omoba-bevy`)

### 6.1 Exporter

- **Generator in the client crate** (phase derivation, telegraph times, row parsing and the motion library live there):
  `OMOBA_WRITE_CHARACTER_CONTRACT=1 cargo test -p client --lib character_contract_is_current` writes the body;
  without the variable the test fails when the committed file is stale (the `vocabulary_doc_is_current` pattern).
- **Wrapper** `scripts/export_character_contract.py --output DIR [--check]` (stdlib Python, the
  `export_asset_catalog.py` pattern) adds `source`, `previousRevision`, the canonical revision and the JSON Schema
  check, and writes `shared/assets/catalog/character-contract.json`.
- The rule parameters live in `shared/assets/catalog/character-contract-rules.json` (data, reviewed like code); the
  generator copies them into the contract.
- **Default preview pack** (optional, C0b): the exporter can also emit each default motion as a `.vrma` on a CC0
  reference rig (`character-contract-defaults/<motion>.vrma` + an Ekza library manifest), so Studio can preview a
  default on the user's character and offer *Start from default* (`CC-Q3`). Without it Studio previews the 14 shared
  starter clips only and shows other defaults as timing ghosts.

### 6.2 Engine: slot resolution

1. **Slot identity on cues.** `MotionCue` (`skill_presentation.rs:220-231`) gains `slot: SlotKey` —
   `Base(Idle|Run|Death)`, `Basic{class, index, mode}`, `Skill{id, part: Release|Recast|Windup}` — set where cues are
   built (skill rows, basic rows with the alternation parity and the weapon mode).
2. **Loading a pack.** On the runtime humanoid path, after `HumanoidRuntimeLibrary::ensure`, the client reads
   `asset.extras.ekza_animation_set_v1` from the retained glTF source (`include_source` is already on,
   `client/src/world.rs:116-126`), validates it with the passport's `MotionPack` (the same Rust code the builder runs)
   against the compiled contract (`include_str!` of the committed snapshot), and for each passing custom slot calls
   `remap_embedded_clip` (`humanoid.rs:115-138`) to add a node: `slot_nodes: HashMap<SlotKey, (node, ClipMeta
   {duration, looping, contact})>`. Base slots replace `idle_node`, `run_node`, `death_node`.
3. **Resolution.** `CharacterAnimationSet::resolve(&cue) -> Resolved {node, duration, looping, contact, rate, start}`:
   the pack's slot node with rate 1 and start 0 and its own metadata, else the row's library motion with the row's
   rate and start. `motion()`, `owns()` and `playing_cue()` go through `resolve`.
4. **Metadata from the resolved clip.** Every timing consumer that reads `SharedHumanoidMotion::embedded()` today —
   wind-up fitting, `play_secs` for facing, `windup_entry_secs` for late joins, the muzzle-flash window
   (`skill_presentation.rs:254-283`, `held_weapons.rs:364-390`) — reads `Resolved` instead.
5. **Per-slot fallback.** A slot that fails validation or remapping is absent from `slot_nodes` and plays its
   default; logged once per avatar and slot with the rule id.
6. **Preview and party stage** (`frontend/preview.rs`, `frontend/party_stage.rs:550`) build the same set and call the
   same `resolve`; the collection preview gains a debug list "custom: base.run, basic.wildspark.0, …".
7. **Caching**: the per-model cache keyed by the glTF asset already covers an embedded pack (never evicted —
   pre-existing; mobile memory unmeasured, §12 R13).
8. **Review capture**: `scripts/capture_standard_skills.py --phases --avatar <glb>` renders every slot of a view for
   the owner's review.

### 6.3 Which hero a character is for (decision D8)

Avatars stay hero-independent, as OMOBA's design says ("keep appearance separate from build",
`docs/plans/creator-loop-and-class-builder.md:170-176`). The slot keys decide what plays:

| Slot | Plays when |
|---|---|
| `base.*` | the avatar is played on **any** class |
| `basic.<class>.*` | the avatar is played as `<class>` (the basic attack belongs to the class body) |
| `skill.<id>.*` | the avatar casts skill `<id>` — on its home class, a borrowed kit or the lab |

The package's `target.hero` is a label: the market and locker show "Made for Wildspark", and choosing the avatar
pre-selects Wildspark (the player can change it). A character made for `any` carries base slots only. A hero lock
(collab characters playable only on their hero) is `CC-Q1`; if chosen, it is a catalogue flag enforced by the client's
equip UI and the server's admission, not a protocol change.

### 6.4 Passport: `validate-motion-pack`

New in `passport/src/motion_pack.rs`: `MotionPack::parse(json, bin, contract) -> PackVerdict {slots: [{slot, mode,
verdict: Pass | Fail(rule ids), measured: {duration, contact, hipsDrift, seamDegrees}}], pack: Ok | Reject(rule ids)}`;
bounded parsing (JSON ≤ 4 MiB, ≤ 4096 keys per channel, ≤ 48 custom slots), no allocation from untrusted counts
beyond the caps. CLI `cargo run -p omoba-passport --bin validate-motion-pack -- --contract <file> <glb> [--report
<json>]`, exit 0 / 2 / 1 like the rendition builder's contract. `validate_humanoid_profile` gains the v2 profile:
the runtime humanoid rules plus `MotionPack` (no five-clip requirement).

### 6.5 Builder `omoba-humanoid-glb-v2`

A second mode of `scripts/ekza_build_rendition.py` (sandboxed Docker, no network, stdout-JSON contract, output named
by content hash):

1. Validate the source with the runtime humanoid check (as v1, with PR #106 for VRM 1.0).
2. Turn VRM 1.0 roots to rest facing −Z (`normalize_vrm1_rest_facing`). If `hips` is itself a scene root, insert a
   parent node first so the hips rotation and translation keys keep their meaning (fixture case).
3. Keep the custom animations, drop unreferenced ones; **do not append** the five generic clips.
4. Run the Rust `validate-motion-pack` (built from the pinned `omoba-bevy` ref inside the image — no Python copy of the
   motion rules; ends the drift risk of `ARCHITECTURE.md:241-242` for v2).
5. Exit 2 with the per-slot report if any custom slot fails; else write the rendition and the report
   (`renditions.report_key`): per slot custom/default, verdict, measured values.

The **v1 rendition** of the same revision is still built (`omoba-humanoid-glb`, five clips appended, custom clips kept
and unused) so clients without v2 support show the character with OMOBA's motions (`CC-Q4`).

### 6.6 Profile, SDK, server

- Registry profile `desktop/humanoid-glb-v2` version 1 (§7.1); OMOBA `project_accepts` it.
- SDK: `SupportSelector::omoba_desktop_v2()` next to `omoba_desktop()`; the client queries v2 first and merges per
  avatar id (a v2 approval wins over a v1 one). The slug stays `ekza-<sha256(avatarId \n renditionSha)>`, so a v2
  rendition has its own slug.
- Server admission (`server/src/passport_admission.rs`) accepts free approved slugs of either profile (same TTL and
  retry); paid tickets unchanged.
- **Old clients** see a v2 slug in a join packet that their v1 catalogue does not list. C3 verifies that they show the
  default skin (and do not stall); if they do not, the v2 release ships with the next protocol version (§12 R1).

### 6.7 Protocol impact

None on the wire: the pack is inside a content-addressed avatar file and slot resolution is client-side cosmetic.
Server gameplay never reads clips (`common/src/sim/cast.rs:217-232`). The only server change is admission of v2
slugs.

### 6.8 Test channel in the client

`OMOBA_ASSET_CHANNEL=test` (OMOBA Dev builds and the dev lobby) adds `&channel=test` to catalogue queries; release
builds always use `live`. The dev lobby (UDP 4100 on the dev contour) runs a server with the same flag, so admission
sees test approvals.

### 6.9 Files that would be added or changed in `omoba-bevy` (not in this PR)

`shared/assets/catalog/character-contract.json`, `character-contract.schema.json`, `character-contract-rules.json`,
`character-contract-fixtures/v1/**`; `scripts/export_character_contract.py`; `client/src/character_contract.rs`
(generator test); `client/src/player/animation.rs`, `client/src/skill_presentation/{mod,schema}.rs`,
`client/src/humanoid.rs`, `client/src/frontend/{preview,party_stage}.rs`, `client/src/held_weapons.rs`;
`passport/src/{motion_pack.rs,lib.rs,store.rs}`, `passport/src/bin/validate-motion-pack.rs`;
`scripts/ekza_build_rendition.py`, `scripts/retarget_animations.py`; `server/src/passport_admission.rs`;
`docs/character-contract.md`, `docs/humanoid-motion.md` (the "versioned runtime-humanoid profile" section becomes
real), `docs/combat-cosmetics.md`.

---

## 7. Hub side (`ekza-registry`)

### 7.1 Contract registry

Migration `…_character_contracts.sql`:

- `studio.project_contracts(project_id, revision text check (revision ~ '^sha256-[0-9a-f]{64}$'), schema text,
  document jsonb, bytes int, previous_revision text null, compatibility text check in ('compatible','breaking',
  'initial'), status text check in ('active','retired') default 'active', published_by uuid, created timestamptz,
  primary key (project_id, revision))` — the server recomputes the canonical revision on insert and rejects a mismatch
  or a schema violation.
- `studio.project_contract_channels(project_id, channel text check in ('test','live'), revision, updated_by,
  updated, primary key (project_id, channel))`, audited in `submission_events` style.
- `rendition_profiles.builder` check gains `omoba-humanoid-glb-v2`; insert `('desktop','humanoid-glb-v2',1,'omoba',
  'omoba-humanoid-glb-v2','glb', {"source":{"formats":["vrm1","vrm0"],"maxBytes":52428800,"humanoid":true,
  "animationSet":"ekza_animation_set_v1"}, "rendition":{"format":"glb","selfContained":true,"maxBytes":52428800,
  "animations":{"required":[],"slotMap":true,"report":true}}})`; `project_accepts` adds it for `omoba`.
- **Requirements derived from the contract**: on publish, upsert one `project_requirements` row per view —
  `character.<hero>` (and `character.any`), `asset_kind 'avatar'`, profile `humanoid-glb-v2`, title "Character for
  <Hero>", description from the view; rows are never deleted, only deactivated.

Routes:

| Route | Who | Notes |
|---|---|---|
| `GET /v1/projects/{p}/contracts` | public, CORS `*`, ETag | list: revision, compatibility, status, channels, created |
| `GET /v1/projects/{p}/contracts/{rev}` | public, CORS `*` | the document; `Cache-Control: public, max-age=31536000, immutable` |
| `GET /v1/projects/{p}/contracts/channel/{test\|live}` | public, CORS `*` | the current revision of a channel, short cache |
| `GET /v1/projects/{p}/contracts/{rev}/files/{sha}` | public | default preview files (C0b), CC0 |
| `POST /v1/studio/projects/{p}/contracts` | project owner / CI | upload a document |
| `POST /v1/studio/projects/{p}/contracts/{rev}/channel` | project owner | `{channel}`; refuses a breaking move to `live` without `breaking: true` |
| `POST /v1/studio/projects/{p}/contracts/{rev}/retire` | project owner | packages on it are refused at submit; approved releases stay |

Public routes live outside `/v1/studio/` (which is `no-store`). MVP publishing is the operator CLI:
`studio_cli project-contract publish --project omoba --file character-contract.json [--channel test]` and
`studio_cli project-contract select --project omoba --channel live --revision sha256-…`, fed by OMOBA's exporter.

### 7.2 Submission intent

A submission for a character carries `{projectId: "omoba", requirementId: "character.<hero>", contractRevision,
channel: "test"}`. `studio.submissions` gains `contract_revision text null` (checked against `project_contracts`,
`active`). The requirement must match the slot map's `target`.

### 7.3 `check_animation_set`

`backend/app/services/animation_set.py`, run on source upload when the intent names a contract (independent of the
`EKZA_STUDIO_SOURCE_VALIDATION_ENABLED` flag, P-9) and again on the builder output in `check_rendition`: parse the GLB
JSON chunk within the existing budgets; apply the `pack.*` rules of §5.1 (Appendix C schema, revision active, target
view, listed slots, animation references, byte caps); for the rendition, require the builder report to pass every
custom slot and the rendition's slot map to equal the source's (no silent drops). Motion rules are the builder's
(Rust); the registry does not re-implement them.

### 7.4 Gates: curator, rights holder, OMOBA owner

1. **Curator** approves the revision (moderation; unchanged).
2. **Rights holder** countersigns, for collab characters only (§7.6).
3. **Builder** makes the v2 (and v1) renditions; `check_rendition`.
4. **OMOBA owner** approves into **test**: the queue shows the slot table (custom vs default per slot, measured
   duration and contact from the builder report, the rights panel) and links the test channel. Approval creates a
   `test` release pointer.
5. **Promote to live**: a second owner action; creates the `live` pointer. Revoke and takedown as today.

`CC-Q6` asks whether curator and owner may be one step for OMOBA characters.

### 7.5 Channels

`studio.project_releases` gains `channel text not null default 'live' check in ('test','live')`; the primary key
becomes `(avatar_id, project_id, platform, profile, channel)`; `active_project_releases` exposes it; `/v2/avatars` and
`/v2/assets` take `channel=test|live` (default `live`). Existing rows become `live` (backfill by default value).

### 7.6 Rights and licence per revision

- `studio.revisions` gains `license_snapshot text`, `attribution_snapshot text`, `license_sha256` (set at submit;
  immutable afterwards).
- `studio.revision_rights(revision_id, role in ('creator','co_author','rights_holder'), party_profile_id uuid null,
  invite_email_sha256 text null, terms_text text, terms_sha256 text, scope text, consented_at timestamptz null,
  withdrawn_at timestamptz null)` — the commerce consent pattern (exact hash, `I_ACCEPT`, immutable rows, withdrawal
  as a new state).
- **Collab gate (SQL)**: an owner decision on a submission whose revision has a `rights_holder` row is refused until
  every rights holder of that revision has `consented_at` and no `withdrawn_at`. Withdrawal after approval revokes the
  release pointers (tombstone; catalogue stops listing it; clients drop it at the next catalogue refresh).
- The default terms text, the scope wording and the withdrawal semantics are legal decisions (`CC-Q5`, `CC-Q13`).

### 7.7 Auth from the editor: two options

| | **A. Hub submit page + `postMessage`** (recommended for the MVP) | **B. OAuth code + PKCE, scoped token, CORS write routes** |
|---|---|---|
| Editor holds | nothing (no token, no cookie) | a `studio-upload` access token in memory, refresh in storage |
| New Hub surface | one signed-in page `/studio/submit` (BFF cookies, existing allow-listed routes) | an authorization page, `POST /v1/account/oauth/token`, a PKCE client registry, `/v1/creator/*` write routes with an exact-origin CORS allow-list |
| Consent and licence UI | on Hub, under Hub's terms — where it must be recorded anyway | rebuilt in the editor, or a Hub hop anyway |
| Network from the editor | none (a navigation and `postMessage`) — Studio's same-origin privacy rule (FR-AR-11, NFR-08) holds | cross-origin `POST`s — needs an exception to the privacy rule |
| iPad Safari | `window.open` on the tap; works if neither page sets COOP `same-origin` | works; redirects must avoid the editor's `/studio/*` rewrites |
| Agents / headless | not usable (needs a person) | usable (device code already exists for MCP) |
| Status in the editor | the reply carries the status URL; no polling | can poll |
| Size | S (≈ 3 days registry web + 2 days Studio) | L (≈ 8–10 days, security review) |
| Owner-gated prod changes | editor origin allow-list on Hub | PKCE client, Supabase redirect allow-list, CORS allow-list |

**Recommendation: A for the MVP** — smallest attack surface, no tokens in a static editor, consent captured where it is
legally recorded, keeps Studio's privacy promise, fits iPad. B follows (C5b, after the MVP) for agents and in-editor
status; it reuses the hashed, revocable `studio_account_link` tokens with a new `studio-upload` scope. ADR 0010 §1 T3
(device-code login) and ROADMAP M4a are rewritten accordingly (§8.17).

**`ekza-studio-submit/v1`** (both directions check `event.origin` against allow-lists; `nonce` from the editor):

```
editor → opens  https://hub.ekza.io/studio/submit?v=1&nonce=<128-bit>&origin=<editor origin>   (on the tap, synchronously)
hub    → opener {type:'ekza-studio-submit/v1', event:'ready', nonce}               (after sign-in)
editor → hub    {type, event:'package', nonce, files:{source: ArrayBuffer, thumbnail: ArrayBuffer} (transferred),
                 manifest:{name, kind:'avatar', fileName, sha256, bytes, thumbnailSha256, contract:{projectId, revision},
                           target:{hero, requirementId}, slots:{custom:[…], default:[…]}, license:{preset, text},
                           attribution, collab:{rightsHolder?: email|null}, hubAssetId: uuid|null}}
hub    → opener {type, event:'submitted', nonce, assetId, revisionId, submissionId, statusUrl}
              | {type, event:'error', nonce, code, message} | {type, event:'cancelled', nonce}
```

The Hub page re-hashes the bytes, re-runs `check_animation_set` client-side for an early message, shows the slot
table, licence and rights fields, and on **Submit** calls the existing BFF routes (create asset or new revision of
`hubAssetId`, upload source and thumbnail, submit with the intent). Fallback when the window is blocked or closed:
*Download package* and Hub's normal upload page, which reads the slot map from the file.

### 7.8 Dev contour test plan (C7)

On `registry.dev.ekza.io` / the dev Hub / `app.dev.omoba.io` / the dev lobby: (1) set the dev builder's `DEV_BEVY_REF`
to an `omoba-bevy` ref with #106 and C3–C4 (P-7); (2) apply the dev migrations; (3) publish the contract from OMOBA's
exporter with the CLI, channel `test` and `live`; (4) serve a Studio preview build on the editor's dev origin with the
dev Hub in its allow-list; (5) run the four flows of §9 with a seeded creator, curator, OMOBA owner and rights-holder
account (signup is closed on dev: accounts by the operator CLI); (6) approve into `test`, play in the dev lobby with an
OMOBA Dev build (`OMOBA_ASSET_CHANNEL=test`), capture every slot, promote to `live`, check that a release-channel
client sees it; (7) negative cases: a failing slot (rejected with the per-slot report), a retired revision, an
unsigned collab, a withdrawn consent. Evidence in `docs/evidence/cc-e2e/` of this repo. Limits: one match at a time,
3.4 GB RAM (no Rust builds on the box — the builder image is built elsewhere and pulled).

### 7.9 Files that would be added in `ekza-registry` (not in this PR)

`supabase/migrations/<date>_character_contracts.sql`, `<date>_release_channels.sql`, `<date>_revision_rights.sql`;
`supabase/tests/character_contracts.sql`; `backend/app/api/contracts.py`, `backend/app/services/animation_set.py`,
`backend/app/services/profile_checks.py` (v2), `backend/app/cli/project_contract.py`; `web/app/routes/studio.submit.tsx`
and `web/app/lib/studio-submit-bridge.ts`, the owner queue's slot table, the rights-holder approval page;
`deploy/worker` builder mode; `docs/character-contract.md`, `backend/STUDIO.md`.

---

## 8. Studio side (`ekza-studio`)

### 8.1 Contract loading

Strict, lazy parser `packages/io/src/contract/` (the `library/manifest.ts` style): JSON Schema-equivalent checks in
code (no schema library in the bundle), canonical revision recomputed, unknown rule ids refused. Sources, in order:

1. the copy **pinned in the document** (the target record, §8.2) — a project always reopens against the contract it
   was made for, offline;
2. the **bundled snapshot**, same origin: `apps/web/public/contracts/omoba/index.json` (revisions, channels, SHA-256)
   and `…/<revision>.json`, refreshed by `tooling/sync-contract.mjs` from a pinned OMOBA tag or the registry (with the
   conformance fixtures);
3. **live** from Hub (`GET …/contracts/channel/live`, CORS `*`, no credentials) — only on an explicit tap (*Check for
   a newer contract*) and on *Submit*; a privacy-rule exception owned by `CC-Q8`;
4. a deep link `…/app?target=omoba/<hero>&rev=<revision>` (also `/editor`, `/autorig`) binds on arrival if the
   revision is bundled or fetchable.

A new optional `EditorServices.contracts` member (next to `libraryPath`, `editor-core/src/types.ts:598-618`) resolves
these; Cache Storage keyed by SHA-256 keeps fetched revisions.

### 8.2 Target binding in the document

Extension table `ekza.targets` via `registerTable` (`doc/src/tables/registry.ts:141-165`), partition `char:<id>`, so
older builds keep the rows untouched and `SCHEMA_VERSION` 4 stays:

```ts
interface TargetRecord {
  readonly id: TargetId;
  readonly character: CharacterId;
  readonly project: 'omoba';
  readonly contract: { readonly schema: 'omoba.character-contract.v1'; readonly revision: string };
  readonly document: string;                      // the canonical contract JSON, pinned
  readonly hero: string;                          // a view id ('wildspark' | 'any' | …)
  readonly aliases: Readonly<Record<string, string>>;   // slot → slot whose clip it reuses
  readonly hub: { readonly assetId: string | null; readonly lastRevisionId: string | null };
  readonly deleted: Tombstone;
}
```

One target per character. Operators (lazy chunk behind an `isTargetOperator` prefix check, like
`isRigWorkspaceOperator`): `target.bind {character, hero, revision?}`, `target.unbind`, `target.update {revision}`
(explicit; never edits clips), `target.slot.create`, `target.slot.assign {slot, clip}`, `target.slot.clear {slot}`
(sets the clip's slot to null → default), `target.slot.alias {slot, to | null}`, `target.fix {slot, rule}`,
`target.recordSubmission {assetId, revisionId}`. Each is one undo step. **Open vocabulary (ADR 0010 §5 amendment)**:
`slotProblem` accepts vocabulary v1 plus the bound contract's slot ids for that character; `clip.setSettings`
enforces one clip per contract slot per character.

### 8.3 The slot status function

`editor-core/src/workflows/target/status.ts`, pure, never stored:

```ts
type SlotStatus =
  | { readonly kind: 'custom'; readonly clip: ClipId; readonly via: 'own' | 'alias'; readonly issues: readonly ContractIssue[] }
  | { readonly kind: 'invalid'; readonly clip: ClipId; readonly issues: readonly ContractIssue[] }   // ≥ 1 error
  | { readonly kind: 'default' }                                     // no clip; OMOBA plays its own
  | { readonly kind: 'missing' }                                     // required, no clip, no default (none in v1)
  | { readonly kind: 'fixed' };                                      // not custom-able in this schema (wind-ups)
interface SlotRow { readonly slot: string; readonly label: string; readonly group: 'base' | 'basic' | 'skill';
  readonly key: 'q' | 'w' | 'e' | 'r' | null; readonly status: SlotStatus; readonly timing: string;   // "↻ 0.67 s · in place"
  readonly target: { readonly secs: number; readonly contactSecs: number | null } }
function slotStatuses(app: EditorApp, character: CharacterId): { readonly rows: readonly SlotRow[];
  readonly counts: { custom: number; default: number; invalid: number; missing: number; fixed: number };
  readonly extras: readonly ClipId[] }                               // clips OMOBA will not use
```

It feeds the Pro panel, Auto-Rig ④/⑤, Halo's chips, readiness and Share card, Validation rows (new area
`'animation'` in `RigValidationRow.area`) and `target_describe`.

### 8.4 Pro: the *Target* panel

Lazy panel (`editor/src/panels/registry.ts`, `lazyPanel.tsx`) next to Clips; also reachable from *Target ▾* in the
Clips header and from Export.

```
Target · OMOBA · Wildspark  rev 89fd2e… ✓            [Check for newer] [⋯]
4 custom · 4 game default · 1 to fix
BASE
  ● Idle                ↻ 2.50 s · in place          [▶ A/B] [Clear]
  ○ Run                 game default · ↻ 0.67 s      [▶] [Start from default] [From library ▾] [New] [Assign ▾]
  ○ Death               game default · 2.38 s
BASIC ATTACK
  ● Basic attack        0.27 s · contact 0.05 s ◆     [▶ A/B] [Clear]
  ⚠ Rocket mode         contact 0.21 s > 0.15 s       [Fix: Move contact ▸] [Fit timing]
Q  Switchfire           ○ game default · 0.30 s
W  Shockline            ● 0.55 s · contact 0.04 s
E  Snapline             ○ game default
R  Last Spark           ● same clip as Rocket mode   [Unlink]
Not used by OMOBA: Wave, Jump                         [Map to a slot ▾]
```

Row click activates the clip; *A/B* toggles the default (where previewable) against the custom clip on the character.
Contract-locked fields in Clip Settings (loop, root motion, slot) show "from contract" with an *Unlock* that unbinds
the slot. Export ▸ *Package for OMOBA…* reuses the character checks and VRM meta fields, then *Download* or *Submit ▸*.

### 8.5 Auto-Rig ④ and ⑤ (contract mode)

- ④ *Animations*, when a target is bound (or chosen on the step's new first line *For: OMOBA · Wildspark ▾*): the
  checklist replaces the free clip list — "For OMOBA · Wildspark: 4 custom · 5 game default · 0 to fix"; per row
  [Game default ▶] [Pick from library] [Drop .vrma] [Animate in Studio ▸]; the note "OMOBA uses its own motions"
  (`AnimationsStep.tsx:431-459`) becomes "Empty slots use OMOBA's own animations".
- ⑤ *Export*: new target `omoba-hero` (`AutoRigExportTarget`, `ExportStep.tsx:40`) — "OMOBA character package" with
  *Download* and *Submit to OMOBA*; left-out clips list *Add as <slot>* with contract slots (`leftOut.ts:27-65`).

### 8.6 Halo: slot chips and *Fill for OMOBA*

Fits STUDIO-TOUCH-SPEC v0.2 without new surfaces:
- **Destination from the document** (§7.3 there): a bound target is the destination; Share's header reads
  *For: OMOBA · Wildspark*; the Rig-it card's first line offers *OMOBA · <hero> ▾* next to the existing destinations;
  `HaloHandoffState.destination` is derived, not stored.
- **Readiness** (§7.2 there): the Animate stage's rows are the `invalid` and `missing` slot rows; `default` is never a
  problem. The Next chip reads *Make it yours: 9 animations (optional) ▸* then *Submit to OMOBA ▸*.
- **Animations row** (§10.6 there): one chip per slot of the view — `●` custom, `○` default (dimmed, game icon), `⚠`
  invalid; first tap selects and opens its Halo: *Preview default · Make my own · From library · From file · Check ·
  Use default*; ⋯ More holds *Same clip as…*, *Mirror for the second swing*, *Fit timing*.
- **Thread** (§10.3 there): contact ◆, the duration bracket and the telegraph band (§8.8).
- **Recipe** *Fill for OMOBA* (§9.11 there, shared with the MCP prompt): for each slot the person picks — library
  clip with preview, or blank from the contract → loop it → check → next; *Submit to OMOBA* at the end.
- **Share card**: *OMOBA · Wildspark — Ready ✓ · 4 yours, 5 game* → *Export package* / *Submit to OMOBA*.

### 8.7 Slot clip setup from the contract (composition)

`target.slot.create {slot, from: 'blank' | 'library' | 'default' | 'file', libraryClip?, params?, file?}` = one history
group over existing operators: `clip.create`, or `library.useClip {speed, trim, mirror, inPlace, armSpace}`, or the
animation import; then `clip.setSettings {slot, fps: 30, loop: slot.loop, rootMotion: 'in-place', contact:
frame(target.contactSecs), range: blank ? [0, round(window.targetSecs · fps)] : as-is}`; the clip name is the slot
label, sanitized. Variants: *Same clip as…* = `target.slot.alias` (both slots map to one animation in the package);
*Mirror for the second swing* = `pose.mirrorAnimation` onto a copy assigned to the `alternatesWith` slot.

### 8.8 Timeline markers

A painter layer on the time slider and Thread (`curve-editor` / time-slider overlay), lazy with the contract chunk:
**contact ◆** at the clip's contact frame (dragging it runs `clip.setSettings {contact}`); **target bracket**
`[min … target … max]` of the window, red beyond `max`; **limit tick** at 0.15 s for edge-released slots; **telegraph
band** before frame 0 for releases of held phases ("game wind-up plays first, 0.8 s"); for v1.1 wind-up slots the band
becomes the editable clip.

### 8.9 Per-slot validation and fixes

On the document, before any bytes: slot known, loop flag, fps ≤ 60, duration in the window, root motion in place,
contact present and ≤ 0.15 s where edge-released, loop seam within 2° (via the public `clip.makeLoop {dryRun: true}`
wrapper the touch spec adds, §20.3 item 7 there), hips drift from the hips track, rotation-only on driven bones
(Studio's rig keys controls only; the bake lint `ekza.hips-only-translation` already exists). After writing: the full
TypeScript rule set on the bytes (read-back), the same as the passport. Fixes, each one operator run: *Make loop*,
*Set in place*, *Fit timing* (`key.retime` scaling the range to `targetSecs`, or clamping into the window), *Move
contact* (to `targetSecs`), *Use default* (clear). Foot slide, pops and contact suggestions wait for motion-analysis P4.

### 8.10 Package export

`file.exportCharacter` gains `profile: 'ekza/omoba-humanoid-v2'` and `clips: 'target'` (the custom slots of the bound
target, aliases resolved); the writer names each animation by its primary slot, writes `ekza_animation_set_v1`
(Appendix C) and `ekza_animation_v1`, and runs the rule set on the written bytes. New built-in profile
`ekza/omoba-humanoid-v2` — "OMOBA character (VRM 1.0 with your animations)", `requiredClips` = the view's required
slots (none in v1), rules = the VRM rules + `contract.*`; `MODEL_CHARACTER_PROFILE_IDS` gains it (lifting the
model-character restriction for this profile only). `ekza/omoba-humanoid-v1` stays for asset-sourced characters
(P-5). The dev zip (§4.2) is `kind: 'omoba_dev_zip'`.

### 8.11 Submit

*Submit to OMOBA* (Pro Export, Auto-Rig ⑤, Halo Share): the package is baked first (the touch spec's `SaveTicket`
pattern), the button turns active, the tap opens the Hub page synchronously and runs `ekza-studio-submit/v1` (§7.7);
on `submitted` it runs `target.recordSubmission` and shows *Submitted · waiting for review · Open in Hub ▸*. The
button is hidden until the bundled index says the profile is accepted on Hub (`index.json` `submit: true`), so Studio
never offers a path Hub cannot take. Allow-lists: Hub origins `https://hub.ekza.io` and the dev Hub; editor origins on
Hub: `https://studio.ekza.io`, the editor's dev origin, `http://localhost:3000` in dev builds only (`CC-Q12`).

### 8.12 Contract versions

On *Check for newer* or *Submit*, when the live revision differs from the pinned one: a diff card — slots added,
removed, newly custom-able, window or contact changes on slots this character fills, rule changes — with *Update to
<rev>* (`target.update`, one undo step, clips untouched; statuses recompute) or *Keep* (Hub accepts any active
revision). A retired pinned revision blocks *Submit* with the diff card open.

### 8.13 AI agent tools

Toolset bump (minor; manifest and `docs/agent-tools-reference.md` regenerated): `target_describe {character?}` (read:
view, rows, counts, rules in words), `target_bind {hero, revision?}`, `target_slot_create {slot, from, libraryClip?,
params?}`, `target_slot_clear {slot}`, `target_fix {slot, rule}`; `library_use` gains `slot` (any slot string; the
clip id enum becomes dynamic from the loaded packs); `project_export {kind: 'omoba_hero' | 'omoba_dev_zip'}`. MCP
prompt `fill_target_slots`: describe → for each slot the user asked for, library or blank → loop → check →
export, one history group with *Undo all*. Submit is never an agent action (it needs the person on Hub).

### 8.14 Metadata round-trip

`EkzaClipMetaV1` gains `label: string | null` (ADR 0010 rev. 3), written only when non-null so the M1 golden bytes stay
(`io/test/m1-bytes.test.ts`); `normalizeClipMeta` key order updated. Importers restore `slot`, `contactSeconds`,
`rootMotion`, `tags` and `label` for Studio-written files (tool `ekza-animator`), and an imported package with
`ekza_animation_set_v1` offers *Restore the OMOBA target* (needs the revision: pinned, bundled or fetched).

### 8.15 Bundle

All lazy: one `contract` chunk (parser, status function, rules, package extras writer reusing the lazy io write entry,
timeline painter), the Target panel, the operators behind the prefix check. Eager: ≤ 512 B per route (`/editor`
headroom ≈ 9 kB, `/autorig` ≈ 8 kB); no new dependencies (`fflate` exists). Halo's `/app` counts it in its own gate.

### 8.16 Tests

`io`: strict parser on the bundled snapshot and on broken copies (unknown key, wrong revision, unknown rule id, higher
schemaVersion); the conformance fixtures (§5.3) through the TypeScript rules; metadata determinism with goldens
unchanged; package and dev-zip determinism; VRMA round-trip of label, slot, contact. `editor-core`: `slotStatuses`
(each status, aliases, extras), `target.*` undo, contract diff v1→v2. `headless-tests`: sample rig → bind → fill three
slots → export → read back → `ekza_animation_set_v1` equals expectation; `tooling/omoba-validate.mjs` (opt-in) runs
`validate-motion-pack` on it. `agent-evals`: "fill the missing slots". Playwright: Pro Target panel, Auto-Rig ④
contract mode, Halo chips and readiness (`webkit-ipad`), Submit with a mocked Hub window (`postMessage` both ways,
origin rejection, blocked window fallback), offline contract (no network at all), the privacy test still passing on
the default flow.

### 8.17 Documents that change with the implementation

ADR 0010 (§1 rows T2 and T3, §5 open vocabulary, §6 drop "OMOBA admits but does not play custom humanoid clips yet"
once C3 is live, §8 add `ekza-studio-submit/v1`); MVP-SPEC §4.4 (`EkzaClipMetaV1.label`, the new request values);
AUTORIG-SPEC §5.5, §5.6; MCP-SPEC tools; STUDIO-TOUCH-SPEC §7.2, §7.3, §9.11, §10.6, §13.3; ROADMAP M4a; FEATURES;
GLOSSARY (contract, slot, target, package, channel). The banner and problem texts in `io/src/profiles/character.ts`
change only when the profile is accepted on Hub (P-6).

---

## 9. Owner-visible UX: tap by tap

Touches as in STUDIO-TOUCH-SPEC §9 (one tap, drag or filled field; orbit and zoom not counted). Halo on an iPad unless
noted.

### F1 — "Rig it and submit" (all defaults)

1. On Hub's Wildspark page, *Make a Wildspark character in Ekza Studio* (1) → Studio opens with *For: OMOBA ·
   Wildspark* bound from the bundled snapshot.
2. *Bring a model* (1) → pick the file (1).
3. Next chip *Rig it for me ▸* (1) → the card already says *For: OMOBA · Wildspark* → *Rig it* (1). The character
   plays its motion test.
4. Next chip *Submit to OMOBA ▸* (1). Share card: *OMOBA · Wildspark — Ready ✓ · 0 yours, 9 game animations*.
5. First time only: author (1), licence (1); *Who made it?* — *I did* is first (1).
6. *Submit to OMOBA* (1) → the Hub tab: sign in if needed (email + password: 3) → the summary shows nine "game
   default" rows → *Submit* (1). Studio: *Submitted · waiting for review*.

**11 touches** (+3 to sign in). Pro: Target ▾ (2), Export ▸ Package for OMOBA (1), Submit (1) + Hub (1). Auto-Rig:
④ *For: OMOBA · Wildspark* (2), ⑤ *Submit to OMOBA* (1) + Hub (1).

### F2 — Custom run and basic attack (Pro, desktop)

1. Clips header *Target ▾* → OMOBA → Wildspark (2). The Target panel lists nine `○` rows.
2. *Run* row → *From library ▾* → *Run (sprint)* (2) → preview on the character → *Use* (1). Row: `● Run ↻ 0.67 s ·
   in place`.
3. *Basic attack* row → *New* (1): a blank 8-frame clip (0.27 s at 30 fps), contact ◆ at frame 1 (0.045 s → rounded to
   0.033 s), in place, the target bracket on the time slider. The person poses and keys it (animation work, not
   counted).
4. Validation: the other seven rows stay `○ game default` and need nothing. If the swing came out at 0.42 s with
   contact 0.20 s: row `⚠ contact 0.20 s > 0.15 s` → *Fix: Move contact ▸* (1) or *Fit timing* (1).
5. Export ▸ *Package for OMOBA…* (1) → *Submit ▸* (1) → Hub *Submit* (1).

**≈ 11 touches** plus the animation work.

### F3 — Full hero kit

Pro or Halo: nine rows filled — idle and death from the library, run edited from the library clip, two basics and four
releases keyed by hand; *Same clip as Rocket mode* on *Last Spark* (2 touches) so one clip serves both; *Check* shows
every row `●`; *Submit*. Halo's *Fill for OMOBA* recipe walks the nine slots in view order with *Preview default ·
Make my own · From library · From file* on each and shows *7 of 9 · Last Spark* in its stepper; *Use default* on any
slot skips it. With the AI agent (desktop): "fill the empty slots with library clips, keep my basic attack" →
`fill_target_slots` → one history group, *Undo all*.

### F4 — Collab character with the rights holder's approval

1. The creator (for example the artist's studio) builds the character as in F3.
2. *Submit to OMOBA* → Hub page → *Who made it?* → *Licensed character (collab)* (1) → rights holder's email or Hub
   account (1) → the terms shown with their hash (scroll) → *Submit* (1).
3. Hub invites the rights holder (email when SMTP is on; Hub inbox otherwise). Their *Approve this character* page shows
   the revision hash, a turntable and the slot table (which animations are the creator's, which are the game's), and
   the terms → *I approve* (`I_ACCEPT`, 1).
4. Curator approves; the builder makes the renditions; OMOBA's owner sees *Rights: approved by <name> on <date>* →
   *Approve for testing* (1) → plays it in the dev lobby with an OMOBA Dev build → *Promote to live* (1).
5. In the game the market lists it as *Made for Wildspark · with <artist>*. The rights holder can withdraw consent on
   Hub; the release is taken down from the catalogue.

---

## 10. Delivery plan

Sizes in agent-days (S ≤ 3, M 4–6, L 7–10). Each package is a branch and PR into its repository's `dev`.

| WP | Repo | Scope | Size | Depends | Owner OK needed |
|---|---|---|---|---|---|
| **C0** contract + exporter | omoba-bevy | Rust generator test + `export_character_contract.py` + committed snapshot, JSON Schema, rule table, conformance fixtures v1, `docs/character-contract.md`; C0b default preview VRMAs (optional) | M (5; +3 C0b) | — | no for `dev` (agents merge their own PRs after green tests); the contract licence CC0 (`CC-Q3`) |
| **C1** Studio read + checklist | ekza-studio | `io/src/contract` parser, `sync-contract.mjs`, bundled snapshot, `ekza.targets`, `target.*` operators, `slotStatuses`, open vocabulary, Pro Target panel (bind, assign, clear, alias, A/B), Validation area `animation` | M (6) | C0 (snapshot; a draft snapshot unblocks it) | — |
| **C2** package + lints | ekza-studio | TypeScript rule set on document and bytes, fixtures runner, fixes, timeline markers, `target.slot.create`, `ekza/omoba-humanoid-v2`, package writer + slot map, dev zip with the −Z turn, `EkzaClipMetaV1.label` + round-trip, a package fixture for OMOBA | L (8) | C0, C1 | — |
| **C3** engine slot resolution + passport | omoba-bevy | `SlotKey` on cues, pack loading, `resolve`, timing from the resolved clip, per-slot fallback, preview + party stage, `motion_pack.rs` + `validate-motion-pack`, v2 profile in `validate_humanoid_profile`, SDK v2 selector + merge, server admission, test channel flag, old-client check | L (9) | C0 | OMOBA `main` merge and release |
| **C4** builder + profile + registry | omoba-bevy + ekza-registry | builder `omoba-humanoid-glb-v2` (Rust passport inside), v1 still built; migrations (contracts, channels, builder enum, profile row, accepts, requirements), public contract routes, owner routes, CLI, `check_animation_set`, `check_rendition` v2 | L (8) | C0, C3 (passport) | **prod migrations**, **prod worker update**, registry deploy |
| **C5** submit + channels + rights | ekza-registry + ekza-studio | Hub submit page + `ekza-studio-submit/v1`, Studio Submit + `recordSubmission`, release channels test/live + promote, owner queue slot table, revision licence snapshots, `revision_rights`, rights-holder page + SQL gate; (C5b later: PKCE + `studio-upload` + `/v1/creator/*`) | L (8; C5b +9) | C2, C4 | **legal terms**, prod Hub deploy, prod editor-origin allow-list; C5b: prod PKCE/CORS |
| **C6** Auto-Rig + Halo + agent UX | ekza-studio | Auto-Rig ④/⑤ contract mode, Halo destination from document, slot chips, readiness rows, *Fill for OMOBA* recipe, Thread markers, diff card, agent tools + prompt, docs (§8.17) | L (7) | C1, C2; Halo T6a/T11 | Studio release (as usual) |
| **C7** end-to-end on the dev contour | all | §7.8 plan, four flows, negative cases, evidence | M (4) | C3, C4, C5 (C6 for the Halo flows) | dev DNS rename (`hub.dev`), editor dev origin; then prod rollout |
| **C-pre** pre-existing fixes | omoba-web, omoba-bevy, ekza-studio | P-3 Hub origin constants, P-4 kit facing, P-5/P-6 copy and profile clean-up (gated), P-7 dev builder ref | S (3) | — | P-1, P-2 are owner actions |

**Total ≈ 55 agent-days** (C0b, C5b excluded). **Critical path** C0 → C3 → C4 → C5 → C7 ≈ 34 agent-days; C1, C2 and C6
run beside C3–C4. **Order of value**: after C0+C1 a creator can see what each hero needs; after C2 they can make and
download a package that OMOBA's tools validate locally; after C3 a local OMOBA build plays it; after C4+C5 it goes
through Hub; C7 proves it hosted.

---

## 11. Pre-existing problems that block or affect this

| ID | Problem | Effect here | Fix | Who |
|---|---|---|---|---|
| P-1 | The production rendition worker builds with `omoba-bevy` `main`, which lacks PR #106 (VRM 1.0 renditions). | Prod OMOBA renditions of VRM 1.0 — Studio's only character format — likely fail today, with or without this work. | Point the worker at a ref with #106 (dev or the next release); later at a ref with C3/C4. | **owner** |
| P-2 | Hosted Supabase migrations `202610050001`, `202610110001`, `202610110002`, `202610120001` are not applied. | `project_requirements` (`…0002`) is the base of per-hero requirements; C4 migrations come after them. | Apply in order, then C4's. | **owner** |
| P-3 | Hub origin mismatch: `omoba-web@dev` `src/lib/contour.mjs:15`, `src/lib/market.mjs:9` and `omoba-bevy@dev` `account-api/src/ekza_library.rs:57`, `client/src/connection_profile.rs:49` still use `studio.ekza.io` as the Hub; the registry issues links on `hub.ekza.io` since 10-20. | Prod "Sign in with Ekza" hides the link (exact-match check); the submit allow-lists need the final origins. | One constant per file (C-pre). | agent; deploy by owner |
| P-4 | Studio's OMOBA local kit writes VRM 1.0 as is; OMOBA's local import turns VRM 1.0 to −Z (`convert_vrm_to_glb.py`). | A kit character likely faces backwards in OMOBA (inferred, not observed). | The dev zip (§4.2) applies `normalize_vrm1_rest_facing`; verify in C7. | agent |
| P-5 | `ekza/omoba-humanoid-v1` requires `idle, walk, attack, cast, death` (`io/src/profiles/builtin.ts:34-45`): it mirrors the v1 passport but not what OMOBA plays (`run` moves every hero). | Misleading for contract work. | Contract packages use `ekza/omoba-humanoid-v2`; v1 stays for asset characters with a note. | agent |
| P-6 | Studio copy "OMOBA plays its own motion library on your VRM" (`io/src/profiles/character.ts:3-19`, banner, problem text; Auto-Rig ④ note). | Contradicts the contract once C3 ships; true until then. | Change with the profile's acceptance (`index.json` flag). | agent |
| P-7 | Dev contour: the builder is pinned to `omoba-bevy` `07aa408` (pre-#106); the dev Hub sits at `studio.dev.ekza.io`, the name an editor dev origin would take. | Blocks C7. | `DEV_BEVY_REF`; rename the dev Hub to `hub.dev.ekza.io` and give the editor a dev origin. | owner (DNS) + agent |
| P-8 | Ekza is off in OMOBA's ru/cn market builds (`feat/market-profiles`). | Collab characters are not available there. | Product decision; nothing to build. | owner |
| P-9 | Registry source validation is behind `EKZA_STUDIO_SOURCE_VALIDATION_ENABLED` (default off). | `check_animation_set` must not depend on it. | Run it whenever the intent names a contract (§7.3). | agent |
| P-10 | `M-AI-INT-9`: the bridge's "hosted editor" origin `studio.ekza.io` vs NAME-2. | The submit allow-lists need the same answer. | One decision for both (`CC-Q12`). | owner |
| P-11 | The v1 builder's Python check mirrors the Rust passport (`ARCHITECTURE.md:241-242`). | Drift risk for motion rules. | The v2 builder runs the Rust binary (§6.5). | agent |

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Mixed client versions: an old client meets a v2 slug it cannot resolve. | v1 rendition still built; C3 verifies the default-skin fallback; else ship with the next protocol version. |
| R2 | Custom clips hurt readability or fairness (hide a telegraph, fake a skill). | Contact ≤ 0.15 s, duration caps, in place; owner review in the test channel; takedown. Gameplay never depends on clips. |
| R3 | Quality without foot-slide checks (motion-analysis P4 not started): a custom run may skate. | Target cycle = the default's; *Preview default* A/B; P4 later. |
| R4 | Contract churn: re-tuned rows change the revision often. | Slot ids stable; Hub accepts any active revision; the diff card; compatible/breaking classification. |
| R5 | TypeScript and Rust rules drift. | Parameters in the contract, fail closed on unknown ids, shared fixtures in both gates, a Studio package fixture in OMOBA's gate. |
| R6 | Untrusted clips as an attack surface (scale 0 invisibility, huge key counts, NaN). | `clip.channels` (no scale, no morph, hips-only translation), `clip.sampler`, bounded parsing in Rust, byte caps, sandboxed builder. |
| R7 | Ekza Space reads the same VRM: any embedded clip makes Space skip its shared idle/walk (ADR 0010 §6), and it does not know `base.idle`. | Character packages are submitted to OMOBA only in v1; Space reading the slot map is a later Space change. |
| R8 | `/editor` bundle headroom ≈ 9 kB. | Everything lazy, ≤ 512 B eager, measured in C1/C2. |
| R9 | Legal: collab terms, consent withdrawal, already-downloaded copies. | Per-revision rights rows, SQL gate, takedown; terms text by the owner (`CC-Q5`, `CC-Q13`). |
| R10 | The Hub window is blocked or its opener severed (COOP). | Open synchronously on the tap; neither page sets COOP `same-origin` (Studio sets none today); *Download package* fallback. |
| R11 | `hips` as a scene root breaks the −Z turn for embedded clips. | Builder inserts a parent; fixture case. |
| R12 | A basic clip longer than the shortest attack interval is cut. | `clip.basic-interval` warning; target = default play time. |
| R13 | Mobile memory per avatar with up to 48 extra clips (unmeasured; cache never evicted). | Byte cap 4 MiB of animation data; measure in C3 on the Android build. |
| R14 | Held weapons: a custom pose may not read as holding the class weapon (the handheld follows the hand socket; cast accents sit at fixed heights). | `handheld` per slot in the contract, shown in Studio with a weapon ghost (later); owner review. |

---

## 13. Open owner questions

`CC-Q1` hero lock for collab characters · `CC-Q2` wind-ups in v1 or v1.1 · `CC-Q3` contract licence CC0 and the
default preview pack · `CC-Q4` keep building the v1 rendition · `CC-Q5` rights-holder countersign before test or
before live · `CC-Q6` one combined curator + owner step for OMOBA characters · `CC-Q7` Hub submit page now, PKCE later
· `CC-Q8` the live contract fetch as a user-initiated exception to Studio's same-origin rule · `CC-Q9` paid collab
characters · `CC-Q10` multi-hero packages · `CC-Q11` declared playback rate/start per slot · `CC-Q12` final hosted
origins (editor, Hub, dev) · `CC-Q13` withdrawal and takedown policy · `CC-Q14` hero roster changes (a removed
skill's slots). Each has a default in [DECISIONS-OPEN §Q](DECISIONS-OPEN.md#q-character-contract-defaults-chosen-2026-10-24).

---

## 14. Sources

- `omoba-bevy@dev` (`6d34f98`): `client/src/player/animation.rs`, `client/src/skill_presentation/{schema,category,mod}.rs`,
  `client/src/humanoid.rs`, `client/src/humanoid/{retarget,embedded,sockets}.rs`, `client/assets/animations/humanoid-motion-v1.json`,
  `client/assets/config/skills.skillfx`, `shared/assets/catalog/{heroes,skills}.json`, `shared/src/handheld.rs`,
  `shared/src/protocol/wire.rs`, `passport/src/{lib,humanoid,store}.rs`, `scripts/{ekza_build_rendition,retarget_animations,convert_vrm_to_glb,export_asset_catalog}.py`,
  `docs/{humanoid-motion,asset-catalog,combat-cosmetics,handheld-weapons}.md`, `LICENSING.md`, `assets-src/animations/README.md`.
- `ekza-registry@dev` (`82715fa`): `supabase/migrations/{202609190001_game_integration,202609210001_project_releases,202610110002_project_requirements}.sql`,
  `backend/app/api/studio.py`, `backend/STUDIO.md`, `web/app/lib/studio-proxy.server.ts`, `docs/dev-contour.md`, `deploy/hosted-pilot.md`.
- `ekza-bevy-sdk` (`a9a253c`): `src/passport.rs` (`protected_slug`, `SupportSelector::omoba_desktop`).
- `ekza-studio@dev` (`959c587b`): the files named in §2 and §8; ADRs 0010, 0020, 0021, 0022; AUTORIG-SPEC; MCP-SPEC;
  STUDIO-TOUCH-SPEC v0.2 (`design/studio-touch`).
- The prototype exporter's output (Appendix B) was produced from the `dev` data above; its `revision` and
  `inputsSha256` are illustrative (the real exporter hashes a different input set).

---

## Appendix A — JSON Schema `omoba.character-contract.v1`

Draft 2020-12. It lives in OMOBA as `shared/assets/catalog/character-contract.schema.json`; Studio's gate validates
its bundled snapshot against a copy. The schema checks shape; cross-references (every view slot exists, aliases and
`sharesDefaultWith` point at existing slots, the revision recomputes) are checked in code by every reader.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://omoba.io/schemas/omoba.character-contract.v1.json",
  "title": "omoba.character-contract.v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "schemaVersion", "projectId", "revision", "previousRevision", "license", "source",
               "package", "rig", "timing", "rules", "slots", "heroes"],
  "properties": {
    "schema": { "const": "omoba.character-contract.v1" },
    "schemaVersion": { "const": 1 },
    "projectId": { "const": "omoba" },
    "revision": { "$ref": "#/$defs/revision" },
    "previousRevision": { "oneOf": [{ "$ref": "#/$defs/revision" }, { "type": "null" }] },
    "license": { "type": "string", "minLength": 1, "maxLength": 64 },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["commit", "exporter", "inputsSha256", "gameplayRevision", "presentationSha256", "motionLibrary",
                   "protocolVersion"],
      "properties": {
        "commit": { "type": "string", "pattern": "^[0-9a-f]{7,40}$" },
        "exporter": { "type": "string", "maxLength": 200 },
        "inputsSha256": { "$ref": "#/$defs/sha256" },
        "gameplayRevision": { "type": "string", "maxLength": 64 },
        "presentationSha256": { "$ref": "#/$defs/sha256" },
        "motionLibrary": {
          "type": "object",
          "additionalProperties": false,
          "required": ["schemaVersion", "sha256", "clips"],
          "properties": {
            "schemaVersion": { "type": "integer", "minimum": 1 },
            "sha256": { "$ref": "#/$defs/sha256" },
            "clips": { "type": "integer", "minimum": 1, "maximum": 256 }
          }
        },
        "protocolVersion": { "type": "integer", "minimum": 1 }
      }
    },
    "package": {
      "type": "object",
      "additionalProperties": false,
      "required": ["extrasKey", "sourceFormats", "rendition", "slotNaming", "customPlayback"],
      "properties": {
        "extrasKey": { "const": "ekza_animation_set_v1" },
        "sourceFormats": { "type": "array", "minItems": 1, "uniqueItems": true,
                           "items": { "enum": ["vrm1", "vrm0"] } },
        "rendition": {
          "type": "object",
          "additionalProperties": false,
          "required": ["platform", "profile", "version"],
          "properties": {
            "platform": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
            "profile": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
            "version": { "type": "integer", "minimum": 1 }
          }
        },
        "slotNaming": { "const": "animation-name-equals-slot-id" },
        "customPlayback": {
          "type": "object",
          "additionalProperties": false,
          "required": ["rate", "start"],
          "properties": { "rate": { "const": 1 }, "start": { "const": 0 } }
        }
      }
    },
    "rig": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "restPose", "facing", "requiredBones", "requiredBonesVrm0", "drivenBones", "maxHumanoidBones",
                   "maxNodes", "uniformScale", "fingers", "thumbsRecommended", "legLengthFrom", "referenceLegLengthM"],
      "properties": {
        "kind": { "const": "vrm-humanoid" },
        "restPose": { "const": "t-pose" },
        "facing": { "const": "as-vrm-spec" },
        "requiredBones": { "$ref": "#/$defs/boneList" },
        "requiredBonesVrm0": { "$ref": "#/$defs/boneList" },
        "drivenBones": { "$ref": "#/$defs/boneList" },
        "maxHumanoidBones": { "type": "integer", "minimum": 15, "maximum": 64 },
        "maxNodes": { "type": "integer", "minimum": 1, "maximum": 4096 },
        "uniformScale": { "enum": ["humanoid-bones-and-ancestors", "none"] },
        "fingers": { "enum": ["optional", "required"] },
        "thumbsRecommended": { "type": "boolean" },
        "legLengthFrom": { "const": "hips-to-feet" },
        "referenceLegLengthM": { "type": "number", "exclusiveMinimum": 0 }
      }
    },
    "timing": {
      "type": "object",
      "additionalProperties": false,
      "required": ["blendSecs", "idleGraceSecs", "facingHoldSecs", "contactLimitSecs", "rowRate", "rowStart", "fitRate",
                   "unseenHoldSecs", "freshSecs", "maxGapSecs", "deathCut", "movementInterruptsAction",
                   "newActionRestarts"],
      "properties": {
        "blendSecs": { "$ref": "#/$defs/secs" },
        "idleGraceSecs": { "$ref": "#/$defs/secs" },
        "facingHoldSecs": {
          "type": "object", "additionalProperties": false, "required": ["basic", "skill"],
          "properties": { "basic": { "$ref": "#/$defs/secs" }, "skill": { "$ref": "#/$defs/secs" } }
        },
        "contactLimitSecs": { "$ref": "#/$defs/secs" },
        "rowRate": { "$ref": "#/$defs/range" },
        "rowStart": { "$ref": "#/$defs/range" },
        "fitRate": { "$ref": "#/$defs/range" },
        "unseenHoldSecs": { "$ref": "#/$defs/secs" },
        "freshSecs": { "$ref": "#/$defs/secs" },
        "maxGapSecs": { "$ref": "#/$defs/secs" },
        "deathCut": { "enum": ["immediate"] },
        "movementInterruptsAction": { "type": "boolean" },
        "newActionRestarts": { "type": "boolean" }
      }
    },
    "rules": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "severity", "scope", "params"],
        "properties": {
          "id": { "type": "string", "pattern": "^(pack|clip)\\.[a-z][a-z0-9-]{1,40}$" },
          "severity": { "enum": ["error", "warning"] },
          "scope": { "enum": ["pack", "clip"] },
          "params": { "type": "object" }
        }
      }
    },
    "slots": {
      "type": "object",
      "minProperties": 3,
      "propertyNames": { "$ref": "#/$defs/slotId" },
      "additionalProperties": { "$ref": "#/$defs/slot" }
    },
    "heroes": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/hero" }
    }
  },
  "$defs": {
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "revision": { "type": "string", "pattern": "^sha256-[0-9a-f]{64}$" },
    "secs": { "type": "number", "minimum": 0, "maximum": 60 },
    "range": { "type": "array", "prefixItems": [{ "type": "number" }, { "type": "number" }], "minItems": 2, "maxItems": 2 },
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,47}$" },
    "slotId": {
      "type": "string",
      "maxLength": 64,
      "pattern": "^(base\\.(idle|run|walk|death)|basic\\.[a-z][a-z0-9_]{0,31}\\.([0-9]|[a-z][a-z0-9_]{0,15}\\.[0-9])|skill\\.[a-z][a-z0-9_]{0,47}\\.(release|recast|windup))$"
    },
    "boneList": { "type": "array", "uniqueItems": true, "maxItems": 64,
                  "items": { "type": "string", "pattern": "^[a-z][A-Za-z]{1,31}$" } },
    "default": {
      "type": "object",
      "additionalProperties": false,
      "required": ["motion", "durationSecs", "looping", "contactSecs", "rate", "start", "playSecs",
                   "effectiveContactSecs", "standInFor"],
      "properties": {
        "motion": { "$ref": "#/$defs/id" },
        "durationSecs": { "type": "number", "exclusiveMinimum": 0, "maximum": 10 },
        "looping": { "type": "boolean" },
        "contactSecs": { "type": ["number", "null"], "minimum": 0 },
        "rate": { "type": "number", "minimum": 0.5, "maximum": 2 },
        "start": { "type": "number", "minimum": 0, "maximum": 0.8 },
        "playSecs": { "type": "number", "exclusiveMinimum": 0 },
        "effectiveContactSecs": { "type": ["number", "null"] },
        "standInFor": { "type": ["string", "null"], "maxLength": 64 }
      }
    },
    "slot": {
      "type": "object",
      "additionalProperties": false,
      "required": ["group", "role", "label", "kind", "phase", "edgeReleased", "customizable", "customizableFrom",
                   "reserved", "required", "default", "window", "inPlace", "loop", "contact", "telegraph", "handheld",
                   "sharesDefaultWith", "alternatesWith", "usedBy"],
      "properties": {
        "group": { "enum": ["base", "basic", "skill"] },
        "role": { "enum": ["idle", "run", "walk", "death", "basic", "release", "recast", "windup"] },
        "label": { "type": "string", "minLength": 1, "maxLength": 80 },
        "kind": { "enum": ["loop", "action", "hold"] },
        "phase": { "enum": ["locomotion", "state", "instant", "warn_fire", "fuse", "parry"] },
        "edgeReleased": { "type": "boolean" },
        "customizable": { "type": "boolean" },
        "customizableFrom": { "type": ["string", "null"], "pattern": "^[0-9]+(\\.[0-9]+)?$" },
        "reserved": { "type": "boolean" },
        "required": { "type": "boolean" },
        "default": { "$ref": "#/$defs/default" },
        "window": {
          "type": "object", "additionalProperties": false, "required": ["minSecs", "targetSecs", "maxSecs"],
          "properties": {
            "minSecs": { "type": "number", "exclusiveMinimum": 0 },
            "targetSecs": { "type": "number", "exclusiveMinimum": 0 },
            "maxSecs": { "type": "number", "exclusiveMinimum": 0, "maximum": 10 }
          }
        },
        "inPlace": { "type": "boolean" },
        "loop": { "type": "boolean" },
        "contact": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["required", "maxSecs", "targetSecs"],
              "properties": {
                "required": { "type": "boolean" },
                "maxSecs": { "type": ["number", "null"], "minimum": 0 },
                "targetSecs": { "type": ["number", "null"], "minimum": 0 }
              }
            }
          ]
        },
        "telegraph": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["secs", "serverWindupSecs", "fitWindup"],
              "properties": {
                "secs": { "type": "number", "exclusiveMinimum": 0 },
                "serverWindupSecs": { "type": ["number", "null"], "minimum": 0 },
                "fitWindup": { "type": "boolean" }
              }
            }
          ]
        },
        "handheld": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["item", "byMode", "bone", "muzzleWindowSecs"],
              "properties": {
                "item": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,63}$" },
                "byMode": { "type": "object", "additionalProperties": { "type": "string" } },
                "bone": { "type": "string" },
                "muzzleWindowSecs": { "oneOf": [{ "type": "null" }, { "$ref": "#/$defs/range" }] }
              }
            }
          ]
        },
        "sharesDefaultWith": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/slotId" } },
        "alternatesWith": { "type": "array", "uniqueItems": true, "maxItems": 1, "items": { "$ref": "#/$defs/slotId" } },
        "usedBy": { "type": "array", "minItems": 1, "uniqueItems": true,
                    "items": { "type": "string", "pattern": "^(\\*|[a-z][a-z0-9_]{0,31})$" } },
        "skill": { "$ref": "#/$defs/id" },
        "class": { "$ref": "#/$defs/id" },
        "minIntervalSecs": { "type": "number", "exclusiveMinimum": 0 },
        "weaponMode": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,15}$" }
      },
      "allOf": [
        { "if": { "properties": { "group": { "const": "skill" } } }, "then": { "required": ["skill"] } },
        { "if": { "properties": { "group": { "const": "basic" } } }, "then": { "required": ["class", "minIntervalSecs"] } },
        { "if": { "properties": { "kind": { "const": "loop" } } }, "then": { "properties": { "loop": { "const": true } } } },
        { "if": { "properties": { "customizable": { "const": true } } },
          "then": { "properties": { "customizableFrom": { "type": "string" } } } }
      ]
    },
    "hero": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "kind", "name", "role", "requirementId", "basicAttack", "kit", "handheld", "slots"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "kind": { "enum": ["class", "any"] },
        "name": { "type": "string", "minLength": 1, "maxLength": 64 },
        "role": { "type": ["string", "null"], "maxLength": 32 },
        "requirementId": { "type": "string", "maxLength": 128, "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$" },
        "basicAttack": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false,
              "required": ["rangeM", "cooldownSecs", "attackRateCap", "minIntervalSecs", "slots"],
              "properties": {
                "rangeM": { "type": "number", "exclusiveMinimum": 0 },
                "cooldownSecs": { "type": "number", "exclusiveMinimum": 0 },
                "attackRateCap": { "type": "number", "minimum": 1 },
                "minIntervalSecs": { "type": "number", "exclusiveMinimum": 0 },
                "slots": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/slotId" } }
              }
            }
          ]
        },
        "kit": {
          "type": "array", "maxItems": 4,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["key", "skill", "name", "slots"],
            "properties": {
              "key": { "enum": ["q", "w", "e", "r"] },
              "skill": { "$ref": "#/$defs/id" },
              "name": { "type": "string", "minLength": 1, "maxLength": 64 },
              "slots": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/slotId" } }
            }
          }
        },
        "handheld": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["default", "byMode", "bone"],
              "properties": {
                "default": { "type": "string" },
                "byMode": { "type": "object", "additionalProperties": { "type": "string" } },
                "bone": { "type": "string" }
              }
            }
          ]
        },
        "slots": { "type": "array", "minItems": 3, "uniqueItems": true, "items": { "$ref": "#/$defs/slotId" } }
      }
    }
  }
}
```

## Appendix B — Worked example: Wildspark and "any hero"

Output of the prototype exporter on `omoba-bevy@dev` data, trimmed to the `any` and `wildspark` views (and the
reserved `base.walk`). It validates against Appendix A. The full roster (107 slots, 18 views, about 100 kB) has the
same shape. `revision` and `inputsSha256` are illustrative.

```json
{
  "schema": "omoba.character-contract.v1",
  "schemaVersion": 1,
  "projectId": "omoba",
  "revision": "sha256-89fd2e42b41fb844dada4c48c028f8e1523dfc9f6a1ebc977efb5c636f7782cb",
  "previousRevision": null,
  "license": "CC0-1.0",
  "source": {"commit": "6d34f98", "exporter": "scripts/export_character_contract.py", "inputsSha256": "db0e37eec0499b593d08965e342ea0a69699ff7007af41a6f8e3eee05c300d03", "gameplayRevision": "standard-kits-8", "presentationSha256": "fe544cd0df722b9dd21753804c77091e3d8ddb64e863aebbfcfb3f0db4958ae4", "motionLibrary": {"schemaVersion": 1, "sha256": "2af1a6a0332bee5a840554efd7f4efdbf85941efe744c4b03df7fad382879a9a", "clips": 57}, "protocolVersion": 11},
  "package": {"extrasKey": "ekza_animation_set_v1", "sourceFormats": ["vrm1", "vrm0"], "rendition": {"platform": "desktop", "profile": "humanoid-glb-v2", "version": 1}, "slotNaming": "animation-name-equals-slot-id", "customPlayback": {"rate": 1.0, "start": 0.0}},
  "rig": {
    "kind": "vrm-humanoid",
    "restPose": "t-pose",
    "facing": "as-vrm-spec",
    "requiredBones": ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"],
    "requiredBonesVrm0": ["chest", "neck"],
    "drivenBones": ["chest", "head", "hips", "leftFoot", "leftHand", "leftIndexDistal", "leftIndexIntermediate", "leftIndexProximal", "leftLittleDistal", "leftLittleIntermediate", "leftLittleProximal", "leftLowerArm", "leftLowerLeg", "leftMiddleDistal", "leftMiddleIntermediate", "leftMiddleProximal", "leftRingDistal", "leftRingIntermediate", "leftRingProximal", "leftShoulder", "leftThumbDistal", "leftThumbIntermediate", "leftThumbProximal", "leftToes", "leftUpperArm", "leftUpperLeg", "neck", "rightFoot", "rightHand", "rightIndexDistal", "rightIndexIntermediate", "rightIndexProximal", "rightLittleDistal", "rightLittleIntermediate", "rightLittleProximal", "rightLowerArm", "rightLowerLeg", "rightMiddleDistal", "rightMiddleIntermediate", "rightMiddleProximal", "rightRingDistal", "rightRingIntermediate", "rightRingProximal", "rightShoulder", "rightThumbDistal", "rightThumbIntermediate", "rightThumbProximal", "rightToes", "rightUpperArm", "rightUpperLeg", "spine", "upperChest"],
    "maxHumanoidBones": 64,
    "maxNodes": 4096,
    "uniformScale": "humanoid-bones-and-ancestors",
    "fingers": "optional",
    "thumbsRecommended": true,
    "legLengthFrom": "hips-to-feet",
    "referenceLegLengthM": 0.813
  },
  "timing": {"blendSecs": 0.12, "idleGraceSecs": 0.25, "facingHoldSecs": {"basic": 0.45, "skill": 0.7}, "contactLimitSecs": 0.15, "rowRate": [0.5, 2.0], "rowStart": [0.0, 0.8], "fitRate": [0.5, 2.0], "unseenHoldSecs": 1.2, "freshSecs": 0.15, "maxGapSecs": 0.25, "deathCut": "immediate", "movementInterruptsAction": false, "newActionRestarts": true},
  "rules": [
    {"id": "pack.extras", "severity": "error", "scope": "pack", "params": {"key": "ekza_animation_set_v1", "schema": 1}},
    {"id": "pack.contract", "severity": "error", "scope": "pack", "params": {}},
    {"id": "pack.slot-known", "severity": "error", "scope": "pack", "params": {}},
    {"id": "pack.animation-ref", "severity": "error", "scope": "pack", "params": {"nameEqualsSlot": true}},
    {"id": "pack.unreferenced", "severity": "warning", "scope": "pack", "params": {}},
    {"id": "pack.bytes", "severity": "error", "scope": "pack", "params": {"maxFileBytes": 52428800, "maxJsonBytes": 4194304, "maxAnimationBytes": 4194304, "maxCustomSlots": 48}},
    {"id": "clip.channels", "severity": "error", "scope": "clip", "params": {"rotation": "humanoid-bones", "translation": ["hips"], "scale": false, "weights": false}},
    {"id": "clip.sampler", "severity": "error", "scope": "clip", "params": {"interpolation": ["LINEAR", "STEP"], "startsAtSecs": 0.0, "timeEpsilonSecs": 0.0001, "unitQuatEpsilon": 0.001}},
    {"id": "clip.keys", "severity": "error", "scope": "clip", "params": {"maxKeysPerChannel": 4096, "maxSampleRateHz": 60}},
    {"id": "clip.duration", "severity": "error", "scope": "clip", "params": {"source": "slot.window"}},
    {"id": "clip.in-place", "severity": "error", "scope": "clip", "params": {"unit": "legLength", "maxHorizontal": 0.15, "maxHorizontalHold": 0.75, "maxVertical": 0.6}},
    {"id": "clip.loop-closure", "severity": "error", "scope": "clip", "params": {"maxBoneDegrees": 2.0, "maxHipsOffset": 0.01, "unit": "legLength"}},
    {"id": "clip.contact", "severity": "error", "scope": "clip", "params": {"formula": "(contact - start * duration) / rate", "limitSecs": 0.15, "toleranceSecs": 0.0001}},
    {"id": "clip.basic-interval", "severity": "warning", "scope": "clip", "params": {"source": "slot.minIntervalSecs"}}
  ],
  "slots": {
    "base.death": {
      "group": "base", "role": "death", "label": "Death", "kind": "hold", "phase": "state", "edgeReleased": false,
      "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "death", "durationSecs": 2.375, "looping": false, "contactSecs": null, "rate": 1.0, "start": 0.0, "playSecs": 2.375, "effectiveContactSecs": null, "standInFor": null},
      "window": {"minSecs": 0.5, "targetSecs": 2.375, "maxSecs": 3.0},
      "inPlace": true, "loop": false,
      "contact": null,
      "telegraph": null,
      "handheld": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["*"]
    },
    "base.idle": {
      "group": "base", "role": "idle", "label": "Idle", "kind": "loop", "phase": "locomotion", "edgeReleased": false,
      "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "idle", "durationSecs": 2.5, "looping": true, "contactSecs": null, "rate": 1.0, "start": 0.0, "playSecs": 2.5, "effectiveContactSecs": null, "standInFor": null},
      "window": {"minSecs": 1.0, "targetSecs": 2.5, "maxSecs": 4.0},
      "inPlace": true, "loop": true,
      "contact": null,
      "telegraph": null,
      "handheld": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["*"]
    },
    "base.run": {
      "group": "base", "role": "run", "label": "Run (all movement)", "kind": "loop", "phase": "locomotion", "edgeReleased": false,
      "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "run", "durationSecs": 0.6667, "looping": true, "contactSecs": null, "rate": 1.0, "start": 0.0, "playSecs": 0.6667, "effectiveContactSecs": null, "standInFor": null},
      "window": {"minSecs": 0.4, "targetSecs": 0.6667, "maxSecs": 1.2},
      "inPlace": true, "loop": true,
      "contact": null,
      "telegraph": null,
      "handheld": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["*"]
    },
    "base.walk": {
      "group": "base", "role": "walk", "label": "Walk (reserved; not played yet)", "kind": "loop", "phase": "locomotion",
      "edgeReleased": false, "customizable": false, "customizableFrom": null, "reserved": true, "required": false,
      "default": {"motion": "walk", "durationSecs": 1.3333, "looping": true, "contactSecs": null, "rate": 1.0, "start": 0.0, "playSecs": 1.3333, "effectiveContactSecs": null, "standInFor": null},
      "window": {"minSecs": 0.8, "targetSecs": 1.3333, "maxSecs": 2.0},
      "inPlace": true, "loop": true,
      "contact": null,
      "telegraph": null,
      "handheld": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["*"]
    },
    "basic.wildspark.0": {
      "group": "basic", "role": "basic", "label": "Basic attack", "kind": "action", "phase": "instant", "edgeReleased": true,
      "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "burst_fire", "durationSecs": 0.45, "looping": false, "contactSecs": 0.075, "rate": 1.65, "start": 0.0, "playSecs": 0.2727, "effectiveContactSecs": 0.0455, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.2727, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.0455},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": [0.08, 0.25]},
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"], "class": "wildspark", "minIntervalSecs": 0.4375
    },
    "basic.wildspark.rockets.0": {
      "group": "basic", "role": "basic", "label": "Basic attack (rocket mode)", "kind": "action", "phase": "instant",
      "edgeReleased": true, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "shot_heavy", "durationSecs": 0.8, "looping": false, "contactSecs": 0.17, "rate": 1.15, "start": 0.0, "playSecs": 0.6957, "effectiveContactSecs": 0.1478, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.6957, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.1478},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": [0.08, 0.25]},
      "sharesDefaultWith": ["skill.wild_rocket.release"], "alternatesWith": [], "usedBy": ["wildspark"], "class": "wildspark",
      "minIntervalSecs": 0.4375, "weaponMode": "rockets"
    },
    "skill.wild_rocket.release": {
      "group": "skill", "role": "release", "label": "Last Spark (R) — release", "kind": "action", "phase": "instant",
      "edgeReleased": true, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "shot_heavy", "durationSecs": 0.8, "looping": false, "contactSecs": 0.17, "rate": 1.0, "start": 0.05, "playSecs": 0.76, "effectiveContactSecs": 0.13, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.76, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.13},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": [0.08, 0.25]},
      "sharesDefaultWith": ["basic.wildspark.rockets.0"], "alternatesWith": [], "usedBy": ["wildspark"], "skill": "wild_rocket"
    },
    "skill.wild_switch.release": {
      "group": "skill", "role": "release", "label": "Switchfire (Q) — release", "kind": "action", "phase": "instant",
      "edgeReleased": true, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "reload_snap", "durationSecs": 0.6, "looping": false, "contactSecs": 0.34, "rate": 1.5, "start": 0.25, "playSecs": 0.3, "effectiveContactSecs": 0.1267, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.3, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.1267},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": null},
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"], "skill": "wild_switch"
    },
    "skill.wild_traps.release": {
      "group": "skill", "role": "release", "label": "Snapline (E) — release", "kind": "action", "phase": "instant",
      "edgeReleased": true, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "toss_underhand", "durationSecs": 0.4, "looping": false, "contactSecs": 0.13, "rate": 1.3, "start": 0.0, "playSecs": 0.3077, "effectiveContactSecs": 0.1, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.3077, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.1},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": null},
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"], "skill": "wild_traps"
    },
    "skill.wild_zap.release": {
      "group": "skill", "role": "release", "label": "Shockline (W) — release", "kind": "action", "phase": "instant",
      "edgeReleased": true, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"motion": "pistol_shoot", "durationSecs": 0.625, "looping": false, "contactSecs": 0.0417, "rate": 1.1, "start": 0.0, "playSecs": 0.5682, "effectiveContactSecs": 0.0379, "standInFor": null},
      "window": {"minSecs": 0.15, "targetSecs": 0.5682, "maxSecs": 1.2},
      "inPlace": true, "loop": false,
      "contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.0379},
      "telegraph": null,
      "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": [0.08, 0.25]},
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"], "skill": "wild_zap"
    }
  },
  "heroes": [
    {
      "id": "any",
      "kind": "any",
      "name": "Any hero",
      "role": null,
      "requirementId": "character.any",
      "basicAttack": null,
      "kit": [],
      "handheld": null,
      "slots": ["base.idle", "base.run", "base.death"]
    },
    {
      "id": "wildspark",
      "kind": "class",
      "name": "Wildspark",
      "role": "carry",
      "requirementId": "character.wildspark",
      "basicAttack": {"rangeM": 11.5, "cooldownSecs": 0.7, "attackRateCap": 1.6, "minIntervalSecs": 0.4375, "slots": ["basic.wildspark.0", "basic.wildspark.rockets.0"]},
      "kit": [
        {"key": "q", "skill": "wild_switch", "name": "Switchfire", "slots": ["skill.wild_switch.release"]},
        {"key": "w", "skill": "wild_zap", "name": "Shockline", "slots": ["skill.wild_zap.release"]},
        {"key": "e", "skill": "wild_traps", "name": "Snapline", "slots": ["skill.wild_traps.release"]},
        {"key": "r", "skill": "wild_rocket", "name": "Last Spark", "slots": ["skill.wild_rocket.release"]}
      ],
      "handheld": {"default": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand"},
      "slots": ["base.idle", "base.run", "base.death", "basic.wildspark.0", "basic.wildspark.rockets.0", "skill.wild_switch.release", "skill.wild_zap.release", "skill.wild_traps.release", "skill.wild_rocket.release"]
    }
  ]
}
```

## Appendix C — `asset.extras.ekza_animation_set_v1`

JSON Schema (draft 2020-12). Cross-checks against the contract (`pack.*` rules, §5.1) are code.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ekza.io/schemas/ekza_animation_set_v1.json",
  "title": "asset.extras.ekza_animation_set_v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "contract", "target", "slots", "provenance"],
  "properties": {
    "schema": { "const": 1 },
    "contract": {
      "type": "object", "additionalProperties": false, "required": ["schema", "projectId", "revision"],
      "properties": {
        "schema": { "type": "string", "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*\\.v[0-9]+$" },
        "projectId": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
        "revision": { "type": "string", "pattern": "^sha256-[0-9a-f]{64}$" }
      }
    },
    "target": {
      "type": "object", "additionalProperties": false, "required": ["hero", "requirementId"],
      "properties": {
        "hero": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,47}$" },
        "requirementId": { "type": "string", "maxLength": 128, "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$" }
      }
    },
    "slots": {
      "type": "object",
      "minProperties": 1,
      "maxProperties": 128,
      "propertyNames": { "type": "string", "maxLength": 64, "pattern": "^(base|basic|skill)\\.[a-z0-9_.]{1,60}$" },
      "additionalProperties": {
        "oneOf": [
          { "type": "object", "additionalProperties": false, "required": ["mode"],
            "properties": { "mode": { "const": "default" } } },
          { "type": "object", "additionalProperties": false, "required": ["mode", "animation", "contactSecs"],
            "properties": {
              "mode": { "const": "custom" },
              "animation": { "type": "integer", "minimum": 0, "maximum": 255 },
              "contactSecs": { "type": ["number", "null"], "minimum": 0, "maximum": 10 }
            } }
        ]
      }
    },
    "provenance": {
      "type": "object", "additionalProperties": false, "required": ["tool", "toolVersion"],
      "properties": {
        "tool": { "type": "string", "maxLength": 64 },
        "toolVersion": { "type": "string", "maxLength": 32 }
      }
    }
  }
}
```

Example: a Wildspark character with a custom run, a custom repeater basic attack and one clip shared by the rocket
basic attack and Last Spark (the animation is named `basic.wildspark.rockets.0`, its primary slot).

```json
{
  "schema": 1,
  "contract": { "schema": "omoba.character-contract.v1", "projectId": "omoba",
                "revision": "sha256-89fd2e42b41fb844dada4c48c028f8e1523dfc9f6a1ebc977efb5c636f7782cb" },
  "target": { "hero": "wildspark", "requirementId": "character.wildspark" },
  "slots": {
    "base.idle": { "mode": "default" },
    "base.run": { "mode": "custom", "animation": 0, "contactSecs": null },
    "base.death": { "mode": "default" },
    "basic.wildspark.0": { "mode": "custom", "animation": 1, "contactSecs": 0.067 },
    "basic.wildspark.rockets.0": { "mode": "custom", "animation": 2, "contactSecs": 0.133 },
    "skill.wild_switch.release": { "mode": "default" },
    "skill.wild_zap.release": { "mode": "default" },
    "skill.wild_traps.release": { "mode": "default" },
    "skill.wild_rocket.release": { "mode": "custom", "animation": 2, "contactSecs": 0.133 }
  },
  "provenance": { "tool": "ekza-studio", "toolVersion": "0.7.0" }
}
```

## Appendix D — Conformance fixtures v1 (minimum set)

Owned by OMOBA (`shared/assets/catalog/character-contract-fixtures/v1/`), each a small package plus
`expected/<case>.json` (`{pack: "ok" | ["rule ids"], slots: {"<slot>": "pass" | ["rule ids"]}}`). Studio copies them
with SHA-256 pinning; the registry runs the `pack.*` subset.

| Case | Expect |
|---|---|
| `ok-vrm1-three-slots`, `ok-vrm0-three-slots` | pass (VRM 1.0 and 0.x rigs, run + basic + release) |
| `ok-shared-animation` | pass (two slots → one animation named after one of them) |
| `ok-all-default` | pass (slot map only, no animations) |
| `pack-missing-extras`, `pack-bad-schema`, `pack-unknown-revision`, `pack-retired-revision` | `pack.extras` / `pack.contract` |
| `pack-unknown-slot`, `pack-slot-not-listed`, `pack-windup-custom` | `pack.slot-known` |
| `pack-bad-index`, `pack-name-mismatch`, `pack-duplicate-names` | `pack.animation-ref` |
| `pack-unreferenced-animation` | warning `pack.unreferenced` |
| `pack-49-custom-slots`, `pack-animation-bytes-over` | `pack.bytes` |
| `clip-scale-channel`, `clip-morph-weights`, `clip-root-node`, `clip-accessory-node`, `clip-translation-on-spine` | `clip.channels` |
| `clip-cubicspline`, `clip-nan-key`, `clip-unsorted-times`, `clip-starts-late`, `clip-non-unit-quat` | `clip.sampler` |
| `clip-4097-keys`, `clip-120hz` | `clip.keys` |
| `clip-too-short`, `clip-too-long`, `clip-run-cycle-1.3s` | `clip.duration` |
| `clip-hips-drift-at-cap` (pass), `clip-hips-drift-over` | `clip.in-place` |
| `clip-loop-open-3deg`, `clip-loop-closed-1deg` (pass) | `clip.loop-closure` |
| `clip-contact-0.149` (pass), `clip-contact-0.151`, `clip-contact-missing`, `clip-contact-after-end`, `clip-contact-mismatch-meta` | `clip.contact` |
| `clip-basic-longer-than-interval` | warning `clip.basic-interval` |
| `rig-hips-scene-root-vrm1` | pass after the builder's parent insertion; the engine plays it facing −Z |
