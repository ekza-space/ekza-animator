# ADR 0024 — Character contract: OMOBA's slot specification, one-file packages, per-slot defaults

- Status: Proposed (2026-10-24, with [CHARACTER-CONTRACT-SPEC](../CHARACTER-CONTRACT-SPEC.md) v0.1); becomes Accepted
  when the owner accepts the spec. The contract format, the package format and the rule table freeze when work package
  C0 merges into `omoba-bevy` `dev`.
- Inputs: the owner's request of 2026-10-24 (OMOBA exports what each existing hero needs; Studio lets people fill the
  missing animations or keep defaults, showing which are custom; the result is submitted to OMOBA as a turnkey
  package; context: collab characters); research of the same day on `omoba-bevy@dev` `6d34f98`, `ekza-registry@dev`
  `82715fa` and `ekza-studio@dev` `959c587b`; ADR 0010 (its tier T2 `ekza_animation_set_v1` in
  `desktop/humanoid-glb-v2`, and its tier T3 plan), ADRs 0020, 0021, 0022 and 0023 (Halo, on `design/studio-touch`).
- Extends ADR 0010 (realizes T2, replaces the T3 device-code plan for the MVP, opens the slot vocabulary per bound
  contract); does not supersede it.

## Context

OMOBA plays every VRM avatar with its own shared motion library, retargeted onto the rig; skills pick a library motion
by name with a tuned rate and start; timing metadata is read from the library; the Hub rendition builder appends five
generic clips. An avatar's own clips therefore never play, although the building block exists (`remap_embedded_clip`,
and the collection preview already plays embedded clips). Studio can author clips, name them by slot and embed them in
a VRM 1.0, but its slot vocabulary does not match anything OMOBA plays, it says "OMOBA plays its own motion library",
and it cannot reach Hub. Hub can take one source file per revision, build renditions per profile and gate them through
a curator and the game's owner, but has no profile that keeps custom clips, no machine-readable description of what a
game needs, no per-revision licence or rights holders and no staged release.

Options considered for each axis:

1. **Who describes the slots**: Studio hard-codes OMOBA's heroes; Hub curates a requirements list by hand; **OMOBA
   generates a contract from the files it plays**.
2. **Slot keys**: by input key (Q/W/E/R) per hero; **by gameplay identity** (base state, class basic attack, skill id
   + part).
3. **Package**: a separate motion-pack asset referenced from the avatar (needs a wire field, protocol 12,
   weapon-style admission and peer download); a zip of VRM + per-slot VRMA (Hub takes one source file); **one VRM with
   the custom clips embedded and a slot map in `asset.extras`**.
