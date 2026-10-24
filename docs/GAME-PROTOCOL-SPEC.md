# Ekza Game Protocol — games, Ekza Hub and Ekza Studio

Status: **v0.1 (2026-10-24), draft for the owner.** Normative once the owner accepts it and
[ADR 0025](adr/0025-game-protocol.md) moves to Accepted. The five document formats (§3, Appendices A–C) freeze
together with the OMOBA profile when work package C0 merges into `omoba-bevy` `dev` (§13); after that a change needs a
PR that updates this file first and bumps `schemaVersion` (additive) or the schema id (breaking). Defaults and owner
questions: [DECISIONS-OPEN §R](DECISIONS-OPEN.md#r-game-protocol-defaults-chosen-2026-10-24) (`GP-*`). The OMOBA
profile is [CHARACTER-CONTRACT-SPEC](CHARACTER-CONTRACT-SPEC.md) v0.2.

Owner request (2026-10-24, translated): *"Build the architecture so that, on this principle, other games can be
connected with their own protocols — we need to standardize the protocol so other games support it too, and messages
will go over this protocol. Everyone who works with the SDK must export or provide parameters for each asset and
character: its animation requirements and the assets it must have. For example, a hero must have her gimmick, her
grenades, a rocket. And a character's assets can also be extended. I don't know whether to embed this or to fragment
it separately somehow. Anyway, all of this must be taken into account."* The owner's example is a hero of the
Wildspark kind; this spec works it through on **Wildspark**, OMOBA's own hero (§6).

Inputs (read-only research of 2026-10-24): [CHARACTER-CONTRACT-SPEC](CHARACTER-CONTRACT-SPEC.md) v0.1 and
[ADR 0024](adr/0024-character-contract.md) (the OMOBA-only contract this protocol generalizes); `omoba-bevy`
`origin/dev` @ `6d34f98` (handheld weapons and the one-GLB Wildspark set, `omoba.asset-catalog.v1` and its
requirements, combat cosmetics, the passport's three profiles, the wire); `ekza-registry` `origin/dev` @ `82715fa`
(projects, requirements, rendition profiles, typed assets, map slots, submissions, releases, consent); `ekza-bevy-sdk`
@ `a9a253c` (catalogue, stores, slugs, account); the Ekza top-level ADRs 0001–0002 and plans; ADR 0010; MCP-SPEC; the
in-flight C0 (`omoba-bevy` `feat/character-contract-export`) and C1 (`ekza-studio` `feat/character-contract-studio`)
branches; the open standards listed in §16.

Audience: the owner (§0, §6, §13, §15), implementers of Hub, the SDKs, OMOBA, Studio and of a second game (§3–§12,
appendices), and anyone writing a tool against the protocol.

The rule this spec follows: **a game owns what it needs; Hub owns who may publish and what is released; a tool owns how
a person makes it; the protocol owns the words all three use.** A game describes itself once, as data generated from
the files it plays; every other party reads that data and adds no game logic of its own.

---

## 0. Summary

```
                       ┌──────────────────── Ekza Game Protocol 1.0 ────────────────────┐
                       │ ekza.game-contract.v1   what a game accepts (targets → slots)   │
                       │ ekza.package.v1         what a creator delivers (fills a target) │
                       │ ekza.validation-report.v1   per-slot verdicts of every stage    │
                       │ ekza.event.v1           lifecycle messages (CloudEvents 1.0)     │
                       │ ekza.contract-index.v1  offline snapshot index                   │
                       │ + profiles: omoba.character.v1, …  (game data under `ext` only)  │
                       └────────────────────────────────────────────────────────────────┘
  Game (SDK)                         Ekza Hub (registry)                   Ekza Studio / any tool / agent
  ─────────                          ──────────────────                    ────────────────────────────
  exporter → game-contract ──publish──▶ contract registry, channels ──read──▶ checklist per target/slot
                                        requirements from `accepts`          fill: animation / asset / socket
                                        ◀──────────── submit (package | bundle) ─── package writer + lints
                                        hub check → builder (game validator)
                                        curator → rights holder → game owner
  catalogue (channel) ◀──release──────  test → live, revoke                  status ◀── events / submit page
  per-slot resolve + fallback          events: webhooks + pull feed
  usage acks ─────────────────────────▶ (aggregated)
```

**Decisions** (ADR 0025 is the record; `GP-*` rows in DECISIONS-OPEN §R):

| # | Decision |
|---|---|
| D1 | **One protocol, five documents, many profiles.** The Ekza Game Protocol (EGP) 1.0 defines `ekza.game-contract.v1`, `ekza.package.v1`, `ekza.validation-report.v1`, `ekza.event.v1` and `ekza.contract-index.v1`. A game's specifics are a **profile** (`<game>.<name>.v<N>`) that lives only under `ext` keys and in namespaced rules; a game that does not mark its profile `required` is fully served by generic tools. OMOBA's contract becomes `ekza.game-contract.v1` with the profile `omoba.character.v1` (it was `omoba.character-contract.v1`, never published). |
| D2 | **Versioning and identity.** The schema id carries the major (`.v1`); `schemaVersion` `"1.N"` carries additive minors; `minReaderVersion` lets an older reader accept a newer document by ignoring keys it does not know. Content identity is `revision: sha256-<canonical JSON>` (the `omoba.asset-catalog.v1` rule). Ids are stable; retired ids are listed in the document and Hub refuses to reuse them. Games conform at levels **G0 Listed · G1 Described · G2 Validated · G3 Live** (§3.6). |
| D3 | **Model: game → targets → slots.** A target is what a creator makes content for (`character`, `any`, `item`, `vehicle`, `prop`). Slots are defined once per game, keyed by **gameplay identity**, shared through `usedBy`, and have a kind: `animation`, `asset` (handheld, projectile, throwable, deployable, attachment, effect) or `socket` (`variant`, `audio` reserved). Each target lists its slots in checklist `sections` and the package kinds it `accepts`, each mapped to one Hub requirement id. **Families** are bounded, extensible slot lists (`accessory.*`, up to N). |
| D4 | **Defaults are the game's and are never shipped.** Every slot may name the game's default; a package marks each listed slot `custom` or `default`. The generic vocabulary carries what tools need to show timing and placement: **markers** (named times in a clip: `contact`, `release`, `fire`) and **anchors** (named points in an asset: `muzzle`, `trail`). |
| D5 | **One package manifest for every package.** `ekza.package.v1`, embedded as `asset.extras.ekza_package_v1` in the glTF/VRM container (it replaces the key `ekza_animation_set_v1` that ADR 0010 reserved and ADR 0024 used; nothing has shipped with it). Kinds: `character` (monolithic), `animation-pack`, `asset-pack`, `accessory`. Fills bind by **index** (an animation, a root node), never by name alone (name binding survives only as the transition path for gun sets made before the manifest). |
| D6 | **Monolithic vs fragments: one package per review unit and per reuse unit.** What belongs to one body and means nothing elsewhere (its clips, its own sockets) goes into the character package; what the game equips separately or reuses across bodies (weapons, projectiles, props, accessories, motion packs) is a fragment. Studio lets a person **author as one and submit as a bundle**: Hub stores fragments, approves the bundle atomically. **OMOBA v1: the character package is one VRM with its clips (unchanged from ADR 0024); the hero's gear is one `asset-pack` GLB per set — today's Wildspark set, extended with the rocket and the trap when the game opens those slots.** |
| D7 | **Runtime composition per slot**: an equipped fragment's fill, else the character package's fill, else the game's default. Each slot is judged on its own (a failing slot plays its default); a set's `mustFill` slots switch together or not at all. The game's wire carries content-addressed release references, never URLs. |
| D8 | **One rule vocabulary.** Core rule ids (`pack.*`, `rig.*`, `clip.*`, `asset.*`, `socket.*`, `rights.*`) have protocol-defined semantics and contract-supplied parameters; a game's own rules are namespaced (`omoba.asset.grip`) and say who checks them (`checkedBy`). Two reference implementations (TypeScript, Rust; permissive licences) run the core conformance fixtures; games own their profile fixtures. Strict at the gates, lenient at runtime. |
| D9 | **Messages.** Commands and queries are HTTP + JSON on the Hub registry with `Idempotency-Key` and RFC 9457 errors. Events are **CloudEvents 1.0** (`io.ekza.gp.*`) written to a transactional outbox and delivered by **signed webhooks** (Standard Webhooks headers) and a **pull feed** with cursors — the polling path every static game can use. Studio keeps `ekza-studio-submit/v1` (`postMessage`) for the person-present submit. |
| D10 | **Auth.** Games use project keys: publishable `ekza_pk_…` (read the test channel) and secret `ekza_sk_…` with scopes (`contract:publish`, `events:read`, `usage:write`, `webhooks:manage`). Creators use their Hub session now and an OAuth PKCE `studio-upload` token later; agents use the existing device code. Review decisions are made only by people on Hub. |
| D11 | **Everything is a file, so everything works offline.** Contracts are committed by the game and bundled by tools; release snapshots are pulled by the SDK CLI and pinned by SHA-256 in a build; packages carry their manifest inside the hashed bytes. No network is needed to validate a package or to play approved content. |
| D12 | **Rights per package and per fragment.** The file declares (VRM meta, `asset.copyright`); Hub verifies per revision (`revision_rights`: creator, co-authors, rights holder with countersign). A bundle is approvable only when every member's rights are complete; a fragment derived from another work names it in `requires` and needs that work's licence to allow derivatives. Revenue shares are stored per rights row and stay inactive until commerce turns them on. |

**What changes for the work in flight** (precise names: §12.3): C0 emits `ekza.game-contract.v1` with
`ext["omoba.character.v1"]` into `shared/assets/catalog/game-contract.json` (exporter
`scripts/export_game_contract.py`, test `game_contract_is_current`, env `OMOBA_WRITE_GAME_CONTRACT`); four rule ids are
renamed (`pack.extras` → `pack.manifest`, `pack.animation-ref` → `pack.ref`, `clip.contact` → `clip.markers`,
`clip.basic-interval` → `clip.min-interval`); `contact` becomes `animation.markers.contact`; `heroes[]` becomes
`targets[]`. C1's game-agnostic `model.ts` is already this protocol's model: it renames `ContractCharacter` →
`ContractTarget`, reads one document schema and dispatches profiles by `ext` key. Both deltas are about one agent-day
each and must land **before the C0 freeze**.

**Delivery** (§13): ten work packages GP0–GP9 on top of C0–C7, about **51 agent-days** without GP9 (other engines,
when a partner asks); the protocol is usable for OMOBA characters after GP1 (≈ 2 days, inside C0/C1), for OMOBA gear
after GP5 + GP6, for a second game after GP2 + GP4 + GP8.

---

## 1. Terms, scope, non-goals

| Term | Meaning |
|---|---|
| **Protocol (EGP)** | The Ekza Game Protocol: the five document formats, the rule vocabulary, the message set and the conformance levels of this spec. Version 1.0. |
| **Game** | A Hub project (`omoba`, `ekza-space`, …) that publishes a contract and consumes releases. |
| **Contract** | `ekza.game-contract.v1`: one game's machine-readable description of what creators may make for it. One JSON document per revision, generated by the game. |
| **Profile** | A named, versioned extension of the protocol for one game or one family of games (`omoba.character.v1`): the shape of its `ext` objects, its slot-id grammar, its namespaced rules and fixtures. |
| **Target** | A thing in the game a creator makes content for: a hero class, "any hero", an item, a vehicle, a placed prop. |
| **Slot** | One place where the game uses one creator-made thing, with a stable id: `skill.wild_rocket.release` (an animation), `wildspark.handheld.launcher` (an asset). |
| **Family** | A bounded, extensible list of slots of one kind (`accessory.*`, at most N) that a package may add instances to. |
| **Default** | What the game plays or shows in a slot that a package leaves to the game. Never shipped in a package. |
| **Fill** | A package's entry for one slot: `default`, or `custom` with a binding (an animation index and markers, or a root node index and anchors). |
| **Package** | One file a creator submits, with its manifest `ekza.package.v1`: a monolithic `character` package or a fragment (`animation-pack`, `asset-pack`, `accessory`). |
| **Bundle** | Several packages submitted and approved together (a character and its gear). A Hub grouping, not a file. |
| **Offer** | One entry of a target's `accepts[]`: a package kind the target takes, the slots it may fill and the Hub requirement id a submission names. |
| **Rendition** | What Hub's builder makes from a package for a rendition profile; content-addressed; what clients download. |
| **Channel** | `test` or `live`: which approved releases a game build sees. |
| **Release** | A game's pinned approval of one rendition of one package revision in one channel. |
| **Loadout** | The packages one player has equipped for one target in one match. |

**In scope (1.0)**: describing targets and slots of any game (animations, assets, sockets); monolithic and fragment
packages and bundles; validation vocabulary, stages and reports; the lifecycle messages between a game, Hub, Studio
and agents; auth; offline distribution; rights per package and fragment; the SDK surface; the OMOBA profile and its
migration.

**Non-goals (1.0)**: gameplay content (new heroes, skills, rules — the protocol is cosmetic: a slot never changes
damage, reach, timing or collision); a universal avatar format beyond glTF 2.0 and VRM; sound slots (`audio` reserved);
material variants (`variant` reserved); in-match revocation; payments (rights rows carry the hooks); a validator
runtime for arbitrary third-party code in browsers; containers other than glTF/VRM (a sidecar for other containers is
a later minor, §5.9).

---

## 2. What exists today (digest)

**OMOBA** (`omoba-bevy@dev`):
- The character contract draft (CHARACTER-CONTRACT-SPEC v0.1): 107 animation slots keyed by gameplay identity, 18
  views, one rule table, one VRM per package with `asset.extras.ekza_animation_set_v1`. C0 is generating it now.
- `omoba.asset-catalog.v1` (`scripts/export_asset_catalog.py`, `docs/asset-catalog.md`): classes, skills and
  **requirements** with `role ∈ held_weapon | projectile | world_prop | engine_effect | animation_reference`,
  `status ∈ supported | planned | engine_owned`, `uses[]` (skill or basic attack, phase, state), a baseline model and a
  profile for supported rows. Wildspark has `wildspark.handheld.repeater`, `wildspark.handheld.launcher` (supported),
  `wildspark.projectile.basic-rocket` (engine-owned), `wildspark.projectile.ultimate` and `wildspark.prop.trap`
  (planned), `wildspark.effect.shockline` and `wildspark.effect.explosion` (engine-owned, procedural). The catalogue is
  consumed by the OMOBA web portal only, never by the game. **These rows already are asset slots in all but name.**
- Handheld weapons (`docs/handheld-weapons.md`, `shared/src/handheld.rs`, `client/src/held_weapons.rs`): cosmetic,
  independent of class; the wire carries `handheld` as `ClassDefault | Unequipped | Item(id)`; the grip is
  `asset.extras.ekza_handheld_v1 {bone, offset, rotation_degrees, scale}` (bone `rightHand|leftHand`, offset ≤ 0.3 m,
  scale 0.25–2); the only socket is the palm frame derived from the rig (`humanoid/sockets.rs`).
- **The one-GLB Wildspark set**: one `handheld-glb-v1` weapon asset with two named subtrees `WildsparkSetRepeater`
  (child `WildsparkRotor`) and `WildsparkSetLauncher` (child `WildsparkSlide`, scale 0 in the file), an optional muzzle
  hint `asset.extras.omoba_wildspark_set_v1`, per-variant bounds, submitted with requirement `wildspark.handheld.set`;
  the game detects a set by node names and switches variants by weapon mode. Three themed sets are built and one was
  approved on the dev contour. Projectiles and traps are packaged GLBs (`cosmetics/standard/rocket.glb`, `trap.glb`
  with nodes `WildsparkTrapBase`, `WildsparkJawLeft`, `WildsparkJawRight`) the game loads from a closed vocabulary;
  explosions and the Shockline bolt are procedural. Nothing but `avatar` and `handheld` is on the wire per player.
- Passport profiles: `humanoid-glb-v1`, `handheld-glb-v1`, `map-prop-glb-v1`; reactions (a 4-slot wheel) and a
  sponsored map slot (`opposite-dragon`) exist as separate systems.

**Ekza Hub** (`ekza-registry@dev`): one asset model (`avatar | weapon | map_prop`), one source file per revision,
curator then game-owner gates, renditions per `(platform, profile, version)` built by a game-owned builder (Docker,
no network, stdout JSON, exit 0/2/1), releases pinned per game (ADR 0002: a new revision never replaces an approved
one), `project_requirements` seeded by SQL (`wildspark.handheld.set`, `community.map.sculpture`), `map_slots` for world
placements, consent rows with `terms_sha256` and `I_ACCEPT`, append-only `submission_events`. **No outbox, webhooks or
event feed: every consumer polls.** Adding a kind or a builder needs a migration (CHECK constraints), and two slug
schemes coexist (64-hex for avatars, 32-hex for weapons).

**Ekza SDK** (`ekza-bevy-sdk` 0.9, MIT OR Apache-2.0): `SupportSelector {project, platform, profile, formats}`,
`/v2/avatars` and `/v2/assets` readers, `AvatarStore`/`AssetStore` with SHA-verified content-addressed caches and an
offline cached catalogue, device-code account linking, the passport ticket path; OMOBA-specific selectors and legacy
characters inside. No events, no contract types, no Bevy plugin.

**Ekza Studio** (`dev` and the C1 branch): ADR 0010's per-clip metadata `ekza_animation_v1`, export profiles as data,
the closed vocabulary-v1 slot list; C1 already layers the contract reader as a **game-agnostic model** (`game →
characters → slots of kind animation | asset`) plus a strict reader per document schema — the shape this protocol
adopts (§12.3).

**Prior art** (references in §16; proprietary platforms described neutrally, TM-1):

| Source | What this protocol takes | What it does differently |
|---|---|---|
| glTF 2.0 extension mechanism (`extras`, `extensionsUsed`/`extensionsRequired`, vendor prefixes, `asset.minVersion`) | the manifest in `asset.extras` (ignored by loaders, covered by the hash); `profiles.used`/`required` mirror used/required extensions; `minReaderVersion` mirrors `minVersion` | a registered vendor extension is a later option (`GP-Q11`) |
| VRM 1.0 (humanoid bones, T-pose rest, `meta` licence fields, VRMA animation files) | the `vrm-humanoid` rig kind; licences declared in VRM meta; VRMA as the `animation-pack` container | — |
| Khronos character/avatar extensions draft (`KHR_character_*`, skeleton mapping; no attachment or equipment extension) | a later second rig kind mapped through `KHR_character_skeleton_mapping` | slots, sockets and asset fills cover what the draft leaves out |
| OMI extensions (`OMI_seat`: named local points on a node) | anchors as named local points | — |
| OpenUSD composition (references, payloads, variant sets, `over`) | a fragment is an "over": it only applies where the base defines the slot; one fixed resolution order (§5.8) | no general composition: depth ≤ 1, one order |
| A large UGC game platform (accessory types tied to named attachment points, per-type bounding boxes, ≈ 4k-triangle accessories, animation-pack asset types, bundles, game-side settings that scale or remove accessories) | families with sockets and bounds; bundles; the game, not the creator, bounds extensions | an open, game-owned contract instead of one platform's fixed list |
| A cross-game avatar service (assets scoped per application, avatar files fetched with consumer parameters; since shut down) | compatibility is per game and per target, declared by the game | the game's contract, not the avatar vendor, defines compatibility |
| A mod-hosting service and a storefront workshop (typed events, dependencies with reverse lookup, metadata blobs, soft dependencies, static-token webhooks) | typed events; `requires` with dependants revoked together | hard dependency checks on Hub; HMAC-signed webhooks |
| Engine data-validation and modular-feature systems (validators run on save and in CI) | validators that run in tools, in CI and in the builder with one rule set | — |
| CloudEvents 1.0, Standard Webhooks | the envelope, reverse-DNS types, versioning by new type; signing headers, retries, SSRF guard | the webhook body is the CloudEvent |
| JSON Schema 2020-12, SchemaVer | closed core with `unevaluatedProperties`, open `ext`; major in the id, additive minors | — |
| OCI descriptors and referrers, RFC 8785 | every blob by digest and size; reports attached to a package by reference without changing it; canonical JSON | the `sha256-<hex>` form of the asset catalogue |

**What is missing for "any game"**: a game-agnostic document with asset slots; one manifest for every package kind; a
composition rule for fragments; events; project keys; a rule vocabulary that is not OMOBA's; a home for schemas and
fixtures outside one game's repository.

---

## 3. Layering, names, versioning, conformance

### 3.1 Documents

| Schema id | What | Written by | Read by | Where it lives |
|---|---|---|---|---|
| `ekza.game-contract.v1` | targets, slots, families, rules, packaging of one game (§4) | the game's exporter | Hub, tools, SDKs, agents | committed in the game's repo; Hub `/v1/projects/{game}/contracts/{rev}`; tool snapshots |
| `ekza.package.v1` | the manifest of one package (§5) | tools (Studio, others) | Hub, builder, the game | inside the package: glTF `asset.extras.ekza_package_v1` |
| `ekza.validation-report.v1` | one stage's verdict per package and per slot (§7.5) | validators (tool, Hub, builder, game) | Hub, tools, review queues | Hub object storage (`renditions.report_key`), events |
| `ekza.event.v1` | one lifecycle event, CloudEvents 1.0 structured mode (§8.3) | Hub | games, creators' tools, agents | webhooks, the pull feed |
| `ekza.contract-index.v1` | revisions, channels and hashes of one game's bundled contracts (§8.10) | `sync-contract` tools, Hub | tools offline | `…/contracts/<game>/index.json` |

JSON Schemas (draft 2020-12): Appendices A–C; their canonical URLs are `https://ekza.io/schemas/gp/<schema id>.json`
and their home is the protocol repository (§13, GP0). Event `data` payloads have one schema per event type
(`https://ekza.io/schemas/gp/events/<type>.v1.json`, §8.4).

### 3.2 Profiles and extension points

A **profile** is the only way a game adds meaning. It is named `<namespace>.<name>.v<N>` (`omoba.character.v1`;
namespaces are Hub project ids or `ekza` for shared profiles) and defines, in its own JSON Schema with one `$defs`
entry per position:

| Extension point | How | Example |
|---|---|---|
| `ext["<profile>"]` objects | on the document, each rig, socket, packaging entry, slot, family and target | OMOBA's engine timings on the document; `phase`, `row`, `telegraph` on a slot; `kit` keys on a target |
| Slot-id grammar | a profile narrows the core grammar (§3.4) | `base.<state>`, `basic.<class>.<n>`, `skill.<id>.<part>`, `<class>.<role>.<name>` |
| Namespaced rules | `<namespace>.<scope>.<name>` with `checkedBy` (§7.3) | `omoba.asset.grip` |
| Fixtures | profile conformance cases in the game's repository | `game-contract-fixtures/v1/` |
| Enumerations | **not extensible by profiles**: slot kinds, asset roles, target kinds, package kinds, rule scopes, event types grow only with a protocol minor | — |

The document lists `profiles.used` and `profiles.required`. A reader:
- ignores `ext` entries of profiles it does not know **unless** the profile is in `required` — then it refuses the
  document ("This game needs a newer <tool>");
- validates `ext` entries of profiles it knows strictly against the profile schema.

A game whose profiles are not `required` must be fully servable by a generic tool: every check a creator must pass is
a core rule with parameters, or a namespaced rule whose `checkedBy` does not include `tool` (§7.3). OMOBA marks
`omoba.character.v1` **used, not required**: its `ext` carries engine timings, row playback and kit keys that make
Studio's previews better but are not needed to make a valid package.

Shared profiles (`ekza.*`) are reserved for conventions several games adopt (for example a future `ekza.handheld.v1`
grip convention that would replace OMOBA's `omoba.asset.grip`); a game's profile may name a shared one in
`profiles.used`.

### 3.3 Versioning

- **Schema id** (`ekza.game-contract.v1`): the major. A change that would make a reader written for the old major
  misread a document is a new id (`…v2`); readers refuse unknown ids.
- **`schemaVersion`** (`"1.0"`, `"1.1"`, …): additive minors. A minor adds optional keys or enum values; it never
  changes a meaning.
- **`minReaderVersion`**: the lowest minor a reader must implement to use the document safely. A writer sets it to the
  lowest minor whose readers lose nothing that matters by ignoring the newer keys (often `"1.0"`).
  A reader that implements minor *R*:
  - refuses the document when `minReaderVersion` > *R* ("needs a newer …");
  - parses **strictly** (unknown keys are errors, as the OMOBA contract and C1 do) when `schemaVersion` ≤ *R*;
  - parses known keys strictly and **ignores unknown keys** (logging them) when `schemaVersion` > *R* ≥
    `minReaderVersion`.
  Strictness therefore still catches typos in every document a reader fully understands.
- **`revision`**: the content identity: `"sha256-"` + lowercase hex SHA-256 of the canonical JSON of the document
  without the `revision` key. Canonical JSON (`ekza-canonical-json/1`) is the rule of `omoba.asset-catalog.v1`:
  recursively sorted keys, compact separators, UTF-8 strings as is, integer-valued numbers as integers, other numbers in
  plain decimal notation, finite, zero or of magnitude ≥ 0.000001 and ≤ 2^53 − 1. Within that range it coincides with RFC 8785
  (JCS) number serialization, so any JCS library reproduces it; writers must keep numbers in that range. Readers
  recompute the revision and refuse a mismatch.
- **Compatibility classes** of a new revision against `previousRevision`, computed by the publisher and re-checked by
  Hub:
  - **compatible**: slots, targets, offers or families added; a slot became customizable; a default's metadata or a
    label changed; a rule loosened; an optional key added;
  - **breaking**: a slot, target, offer or family removed or retired; a slot no longer customizable; a rule tightened;
    a slot's kind or binding changed.
  Hub refuses to move `live` to a breaking revision without an explicit `breaking: true` and a note (§8.5).
- **Stability of ids**: a slot, target, family or offer id keeps its meaning for the life of the game. Removing one
  moves it to `retired` (`id → revision it was retired in`); Hub refuses any later revision that reuses a retired id.
  A package made against an older active revision is judged per slot against the game's current rules (§5.7).

### 3.4 Ids

| Id | Grammar | Example |
|---|---|---|
| game | `^[a-z][a-z0-9-]{1,62}$` (Hub project id) | `omoba` |
| target | `^[a-z][a-z0-9_-]{0,47}$` | `wildspark`, `any` |
| slot | 1–8 dot-separated segments, the first `[a-z][a-z0-9_-]{0,47}`, the rest `[a-z0-9][a-z0-9_-]{0,47}`; ≤ 96 chars | `basic.wildspark.rockets.0`, `wildspark.prop.trap` |
| socket | 1–4 segments of ≤ 32 | `hand.right` |
| family, rig | `^[a-z][a-z0-9_-]{0,31}$` | `accessory`, `humanoid` |
| profile | `<namespace>(.<part>)*.v<N>` | `omoba.character.v1` |
| rule | core `<scope>.<name>`; profile `<namespace>.<scope>.<name>`; scope ∈ `pack rig clip asset socket rights` | `clip.markers`, `omoba.asset.grip` |
| requirement | Hub's `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$`, ≤ 128 | `character.wildspark`, `wildspark.handheld.set` |
| marker, anchor | `^[a-z][a-z0-9_]{0,31}$` | `contact`, `muzzle` |
| event id | `evt_` + ULID | `evt_01JB8Z6Q3K4M5N6P7R8S9T0V1W` |

**Keying rule** (generalizes CC D2): a slot is keyed by **what the game plays or shows**, not by an input key, a menu
position or a class choice. A skill's release clip is `skill.<skillId>.release` because the same skill appears on
several heroes; the Wildspark launcher is `wildspark.handheld.launcher` because that is the requirement id OMOBA's
catalogue already publishes and the item the game shows in rocket mode.

### 3.5 What a reader must do with a contract

1. Cap the bytes (1 MiB for tools and the SDK; Hub accepts up to 4 MiB), parse JSON, check `schema`.
2. Apply §3.3 (`minReaderVersion`, strictness), validate against Appendix A (for a newer minor: after removing and
   logging the keys it does not know), recompute `revision` over the document as received.
3. Check cross-references in code: every `targets[].slots`, `sections[].slots`, `accepts[].slots` and `mustFill`
   entry exists in `slots`; `usedBy` names existing targets; `sharesDefaultWith`/`alternatesWith` point at existing
   slots of the same kind; sockets and rigs referenced exist; families referenced exist; `profiles.required` ⊆ `used`;
   every slot of every offer has a kind listed in that package kind's `packaging.slotKinds`; no id appears in both
   `slots` and `retired`.
4. Check every rule id: unknown **core** ids → refuse the document (fail closed); unknown **namespaced** ids → keep,
   and treat as *deferred* (§7.3).
5. Apply known profiles to `ext` (§3.2).

### 3.6 Conformance levels

| Level | A game… | What creators get |
|---|---|---|
| **G0 Listed** | is a Hub project with free-text requirements (today's `wildspark.handheld.set` seed) | upload + review; no checklist |
| **G1 Described** | publishes `ekza.game-contract.v1` revisions (§4) with core rules; Hub derives its requirements from `accepts` | Studio's checklist per target and slot; Hub's structural check |
| **G2 Validated** | ships a builder/validator that implements every rule its contract lists, passes the core fixtures and its own profile fixtures; Hub's builder runs it in the sandbox | strict gates, per-slot reports before review |
| **G3 Live** | consumes channels through an SDK, resolves fills per slot with fallback, admits approved references on its server, reports usage | "works in game" status, test channel, telemetry of fallbacks |

Tools conform as **Reader** (parses contracts per §3.5, shows targets and slots), **Writer** (writes packages that
pass every core `pack.*` rule) and **Validator** (implements every core rule and passes the core fixtures). Studio
aims at all three; a third-party exporter may be a Writer only (Hub and the game validate). Hub is a single
implementation and must implement every core rule of `checkedBy: hub`.

---

## 4. The game contract `ekza.game-contract.v1`

### 4.1 Top level

| Key | Meaning |
|---|---|
| `schema`, `schemaVersion`, `minReaderVersion` | §3.3 |
| `game` | `{id, name}` — the Hub project |
| `revision`, `previousRevision` | §3.3; `previousRevision` lets readers show a diff |
| `license` | the document's data licence (OMOBA: `CC0-1.0`) |
| `source` | `{commit, exporter, inputsSha256}`: the game's commit (or null for non-git sources), the exporter path, SHA-256 over the sorted map path → byte hash of every consumed input |
| `profiles` | `{used[], required[]}` (§3.2) |
| `rigs` | named rig classes the game drives (§4.2) |
| `sockets` | named attachment points relative to a rig (§4.3) |
| `packaging` | per package kind: containers, byte caps, the manifest key, how fills bind, the rendition profile (§4.8) |
| `rules` | the rule table (§7) |
| `slots` | every slot of the game, by id (§4.4) |
| `families` | extensible slot lists (§4.6) |
| `targets` | ordered targets with sections, slots, families and offers (§4.7) |
| `retired` | `{slots, targets, families}`: id → the revision that retired it |
| `ext` | profile data (§3.2) |

Size: OMOBA's full document is about 150 kB canonical (113 slots, 18 targets, prototype run); readers cap at 1 MiB.

### 4.2 Rigs

`rigs.<id>` describes a skeleton class the game can drive. 1.0 defines one kind, **`vrm-humanoid`**, with the fields
of CC v0.1 §3.4 made generic: `sourceFormats` (`vrm1`, `vrm0`), `restPose` (`t-pose | a-pose | any`), `facing`
(`as-vrm-spec`), `requiredBones`, `requiredBonesVrm0`, `drivenBones` (the only bones a custom clip may rotate),
`maxHumanoidBones`, `maxNodes`, `uniformScale`, `fingers`, `thumbsRecommended` and `lengthUnit {name: "legLength",
from: "hips-to-feet", referenceM}` (the unit of in-place limits, so limits do not depend on the model's scale). The
rule `rig.humanoid` checks a character package against it. Reserved kind for a later minor: `gltf-skeleton` (named
bones of a non-humanoid rig: creatures, vehicles).

### 4.3 Sockets

`sockets.<id>` = `{label, rig, bone, frame, fillable, ext}`: an attachment point on a rig. `frame` is `bone` (the
bone's own frame), `palm` (a grip frame the game derives from the rig, as OMOBA's `grip_frame` does) or `authored`
(a node the character package provides). `fillable: true` means a character package may override the point with a
`socket` slot (§4.5); otherwise the game always derives it. OMOBA 1.0 declares `hand.right` and `hand.left`, both
`palm`, not fillable.

### 4.4 Slots: common fields

| Field | Type | Meaning |
|---|---|---|
| `kind` | `animation \| asset \| socket` | which spec object is filled (exactly one of `animation`, `asset`, `socket` is non-null) |
| `label`, `description` | string ≤ 80, string ≤ 2000 or null | display text; OMOBA fills `description` from its requirement briefs |
| `customizable`, `customizableFrom` | bool, `"1"` / `"1.1"` / null | a package may fill it under this contract; the profile minor that opens it (a fixed slot with a version is shown "opens in 1.1") |
| `reserved` | bool | exists for a future game state; never played |
| `required` | bool | a package for an offer that lists it must fill it; then `default` is null. Rare: a game with a default for everything has none |
| `default` | `{name, playSecs, loop, markers, preview}` or null | the game's own default: its name, as-played length and markers (animations), and an optional preview file the game publishes (CC0 VRMA, GLB or PNG by SHA-256, served by Hub, §8.5) |
| `sharesDefaultWith` | slot ids | slots whose default is the same thing (one custom fill can serve all) |
| `alternatesWith` | ≤ 1 slot id | the other half of an alternating pair (two swings) |
| `usedBy` | target ids or `*` | the targets that use the slot (a slot is defined once and shared) |
| `ext` | profile data | OMOBA: group, role, phase, row playback, telegraph, handheld; for assets the catalogue role, status, uses, baseline |

**Sharing**: a slot used by several targets is one slot (`base.idle` is used by `*`). A fill applies wherever the
slot is used **when the package is equipped for that target** (§5.8); a game that wants a per-target variant defines
two slots (OMOBA keeps `riftshot.handheld.repeater` and `wildspark.handheld.repeater` separate, as its catalogue does).

### 4.5 Slot kinds

**`animation`** — one clip on a rig:

| Field | Meaning |
|---|---|
| `rig` | the rig id the clip drives |
| `playback` | `loop` (repeats), `action` (once), `hold` (once, then holds the last pose) |
| `loop` | the clip must loop and close (`clip.loop-closure`) |
| `inPlace` | the hips may not travel (`clip.in-place`) |
| `window` | `{minSecs, targetSecs, maxSecs}`: allowed length of a custom clip; `targetSecs` = the default's as-played length |
| `markers` | `{name: {required, maxSecs, targetSecs}}`: named times the game uses. Standard names: **`contact`** (the impact pose; OMOBA's contact rule is `maxSecs: 0.15` on edge-released slots), **`release`** (a thrown object leaves the hand), **`fire`** (a shot leaves the muzzle), **`footstep_l`**, **`footstep_r`**, **`land`**. A profile may define others |
| `minIntervalSecs` | the shortest time before the game may start the next action (a longer clip is cut) |
| `leadInSecs` | the game's own lead-in (a wind-up or telegraph) before this clip starts; tools draw it as a band before frame 0 |

A custom clip plays **as authored** (rate 1, start 0) unless a profile says otherwise; the game reads length, loop
and markers from the clip it resolved, never from the default it replaced (CC D5, generalized).

**`asset`** — a separate object the game shows:

| Field | Meaning |
|---|---|
| `role` | **`handheld`** (held in a hand socket: weapon, tool, scepter), **`projectile`** (spawned, travels: rocket, bolt, arrow), **`throwable`** (thrown on an arc: a grenade), **`deployable`** (placed and persists: a trap, a turret), **`attachment`** (rigidly attached to a body socket: a backpack, a hat), **`effect`** (a mesh effect: a trail, a shell) |
| `socket` | the socket it attaches to (`handheld`, `attachment`), else null |
| `rootName` | the name the fill's root node must carry, when the game binds by name too (OMOBA: `WildsparkSetLauncher`); null when the manifest's index is the only binding |
| `nodes` | `{required[], optional[]}`: named parts under the root that the game drives (OMOBA: `WildsparkSlide` recoils, `WildsparkRotor` spins, trap jaws close) |
| `anchors` | `{name: {required, default, boxM}}`: named points in the asset's space. Standard names: **`muzzle`**, **`trail`**, **`grip_off`** (off-hand), **`impact`**. A fill may supply them (`anchors` in the manifest); a missing optional anchor uses `default` |
| `axes` | `{origin: grip \| center \| base \| socket, up, forward}` in glTF axes (OMOBA handhelds: origin at the palm, +Y along the shaft, +Z toward the muzzle) |
| `sizeM` | `{boxMin, boxMax}` in metres: the allowed bounding box (OMOBA: the baseline ± 10 %), or nulls |
| `budget` | `{maxTriangles, maxNodes, maxMeshes, maxMaterials, maxImages, maxTextureSize, maxTexturePixels}` (nullable where the game sets no cap) |
| `materials` | `{extensionsAllowed[], imageFormats[], maxEmissiveStrength}` |
| `motion` | `static` (no animations, no skins), `named-parts` (the game moves `nodes` itself), `node-animation` (glTF node TRS animation allowed, looped by the game), `skinned` |

**`socket`** — a character package's own placement of a socket: `{socket, maxOffsetM, maxRotationDeg}`; the fill
names a node of the character model. Used when a game lets characters carry their weapon on an unusual hand or a
tail; OMOBA 1.0 has none.

Reserved kinds (a later minor; readers refuse documents that use them before then): **`variant`** (a material
variant of the target's base model, in the manner of glTF's materials-variants extension) and **`audio`**.

### 4.6 Families: extensible lists

The owner's "a character's assets can also be extended" is a **family**: a slot template a package may instantiate
up to a bound.

```jsonc
"families": {
  "accessory": {
    "kind": "asset", "label": "Accessories", "description": "Up to three cosmetic attachments on any hero.",
    "customizable": true, "customizableFrom": "1.2", "reserved": false, "required": false, "default": null,
    "animation": null, "socket": null,
    "asset": { "role": "attachment", "socket": "back", /* … the same spec object as a slot; illustrative: OMOBA has no "back" socket yet … */ },
    "idPrefix": "accessory", "minFills": 0, "maxFills": 3, "usedBy": ["*"], "ext": {}
  }
}
```

A package fills family instances with slot ids `<idPrefix>.<name>` (`accessory.cape`, `accessory.lantern_charm`):
`<name>` is creator-chosen, follows the slot grammar and is unique in the package. The family's spec, budget and rules
apply to every instance; `maxFills` bounds the instances per package **and** per loadout (the game shows at most that
many); the game decides where and how (an equip UI per family). Families are how a game opens **open-ended** content
(emotes, reactions, accessories, trinkets) without listing every item in its contract. A family instance is never
`required`. OMOBA 1.0 declares no families; its 4-slot reaction wheel is the natural first one (`reaction.*`,
`maxFills: 4`, §11.4).

### 4.7 Targets

| Field | Meaning |
|---|---|
| `id`, `kind`, `name`, `subtitle` | `kind` ∈ `character` (a playable body: a hero class), `any` (a view over slots every character uses: "a character for any hero"), `item`, `vehicle`, `prop` |
| `sections` | the checklist: `[{id, label, key, slots}]` in display order; `key` is an input hint ("Q") or null. Sections may mix kinds: Wildspark's **E** section holds the Snapline release clip *and* the trap asset (§6) |
| `slots` | every slot of the target in checklist order |
| `families` | families the target uses |
| `accepts` | the target's **offers** (below) |
| `ext` | profile data (OMOBA: role, basic attack numbers, kit keys, default handheld) |

**Offers** (`accepts[]`), one per package kind the target takes:

| Field | Meaning |
|---|---|
| `package` | the package kind (`character`, `asset-pack`, …) |
| `requirementId` | the Hub requirement a submission names; **Hub derives `project_requirements` rows from offers** on publish (§8.5) |
| `label` | "Character for Wildspark", "Wildspark gear set" |
| `slots`, `families` | what a package for this offer may fill (each slot's kind must be in `packaging.<kind>.slotKinds`) |
| `listing` | `every-customizable-slot` — the manifest lists every customizable slot of the offer once, as `custom` or `default` (CC D4: "which slots are mine" is visible on Hub); `filled-slots-only` — the manifest lists only what it fills |
| `mustFill` | slots every package for this offer must fill `custom` (a set: OMOBA's gear set must fill both guns) |

Keeping offers explicit keeps today's ids: `character.<hero>` for character packages and the existing
`wildspark.handheld.set` for the gear set, so submissions, deep links and the creator loop do not change.

### 4.8 Packaging

`packaging.<packageKind>` = `{containers, manifestKey, slotKinds, maxBytes, maxJsonBytes, maxFills, binding,
rendition, ext}`:
- `containers`: `vrm1`, `vrm0`, `glb`, `vrma` (glTF 2.0 binary containers; §5.9 for others).
- `manifestKey`: `ekza_package_v1` (fixed in 1.0).
- `binding`: `manifest` (fills bind by the manifest only) or `manifest-or-names` (a package without a manifest is bound
  by `rootName`s — the transition path for OMOBA's existing sets, §12.1).
- `rendition`: the Hub rendition profile Hub builds for this kind (`desktop/humanoid-glb-v2`, `desktop/handheld-glb-v1`)
  or null (the source is served as is). The registry's profile document keeps container and byte checks; slot rules
  live in the contract.

---

## 5. Packages `ekza.package.v1`

### 5.1 Kinds

| Kind | Container | Fills | Typical use | Hub asset kind |
|---|---|---|---|---|
| **`character`** (monolithic) | VRM 1.0 / 0.x | animation slots (and, from a later minor, socket slots) of one target's offer | a body with its own clips: CC D6 | `avatar` |
| **`animation-pack`** | one GLB or VRMA with several animations on a reference rig of the contract's rig class | animation slots of an offer, reusable on any body of that rig | motion-only packs (ADR 0010 T1) | `animation` (new) |
| **`asset-pack`** | one GLB, one subtree per filled slot | asset slots of an offer | a hero's gear set: guns, rocket, trap | `weapon` (OMOBA) / `asset` |
| **`accessory`** | one GLB, one subtree | instances of one family | a hat, a charm | `accessory` (new) |

A character package **may** carry asset fills too (§5.4), but only when the contract's `packaging.character.slotKinds`
lists `asset`; OMOBA's does not (D6).

### 5.2 The manifest

Embedded as `asset.extras.ekza_package_v1` (glTF `extras` are free-form application data that loaders preserve and
ignore; the key is covered by the file's SHA-256). JSON Schema: Appendix B.

```jsonc
"ekza_package_v1": {
  "schema": "ekza.package.v1", "schemaVersion": "1.0",
  "kind": "character",
  "contract": { "schema": "ekza.game-contract.v1", "game": "omoba", "revision": "sha256-…" },
  "target": { "id": "wildspark", "requirementId": "character.wildspark" },
  "slots": {
    "base.idle": { "mode": "default" },
    "base.run": { "mode": "custom", "animation": 0, "markers": {} },
    "basic.wildspark.0": { "mode": "custom", "animation": 1, "markers": { "contact": 0.067 } }
    // … every customizable slot of the offer, once (listing: every-customizable-slot)
  },
  "requires": [],
  "provenance": { "tool": "ekza-studio", "toolVersion": "0.7.0" }
}
```

Fills:
- `{ "mode": "default" }` — the game's default plays (never shipped).
- Animation: `{ "mode": "custom", "animation": <index into glTF animations>, "markers": {name: secs} }` — markers the
  slot declares (`contact` where required); seconds from the clip's first key.
- Asset: `{ "mode": "custom", "node": <index of the subtree's root node>, "anchors": {name: [x, y, z]} }` — the root
  must be a root of the default scene (or its direct child when the file has a single wrapper root, as OMOBA's set
  `wildspark-set` → `WildsparkSetRepeater`), anchors in the root's space, metres.
- Several slots may bind the same animation or node (shared defaults, alternation, one rocket model for two slots).

Rules (all `pack.*`, §7.2): the manifest parses strictly; the contract revision is active on Hub (or known to the game
build); the target exists and `requirementId` is one of its offers with this package kind; every slot belongs to the
offer (or matches a family prefix of it); the listing rule and `mustFill` hold; each binding points at an existing
animation or node; a bound animation's `name` equals one of the slot ids that reference it and a bound node's `name`
equals the slot's `rootName` when one is set; unreferenced animations and subtrees are warned and dropped by the
builder; byte and fill caps hold. No `uri` keys, lowercase hex, deterministic key order, no timestamps (ADR 0010 §2).

### 5.3 Monolithic packages

One file, one review, one release: the body, its clips and (where the game allows) its own sockets. Strengths: the
simplest path for a person ("rig it and submit"), one hash, one rights snapshot, no dependency resolution, fits Hub's
one-source-per-revision model and OMOBA's wire (one `avatar` reference). Weaknesses: anything inside cannot be reused
on another body, re-reviewed alone or equipped separately; a weapon inside a body couples the body to a hero, which
OMOBA's design forbids ("keep appearance separate from build").

### 5.4 Fragments

A fragment fills slots of one offer of one target and is its own Hub asset with its own revisions, review, rights
and release. It references:
- **its target** by `contract.revision` + `target.id` + `requirementId` (as a character package does);
- **another package** only through `requires[] {kind, sha256, reason}`: `sockets` (it uses sockets authored by a
  specific character package), `rig` (an animation pack made for one body's proportions), `derived-from` (it modifies
  another creator's work; rights §10.4). `sha256` is the required package's **source file** hash; Hub resolves it to a
  Hub revision and refuses unknown or unapproved ones.

Dependency rules: depth ≤ 1 (a fragment may require a character package; nothing may require a fragment that
requires something); no cycles; a required package must be approved for the same game; when a required revision is
revoked, Hub revokes dependants in the same transaction (tombstones). In OMOBA 1.0 no fragment requires anything:
gear fits any body because the game derives the palm socket.

### 5.5 Bundles: author as one, submit as fragments

Studio (and any Writer) may submit several packages as one **bundle**: a character package plus its gear set, made in
one project. Hub creates one asset (or revision) per package and one `bundles` row linking them; each package is
validated and built on its own; reviewers see the bundle on one page; the game owner approves (or promotes, revokes)
the **bundle atomically**, so a collab character never goes live without its gear. Members stay independently
equippable afterwards (a player may wear the body without the gear). `ekza-studio-submit/v1` grows a `packages[]`
array for this (§8.7). The answer to "embed or fragment?" for a person making a hero is therefore *both*: they make
one thing in one project; the protocol stores and releases the parts.

### 5.6 Verdict and recommendation

- **Protocol**: both monolithic and fragment packages are first-class; **one package per review unit and per reuse
  unit** decides which: body-bound content in the character package, separately equipped or reusable content in
  fragments; bundles keep the person's experience single.
- **OMOBA 1.0**: the **character package** stays exactly as ADR 0024 decided (one VRM 1.0 with the custom clips,
  animation slots only). **Gear is an `asset-pack` fragment**, one GLB per set — the proven Wildspark set (repeater +
  launcher subtrees in one file, one review, one claim, one `handheld` item on the wire). When OMOBA opens projectile
  and prop slots, the **same offer grows** (`wildspark.handheld.set` gains `wildspark.projectile.ultimate` and
  `wildspark.prop.trap` as optional slots; `mustFill` stays the two guns) so the set still travels as one item; this is
  a compatible revision. Motion-only `animation-pack`s and `accessory` families come after 1.0 for OMOBA (§11.2, §11.4;
  not yet a work package).

### 5.7 Which revision a package is judged against

A package names the contract revision it was made against. Hub accepts any **active** (non-retired) revision; the
builder and the game judge each slot against the contract **they** carry: a slot that still exists and passes the
current rules plays; others fall back. Approved releases are never silently migrated (Ekza ADR 0002).

### 5.8 Runtime composition

A game resolves each slot of a player's target from the player's **loadout** (the character package and the
fragments equipped for that target, all approved for the game's channel):

1. the fill of an equipped **fragment** that fills the slot and passed the game's own checks at load;
2. else the fill of the **character package**;
3. else the game's **default**.

Conflicts are resolved by the equip UI (one fragment per offer per loadout); if two equipped fragments fill one slot,
the one equipped last wins. A failing fill is skipped for that slot only (logged once with the rule id); a partial
fill never plays. **Sets**: if any `mustFill` slot of an equipped fragment fails or is still downloading, the game
shows the defaults for **all** of that offer's slots ("never mix pairs", the rule OMOBA already applies). Family
instances are shown up to `maxFills`.

The wire carries **content-addressed release references** (the SDK's slugs: hash of identity and rendition SHA-256),
never URLs; the game's server admits only references it can find approved for its channel (OMOBA's
`passport_admission`). How a game puts references on its wire is its own protocol: OMOBA carries `avatar` and
`handheld` today; more fragment kinds need a new field and a game protocol version (§11.3).

### 5.9 Containers

1.0 packages are glTF 2.0 binary files (`.glb`, `.vrm`, `.vrma`), self-contained (embedded buffers and images, no
`uri`), one per Hub revision. A later minor may add a **sidecar container** for engines that need other formats: a
deterministic zip with `ekza-package.json` (the same manifest, `node`/`animation` replaced by in-zip paths) and
content files, if and when Hub accepts multi-file sources. Studio's dev zip (CC §4.2) is a local-test artifact, not a
package.

---

## 6. Worked example: Wildspark — the gimmick, the throwable traps, the rocket

The owner's example — a hero who must have her gimmick, her grenades and a rocket — maps onto Wildspark as follows.
Wildspark's **gimmick** is *Switchfire* (Q): it toggles the weapon between a **repeater** and a **launcher**; the
launcher is also drawn for 1.1 s after *Shockline* (W) and *Last Spark* (R). Her thrown objects are the **Snapline
traps** (E): she tosses three traps that arm and snap shut — the role grenades play in the owner's example. Her
**rocket** is *Last Spark* (R); in rocket mode her basic attack also fires a smaller rocket.

### 6.1 The contract: Wildspark's checklist

The `wildspark` target's sections (Appendix D has the JSON; the full document is CHARACTER-CONTRACT-SPEC v0.2
Appendix B):

| Section | Slot | Kind | v1 | Default | What a creator must respect |
|---|---|---|---|---|---|
| Base | `base.idle`, `base.run`, `base.death` | animation | custom-able | library idle / sprint / death | loop, in place, windows 1–4 s / 0.4–1.2 s / 0.5–3 s |
| Basic attack | `basic.wildspark.0` | animation | custom-able | burst_fire, plays 0.273 s | `contact` ≤ 0.15 s; next basic after ≥ 0.4375 s |
| | `basic.wildspark.rockets.0` | animation | custom-able | shot_heavy, 0.696 s | shares its default with R |
| | `wildspark.projectile.basic-rocket` | asset · projectile | fixed (engine-owned) | `wild-rocket` | — |
| **Q Switchfire (gimmick)** | `skill.wild_switch.release` | animation | custom-able | reload_snap, 0.300 s | the switch itself is the two gear slots below |
| W Shockline | `skill.wild_zap.release` | animation | custom-able | pistol_shoot, 0.568 s | `contact` ≤ 0.15 s; launcher drawn |
| | `wildspark.effect.shockline` | asset · effect | fixed (procedural) | — | — |
| **E Snapline (throwables)** | `skill.wild_traps.release` | animation | custom-able | toss_underhand, 0.308 s | `contact` = the toss; ≤ 0.15 s |
| | `wildspark.prop.trap` | asset · deployable | planned | `trap` | nodes `WildsparkTrapBase`, `WildsparkJawLeft`, `WildsparkJawRight` (the game folds the jaws) |
| **R Last Spark (rocket)** | `skill.wild_rocket.release` | animation | custom-able | shot_heavy, 0.760 s | `contact` ≤ 0.15 s |
| | `wildspark.projectile.ultimate` | asset · projectile | planned | `rocket` | origin centre, +Z forward, `trail` anchor |
| **Gear** | `wildspark.handheld.repeater` | asset · handheld | custom-able | `wildspark-repeater` | root `WildsparkSetRepeater`, part `WildsparkRotor`, `muzzle` anchor, box ±10 % of baseline, ≤ 64 nodes, ≤ 16 meshes, textures ≤ 4096², PNG/JPEG |
| | `wildspark.handheld.launcher` | asset · handheld | custom-able | `wild-launcher` | root `WildsparkSetLauncher`, part `WildsparkSlide`, `muzzle` anchor |

Offers: `character.wildspark` (`character`, the nine custom-able animation slots, every one listed) and
`wildspark.handheld.set` (`asset-pack`, the two guns, `mustFill` both). The planned rocket and trap slots are in the
contract today with `customizable: false`, so Studio shows them (dimmed, "made by the game — opens later") and the
owner sees the whole kit in one place.

### 6.2 What a creator submits

A collab artist makes "Wildspark, artist edition" in Studio: a model, four custom clips (run, the repeater basic, the
rocket-mode basic reused for Last Spark, the trap toss) and a gun pair. Studio submits **one bundle of two packages**:

1. `wildspark-artist.vrm` — `kind: character`, the manifest of §5.2 with the nine slots (four custom);
2. `wildspark-artist-gear.glb` — `kind: asset-pack`:

```json
{
  "schema": "ekza.package.v1", "schemaVersion": "1.0", "kind": "asset-pack",
  "contract": { "schema": "ekza.game-contract.v1", "game": "omoba", "revision": "sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7" },
  "target": { "id": "wildspark", "requirementId": "wildspark.handheld.set" },
  "slots": {
    "wildspark.handheld.repeater": { "mode": "custom", "node": 1, "anchors": { "muzzle": [0, 0.12, 0.735] } },
    "wildspark.handheld.launcher": { "mode": "custom", "node": 3, "anchors": { "muzzle": [0, 0.13, 0.81] } }
  },
  "requires": [],
  "provenance": { "tool": "ekza-studio", "toolVersion": "0.7.0" }
}
```

(The GLB keeps OMOBA's `ekza_handheld_v1` grip, which the profile rule `omoba.asset.grip` checks.)

### 6.3 What happens

| Step | Character package | Gear set |
|---|---|---|
| Studio | per-slot lints (`clip.*`); the four custom rows `●`, five `○` | `asset.*` lints: root names, parts, bounds, budget, materials; `omoba.asset.grip` |
| Hub (structural) | `pack.*`, `rig.humanoid` | `pack.*`, `asset.container`, `asset.budget` |
| Builder (OMOBA's validator in the sandbox) | `omoba-humanoid-glb-v2`: keeps the four clips, per-slot report | the handheld validator step GP5 adds (the registry row says builder `none` today): per-slot report (repeater, launcher) |
| Rights | the artist's rights holder countersigns **both** revisions (one page, the bundle) | |
| Owner | approves the **bundle** into `test`, plays it in the dev lobby, promotes to `live` | |
| Game | the avatar plays the four custom clips, OMOBA's defaults for the other five; the player equips the gear like any handheld set; rocket mode shows the artist's launcher; the rocket and the traps stay OMOBA's | |

When OMOBA opens the rocket and the trap (§11.3), the artist submits a **new revision of the gear set** that also
fills `wildspark.projectile.ultimate` and `wildspark.prop.trap`; the character package is untouched.

### 6.4 Extending the kit

If OMOBA later lets Wildspark carry trinkets, it adds a family (`trinket`, `maxFills: 2`, socket `hip`) and lists it in
the gear offer's `families`; the artist adds `trinket.spark_plug` to the next gear revision. The game, not the
creator, bounds the extension.

---

## 7. Validation

### 7.1 Stages and verdicts

| Stage (`checkedBy`) | Runs | On | Verdict |
|---|---|---|---|
| `tool` | the creator's tool (Studio: on the document before export, then on the written bytes) | every package before submit | an error blocks export and submit, with the slot named and a fix offered; warnings show |
| `hub` | the registry (structural subset, Python) | on upload and on the builder's output | rejects the submission with the report |
| `builder` | the game's validator inside Hub's builder sandbox (no network, bounded CPU/memory/time) | after curator approval, before the game owner sees it | exit 2 + per-slot report rejects; nothing is silently downgraded |
| `game` | the game client and server at load | every installed package | per slot: a failing fill plays the default, logged once; never a partial fill, never a whole-package rejection for one slot's problem |

**Strict at the gates, lenient at runtime** (CC D7, generalized). Each stage writes an `ekza.validation-report.v1`
(Appendix C): package-level issues and, per slot, `mode`, `verdict` (`pass | fail | skipped | deferred`), issues and
measured values (duration, contact, hips drift, triangle count, bounds).

### 7.2 Core rule vocabulary (1.0)

Parameters are data in `contract.rules[].params` (a value or `"from": "<path>"` pointing at slot or packaging data);
the logic of each id is fixed by this table. Every core rule's `checkedBy` defaults to all stages that can evaluate it.

| Rule id | Scope | Checks | Params |
|---|---|---|---|
| `pack.manifest` | package | `asset.extras.ekza_package_v1` present, parses strictly (Appendix B), `schemaVersion` readable | `key`, `schema` |
| `pack.contract` | package | contract `schema`/`game` match; `revision` known and active (Hub), known to the build or logged (game) | — |
| `pack.target` | package | target exists; `requirementId` is one of its offers; `kind` equals the offer's package kind | — |
| `pack.slot-known` | package | every slot is in the offer (or an instance of an offer family), customizable when `custom`; listing rule; `mustFill`; family `maxFills` | — |
| `pack.ref` | package | bindings point at existing animations / root nodes; animation name = one referencing slot id; node name = `rootName` when set; no two animations share a name | `animationNameEqualsSlot`, `nodeNameEqualsRootName` |
| `pack.unreferenced` | package | animations or subtrees no fill references (warning; the builder drops them) | — |
| `pack.bytes` | package | file, JSON chunk, animation bytes and fill counts within `packaging` | `from: packaging`, `maxAnimationBytes` |
| `pack.requires` | package | `requires` resolvable, approved, depth ≤ 1, no cycles | — |
| `rig.humanoid` | rig | the rig class rules of §4.2 (bones, limits, uniform scale, one of VRM 0.x / 1.0) | `from: rigs` |
| `clip.channels` | animation | rotation channels only on `drivenBones`; translation only on hips; no scale, no morph weights, no other nodes | `rotation`, `translation`, `scale`, `weights` |
| `clip.sampler` | animation | interpolation allowed; times finite, increasing, first key at 0; unit quaternions | eps values |
| `clip.keys` | animation | keys per channel, sample rate | caps |
| `clip.duration` | animation | length within the slot's `window` | `from: slot.animation.window` |
| `clip.in-place` | animation | hips travel within limits in units of the rig's `lengthUnit` (`hold`: its own cap) | caps |
| `clip.loop-closure` | animation | loop slots close within an angle and an offset | eps values |
| `clip.markers` | animation | every `required` marker present; `0 ≤ t ≤ duration`; `t ≤ maxSecs` (+ tolerance); equal to the per-clip metadata when both exist | `from: slot.animation.markers`, `toleranceSecs` |
| `clip.min-interval` | animation | a clip longer than `minIntervalSecs` is cut (warning) | `from: slot.animation.minIntervalSecs` |
| `asset.container` | asset | glTF 2.0, embedded, buffers, scenes, no matrix-and-TRS, `extensionsRequired` ⊆ allowed | caps |
| `asset.nodes` | asset | `rootName`, required parts present and unique under the root | `from: slot.asset` |
| `asset.budget` | asset | triangles, nodes, meshes, materials, images, texture size and pixels | `from: slot.asset.budget` |
| `asset.bounds` | asset | the subtree's box inside `sizeM` | `from: slot.asset.sizeM` |
| `asset.anchors` | asset | required anchors present; anchors inside their box (else ignored, warning) | `from: slot.asset.anchors` |
| `asset.materials` | asset | material extensions, image formats, emissive strength | `from: slot.asset.materials` |
| `asset.motion` | asset | `static`: no animations or skins; `named-parts`: no animations; `node-animation`: node TRS only, bounded keys | `from: slot.asset.motion` |
| `socket.node` | socket | the fill's node exists, is parented under the socket's bone, offset and rotation within bounds | `from: slot.socket` |
| `rights.license` | rights | the declared licence (VRM meta, `asset.copyright`) is one the game accepts | `allowed[]` |
| `rights.derivation` | rights | a `derived-from` requirement's licence allows modification | — |

The OMOBA numbers of CC §5.1 become the params of these rules (§12.2). A rule's severity is the contract's choice.

### 7.3 Custom (profile) rules, safely

A game adds a rule only when no core rule with parameters can express it:
1. **Name** it `<namespace>.<scope>.<name>` (`omoba.asset.grip`: the `ekza_handheld_v1` grip bounds).
2. **List who checks it** in `checkedBy`. The game's builder (`builder`) and runtime (`game`) must implement every
   rule they are listed for; Hub refuses to publish a contract to `live` until the game's builder declares it (the
   builder's `--rules` output, §7.4).
3. **Tools**: a tool that implements the rule (Studio implements OMOBA's grip rule in its OMOBA profile module) runs it;
   a tool that does not shows the rule as **deferred** — "checked by OMOBA when you submit" — and does **not** block
   export. A namespaced rule whose `checkedBy` is only `tool` is invalid (it would never be enforced).
4. **Unknown core ids fail closed** everywhere (a contract with a core id a reader does not know needs a newer
   reader); **unknown namespaced ids defer** in tools and fail closed in the game's own builder.
5. **Isolation**: game rules run only inside the game's own builder image, in Hub's sandbox, with no network. Hub
   never runs a game's code in its own process; browsers never run it. A later minor may allow portable rule modules
   (WebAssembly components with a pure `check(manifest, bytes, params) → issues` interface, fuel-limited) so tools can
   run game rules too (`GP-Q8`).

### 7.4 Reference implementations and fixtures

- **TypeScript** `@ekza/gp` (MIT): the document parsers (§3.5), canonical JSON and revision, the `pack.*`, `rig.*`,
  `clip.*`, `asset.*` core rules on bytes. Studio's `packages/io/src/contract/` is its first home and is extracted into
  the protocol repository in GP0.
- **Rust** `ekza-gp` (MIT OR Apache-2.0, as `ekza-bevy-sdk`): the same set, bounded parsing (no allocation from
  untrusted counts beyond caps), a `--rules` listing and the builder contract (stdout JSON, exit 0/2/1). Exposed to
  other engines through a C ABI (§9). OMOBA's passport calls it for core rules and keeps OMOBA-only rules
  (`omoba.asset.grip`, the runtime humanoid retarget checks) in its MPL-2.0 code; the core is written fresh from this
  spec and the fixtures, so no code changes licence.
- **Python** in the registry implements only the structural `hub` subset (`pack.*`, `asset.container`,
  `asset.budget`) — no third implementation of motion rules (CC D7).
- **Core conformance fixtures** (Appendix E) live in the protocol repository: small synthetic packages (a 15-bone rig,
  a 3-node asset) with `expected/<case>.json` per slot. Both reference implementations and the registry's structural
  subset run them in their gates. **Profile fixtures** live in the game's repository (OMOBA: CC Appendix D, renamed
  §12.2) and are copied into tools with SHA-256 pinning.

### 7.5 Reports

`ekza.validation-report.v1` (Appendix C) is the only verdict format. Hub stores one per stage per package revision,
shows them in the review queues (custom vs default per slot, measured values, failing rules), attaches them to
`package.validated` events and returns the `hub` report synchronously to the submit page.

---

## 8. Messages and API

### 8.1 Parties and channels

| From → to | Channel | Purpose |
|---|---|---|
| Game CI → Hub | HTTPS + secret key | publish contracts, move channels |
| Hub → game | signed webhooks; pull feed | contract, release, rights events |
| Game client → Hub | public HTTPS (+ publishable key for `test`) | contracts, catalogue, files |
| Game server → Hub | HTTPS + secret key | admission reads, usage reports |
| Studio ↔ Hub | `postMessage` with the signed-in Hub page (now); OAuth PKCE `studio-upload` (later) | submit; status |
| Studio → Hub (public) | HTTPS GET, no credentials, on a user tap | contracts (CC-Q8) |
| Agent ↔ Hub | device-code token `studio-upload` (later) | submit drafts, read status (never decide) |
| Hub → people | Hub inbox, e-mail when enabled | creators, curators, rights holders, owners |

### 8.2 Transport rules

- JSON over HTTPS on the registry (`https://registry.ekza.io`, dev `https://registry.dev.ekza.io`); public reads
  outside `/v1/studio/` with CORS `*`, ETags and immutable caching for content-addressed resources.
- **Idempotency**: every `POST` that creates or changes state takes an `Idempotency-Key` header (a UUID; the IETF
  idempotency-key header draft). Hub stores `(key, route, actor, body SHA-256, response)` for 24 h; a replay returns
  the stored response; the same key with another body is `422 idempotency_mismatch`. The existing
  `map_placements.idempotency_key` column is the pattern.
- **Errors**: RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail` and an Ekza `code`
  (the registry's existing issue codes, or a rule id) and, for validation, the `ekza.validation-report.v1` under
  `report`.
- **Rate limits**: per key and per account; `429` with `Retry-After`; a catalogue that cannot be read completely
  answers `503` with `Retry-After` (never a partial list, as `/v2` does today).

### 8.3 The event envelope

Events are CloudEvents 1.0 in **structured JSON mode** with two extension attributes (Appendix C):

```json
{
  "specversion": "1.0",
  "id": "evt_01JB8Z6Q3K4M5N6P7R8S9T0V1W",
  "source": "https://registry.ekza.io/projects/omoba",
  "type": "io.ekza.gp.release.promoted",
  "subject": "packages/ekza:avatar:5f1c2a3e-0b7d-4c1e-9a2b-3c4d5e6f7a8b/revisions/2b8e0c4d-6a1f-4f3e-8d2c-1b0a9e8f7d6c",
  "time": "2026-11-02T10:15:00Z",
  "datacontenttype": "application/json",
  "dataschema": "https://ekza.io/schemas/gp/events/release.promoted.v1.json",
  "ekzaproject": "omoba",
  "ekzaseq": 418,
  "data": {
    "release": {
      "packageId": "ekza:avatar:5f1c2a3e-0b7d-4c1e-9a2b-3c4d5e6f7a8b", "revisionId": "2b8e0c4d-6a1f-4f3e-8d2c-1b0a9e8f7d6c",
      "kind": "character", "target": "wildspark", "channel": "live", "bundleId": "b-7d1e",
      "contractRevision": "sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7",
      "rendition": { "platform": "desktop", "profile": "humanoid-glb-v2", "sha256": "…", "bytes": 4182233 }
    }
  }
}
```

- `type` = `io.ekza.gp.<object>.<verb>` (reverse-DNS). A compatible payload change keeps the `type` and bumps the
  `dataschema` minor; an incompatible one publishes a new type with a major suffix (`io.ekza.gp.release.promoted.v2`)
  **beside** the old one for a deprecation window, as the CloudEvents Primer recommends; subscriptions choose.
- Over HTTP the event is sent in structured mode, `Content-Type: application/cloudevents+json`; batched mode is not
  used.
- `ekzaseq` is a per-project, monotonic sequence (the outbox row number; gaps are possible, order is not); `id` is unique; delivery is
  **at least once**; consumers deduplicate by `id` and process per `subject` in `ekzaseq` order.
- Events are written in the **same database transaction** as the state change (a `studio.event_outbox` table),
  then delivered; they are retained 30 days in the feed.
- Payloads carry ids, hashes and states — never file bytes, tokens, e-mail addresses or terms text.

### 8.4 Event catalogue

| Type | When | `subject` | `data` (main fields) | Delivered to |
|---|---|---|---|---|
| `io.ekza.gp.contract.published` | a revision is stored | `contracts/<rev>` | `revision, previousRevision, compatibility, schemaVersion, profiles, bytes` | game; tools (feed) |
| `io.ekza.gp.contract.channel-moved` | `test`/`live` pointer moves | `contracts/channels/<ch>` | `channel, revision, previous, breaking, note` | game; tools |
| `io.ekza.gp.contract.retired` | a revision is retired | `contracts/<rev>` | `revision, replacement` | game; creators with packages on it |
| `io.ekza.gp.package.submitted` | a creator submits (package or bundle member) | `packages/<id>/revisions/<rev>` | `kind, target, requirementId, contractRevision, sha256, bytes, bundleId, slots {custom, default}` | game owner queue; creator |
| `io.ekza.gp.package.validated` | a stage finishes | same | `stage, verdict, reportUrl, summary {pass, fail, deferred}` | creator; owner (builder stage) |
| `io.ekza.gp.package.withdrawn` | the creator withdraws | same | `reason` | owner |
| `io.ekza.gp.rendition.ready` / `.failed` | the builder finishes | `…/renditions/<profile>` | `platform, profile, profileVersion, sha256, bytes, reportUrl` / `code` | creator; owner |
| `io.ekza.gp.review.decided` | curator or owner decides | `packages/<id>/revisions/<rev>` | `gate (curator \| owner), decision (approve \| reject), reasonCode, note` | creator |
| `io.ekza.gp.rights.requested` | a collab revision needs a countersign | same | `role, termsSha256` | rights holder (inbox) |
| `io.ekza.gp.rights.countersigned` / `.withdrawn` | consent given / withdrawn | same | `role, termsSha256, at` | owner; creator; game (withdrawn) |
| `io.ekza.gp.release.approved` | approved into `test` | same | `release {…, channel: "test"}` | game; creator |
| `io.ekza.gp.release.promoted` | promoted to `live` | same | `release {…, channel: "live"}` | game; creator |
| `io.ekza.gp.release.revoked` | revoke, takedown, rights withdrawal, dependency revoke | same | `release, reason (owner \| takedown \| rights \| dependency \| unpublish)` | game; creator |
| `io.ekza.gp.usage.reported` | Hub accepted a game's usage batch | `releases/<sha>` | aggregates (§8.9) | creator (summary) |

### 8.5 Endpoints

Public (no credentials, CORS `*`):

| Method · path | Notes |
|---|---|
| `GET /v1/projects/{game}/contracts` | list: revision, compatibility, status, channels, created; ETag |
| `GET /v1/projects/{game}/contracts/{rev}` | the document; `immutable` |
| `GET /v1/projects/{game}/contracts/channel/{test\|live}` | the current revision of a channel; short cache |
| `GET /v1/projects/{game}/contracts/{rev}/files/{sha256}` | default previews the game published |
| `POST /v1/projects/{game}/contracts/{rev}/check` | structural dry run of a manifest (JSON body, ≤ 64 KiB, no file): returns the `hub` report subset; rate-limited; lets third-party tools test before upload |
| `GET /v2/assets?kind&project&platform&profile&channel=live` | today's catalogue plus `channel`, per item `fills {custom[], default[]}`, `target`, `requirementId`, `bundleId`; `channel=test` needs a key |

Game (project keys, §8.8):

| Method · path | Scope | Notes |
|---|---|---|
| `POST /v1/studio/projects/{game}/contracts` | `contract:publish` | upload a document; Hub recomputes `revision`, validates, classifies against `previousRevision`, enforces retired ids, derives requirements from offers (rows are deactivated, never deleted) |
| `POST /v1/studio/projects/{game}/contracts/{rev}/channel` | `contract:publish` or owner session | `{channel, breaking?, note?}` |
| `POST /v1/studio/projects/{game}/contracts/{rev}/retire` | owner session | packages on it are refused at submit; approved releases stay |
| `GET /v1/projects/{game}/events?after={cursor}&limit=100` | `events:read` | the pull feed: events after `ekzaseq` cursor, oldest first, `next` cursor |
| `GET/POST/DELETE /v1/studio/projects/{game}/webhooks` | owner session or `webhooks:manage` | `{url (https), types[], secret shown once}` |
| `POST /v1/projects/{game}/usage` | `usage:write` | batched aggregates (§8.9) |
| `GET /v1/projects/{game}/releases/snapshot?channel=` | `ekza_pk_` (`test`) or none (`live`) | the catalogue + contract revision + file hashes as one JSON for static builds (§8.10) |

Creator (now: the Hub submit page through the BFF; later `/v1/creator/*` with a PKCE `studio-upload` token):
`POST /v1/creator/packages` (create asset or revision, upload, submit with intent `{game, requirementId,
contractRevision, channel: "test", bundleId?}`), `GET /v1/creator/submissions/{id}` (status, reports),
`GET /v1/creator/events?after=` (the creator's own events). People decide on Hub only: curator, rights holder and
owner actions have no API-key route.

### 8.6 Webhooks

Standard Webhooks signing: headers `webhook-id` (= the event `id`, stable across retries, the receiver's idempotency
key), `webhook-timestamp` (Unix seconds) and `webhook-signature: v1,<base64 HMAC-SHA256(secret, id + "." + timestamp
+ "." + body)>`; secrets `whsec_…` (24–64 random bytes), rotatable with two signatures sent at once during rotation;
receivers reject timestamps more than 5 minutes off. The body is the CloudEvent (§8.3), not the Standard Webhooks
default payload. The asymmetric `v1a` (Ed25519) scheme is a later option for receivers that cannot keep a secret.
Delivery: `POST` the structured event, success = 2xx within 10 s; retries with exponential backoff (1 min … 24 h, 8 attempts); then the endpoint is disabled
and the owner notified; the pull feed always has the events. HTTPS only, no redirects, private addresses refused
(no requests into Hub's own network).

### 8.7 Studio ↔ Hub

`ekza-studio-submit/v1` (CC §7.7) stays the MVP path: no tokens in the editor, consent recorded on Hub. Minor
`ekza-studio-submit/v1.1` (GP6) replaces the single `files`/`manifest` with `packages: [{role, files, manifest}]` and
a `bundle {name}`, and its reply lists one `{assetId, revisionId, submissionId}` per package plus `bundleId`. The Hub
page re-hashes every file, runs the `hub` checks client-side for an early message and shows one slot table per
package. Status after submit: the `statusUrl`; with the later PKCE token, Studio reads `/v1/creator/events`.

### 8.8 Auth

| Credential | Format | Holder | Scopes | Notes |
|---|---|---|---|---|
| Publishable project key | `ekza_pk_<game>_<base32>` | game client builds | `catalog:read-test` | not secret (ships in Dev builds); revocable; only unlocks the `test` channel and the snapshot of it |
| Secret project key | `ekza_sk_<base32>` | game CI and servers | `contract:publish`, `events:read`, `usage:write`, `webhooks:manage`, `admission:read` | hashed at rest (SHA-256, as `studio_account_link` tokens), shown once, per-key scopes and expiry, audit rows |
| Hub session | cookie (BFF) | people | role-based (creator, curator, owner, rights holder) | the only way to decide |
| `studio-upload` token | OAuth 2.1 code + PKCE (later), device code for agents | Studio, agents | create/upload/submit/validate own packages; read own status | never review, decide or manage keys |

Project owners create and revoke keys on Hub; each request is logged with the key id. Keys never appear in events.

### 8.9 Usage acknowledgements

A G3 game reports, per day, per release reference and per client build: `installs`, `loads`, `fallbacks
{slot: {rule: count}}` and `equips` counts. **Aggregates only**: no player, account, device or IP data. Opt-in per game
(`GP-Q7`). Hub shows creators "works in OMOBA" and the slots that fell back; owners see revision drift (a rule newer
than the release).

### 8.10 Offline and static distribution

- **Contracts**: the game commits its snapshot (OMOBA: `shared/assets/catalog/game-contract.json`) and compiles it into
  its build; tools bundle snapshots with `ekza.contract-index.v1` (`{schema, game, contractSchema, profiles, channels,
  submit, revisions[{revision, file, bytes, sha256, previousRevision, targets, slots}]}`) — C1's index with `characters`
  renamed `targets` and `profiles` added.
- **Releases**: `ekza-gp snapshot pull --game omoba --channel live --out <dir>` (SDK CLI, §9.1) writes the catalogue
  JSON, the contract revision it was approved under, `files/<sha256>.<ext>` and `snapshot.json`
  (`ekza.release-snapshot.v1`: `{game, channel, catalogSha256, contractRevision, files {sha256: bytes}}`); a static
  build embeds the directory and pins `catalogSha256`. Integrity comes from the pins; a signed snapshot for mirrors is a
  later option (`GP-Q9`).
- **Packages** carry their manifest inside the hashed bytes, so a package validated offline is the package Hub sees.

### 8.11 The flow in six lines

```
1 Game CI   ──POST contracts (sk)──────────▶ Hub ── contract.published / channel-moved ──▶ game webhooks + feed
2 Studio    ──GET contract (public)  →  person fills slots  →  lints per slot (tool report)
3 Studio    ──postMessage bundle──▶ Hub page ── hub report → package.submitted ──▶ owner queue
4 Hub       ── builder (game validator, sandbox) → package.validated, rendition.ready ──▶ creator
5 People    ── curator → rights countersign → owner approve (test) → promote (live) ── release.* ──▶ game
6 Game      ── catalogue(channel) → install, verify SHA → resolve per slot → usage aggregates ──▶ Hub
```

---

## 9. SDKs

### 9.1 Rust (`ekza-bevy-sdk`, feature `gp`, on the `ekza-gp` crate)

```rust
// ekza_gp (engine-free, MIT OR Apache-2.0)
pub struct GameContract { /* serde, deny_unknown_fields per §3.3, ext as serde_json::Value per profile */ }
impl GameContract {
    pub fn parse(json: &[u8], opts: ReadOptions) -> Result<Self, ContractError>;   // §3.5, revision recomputed
    pub fn target(&self, id: &str) -> Option<&Target>;
    pub fn offer(&self, requirement_id: &str) -> Option<(&Target, &Offer)>;
}
pub struct PackageManifest { /* ekza.package.v1 */ }
impl PackageManifest { pub fn from_glb(bytes: &[u8]) -> Result<Self, PackageError>; }
pub trait Rule: Send + Sync { fn id(&self) -> &'static str; fn check(&self, cx: &RuleCx, params: &Params) -> Vec<Issue>; }
pub struct Validator { /* core rules + registered profile rules */ }
impl Validator {
    pub fn core() -> Self;
    pub fn with_rule(self, rule: Box<dyn Rule>) -> Self;                            // a game's namespaced rules
    pub fn validate(&self, c: &GameContract, glb: &[u8], stage: Stage) -> ValidationReport;
}
pub struct Loadout { pub character: Option<ReleaseRef>, pub fragments: Vec<ReleaseRef> }
pub fn resolve<'a>(c: &'a GameContract, l: &'a Loadout, slot: &str, ok: &dyn Fn(&ReleaseRef, &str) -> bool) -> Resolved<'a>;
pub struct UsageReporter { /* batches §8.9 aggregates, posts with ekza_sk_ */ }

// ekza_bevy_sdk::gp (feature "gp")
pub struct EkzaGpPlugin { pub game: String, pub channel: Channel, pub contract: &'static str /* include_str! */ }
// Resources: GpCatalog (channel-aware AssetStore over /v2/assets), GpContract; Events: PackageInstalled{reference,
// report}, SlotFallback{reference, slot, rule}; Systems: refresh on interval, install + validate, usage flush.
```

Also: one slug scheme for every kind (the 64-hex `protected_slug`; the 32-hex weapon slug stays readable for old
clients), `AssetKind` grows `Animation` and `Accessory`, `SupportSelector` gains `channel`, the OMOBA-specific
helpers move to OMOBA. A CLI `ekza-gp` (`contract check|diff|publish`, `package check`, `snapshot pull`) ships with the
crate. A C ABI (`ekza_gp_validate(contract, glb) -> report json`, `ekza_gp_resolve(…)`) serves other engines.

### 9.2 Other engines (sketches)

| Engine | Package | Reads contracts | Reads manifests | Validates | Catalogue, events |
|---|---|---|---|---|---|
| Unity | a UPM package `io.ekza.gp` (C#) | generated from Appendix A | via the glTF importer's JSON access (`asset.extras`) | the Rust core through the C ABI (native plugin) | `UnityWebRequest` over §8.5; pull feed in editor tooling |
| Godot | an addon `ekza_gp` (GDScript API + GDExtension over the Rust core) | GDScript classes | `GLTFDocument` / `GLTFState` JSON | GDExtension | `HTTPRequest` |
| Web (three.js, Babylon.js, others) | `@ekza/gp` (TypeScript, the reference) | TS types | the GLB JSON chunk | TS core | `fetch` |

Every SDK offers a **contract builder** for games that author contracts by hand or from engine data
(`ContractBuilder::new("mygame").target(…).slot(…).build()` → canonical JSON + revision) and a `contract check`
command for their CI.

### 9.3 Agents

The MCP tools of CC §8.13 are already game-agnostic (`target_describe`, `target_bind`, `target_slot_create`,
`target_slot_clear`, `target_fix`, `library_use {slot}`); GP6 adds `target_asset_import {slot, file, node}` and
`project_export {kind: 'package', packageKind, bundle?}`. Agents prepare packages and may submit drafts with a
`studio-upload` token; they never decide, countersign or move channels.

---

## 10. Rights and licensing

### 10.1 Declared and verified

- **Declared** (in the file): VRM meta (authors, licence, permissions such as redistribution and modification) for
  characters; `asset.copyright` and the manifest's `provenance` for other packages; the per-clip `derivedFrom`
  (ADR 0010). Tools fill these and lint them (`rights.license`).
- **Verified** (on Hub, per revision, immutable): `license_snapshot`, `attribution_snapshot`, `license_sha256` and
  `revision_rights(role ∈ creator | co_author | rights_holder, party, terms_text, terms_sha256, scope, consented_at,
  withdrawn_at, share_bps)` — CC §7.6 with one added column.

### 10.2 Per package and per fragment

Each package revision has its own rights rows: a gear set made by a different artist than the body has its own
creator. A fragment's licence must allow the game's use (the contract's `rights.license.allowed`).

### 10.3 Collabs and bundles

A collab names a rights holder per revision; the owner's decision on that revision is refused until every rights
holder consented and none withdrew (CC D11, SQL gate). For a **bundle**, the gate applies to every member: the bundle
is approvable only when all members are. A withdrawal revokes the member's releases and, if the member is a bundle's
character package, the whole bundle (tombstones; clients drop it at the next refresh).

### 10.4 Derivatives

A fragment that modifies another creator's work (a recolour of someone's gear, an animation pack cut from someone's
clips) declares `requires {reason: "derived-from"}`; `rights.derivation` refuses it when the base's declared licence
forbids modification; Hub additionally asks the base's creator to countersign when the base is not under an open
licence. Games never see derivation chains longer than one (§5.4).

### 10.5 Revenue hooks (later)

`share_bps` per rights row (0–10000, summing to ≤ 10000 per revision) is stored from the start and ignored until the
commerce ledger (Ekza ADR 0001) pays out; bundles split by member. Paid releases keep using passport tickets.

---

## 11. The OMOBA profile `omoba.character.v1`

### 11.1 What the profile adds

The OMOBA profile is CHARACTER-CONTRACT-SPEC v0.2. It defines:
- the `ext` shapes (Appendix A of CC v0.2): engine `timing`, motion library and presentation hashes, `customPlayback`
  on the document; `heroKind`, `role`, `basicAttack`, `kit`, default `handheld` on targets; `group`, `role`, `phase`,
  `edgeReleased`, `row` (the default's motion, duration, rate, start, effective contact, stand-in), `telegraph`,
  `handheld`, `skill`/`class`/`weaponMode` on animation slots; `catalogRole`, `status`, `item`, `model`, `uses`,
  `baseline`, `gripMetadata` on asset slots;
- the slot grammar: `base.<state>`, `basic.<class>.<n>`, `basic.<class>.<mode>.<n>`, `skill.<id>.release|recast|windup`
  for animations; `<class>.(handheld|projectile|prop|effect).<name>` for assets (the `omoba.asset-catalog.v1`
  requirement ids);
- one namespaced rule, `omoba.asset.grip`;
- its fixtures (`shared/assets/catalog/game-contract-fixtures/v1/`).

### 11.2 OMOBA in 1.0 (C0 + GP5)

| Content | 1.0 | Later |
|---|---|---|
| Character packages | 101 of the animation slots custom-able (CC D3) | wind-ups (v1.1), new engine states |
| Gear sets | `<class>.handheld.*` asset slots custom-able where the catalogue says `supported`; offers `wildspark.handheld.set` and one per single-gun class (GP5) | two-gun sets as separate items |
| Projectiles, props | listed, `customizable: false` (`planned` / `engine_owned`) | open per slot when the game loads approved projectile and prop models (GP7) |
| Effects | listed, `customizable: false` (procedural) | — |
| Families | none | `reaction.*` (the 4-slot wheel), accessories when the game has more sockets |

### 11.3 Opening the rocket and the trap

Today the game draws projectiles and traps from a closed, packaged vocabulary and has no per-player reference for
them on the wire. GP7 opens them without a new wire field by **riding on the gear set**: an equipped gear set item
that also fills `wildspark.projectile.ultimate` / `wildspark.prop.trap` supplies those models for that player's
rockets and traps (the set is already a per-player reference); a failing or missing fill uses the packaged model.
Other games may choose separate fragments instead; the protocol supports both.

### 11.4 Reactions and map props (mapping only)

OMOBA's reaction wheel maps to a family `reaction.*` (`maxFills: 4`, an `attachment` or a 2D asset in a later minor);
the sponsored map slot maps to a `prop` target with one asset slot and its `map-prop-glb-v1` budget. Neither changes
in this spec; both show the protocol covers them.

---

## 12. Migration

### 12.1 Existing pieces → protocol

| Today | In the protocol |
|---|---|
| `omoba.character-contract.v1` (C0 draft, unpublished) | `ekza.game-contract.v1` + `ext["omoba.character.v1"]` (§12.2) |
| `asset.extras.ekza_animation_set_v1` (ADR 0010 reserved, ADR 0024 used, unpublished) | `asset.extras.ekza_package_v1`, `kind: character` |
| `omoba.asset-catalog.v1` requirements | asset slots: `role` → `asset.role` (`held_weapon` → `handheld`, `projectile` → `projectile`, `world_prop` → `deployable`, `engine_effect` → `effect`), `status` → `customizable` (`supported` → true, `planned` / `engine_owned` → false), `brief` → `description`, `uses`/`baseline` → `ext`, `classIds` → `usedBy`; the `motion.<id>` rows (`animation_reference`) are replaced by animation slots' defaults. The catalogue stays as a **derived view** for the web portal until the portal reads the contract (GP5) |
| `studio.project_requirements` (seeded by SQL) | derived from `targets[].accepts[]` on publish; existing ids kept (`wildspark.handheld.set`; `character.<hero>`); `community.map.sculpture` stays a G0 seed until map props are described |
| `rendition_profiles` | referenced from `packaging.<kind>.rendition`; the profile document keeps container and byte checks; slot rules move to the contract; the builder CHECK constraint becomes a `rendition_builders` table (GP2) so a new game's builder needs no migration |
| `asset.extras.ekza_handheld_v1` grip | unchanged; checked by `omoba.asset.grip` |
| `asset.extras.omoba_wildspark_set_v1` muzzle hint | superseded by fill `anchors.muzzle`; still read when a set has no manifest (`binding: manifest-or-names`) |
| node names `WildsparkSetRepeater` / `WildsparkSetLauncher` | `asset.rootName` + `pack.ref nodeNameEqualsRootName`; existing sets without a manifest stay valid |
| `humanoid-glb-v1` (five named clips) | unchanged for v1 renditions; not a protocol concept |
| ADR 0010 `ekza_animation_v1` (per clip) | unchanged; the package manifest refers to animation indices |
| ADR 0010 T1 `ekza:animation` / `universal/vrma-humanoid-v1` | the `animation-pack` package kind |
| `studio.map_slots`, placements | a `prop` target later; time-limited placements stay a Hub feature |
| the Wildspark creator loop (weapon → requirement → approvals → claim) | the `asset-pack` path: same transport, plus a manifest, per-slot reports and events |
| `ekza-studio-submit/v1` | kept; v1.1 adds bundles |
| `/v2/assets` items | + `channel`, `fills`, `target`, `requirementId`, `bundleId` |
| SDK selectors, stores, slugs | reused; `gp` adds contracts, manifests, validator, resolver, usage; one slug scheme |
| `submission_events`, `placement_events` | kept as history; the outbox emits events from the same transitions |

### 12.2 The OMOBA contract reshaped (old field → new place)

| `omoba.character-contract.v1` | `ekza.game-contract.v1` |
|---|---|
| `schema`, `schemaVersion: 1`, `projectId` | `schema: "ekza.game-contract.v1"`, `schemaVersion: "1.0"`, `minReaderVersion: "1.0"`, `game: {id: "omoba", name: "OMOBA"}`, `profiles: {used: ["omoba.character.v1"], required: []}` |
| `source.{commit, exporter, inputsSha256}` | `source` (exporter `scripts/export_game_contract.py`) |
| `source.{gameplayRevision, presentationSha256, motionLibrary, protocolVersion}`, `timing`, `package.customPlayback` | `ext["omoba.character.v1"]` on the document |
| `package.{extrasKey, sourceFormats, rendition, slotNaming}` | `packaging.character` (`manifestKey: ekza_package_v1`, `containers`, `rendition`, `binding: manifest`); `sourceFormats` also in `rigs.humanoid` |
| `rig.*` (`legLengthFrom`, `referenceLegLengthM`) | `rigs.humanoid.*` (`lengthUnit {name, from, referenceM}`) |
| `heroes[]` (`id, kind class\|any, name, role, requirementId, basicAttack, kit, handheld, slots`) | `targets[]` (`kind character\|any`, `subtitle` = role, `sections` base / basic / q / w / e / r [/ gear], `slots`, `accepts[0] = {package: character, requirementId, listing: every-customizable-slot}`, `ext` = heroKind, role, basicAttack (without slots), kit (without slots), handheld) |
| slot `kind loop\|action\|hold` | `animation.playback` (slot `kind` is now `animation`) |
| slot `window`, `inPlace`, `loop`, `minIntervalSecs` | `animation.*` |
| slot `contact {required, maxSecs, targetSecs}` | `animation.markers.contact` |
| slot `telegraph.secs` (release of a held phase) | `animation.leadInSecs` (the full `telegraph` stays in `ext`) |
| slot `default {motion, durationSecs, looping, contactSecs, rate, start, playSecs, effectiveContactSecs, standInFor}` | `default {name: motion, playSecs, loop: looping, markers: {contact: max(0, effectiveContactSecs)}, preview: null}` + `ext.row {motion, durationSecs, contactSecs, rate, start, effectiveContactSecs, standInFor}` |
| slot `group, role, phase, edgeReleased, telegraph, handheld, skill, class, weaponMode` | slot `ext["omoba.character.v1"]` |
| slot `customizable, customizableFrom, reserved, required, label, sharesDefaultWith, alternatesWith, usedBy` | unchanged; `description: null` added |
| rules `pack.extras`, `pack.animation-ref`, `clip.contact`, `clip.basic-interval` | `pack.manifest`, `pack.ref`, `clip.markers`, `clip.min-interval` |
| rules `pack.contract`, `pack.slot-known`, `pack.unreferenced`, `pack.bytes`, `clip.channels`, `clip.sampler`, `clip.keys`, `clip.duration`, `clip.in-place`, `clip.loop-closure` | unchanged ids; `scope` `pack → package`, `clip → animation`; `checkedBy` added |
| — | new: `pack.target`, `rig.humanoid` (made explicit), `asset.*` and `omoba.asset.grip` (GP5) |
| `asset.extras.ekza_animation_set_v1 {schema: 1, contract {schema, projectId, revision}, target {hero, requirementId}, slots {mode, animation, contactSecs}, provenance}` | `asset.extras.ekza_package_v1 {schema: "ekza.package.v1", schemaVersion, kind: "character", contract {schema, game, revision}, target {id, requirementId}, slots {mode, animation, markers {contact}}, requires: [], provenance}` |

A prototype converter (spec illustration) reshaped the prototype export of OMOBA `dev` into this form; the result
validates against Appendix A and the profile schema (113 slots with Wildspark's six asset slots, 18 targets,
≈ 150 kB canonical).

### 12.3 Precise guidance for the work in flight

**C0** (`omoba-bevy`, branch `feat/character-contract-export`) — before its freeze:

| Item | Name |
|---|---|
| Committed document | `shared/assets/catalog/game-contract.json` (was `character-contract.json`) |
| Document schema | `ekza.game-contract.v1`, `schemaVersion "1.0"`, `minReaderVersion "1.0"`, profile `omoba.character.v1` used, not required |
| Schemas next to it | `ekza.game-contract.v1.schema.json` (a pinned copy of Appendix A) and `omoba.character.v1.schema.json` (CC v0.2 Appendix A) |
| Rule parameters source | `shared/assets/catalog/game-contract-rules.json`, `schema: "omoba.game-contract-rules.v1"` (was `omoba.character-contract-rules.v1`) |
| Fixtures | `shared/assets/catalog/game-contract-fixtures/v1/` (case names of CC Appendix D, rule ids renamed) |
| Generator | `client/src/game_contract.rs`, test `game_contract_is_current`, env `OMOBA_WRITE_GAME_CONTRACT=1` |
| Wrapper | `scripts/export_game_contract.py --output DIR [--check]` |
| Shape | §12.2; animation slots only; asset slots come in GP5 (adding slots is a compatible revision) |
| Docs | `docs/game-contract.md` (was `docs/character-contract.md`) |

**C1** (`ekza-studio`, branch `feat/character-contract-studio`) — before C0 freezes:

| Item | Change |
|---|---|
| `packages/io/src/contract/model.ts` | keep as the protocol model; `ContractCharacter` → `ContractTarget` (`kind: 'character' \| 'any' \| 'item' \| 'vehicle' \| 'prop'`, add `accepts: ContractOffer[]`, `families`); `ContractSlotKind` = `'animation' \| 'asset' \| 'socket'`; `AnimationSlotSpec.contact` → `markers: Record<string, MarkerSpec>`; `telegraphSecs` → `leadInSecs`; `ContractSlotDefault {name, playSecs, loop, markers}`; add `AssetSlotSpec`; `ContractModel.schema` → `profiles: {used, required}`, keep `game`, `gameName` |
| reader | one strict parser `gameContract.ts` for `ekza.game-contract.v1` (§3.3, §3.5) + profile modules keyed by profile id: `profiles/omobaCharacterV1.ts` replaces `characterContractV1*.ts`; `CONTRACT_PROFILES` becomes `{profile, readExt(position, json)}` |
| fixtures | `fixtures/contracts/ekza.game-contract.v1.schema.json`, `omoba.character.v1.schema.json`, `omoba.game-contract.json`; drop the old schema file |
| index | `ekza.contract-index.v1`: `contractSchema: "ekza.game-contract.v1"`, add `profiles`, `characters` → `targets` |
| target record (§8.2 of CC) | `contract: {schema: 'ekza.game-contract.v1', game, revision}`, `hero` → `target` |
| rules | rule ids per §12.2; unknown namespaced ids → status `deferred` |

**C2–C7**: C2 writes `ekza_package_v1` (not `ekza_animation_set_v1`) and runs `clip.markers`; C3's passport reads
`ekza_package_v1` and implements the renamed ids (through `ekza-gp` once GP0 exists, until then natively); C4 stores
`ekza.game-contract.v1` with `profiles`, derives requirements from `accepts`, names the registry check
`check_package` (was `check_animation_set`) and adds the profile row's `source.manifest: "ekza_package_v1"` (was
`animationSet`); C5's submit message is v1 (one package) and becomes v1.1 in GP6; C6's agent tools keep their names;
C7 adds one negative case per renamed rule.

**ADR 0010** is amended when C2 lands: §1 row T2's key becomes `ekza_package_v1`; T1 becomes the `animation-pack`
kind; §5's open vocabulary follows the bound contract (already ADR 0024).

---

## 13. Delivery plan

Sizes in agent-days (S ≤ 3, M 4–6, L 7–10). Each package is a branch and a PR into its repository's `dev`; the CC
work packages C0–C7 (CC §10) keep their scope and gain the deltas named here.

| WP | Repo | Scope | Size | Depends | Owner OK needed |
|---|---|---|---|---|---|
| **GP1** C0/C1 reshape | omoba-bevy, ekza-studio | §12.3: emit and read `ekza.game-contract.v1` + profile ext, renamed files and rule ids, schemas, fixtures | S (2) | — (inside C0 and C1, before the freeze) | — |
| **GP0** protocol home | new repository `ekza-game-protocol` | this spec's normative parts, the five schemas, canonical JSON, the core rule vocabulary, core fixtures (Appendix E), `@ekza/gp` (TS, MIT, extracted from Studio) and `ekza-gp` (Rust, MIT OR Apache-2.0) with the CLI and C ABI, a local gate | L (8) | GP1 | new public repository, licences (`GP-Q1`, `GP-Q2`) |
| **GP2** generic registry | ekza-registry | in C4: contracts with `profiles`, retired-id enforcement, compatibility check, requirements from `accepts`, `check_package` (structural core), `rendition_builders` table instead of the CHECK constraint, `bundles` table, `/check` dry run | M (4) | C4 | prod migrations |
| **GP3** events and keys | ekza-registry | outbox, CloudEvents, pull feed, webhooks (Standard Webhooks, retries, egress guard), project keys and scopes, usage endpoint, Hub inbox entries | M (6) | GP2 | prod migrations, outbound HTTP from the registry |
| **GP4** SDK `gp` | ekza-bevy-sdk | depend on `ekza-gp`; channel-aware catalogue, bundles, resolver, `EkzaGpPlugin`, usage reporter, `snapshot pull`; one slug scheme; OMOBA helpers moved out | M (6) | GP0 | SDK release |
| **GP5** OMOBA gear | omoba-bevy (+ registry profile row) | asset slots from the asset-catalog requirements, gear offers, `omoba.asset.grip`, `asset.*` via `ekza-gp` in `passport/weapons.rs`, a handheld validator step in the builder (`omoba-handheld-v1`, as OMOBA's profile document names it; the registry row says `none`) writing the per-slot report, manifest-or-names binding for existing sets; the catalogue exported from the contract | M (5) | GP1, GP0 | OMOBA release |
| **GP6** Studio gear + bundles | ekza-studio | Gear rows in the checklist, GLB import mapped to asset slots (root, parts, anchors gizmo), `asset.*` lints, `asset-pack` writer, bundle submit (`ekza-studio-submit/v1.1`), agent tools | L (8) | C2, C5, GP5 | Studio release |
| **GP7** OMOBA rocket and trap | omoba-bevy | load approved projectile/prop models from the equipped gear set, fallbacks, budgets measured on mobile; open the two slots in a compatible revision | L (8) | GP5 | OMOBA release |
| **GP8** second game pilot | ekza-space (`core`) | a minimal contract (`ekza-space`: target `any`, `base.idle`, `base.walk`; profile none) published and consumed through GP2/GP4 with no registry code change — proves generality | M (4) | GP2, GP4 | — |
| **GP9** other engines | new packages | Unity package, Godot addon over the C ABI; docs | L (8) | GP0, GP4 | when a partner asks |

**Total ≈ 51 agent-days** without GP9 (59 with it). **Order of value**: GP1 now (cheapest moment, before the C0 freeze);
GP0 next so C3 and GP5 call one core; GP2 inside C4; then GP5 → GP6 (the owner's Wildspark gear end to end); GP3 when
a second game or a non-OMOBA tool needs events (OMOBA can poll until then); GP7 opens the rocket and the trap; GP8
proves the protocol on a second game. **Critical path to the owner's example (character + gear through Hub; rocket and
trap after GP7)**: C0+GP1 → C3 → C4+GP2 → C5 → GP6 ≈ 44 agent-days; GP0 → GP5 and C1 → C2 run beside it.

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Renaming in flight (C0, C1) costs a day and confuses agents. | One rename table (§12.3), done before the freeze; nothing has shipped with the old names. |
| R2 | A generic core too thin for real games: profiles grow into a second protocol. | Profiles may only add `ext` and namespaced rules; anything Studio must check is a core rule; enumerations grow only with protocol minors; GP8 tests a second game early. |
| R3 | A generic core too thick: OMOBA pays for features it never uses. | Every core field is used by OMOBA today or by the owner's example; reserved kinds stay out of 1.0 schemas. |
| R4 | Strict parsing blocks forward evolution. | `minReaderVersion` (§3.3): strict for understood minors, tolerant only when the writer says it is safe. |
| R5 | Untrusted assets as an attack surface (huge counts, NaN, scale-0 invisibility, external URIs). | `asset.container`, `asset.budget`, `clip.*`; bounded parsing in Rust; sandboxed builders; no `uri`. |
| R6 | Game rules run arbitrary code. | Only in the game's own builder image, sandboxed, no network; never in Hub's process or browsers (§7.3). |
| R7 | Webhooks as an SSRF or exfiltration path. | HTTPS only, no redirects, private ranges refused, payloads without secrets, per-endpoint secrets. |
| R8 | Fragments multiply review load. | Bundles reviewed on one page and approved atomically; per-slot reports first. |
| R9 | Mixed sets in a match (one gun custom, one default). | `mustFill` + "all or none" at runtime (§5.8). |
| R10 | Rights across bundles and derivatives. | Per-revision rights per package; bundle gate on all members; derivation depth 1. |
| R11 | Events leak private data. | Ids and hashes only; usage aggregates only; opt-in. |
| R12 | Two slug schemes and kind enums drift between SDK and registry. | GP4 unifies slugs; GP2 makes builders a table; kinds come from the protocol. |
| R13 | The owner's example needs engine work the protocol cannot do (rocket, trap). | Listed now as fixed slots so the kit is visible; GP7 opens them as a compatible revision. |

---

## 15. Open owner questions

`GP-Q1` protocol name and home (a new public repository) · `GP-Q2` licences: schemas, fixtures and spec text CC0,
reference code MIT OR Apache-2.0 · `GP-Q3` asset slots in OMOBA's first contract or in GP5 · `GP-Q4` bundles approved
atomically · `GP-Q5` gear equip semantics (slot-keyed, any body; sets all-or-none) · `GP-Q6` outbound webhooks from the
registry (and when) · `GP-Q7` usage aggregates, opt-in · `GP-Q8` portable rule modules (WebAssembly) later · `GP-Q9`
signed release snapshots for mirrors · `GP-Q10` who may create a Hub project for a third-party game · `GP-Q11` the
glTF vendor extension prefix (register `EKZA_` and move the manifest into an extension) or stay in `asset.extras` ·
`GP-Q12` revenue shares stored now, inactive. Each has a default in
[DECISIONS-OPEN §R](DECISIONS-OPEN.md#r-game-protocol-defaults-chosen-2026-10-24).

---

## 16. Sources

Internal (read-only, 2026-10-24): `omoba-bevy@dev` `6d34f98` — `docs/{handheld-weapons,wildspark-skin-sets,asset-catalog,combat-cosmetics,sticker-assets,community-workshop,class-workshop-game,humanoid-motion}.md`,
`docs/plans/{studio-skill-asset-catalog,creator-loop-and-class-builder}.md`, `docs/profiles/handheld-glb-v1.json`,
`scripts/export_asset_catalog.py`, `shared/assets/catalog/asset-requirements.json`, `shared/src/{handheld,loadout}.rs`,
`shared/src/protocol/wire.rs`, `client/src/{held_weapons,humanoid}.rs`, `client/src/humanoid/sockets.rs`,
`client/src/skill_presentation/{vocab,effects}.rs`, `passport/src/{lib,humanoid,weapons,weapon_store,sponsorship}.rs`,
`server/src/passport_admission.rs`; `ekza-registry@dev` `82715fa` — `backend/STUDIO.md`, migrations
`202609190001_game_integration`, `202610010001_typed_assets`, `202609210001_project_releases`,
`202610110002_project_requirements`, `202610110001_library_claims`, `202610150001_map_placements`,
`202609110002_creator_commerce`, `backend/app/services/{profile_checks,handheld,integration}.py`; `ekza-bevy-sdk`
`a9a253c` — `src/{passport,registry,assets,store,cache,account}.rs`, README; the Ekza top-level `ARCHITECTURE.md`,
`PLAN-WEB2-FIRST.md`, `adr/0001`, `adr/0002`; this repository's ADRs 0010, 0024, CHARACTER-CONTRACT-SPEC v0.1,
MCP-SPEC; the C0 and C1 branches named above.

External (open specifications; proprietary platforms are described neutrally per TM-1, their references are kept in
the research notes outside the repository):

- glTF 2.0 specification, extensions and `extras`: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#specifying-extensions ;
  extension prefixes: https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md ; extension process:
  https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md ; `KHR_animation_pointer`:
  https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md ;
  `KHR_xmp_json_ld` (licence metadata as JSON-LD packets):
  https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_xmp_json_ld/README.md
- Khronos avatar extensions, phase 1 draft (`KHR_character_*`, open as of 2026-10-23):
  https://github.com/KhronosGroup/glTF/pull/2512
- VRM 1.0 humanoid: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md ;
  meta and licence fields: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md ;
  VRM animation (VRMA): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md
- OMI glTF extensions and stages (`OMI_seat`, `OMI_spawn_point`, physics, audio): https://github.com/omigroup/gltf-extensions
- Metaverse Standards Forum, Interoperable Characters/Avatars:
  https://metaverse-standards.org/domain-groups/interoperable-characters-avatars ; 3D Asset Interoperability:
  https://metaverse-standards.org/domain-groups/introduction-to-3d-asset-interoperability-working-group
- OpenUSD composition (LIVERPS strength order, `over`, asset resolution):
  https://openusd.org/release/glossary.html#liverps-strength-ordering ;
  https://openusd.org/release/glossary.html#usdglossary-over ; https://openusd.org/release/glossary.html#usdglossary-assetresolution
- CloudEvents 1.0.2: https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md ; HTTP binding:
  https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/bindings/http-protocol-binding.md ; versioning (Primer):
  https://github.com/cloudevents/spec/blob/main/cloudevents/primer.md#versioning-of-cloudevents ; webhook handshake:
  https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/http-webhook.md
- Standard Webhooks: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
- JSON Schema `unevaluatedProperties`: https://json-schema.org/understanding-json-schema/reference/object#unevaluatedproperties ;
  structuring and `$id`: https://json-schema.org/understanding-json-schema/structuring ; SchemaVer:
  https://snowplow.io/blog/introducing-schemaver-for-semantic-versioning-of-schemas
- OCI descriptor and manifest (digests, `artifactType`, `subject`): https://github.com/opencontainers/image-spec/blob/main/descriptor.md ,
  https://github.com/opencontainers/image-spec/blob/main/manifest.md ; referrers API:
  https://github.com/opencontainers/distribution-spec/blob/main/spec.md#listing-referrers
- RFC 8785, JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785 ; RFC 9457, Problem Details for HTTP
  APIs: https://www.rfc-editor.org/rfc/rfc9457 ; the `Idempotency-Key` HTTP header field (IETF draft):
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ ; OAuth 2.1 (PKCE):
  https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/

---

## Appendix A — JSON Schema `ekza.game-contract.v1`

Draft 2020-12. Canonical URL `https://ekza.io/schemas/gp/ekza.game-contract.v1.json`; home: the protocol repository (GP0); games keep a pinned copy next to their contract. The schema checks shape; cross-references and the revision are checked in code (§3.5). Profile `ext` objects are checked against the profile's own schema (OMOBA: CHARACTER-CONTRACT-SPEC v0.2 Appendix A).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ekza.io/schemas/gp/ekza.game-contract.v1.json",
  "title": "ekza.game-contract.v1",
  "description": "Ekza Game Protocol 1.0: what one game accepts from creators. Core keys are strict; profile data lives only under `ext`.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "schemaVersion", "minReaderVersion", "game", "revision", "previousRevision", "license",
               "source", "profiles", "rigs", "sockets", "packaging", "rules", "slots", "families", "targets",
               "retired", "ext"],
  "properties": {
    "schema": { "const": "ekza.game-contract.v1" },
    "schemaVersion": { "$ref": "#/$defs/version" },
    "minReaderVersion": { "$ref": "#/$defs/version" },
    "game": {
      "type": "object", "additionalProperties": false, "required": ["id", "name"],
      "properties": {
        "id": { "$ref": "#/$defs/gameId" },
        "name": { "type": "string", "minLength": 1, "maxLength": 64 }
      }
    },
    "revision": { "$ref": "#/$defs/revision" },
    "previousRevision": { "oneOf": [{ "$ref": "#/$defs/revision" }, { "type": "null" }] },
    "license": { "type": "string", "minLength": 1, "maxLength": 64 },
    "source": {
      "type": "object", "additionalProperties": false, "required": ["commit", "exporter", "inputsSha256"],
      "properties": {
        "commit": { "oneOf": [{ "type": "string", "pattern": "^[0-9a-f]{7,64}$" }, { "type": "null" }] },
        "exporter": { "type": "string", "minLength": 1, "maxLength": 200 },
        "inputsSha256": { "$ref": "#/$defs/sha256" }
      }
    },
    "profiles": {
      "type": "object", "additionalProperties": false, "required": ["used", "required"],
      "properties": {
        "used": { "type": "array", "uniqueItems": true, "maxItems": 16, "items": { "$ref": "#/$defs/profileId" } },
        "required": { "type": "array", "uniqueItems": true, "maxItems": 16, "items": { "$ref": "#/$defs/profileId" } }
      }
    },
    "rigs": {
      "type": "object", "maxProperties": 8,
      "propertyNames": { "$ref": "#/$defs/shortId" },
      "additionalProperties": { "$ref": "#/$defs/rig" }
    },
    "sockets": {
      "type": "object", "maxProperties": 64,
      "propertyNames": { "$ref": "#/$defs/socketId" },
      "additionalProperties": { "$ref": "#/$defs/socket" }
    },
    "packaging": {
      "type": "object", "minProperties": 1,
      "propertyNames": { "$ref": "#/$defs/packageKind" },
      "additionalProperties": { "$ref": "#/$defs/packaging" }
    },
    "rules": { "type": "array", "minItems": 1, "maxItems": 256, "items": { "$ref": "#/$defs/rule" } },
    "slots": {
      "type": "object", "minProperties": 1, "maxProperties": 4096,
      "propertyNames": { "$ref": "#/$defs/slotId" },
      "additionalProperties": { "$ref": "#/$defs/slot" }
    },
    "families": {
      "type": "object", "maxProperties": 64,
      "propertyNames": { "$ref": "#/$defs/shortId" },
      "additionalProperties": { "$ref": "#/$defs/family" }
    },
    "targets": { "type": "array", "minItems": 1, "maxItems": 1024, "items": { "$ref": "#/$defs/target" } },
    "retired": {
      "type": "object", "additionalProperties": false, "required": ["slots", "targets", "families"],
      "properties": {
        "slots": { "type": "object", "propertyNames": { "$ref": "#/$defs/slotId" }, "additionalProperties": { "$ref": "#/$defs/revision" } },
        "targets": { "type": "object", "propertyNames": { "$ref": "#/$defs/targetId" }, "additionalProperties": { "$ref": "#/$defs/revision" } },
        "families": { "type": "object", "propertyNames": { "$ref": "#/$defs/shortId" }, "additionalProperties": { "$ref": "#/$defs/revision" } }
      }
    },
    "ext": { "$ref": "#/$defs/ext" }
  },
  "$defs": {
    "version": { "type": "string", "pattern": "^1\\.(0|[1-9][0-9]{0,3})$" },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "revision": { "type": "string", "pattern": "^sha256-[0-9a-f]{64}$" },
    "gameId": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
    "targetId": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{0,47}$" },
    "shortId": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{0,31}$" },
    "slotId": { "type": "string", "maxLength": 96, "pattern": "^[a-z][a-z0-9_-]{0,47}(\\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$" },
    "socketId": { "type": "string", "maxLength": 64, "pattern": "^[a-z][a-z0-9_-]{0,31}(\\.[a-z0-9][a-z0-9_-]{0,31}){0,3}$" },
    "profileId": { "type": "string", "maxLength": 64, "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*\\.v[0-9]+$" },
    "ruleId": {
      "type": "string", "maxLength": 80,
      "pattern": "^([a-z][a-z0-9-]{1,31}\\.)?(pack|clip|rig|asset|socket|rights)\\.[a-z][a-z0-9-]{1,40}$"
    },
    "requirementId": { "type": "string", "maxLength": 128, "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$" },
    "name": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_.-]{0,63}$" },
    "markerName": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$" },
    "secs": { "type": "number", "minimum": 0, "maximum": 600 },
    "nullableSecs": { "oneOf": [{ "$ref": "#/$defs/secs" }, { "type": "null" }] },
    "vec3": { "type": "array", "minItems": 3, "maxItems": 3, "items": { "type": "number", "minimum": -100, "maximum": 100 } },
    "packageKind": { "enum": ["character", "animation-pack", "asset-pack", "accessory"] },
    "slotKind": { "enum": ["animation", "asset", "socket"] },
    "label": { "type": "string", "minLength": 1, "maxLength": 80 },
    "description": { "oneOf": [{ "type": "string", "maxLength": 2000 }, { "type": "null" }] },
    "ext": {
      "type": "object", "maxProperties": 16,
      "propertyNames": { "$ref": "#/$defs/profileId" },
      "additionalProperties": { "type": "object" }
    },
    "rig": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "sourceFormats", "restPose", "facing", "requiredBones", "requiredBonesVrm0", "drivenBones",
                   "maxHumanoidBones", "maxNodes", "uniformScale", "fingers", "thumbsRecommended", "lengthUnit", "ext"],
      "properties": {
        "kind": { "const": "vrm-humanoid" },
        "sourceFormats": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "enum": ["vrm1", "vrm0"] } },
        "restPose": { "enum": ["t-pose", "a-pose", "any"] },
        "facing": { "const": "as-vrm-spec" },
        "requiredBones": { "$ref": "#/$defs/boneList" },
        "requiredBonesVrm0": { "$ref": "#/$defs/boneList" },
        "drivenBones": { "$ref": "#/$defs/boneList" },
        "maxHumanoidBones": { "type": "integer", "minimum": 15, "maximum": 64 },
        "maxNodes": { "type": "integer", "minimum": 1, "maximum": 65536 },
        "uniformScale": { "enum": ["humanoid-bones-and-ancestors", "none"] },
        "fingers": { "enum": ["optional", "required"] },
        "thumbsRecommended": { "type": "boolean" },
        "lengthUnit": {
          "type": "object", "additionalProperties": false, "required": ["name", "from", "referenceM"],
          "properties": {
            "name": { "const": "legLength" },
            "from": { "const": "hips-to-feet" },
            "referenceM": { "type": "number", "exclusiveMinimum": 0, "maximum": 10 }
          }
        },
        "ext": { "$ref": "#/$defs/ext" }
      }
    },
    "boneList": { "type": "array", "uniqueItems": true, "maxItems": 64, "items": { "type": "string", "pattern": "^[a-z][A-Za-z]{1,31}$" } },
    "socket": {
      "type": "object", "additionalProperties": false, "required": ["label", "rig", "bone", "frame", "fillable", "ext"],
      "properties": {
        "label": { "$ref": "#/$defs/label" },
        "rig": { "$ref": "#/$defs/shortId" },
        "bone": { "type": "string", "pattern": "^[a-z][A-Za-z]{1,31}$" },
        "frame": { "enum": ["bone", "palm", "authored"] },
        "fillable": { "type": "boolean" },
        "ext": { "$ref": "#/$defs/ext" }
      }
    },
    "packaging": {
      "type": "object", "additionalProperties": false,
      "required": ["containers", "manifestKey", "slotKinds", "maxBytes", "maxJsonBytes", "maxFills", "binding", "rendition", "ext"],
      "properties": {
        "containers": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "enum": ["vrm1", "vrm0", "glb", "vrma"] } },
        "manifestKey": { "const": "ekza_package_v1" },
        "slotKinds": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "$ref": "#/$defs/slotKind" } },
        "maxBytes": { "type": "integer", "minimum": 20, "maximum": 268435456 },
        "maxJsonBytes": { "type": "integer", "minimum": 1024, "maximum": 16777216 },
        "maxFills": { "type": "integer", "minimum": 1, "maximum": 512 },
        "binding": { "enum": ["manifest", "manifest-or-names"] },
        "rendition": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["platform", "profile", "version"],
              "properties": {
                "platform": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
                "profile": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
                "version": { "type": "integer", "minimum": 1 }
              }
            }
          ]
        },
        "ext": { "$ref": "#/$defs/ext" }
      }
    },
    "rule": {
      "type": "object", "additionalProperties": false, "required": ["id", "severity", "scope", "params", "checkedBy"],
      "properties": {
        "id": { "$ref": "#/$defs/ruleId" },
        "severity": { "enum": ["error", "warning"] },
        "scope": { "enum": ["package", "animation", "asset", "socket", "rig", "rights"] },
        "params": { "type": "object" },
        "checkedBy": {
          "type": "array", "minItems": 1, "uniqueItems": true,
          "items": { "enum": ["tool", "hub", "builder", "game"] }
        }
      }
    },
    "default": {
      "type": "object", "additionalProperties": false, "required": ["name", "playSecs", "loop", "markers", "preview"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 64 },
        "playSecs": { "$ref": "#/$defs/nullableSecs" },
        "loop": { "type": ["boolean", "null"] },
        "markers": {
          "type": "object", "maxProperties": 8,
          "propertyNames": { "$ref": "#/$defs/markerName" },
          "additionalProperties": { "$ref": "#/$defs/secs" }
        },
        "preview": {
          "oneOf": [
            { "type": "null" },
            {
              "type": "object", "additionalProperties": false, "required": ["sha256", "bytes", "format", "license"],
              "properties": {
                "sha256": { "$ref": "#/$defs/sha256" },
                "bytes": { "type": "integer", "minimum": 1, "maximum": 268435456 },
                "format": { "enum": ["vrma", "glb", "png"] },
                "license": { "type": "string", "minLength": 1, "maxLength": 64 }
              }
            }
          ]
        }
      }
    },
    "animationSpec": {
      "type": "object", "additionalProperties": false,
      "required": ["rig", "playback", "loop", "inPlace", "window", "markers", "minIntervalSecs", "leadInSecs"],
      "properties": {
        "rig": { "$ref": "#/$defs/shortId" },
        "playback": { "enum": ["loop", "action", "hold"] },
        "loop": { "type": "boolean" },
        "inPlace": { "type": "boolean" },
        "window": {
          "type": "object", "additionalProperties": false, "required": ["minSecs", "targetSecs", "maxSecs"],
          "properties": {
            "minSecs": { "type": "number", "exclusiveMinimum": 0, "maximum": 600 },
            "targetSecs": { "type": "number", "exclusiveMinimum": 0, "maximum": 600 },
            "maxSecs": { "type": "number", "exclusiveMinimum": 0, "maximum": 600 }
          }
        },
        "markers": {
          "type": "object", "maxProperties": 8,
          "propertyNames": { "$ref": "#/$defs/markerName" },
          "additionalProperties": {
            "type": "object", "additionalProperties": false, "required": ["required", "maxSecs", "targetSecs"],
            "properties": {
              "required": { "type": "boolean" },
              "maxSecs": { "$ref": "#/$defs/nullableSecs" },
              "targetSecs": { "$ref": "#/$defs/nullableSecs" }
            }
          }
        },
        "minIntervalSecs": { "$ref": "#/$defs/nullableSecs" },
        "leadInSecs": { "$ref": "#/$defs/nullableSecs" }
      }
    },
    "assetSpec": {
      "type": "object", "additionalProperties": false,
      "required": ["role", "socket", "rootName", "nodes", "anchors", "axes", "sizeM", "budget", "materials", "motion"],
      "properties": {
        "role": { "enum": ["handheld", "projectile", "throwable", "deployable", "attachment", "effect"] },
        "socket": { "oneOf": [{ "$ref": "#/$defs/socketId" }, { "type": "null" }] },
        "rootName": { "oneOf": [{ "$ref": "#/$defs/name" }, { "type": "null" }] },
        "nodes": {
          "type": "object", "additionalProperties": false, "required": ["required", "optional"],
          "properties": {
            "required": { "type": "array", "uniqueItems": true, "maxItems": 32, "items": { "$ref": "#/$defs/name" } },
            "optional": { "type": "array", "uniqueItems": true, "maxItems": 32, "items": { "$ref": "#/$defs/name" } }
          }
        },
        "anchors": {
          "type": "object", "maxProperties": 8,
          "propertyNames": { "$ref": "#/$defs/markerName" },
          "additionalProperties": {
            "type": "object", "additionalProperties": false, "required": ["required", "default", "boxM"],
            "properties": {
              "required": { "type": "boolean" },
              "default": { "oneOf": [{ "$ref": "#/$defs/vec3" }, { "type": "null" }] },
              "boxM": {
                "oneOf": [
                  { "type": "null" },
                  { "type": "object", "additionalProperties": false, "required": ["min", "max"],
                    "properties": { "min": { "$ref": "#/$defs/vec3" }, "max": { "$ref": "#/$defs/vec3" } } }
                ]
              }
            }
          }
        },
        "axes": {
          "type": "object", "additionalProperties": false, "required": ["origin", "up", "forward"],
          "properties": {
            "origin": { "enum": ["grip", "center", "base", "socket"] },
            "up": { "enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] },
            "forward": { "enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] }
          }
        },
        "sizeM": {
          "type": "object", "additionalProperties": false, "required": ["boxMin", "boxMax"],
          "properties": {
            "boxMin": { "oneOf": [{ "$ref": "#/$defs/vec3" }, { "type": "null" }] },
            "boxMax": { "oneOf": [{ "$ref": "#/$defs/vec3" }, { "type": "null" }] }
          }
        },
        "budget": {
          "type": "object", "additionalProperties": false,
          "required": ["maxTriangles", "maxNodes", "maxMeshes", "maxMaterials", "maxImages", "maxTextureSize", "maxTexturePixels"],
          "properties": {
            "maxTriangles": { "type": ["integer", "null"], "minimum": 1 },
            "maxNodes": { "type": "integer", "minimum": 1, "maximum": 4096 },
            "maxMeshes": { "type": "integer", "minimum": 1, "maximum": 1024 },
            "maxMaterials": { "type": ["integer", "null"], "minimum": 1, "maximum": 256 },
            "maxImages": { "type": "integer", "minimum": 0, "maximum": 256 },
            "maxTextureSize": { "type": "integer", "minimum": 0, "maximum": 16384 },
            "maxTexturePixels": { "type": "integer", "minimum": 0 }
          }
        },
        "materials": {
          "type": "object", "additionalProperties": false, "required": ["extensionsAllowed", "imageFormats", "maxEmissiveStrength"],
          "properties": {
            "extensionsAllowed": { "type": "array", "uniqueItems": true, "items": { "type": "string", "pattern": "^[A-Z0-9]+_[A-Za-z0-9_]+$" } },
            "imageFormats": { "type": "array", "uniqueItems": true, "items": { "enum": ["png", "jpeg", "webp", "ktx2"] } },
            "maxEmissiveStrength": { "type": ["number", "null"], "minimum": 0 }
          }
        },
        "motion": { "enum": ["static", "named-parts", "node-animation", "skinned"] }
      }
    },
    "socketSpec": {
      "type": "object", "additionalProperties": false, "required": ["socket", "maxOffsetM", "maxRotationDeg"],
      "properties": {
        "socket": { "$ref": "#/$defs/socketId" },
        "maxOffsetM": { "type": "number", "minimum": 0, "maximum": 10 },
        "maxRotationDeg": { "type": "number", "minimum": 0, "maximum": 360 }
      }
    },
    "slotBody": {
      "type": "object",
      "properties": {
        "kind": { "$ref": "#/$defs/slotKind" },
        "label": { "$ref": "#/$defs/label" },
        "description": { "$ref": "#/$defs/description" },
        "customizable": { "type": "boolean" },
        "customizableFrom": { "oneOf": [{ "type": "string", "pattern": "^[0-9]+(\\.[0-9]+)?$" }, { "type": "null" }] },
        "reserved": { "type": "boolean" },
        "required": { "type": "boolean" },
        "default": { "oneOf": [{ "$ref": "#/$defs/default" }, { "type": "null" }] },
        "animation": { "oneOf": [{ "$ref": "#/$defs/animationSpec" }, { "type": "null" }] },
        "asset": { "oneOf": [{ "$ref": "#/$defs/assetSpec" }, { "type": "null" }] },
        "socket": { "oneOf": [{ "$ref": "#/$defs/socketSpec" }, { "type": "null" }] },
        "ext": { "$ref": "#/$defs/ext" }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "animation" } } },
          "then": { "properties": { "animation": { "$ref": "#/$defs/animationSpec" }, "asset": { "type": "null" }, "socket": { "type": "null" } } } },
        { "if": { "properties": { "kind": { "const": "asset" } } },
          "then": { "properties": { "asset": { "$ref": "#/$defs/assetSpec" }, "animation": { "type": "null" }, "socket": { "type": "null" } } } },
        { "if": { "properties": { "kind": { "const": "socket" } } },
          "then": { "properties": { "socket": { "$ref": "#/$defs/socketSpec" }, "animation": { "type": "null" }, "asset": { "type": "null" } } } },
        { "if": { "properties": { "customizable": { "const": true } } },
          "then": { "properties": { "customizableFrom": { "type": "string" } } } },
        { "if": { "properties": { "required": { "const": true } } },
          "then": { "properties": { "default": { "type": "null" } } } }
      ]
    },
    "slot": {
      "allOf": [{ "$ref": "#/$defs/slotBody" }],
      "type": "object",
      "unevaluatedProperties": false,
      "required": ["kind", "label", "description", "customizable", "customizableFrom", "reserved", "required", "default",
                   "animation", "asset", "socket", "sharesDefaultWith", "alternatesWith", "usedBy", "ext"],
      "properties": {
        "sharesDefaultWith": { "type": "array", "uniqueItems": true, "maxItems": 64, "items": { "$ref": "#/$defs/slotId" } },
        "alternatesWith": { "type": "array", "uniqueItems": true, "maxItems": 1, "items": { "$ref": "#/$defs/slotId" } },
        "usedBy": {
          "type": "array", "minItems": 1, "uniqueItems": true,
          "items": { "oneOf": [{ "const": "*" }, { "$ref": "#/$defs/targetId" }] }
        }
      }
    },
    "family": {
      "allOf": [{ "$ref": "#/$defs/slotBody" }],
      "type": "object",
      "unevaluatedProperties": false,
      "required": ["kind", "label", "description", "customizable", "customizableFrom", "reserved", "required", "default",
                   "animation", "asset", "socket", "idPrefix", "minFills", "maxFills", "usedBy", "ext"],
      "properties": {
        "idPrefix": { "$ref": "#/$defs/slotId" },
        "minFills": { "type": "integer", "minimum": 0, "maximum": 64 },
        "maxFills": { "type": "integer", "minimum": 1, "maximum": 64 },
        "usedBy": {
          "type": "array", "minItems": 1, "uniqueItems": true,
          "items": { "oneOf": [{ "const": "*" }, { "$ref": "#/$defs/targetId" }] }
        }
      }
    },
    "target": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "kind", "name", "subtitle", "sections", "slots", "families", "accepts", "ext"],
      "properties": {
        "id": { "$ref": "#/$defs/targetId" },
        "kind": { "enum": ["character", "any", "item", "vehicle", "prop"] },
        "name": { "type": "string", "minLength": 1, "maxLength": 64 },
        "subtitle": { "oneOf": [{ "type": "string", "maxLength": 64 }, { "type": "null" }] },
        "sections": {
          "type": "array", "minItems": 1, "maxItems": 32,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["id", "label", "key", "slots"],
            "properties": {
              "id": { "$ref": "#/$defs/shortId" },
              "label": { "$ref": "#/$defs/label" },
              "key": { "oneOf": [{ "type": "string", "maxLength": 8 }, { "type": "null" }] },
              "slots": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/slotId" } }
            }
          }
        },
        "slots": { "type": "array", "minItems": 1, "uniqueItems": true, "maxItems": 512, "items": { "$ref": "#/$defs/slotId" } },
        "families": { "type": "array", "uniqueItems": true, "maxItems": 16, "items": { "$ref": "#/$defs/shortId" } },
        "accepts": {
          "type": "array", "minItems": 1, "maxItems": 16,
          "items": {
            "type": "object", "additionalProperties": false, "required": ["package", "requirementId", "label", "slots", "families", "listing", "mustFill"],
            "properties": {
              "package": { "$ref": "#/$defs/packageKind" },
              "requirementId": { "$ref": "#/$defs/requirementId" },
              "label": { "$ref": "#/$defs/label" },
              "slots": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/slotId" } },
              "families": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/shortId" } },
              "listing": { "enum": ["every-customizable-slot", "filled-slots-only"] },
              "mustFill": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/slotId" } }
            }
          }
        },
        "ext": { "$ref": "#/$defs/ext" }
      }
    }
  }
}
```

## Appendix B — JSON Schema `ekza.package.v1` and examples

Embedded as `asset.extras.ekza_package_v1`. Cross-checks against the contract are the `pack.*` rules (§7.2).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ekza.io/schemas/gp/ekza.package.v1.json",
  "title": "ekza.package.v1",
  "description": "Ekza Game Protocol 1.0: the manifest of one package (monolithic or fragment). In glTF/VRM containers it is `asset.extras.ekza_package_v1`, covered by the file's SHA-256.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "schemaVersion", "kind", "contract", "target", "slots", "requires", "provenance"],
  "properties": {
    "schema": { "const": "ekza.package.v1" },
    "schemaVersion": { "type": "string", "pattern": "^1\\.(0|[1-9][0-9]{0,3})$" },
    "kind": { "enum": ["character", "animation-pack", "asset-pack", "accessory"] },
    "contract": {
      "type": "object", "additionalProperties": false, "required": ["schema", "game", "revision"],
      "properties": {
        "schema": { "const": "ekza.game-contract.v1" },
        "game": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
        "revision": { "type": "string", "pattern": "^sha256-[0-9a-f]{64}$" }
      }
    },
    "target": {
      "type": "object", "additionalProperties": false, "required": ["id", "requirementId"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z][a-z0-9_-]{0,47}$" },
        "requirementId": { "type": "string", "maxLength": 128, "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$" }
      }
    },
    "slots": {
      "type": "object", "minProperties": 1, "maxProperties": 512,
      "propertyNames": { "type": "string", "maxLength": 96, "pattern": "^[a-z][a-z0-9_-]{0,47}(\\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$" },
      "additionalProperties": {
        "oneOf": [
          { "type": "object", "additionalProperties": false, "required": ["mode"],
            "properties": { "mode": { "const": "default" } } },
          { "type": "object", "additionalProperties": false, "required": ["mode", "animation", "markers"],
            "properties": {
              "mode": { "const": "custom" },
              "animation": { "type": "integer", "minimum": 0, "maximum": 1023 },
              "markers": {
                "type": "object", "maxProperties": 8,
                "propertyNames": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$" },
                "additionalProperties": { "type": "number", "minimum": 0, "maximum": 600 }
              }
            } },
          { "type": "object", "additionalProperties": false, "required": ["mode", "node", "anchors"],
            "properties": {
              "mode": { "const": "custom" },
              "node": { "type": "integer", "minimum": 0, "maximum": 65535 },
              "anchors": {
                "type": "object", "maxProperties": 8,
                "propertyNames": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$" },
                "additionalProperties": {
                  "type": "array", "minItems": 3, "maxItems": 3,
                  "items": { "type": "number", "minimum": -100, "maximum": 100 }
                }
              }
            } }
        ]
      }
    },
    "requires": {
      "type": "array", "maxItems": 8,
      "items": {
        "type": "object", "additionalProperties": false, "required": ["kind", "sha256", "reason"],
        "properties": {
          "kind": { "enum": ["character", "animation-pack", "asset-pack", "accessory"] },
          "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "reason": { "enum": ["sockets", "rig", "derived-from"] }
        }
      }
    },
    "provenance": {
      "type": "object", "additionalProperties": false, "required": ["tool", "toolVersion"],
      "properties": {
        "tool": { "type": "string", "minLength": 1, "maxLength": 64 },
        "toolVersion": { "type": "string", "minLength": 1, "maxLength": 32 }
      }
    }
  }
}
```

Example 1 — a Wildspark character package (four custom clips; the rocket-mode basic attack and Last Spark share animation 2, named `basic.wildspark.rockets.0`; `contract.revision` is the Appendix D example's):

```json
{
  "schema": "ekza.package.v1",
  "schemaVersion": "1.0",
  "kind": "character",
  "contract": {"schema": "ekza.game-contract.v1", "game": "omoba", "revision": "sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7"},
  "target": {"id": "wildspark", "requirementId": "character.wildspark"},
  "slots": {
    "base.idle": {"mode": "default"},
    "base.run": {"mode": "custom", "animation": 0, "markers": {}},
    "base.death": {"mode": "default"},
    "basic.wildspark.0": {"mode": "custom", "animation": 1, "markers": {"contact": 0.067}},
    "basic.wildspark.rockets.0": {"mode": "custom", "animation": 2, "markers": {"contact": 0.133}},
    "skill.wild_switch.release": {"mode": "default"},
    "skill.wild_zap.release": {"mode": "default"},
    "skill.wild_traps.release": {"mode": "custom", "animation": 3, "markers": {"contact": 0.1}},
    "skill.wild_rocket.release": {"mode": "custom", "animation": 2, "markers": {"contact": 0.133}}
  },
  "requires": [],
  "provenance": {"tool": "ekza-studio", "toolVersion": "0.7.0"}
}
```

Example 2 — the matching gear set (`asset-pack`):

```json
{
  "schema": "ekza.package.v1",
  "schemaVersion": "1.0",
  "kind": "asset-pack",
  "contract": {"schema": "ekza.game-contract.v1", "game": "omoba", "revision": "sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7"},
  "target": {"id": "wildspark", "requirementId": "wildspark.handheld.set"},
  "slots": {
    "wildspark.handheld.repeater": {"mode": "custom", "node": 1, "anchors": {"muzzle": [0, 0.12, 0.735]}},
    "wildspark.handheld.launcher": {"mode": "custom", "node": 3, "anchors": {"muzzle": [0, 0.13, 0.81]}}
  },
  "requires": [],
  "provenance": {"tool": "ekza-studio", "toolVersion": "0.7.0"}
}
```

## Appendix C — JSON Schemas `ekza.validation-report.v1` and `ekza.event.v1`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ekza.io/schemas/gp/ekza.validation-report.v1.json",
  "title": "ekza.validation-report.v1",
  "description": "Ekza Game Protocol 1.0: the verdict of one validator stage on one package, per package and per slot.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "schemaVersion", "package", "contract", "stage", "validator", "verdict", "issues", "slots"],
  "$defs": {
    "issue": {
      "type": "object", "additionalProperties": false, "required": ["rule", "severity", "message", "path"],
      "properties": {
        "rule": { "type": "string", "maxLength": 80 },
        "severity": { "enum": ["error", "warning"] },
        "message": { "type": "string", "maxLength": 500 },
        "path": { "type": ["string", "null"], "maxLength": 200 }
      }
    }
  },
  "properties": {
    "schema": { "const": "ekza.validation-report.v1" },
    "schemaVersion": { "type": "string", "pattern": "^1\\.(0|[1-9][0-9]{0,3})$" },
    "package": {
      "type": "object", "additionalProperties": false, "required": ["sha256", "bytes", "kind"],
      "properties": {
        "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "bytes": { "type": "integer", "minimum": 0 },
        "kind": { "enum": ["character", "animation-pack", "asset-pack", "accessory"] }
      }
    },
    "contract": {
      "type": "object", "additionalProperties": false, "required": ["game", "revision"],
      "properties": {
        "game": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
        "revision": { "type": "string", "pattern": "^sha256-[0-9a-f]{64}$" }
      }
    },
    "stage": { "enum": ["tool", "hub", "builder", "game"] },
    "validator": {
      "type": "object", "additionalProperties": false, "required": ["name", "version", "rules"],
      "properties": {
        "name": { "type": "string", "maxLength": 64 },
        "version": { "type": "string", "maxLength": 32 },
        "rules": { "type": "array", "uniqueItems": true, "items": { "type": "string", "maxLength": 80 } }
      }
    },
    "verdict": { "enum": ["pass", "fail"] },
    "issues": { "type": "array", "maxItems": 256, "items": { "$ref": "#/$defs/issue" } },
    "slots": {
      "type": "object", "maxProperties": 512,
      "additionalProperties": {
        "type": "object", "additionalProperties": false, "required": ["mode", "verdict", "issues", "measured"],
        "properties": {
          "mode": { "enum": ["custom", "default"] },
          "verdict": { "enum": ["pass", "fail", "skipped", "deferred"] },
          "issues": { "type": "array", "maxItems": 64, "items": { "$ref": "#/$defs/issue" } },
          "measured": {
            "type": "object", "maxProperties": 16,
            "propertyNames": { "pattern": "^[a-z][A-Za-z0-9]{0,31}$" },
            "additionalProperties": { "type": ["number", "string", "boolean", "null"] }
          }
        }
      }
    }
  }
}
```

Example — the builder stage rejecting one slot of a character package:

```json
{
  "schema": "ekza.validation-report.v1",
  "schemaVersion": "1.0",
  "package": {"sha256": "0000000000000000000000000000000000000000000000000000000000000000", "bytes": 4182233, "kind": "character"},
  "contract": {"game": "omoba", "revision": "sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7"},
  "stage": "builder",
  "validator": {"name": "omoba-passport", "version": "0.45.0", "rules": ["pack.manifest", "clip.markers"]},
  "verdict": "fail",
  "issues": [],
  "slots": {
    "base.run": {"mode": "custom", "verdict": "pass", "issues": [], "measured": {"durationSecs": 0.667, "hipsDrift": 0.04, "seamDegrees": 0.8}},
    "basic.wildspark.rockets.0": {"mode": "custom", "verdict": "fail", "issues": [{"rule": "clip.markers", "severity": "error", "message": "contact at 0.21 s; this slot allows at most 0.15 s", "path": "markers.contact"}], "measured": {"durationSecs": 0.42, "contactSecs": 0.21}},
    "base.idle": {"mode": "default", "verdict": "skipped", "issues": [], "measured": {}}
  }
}
```

The event envelope (`data` is validated against `dataschema`; one data schema per event type, §8.4):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ekza.io/schemas/gp/ekza.event.v1.json",
  "title": "ekza.event.v1",
  "description": "Ekza Game Protocol 1.0 event: a CloudEvents 1.0 event in structured JSON mode with two extension attributes. `data` is validated against `dataschema`.",
  "type": "object",
  "additionalProperties": false,
  "required": ["specversion", "id", "source", "type", "subject", "time", "datacontenttype", "dataschema",
               "ekzaproject", "ekzaseq", "data"],
  "properties": {
    "specversion": { "const": "1.0" },
    "id": { "type": "string", "pattern": "^evt_[0-9A-HJKMNP-TV-Z]{26}$" },
    "source": { "type": "string", "pattern": "^https://[a-z0-9.-]+(:[0-9]+)?/projects/[a-z][a-z0-9-]{1,62}$" },
    "type": {
      "enum": [
        "io.ekza.gp.contract.published", "io.ekza.gp.contract.channel-moved", "io.ekza.gp.contract.retired",
        "io.ekza.gp.package.submitted", "io.ekza.gp.package.validated", "io.ekza.gp.package.withdrawn",
        "io.ekza.gp.rendition.ready", "io.ekza.gp.rendition.failed",
        "io.ekza.gp.review.decided",
        "io.ekza.gp.rights.requested", "io.ekza.gp.rights.countersigned", "io.ekza.gp.rights.withdrawn",
        "io.ekza.gp.release.approved", "io.ekza.gp.release.promoted", "io.ekza.gp.release.revoked",
        "io.ekza.gp.usage.reported"
      ]
    },
    "subject": { "type": "string", "minLength": 1, "maxLength": 256 },
    "time": { "type": "string", "format": "date-time" },
    "datacontenttype": { "const": "application/json" },
    "dataschema": { "type": "string", "pattern": "^https://ekza\\.io/schemas/gp/events/[a-z.-]+\\.v[0-9]+\\.json$" },
    "ekzaproject": { "type": "string", "pattern": "^[a-z][a-z0-9-]{1,62}$" },
    "ekzaseq": { "type": "integer", "minimum": 1 },
    "data": { "type": "object" }
  }
}
```