4. **Defaults**: shipped in the package (bytes, licence questions, drift from OMOBA's tuning); **not shipped — OMOBA
   plays its own default per slot**.
5. **Custom playback**: the default row's rate and start applied to the custom clip; a rate and start declared per slot;
   **the clip plays as authored**.
6. **Rules**: each side writes its own checks; the passport compiled to WASM inside Studio (MPL-2.0 in an MIT
   editor, bundle cost); **one data table in the contract, two implementations (TypeScript, Rust), shared fixtures**.
7. **Hero binding**: hero-locked avatars; **hero-independent avatars whose slots apply by key match**.
8. **Auth from the editor**: OAuth code + PKCE with a scoped token and CORS write routes; **a Hub page driven by
   `postMessage`**.

## Decision

1. **OMOBA owns `omoba.character-contract.v1`**, generated (Rust generator test in the client crate + a stdlib Python
   wrapper) and committed as `shared/assets/catalog/character-contract.json`, checked in OMOBA's gate. Identity is
   `revision: sha256-<canonical JSON>` with the canonicalization of `omoba.asset-catalog.v1`; readers recompute it.
   Data licence CC0-1.0. Hub stores and serves revisions (public, CORS `*`, immutable); Studio bundles a snapshot and
   pins the copy it used inside the project.
2. **Slots are keyed by gameplay identity**: `base.idle|run|walk|death`, `basic.<class>.<n>` (and
   `basic.<class>.<mode>.<n>` for a weapon mode), `skill.<skillId>.release|recast|windup`. Ids are stable and never
   reused. Each slot carries its kind (loop, action, hold), phase, the default motion with its row playback and the
   derived effective play and contact times, the allowed duration window, in-place and loop flags, the contact
   requirement, telegraph, handheld, shared-default and alternation links. `heroes[]` gives one ordered view per class
   and an `any` view (base slots only).
3. **Custom-able in v1**: base idle, run, death; every basic attack; every skill release and recast — 101 of the 107
   slots today. Wind-ups (5) open in v1.1; `base.walk` is reserved; Studio vocabulary slots without an engine state are
   ignored by OMOBA and left out of packages.
4. **Defaults are not shipped.** A package's slot map lists every custom-able slot of its target view as `custom` or
   `default`; `default` plays OMOBA's library motion with its own row. Every Studio surface, Hub's review and the
   owner's queue show the split.
5. **A custom clip plays as authored** (rate 1, start 0); the engine reads duration, looping and contact from the clip
   it resolved. Studio shows the default's effective timing as the target.
6. **The package is one VRM** (1.0, or 0.x) with one glTF animation per custom clip, named by its primary slot id, and
   `asset.extras.ekza_animation_set_v1` {contract schema, project, revision; target hero and requirement; per slot
   mode, animation index, contact seconds}. It fits Hub's one source file per revision, is content-addressed end to
   end and needs no protocol change. A dev zip (VRM turned to −Z, per-slot VRMA, manifest) serves local tests.
7. **One rule table, implemented twice, checked in three places.** Rule ids and parameters ship in the contract;
   Studio (TypeScript) and OMOBA's passport (Rust; also run by the builder inside its sandbox) implement them; Hub's
   registry checks only the structural `pack.*` subset. Unknown rule ids fail closed. OMOBA owns conformance fixtures
   that all three run. Gates are strict (Studio blocks the export, the builder rejects the submission); the runtime is
   lenient (a failing slot plays its default; never a partial clip).
8. **Avatars stay hero-independent.** `base.*` applies on any class, `basic.<class>.*` on that class, `skill.<id>.*`
   whenever the avatar casts that skill. The target hero is a label and the default pick when equipping.
9. **Hub**: contract registry tables and public routes, test/live contract channels, per-hero requirements derived from
   the views, profile `desktop/humanoid-glb-v2` with builder `omoba-humanoid-glb-v2` (keeps custom clips, drops the
   five generic clips, runs the Rust passport, writes a per-slot report), the v1 rendition still built for old clients,
   release channels test → live with an explicit promote, licence and attribution snapshotted per revision, rights
   holders who countersign a collab revision before the game owner may approve it.
10. **Submit from Studio opens a Hub page** and hands the package over with `ekza-studio-submit/v1` (`postMessage`,
    origin allow-lists, a nonce, transferred bytes); the signed-in page records consent and submits through the
    existing BFF. OAuth + PKCE with a `studio-upload` scope and CORS write routes is a later step for agents and
    in-editor status.
11. **Studio** binds a character to a target in an extension table (`ekza.targets`, no schema bump), derives one slot
    status list with a pure function (custom, invalid, default, missing, fixed) and uses it in the Pro Target panel,
    Auto-Rig ④/⑤, Halo's chips, readiness and Share card, Validation rows and the agent tools. Every document write is
    an operator (composition operators over `clip.create`, `library.useClip`, `clip.setSettings`, `clip.makeLoop`,
    `key.retime`, `pose.mirrorAnimation`). Everything is lazy.

## Alternatives

- **Studio-owned or Hub-curated slot lists** were rejected: they drift from the game the day a row is re-tuned; OMOBA
  already proves the generated-catalogue pattern with `omoba.asset-catalog.v1`.
- **Q/W/E/R keys as slot ids** were rejected: rows are keyed by skill id and the same skill appears on several heroes
  and in the lab.
- **A separate motion-pack asset** was rejected for v1: a wire field, a protocol bump, a new admission and peer download
  for no gain while the pack belongs to one rig. It stays the route for motion-only packs reusable across avatars.
- **A zip of VRM + per-slot VRMA as the Hub source** was rejected: Hub stores one source file per revision; the zip
  remains a local-test artifact.
- **Shipping defaults** was rejected: bytes, licence questions, and defaults that would freeze OMOBA's tuning into
  every package.
- **Applying the default row's rate and start to custom clips** was rejected: the creator would not see in Studio what
  plays in the game. **Declared playback per slot** is deferred (an owner question).
- **The passport as WASM in Studio** was rejected: MPL-2.0 inside an MIT editor and bundle cost; a small data-driven
  table plus fixtures is cheaper to keep in step.
- **Hero-locked avatars** were rejected as the default: OMOBA keeps appearance separate from build; a lock for collab
  characters remains an owner question.
- **PKCE first** was rejected for the MVP: a larger security surface and a privacy-rule exception in the editor for a
  flow that needs a person on Hub anyway (consent).

## Consequences

- OMOBA gains a contract exporter, slot identity on motion cues, per-slot resolution and fallback, a motion-pack
  validator in the passport, a v2 builder mode, a v2 SDK selector and server admission for v2 slugs; old clients keep
  working with the v1 rendition.
- Hub gains contract, channel, rights and licence-snapshot tables, a v2 profile and builder, public contract routes, a
  submit page and an owner queue that shows custom versus default per slot. Production migrations, the production
  worker update, legal terms and origin allow-lists need the owner.
- Studio gains a contract parser, a target binding, one slot status function, a Target panel, contract modes in
  Auto-Rig and Halo, per-slot lints and fixes, a package writer and a Submit button; ADR 0010 §1, §5, §6 and §8 are
  amended; the OMOBA copy changes when the profile goes live.
- Pre-existing problems must be cleared for hosted runs: the production worker without OMOBA PR #106, pending hosted
  migrations, the Hub origin mismatch in OMOBA's web and game clients, and the dev contour's builder pin and Hub name.
- New engine states (hit reactions, emotes), custom wind-ups, multi-hero packages and motion-only packs are later
  steps on the same contract.