## Appendix D — Worked example: Wildspark in the protocol (excerpt)

From the converted prototype contract (`omoba-bevy@dev` data; the whole document with the `any` and `wildspark` targets is CHARACTER-CONTRACT-SPEC v0.2 Appendix B, revision `sha256-ca27905176c053491a6e9974c31fd0022ce5c5ea2adea066e4b77f07173ffea7`, illustrative). Shown: the `wildspark` target with its sections and two offers, the Snapline release clip and the six asset slots. The asset budgets of the planned slots are placeholders until GP7 measures them.

```json
{
  "targets": [
    {
      "id": "wildspark", "kind": "character", "name": "Wildspark", "subtitle": "carry",
      "sections": [
        {"id": "base", "label": "Base", "key": null, "slots": ["base.idle", "base.run", "base.death"]},
        {"id": "basic", "label": "Basic attack", "key": null, "slots": ["basic.wildspark.0", "basic.wildspark.rockets.0", "wildspark.projectile.basic-rocket"]},
        {"id": "q", "label": "Switchfire", "key": "Q", "slots": ["skill.wild_switch.release"]},
        {"id": "w", "label": "Shockline", "key": "W", "slots": ["skill.wild_zap.release", "wildspark.effect.shockline"]},
        {"id": "e", "label": "Snapline", "key": "E", "slots": ["skill.wild_traps.release", "wildspark.prop.trap"]},
        {"id": "r", "label": "Last Spark", "key": "R", "slots": ["skill.wild_rocket.release", "wildspark.projectile.ultimate"]},
        {"id": "gear", "label": "Gear", "key": null, "slots": ["wildspark.handheld.repeater", "wildspark.handheld.launcher"]}
      ],
      "slots": ["base.idle", "base.run", "base.death", "basic.wildspark.0", "basic.wildspark.rockets.0", "wildspark.projectile.basic-rocket", "skill.wild_switch.release", "skill.wild_zap.release", "wildspark.effect.shockline", "skill.wild_traps.release", "wildspark.prop.trap", "skill.wild_rocket.release", "wildspark.projectile.ultimate", "wildspark.handheld.repeater", "wildspark.handheld.launcher"],
      "families": [],
      "accepts": [
        {"package": "character", "requirementId": "character.wildspark", "label": "Character for Wildspark", "slots": ["base.idle", "base.run", "base.death", "basic.wildspark.0", "basic.wildspark.rockets.0", "skill.wild_switch.release", "skill.wild_zap.release", "skill.wild_traps.release", "skill.wild_rocket.release"], "families": [], "listing": "every-customizable-slot", "mustFill": []},
        {"package": "asset-pack", "requirementId": "wildspark.handheld.set", "label": "Wildspark gear set", "slots": ["wildspark.handheld.repeater", "wildspark.handheld.launcher"], "families": [], "listing": "filled-slots-only", "mustFill": ["wildspark.handheld.repeater", "wildspark.handheld.launcher"]}
      ],
      "ext": {"omoba.character.v1": {"heroKind": "class", "role": "carry", "basicAttack": {"rangeM": 11.5, "cooldownSecs": 0.7, "attackRateCap": 1.6, "minIntervalSecs": 0.4375}, "kit": [{"key": "q", "skill": "wild_switch", "name": "Switchfire"}, {"key": "w", "skill": "wild_zap", "name": "Shockline"}, {"key": "e", "skill": "wild_traps", "name": "Snapline"}, {"key": "r", "skill": "wild_rocket", "name": "Last Spark"}], "handheld": {"default": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand"}}}
    }
  ],
  "slots": {
    "skill.wild_traps.release": {
      "kind": "animation", "label": "Snapline (E) — release", "description": null, "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"name": "toss_underhand", "playSecs": 0.3077, "loop": false, "markers": {"contact": 0.1}, "preview": null},
      "animation": {"rig": "humanoid", "playback": "action", "loop": false, "inPlace": true, "window": {"minSecs": 0.15, "targetSecs": 0.3077, "maxSecs": 1.2}, "markers": {"contact": {"required": true, "maxSecs": 0.15, "targetSecs": 0.1}}, "minIntervalSecs": null, "leadInSecs": null},
      "asset": null,
      "socket": null,
      "sharesDefaultWith": ["basic.chainkeeper.0", "basic.mage.0", "skill.dawn_barrier.release", "skill.wandering_ember.release"], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"group": "skill", "role": "release", "phase": "instant", "edgeReleased": true, "row": {"motion": "toss_underhand", "durationSecs": 0.4, "contactSecs": 0.13, "rate": 1.3, "start": 0.0, "effectiveContactSecs": 0.1, "standInFor": null}, "telegraph": null, "handheld": {"item": "wild-repeater", "byMode": {"rockets": "wild-launcher"}, "bone": "rightHand", "muzzleWindowSecs": null}, "skill": "wild_traps"}}
    },
    "wildspark.handheld.repeater": {
      "kind": "asset", "label": "Repeater (held)", "description": "The default gun; Rotor spins on basic attacks.", "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"name": "wildspark-repeater", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "handheld", "socket": "hand.right", "rootName": "WildsparkSetRepeater", "nodes": {"required": ["WildsparkRotor"], "optional": []}, "anchors": {"muzzle": {"required": false, "default": [0, 0.12, 0.735], "boxM": null}}, "axes": {"origin": "grip", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": [-0.204, -0.196, -0.444], "boxMax": [0.204, 0.298, 0.842]}, "budget": {"maxTriangles": null, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": null, "maxImages": 64, "maxTextureSize": 4096, "maxTexturePixels": 33554432}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "named-parts"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "held_weapon", "status": "supported", "item": "wild-repeater", "model": null, "uses": [{"basicAttackId": "wildspark", "state": "repeater"}, {"skillId": "wild_switch", "phase": "equipped"}], "baseline": {"kind": "model", "path": "client/assets/weapons/wildspark-repeater.glb"}, "gripMetadata": "ekza_handheld_v1"}}
    },
    "wildspark.handheld.launcher": {
      "kind": "asset", "label": "Launcher (rocket mode)", "description": "Held in rocket mode and for 1.1 s after Shockline and Last Spark; Slide recoils.", "customizable": true, "customizableFrom": "1", "reserved": false, "required": false,
      "default": {"name": "wild-launcher", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "handheld", "socket": "hand.right", "rootName": "WildsparkSetLauncher", "nodes": {"required": ["WildsparkSlide"], "optional": []}, "anchors": {"muzzle": {"required": false, "default": [0, 0.13, 0.81], "boxM": null}}, "axes": {"origin": "grip", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": [-0.219, -0.207, -0.452], "boxMax": [0.219, 0.423, 0.924]}, "budget": {"maxTriangles": null, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": null, "maxImages": 64, "maxTextureSize": 4096, "maxTexturePixels": 33554432}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "named-parts"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "held_weapon", "status": "supported", "item": "wild-launcher", "model": null, "uses": [{"basicAttackId": "wildspark", "state": "rockets"}, {"skillId": "wild_switch", "phase": "equipped"}, {"skillId": "wild_zap", "phase": "release"}, {"skillId": "wild_rocket", "phase": "release"}], "baseline": {"kind": "model", "path": "client/assets/weapons/wild-launcher.glb"}, "gripMetadata": "ekza_handheld_v1"}}
    },
    "wildspark.projectile.basic-rocket": {
      "kind": "asset", "label": "Rocket-mode shot", "description": "Drawn by the game (engine-owned).", "customizable": false, "customizableFrom": null, "reserved": false, "required": false,
      "default": {"name": "wild-rocket", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "projectile", "socket": null, "rootName": null, "nodes": {"required": [], "optional": []}, "anchors": {}, "axes": {"origin": "center", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": null, "boxMax": null}, "budget": {"maxTriangles": 20000, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": 16, "maxImages": 8, "maxTextureSize": 2048, "maxTexturePixels": 8388608}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "static"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "projectile", "status": "engine_owned", "item": null, "model": null, "uses": [{"basicAttackId": "wildspark", "phase": "flight", "state": "rockets"}], "baseline": {"kind": "model", "path": "client/assets/weapons/wild-rocket.glb"}, "gripMetadata": null}}
    },
    "wildspark.projectile.ultimate": {
      "kind": "asset", "label": "Last Spark rocket", "description": "Planned: opens when the game has a projectile profile.", "customizable": false, "customizableFrom": null, "reserved": false, "required": false,
      "default": {"name": "rocket", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "projectile", "socket": null, "rootName": null, "nodes": {"required": [], "optional": []}, "anchors": {"trail": {"required": false, "default": [0, 0, -0.4], "boxM": null}}, "axes": {"origin": "center", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": null, "boxMax": null}, "budget": {"maxTriangles": 20000, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": 16, "maxImages": 8, "maxTextureSize": 2048, "maxTexturePixels": 8388608}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "static"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "projectile", "status": "planned", "item": null, "model": "rocket", "uses": [{"skillId": "wild_rocket", "phase": "flight"}], "baseline": {"kind": "model", "path": "client/assets/cosmetics/standard/rocket.glb"}, "gripMetadata": null}}
    },
    "wildspark.prop.trap": {
      "kind": "asset", "label": "Snapline trap", "description": "Planned: three are placed per cast; the jaws close when armed.", "customizable": false, "customizableFrom": null, "reserved": false, "required": false,
      "default": {"name": "trap", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "deployable", "socket": null, "rootName": null, "nodes": {"required": ["WildsparkTrapBase", "WildsparkJawLeft", "WildsparkJawRight"], "optional": []}, "anchors": {}, "axes": {"origin": "base", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": null, "boxMax": null}, "budget": {"maxTriangles": 20000, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": 16, "maxImages": 8, "maxTextureSize": 2048, "maxTexturePixels": 8388608}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "named-parts"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "world_prop", "status": "planned", "item": null, "model": "trap", "uses": [{"skillId": "wild_traps", "phase": "placed"}], "baseline": {"kind": "model", "path": "client/assets/cosmetics/standard/trap.glb"}, "gripMetadata": null}}
    },
    "wildspark.effect.shockline": {
      "kind": "asset", "label": "Shockline bolt", "description": "Procedural; drawn by the game (engine-owned).", "customizable": false, "customizableFrom": null, "reserved": false, "required": false,
      "default": {"name": "shockline", "playSecs": null, "loop": null, "markers": {}, "preview": null},
      "animation": null,
      "asset": {"role": "effect", "socket": null, "rootName": null, "nodes": {"required": [], "optional": []}, "anchors": {}, "axes": {"origin": "center", "up": "+Y", "forward": "+Z"}, "sizeM": {"boxMin": null, "boxMax": null}, "budget": {"maxTriangles": 20000, "maxNodes": 64, "maxMeshes": 16, "maxMaterials": 16, "maxImages": 8, "maxTextureSize": 2048, "maxTexturePixels": 8388608}, "materials": {"extensionsAllowed": ["KHR_materials_unlit", "KHR_texture_transform"], "imageFormats": ["png", "jpeg"], "maxEmissiveStrength": 1}, "motion": "static"},
      "socket": null,
      "sharesDefaultWith": [], "alternatesWith": [], "usedBy": ["wildspark"],
      "ext": {"omoba.character.v1": {"catalogRole": "engine_effect", "status": "engine_owned", "item": null, "model": null, "uses": [{"skillId": "wild_zap", "phase": "flight"}], "baseline": {"kind": "procedural", "path": null}, "gripMetadata": null}}
    }
  }
}
```

## Appendix E — Core conformance fixtures v1 (minimum set)

Owned by the protocol repository (`fixtures/v1/`, GP0): each case is a small file (a contract, or a package plus the
contract it targets) and `expected/<case>.json` = `{document: "ok" | "refused: <reason>", pack: "ok" | ["rule ids"],
slots: {"<slot>": "pass" | "deferred" | ["rule ids"]}}`. Both reference implementations and the registry's structural
subset run them; tools copy them with SHA-256 pinning. Game profiles add their own cases (OMOBA: CHARACTER-CONTRACT-SPEC
Appendix D).

| Group | Cases | Expect |
|---|---|---|
| Contract reading (§3.3, §3.5) | `contract-ok-minimal` (one `any` target, one animation slot), `contract-ok-asset-family` | ok |
| | `contract-unknown-key`, `contract-revision-mismatch`, `contract-dangling-slot-ref`, `contract-offer-kind-mismatch`, `contract-required-unknown-profile`, `contract-unknown-core-rule`, `contract-min-reader-1.9` | refused |
| | `contract-schema-1.9-min-reader-1.0` (unknown keys ignored), `contract-unknown-namespaced-rule` (rule deferred), `contract-unknown-profile-ext` (ignored) | ok |
| | `contract-retired-id-reused` (against its `previousRevision`) | refused by Hub |
| `pack.manifest`, `pack.contract`, `pack.target` | `pkg-missing-manifest`, `pkg-bad-manifest-key`, `pkg-wrong-game`, `pkg-unknown-revision`, `pkg-retired-revision`, `pkg-unknown-requirement`, `pkg-kind-mismatch` | the rule named |
| `pack.slot-known` | `pkg-unknown-slot`, `pkg-slot-not-listed` (every-customizable-slot), `pkg-fixed-slot-custom`, `pkg-mustfill-default`, `pkg-family-over-max`, `pkg-family-bad-prefix` | `pack.slot-known` |
| `pack.ref`, `pack.unreferenced` | `pkg-bad-animation-index`, `pkg-bad-node-index`, `pkg-animation-name-mismatch`, `pkg-root-name-mismatch`, `pkg-duplicate-animation-names`; `pkg-unreferenced-animation`, `pkg-unreferenced-subtree` | the rule named (the last two warnings) |
| `pack.bytes`, `pack.requires` | `pkg-file-over-cap`, `pkg-json-over-cap`, `pkg-fills-over-cap`; `pkg-requires-unknown`, `pkg-requires-depth-2` | the rule named |
| Packages that pass | `pkg-ok-character-three-custom` (VRM 1.0), `pkg-ok-character-vrm0`, `pkg-ok-all-default`, `pkg-ok-shared-animation`, `pkg-ok-asset-pack-two-roots`, `pkg-ok-asset-pack-wrapper-root`, `pkg-ok-family-two` | ok |
| `rig.humanoid` | `rig-missing-required-bone`, `rig-two-vrm-extensions`, `rig-nonuniform-scale-on-bone` | `rig.humanoid` |
| `clip.*` | `clip-scale-channel`, `clip-morph-weights`, `clip-root-node`, `clip-translation-on-spine`; `clip-cubicspline`, `clip-nan-key`, `clip-unsorted-times`, `clip-starts-late`, `clip-non-unit-quat`; `clip-4097-keys`, `clip-120hz`; `clip-too-short`, `clip-too-long`; `clip-hips-drift-at-cap` (pass), `clip-hips-drift-over`; `clip-loop-open`, `clip-loop-closed` (pass); `clip-marker-at-limit` (pass), `clip-marker-over-limit`, `clip-marker-missing`, `clip-marker-after-end`, `clip-marker-mismatch-meta`; `clip-longer-than-min-interval` | the rule of the group (the last one a warning) |
| `asset.*` | `asset-external-uri`, `asset-two-buffers`, `asset-matrix-and-trs`, `asset-required-extension-not-allowed` (`asset.container`); `asset-missing-part`, `asset-duplicate-part` (`asset.nodes`); `asset-nodes-over`, `asset-images-over`, `asset-texture-over-size`, `asset-triangles-over` (`asset.budget`); `asset-outside-box`, `asset-at-box-edge` (pass) (`asset.bounds`); `asset-anchor-missing-required`, `asset-anchor-outside` (warning, ignored) (`asset.anchors`); `asset-emissive-over`, `asset-webp-image` (`asset.materials`); `asset-static-with-animation`, `asset-static-with-skin` (`asset.motion`) | the rule named |
| `socket.node` | `socket-node-wrong-parent`, `socket-offset-over` | `socket.node` |
