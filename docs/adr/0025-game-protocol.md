# ADR 0025 — Ekza Game Protocol: game contracts, packages and fragments, one rule vocabulary, events

- Status: Proposed (2026-10-24, with [GAME-PROTOCOL-SPEC](../GAME-PROTOCOL-SPEC.md) v0.1 and
  [CHARACTER-CONTRACT-SPEC](../CHARACTER-CONTRACT-SPEC.md) v0.2); becomes Accepted when the owner accepts the spec. The
  document formats freeze together with the OMOBA profile when work package C0 merges into `omoba-bevy` `dev`.
- Inputs: the owner's request of 2026-10-24 (standardize the principle of the character contract into a protocol other
  games support; every game publishes, per character, the animations it needs and the assets it must have — the
  example: a hero's gimmick, her grenades, her rocket; a character's assets can be extended; decide between embedding
  and fragments; messages go over the protocol); research of the same day on `omoba-bevy@dev` `6d34f98` (handheld
  weapons, the one-GLB Wildspark set, `omoba.asset-catalog.v1` requirements, cosmetics, wire, passport),
  `ekza-registry@dev` `82715fa`, `ekza-bevy-sdk` `a9a253c`, the in-flight C0 and C1 branches, and open standards
  (glTF 2.0 extensions, VRM 1.0, the Khronos avatar extension draft, OMI, OpenUSD composition, CloudEvents 1.0,
  Standard Webhooks, JSON Schema 2020-12, OCI, RFC 8785, RFC 9457).
- Extends ADR 0024 (its contract becomes the OMOBA profile; it amends three names: the document schema, the manifest
  key, four rule ids) and ADR 0010 (T1 becomes the `animation-pack` package kind; T2's key becomes `ekza_package_v1`).
  Supersedes neither.

## Context

ADR 0024 lets OMOBA describe the animation slots of its heroes and lets Studio and Hub fill, check and release them.
It is OMOBA-only: its document schema, its slot model, its manifest (`ekza_animation_set_v1`) and its rule ids are
OMOBA's, and it has no place for the objects a hero uses (guns, rockets, traps), although OMOBA already lists those
as requirements in `omoba.asset-catalog.v1` and ships one of them end to end (the Wildspark gun set). Hub has one
asset model, game-owned builders and per-game releases, but requirements are seeded by SQL, a new builder or asset kind
needs a migration, and there is no push channel: every consumer polls. The SDK reads catalogues and verifies files
but knows nothing of contracts. No open standard covers it: glTF and VRM describe files, the Khronos avatar draft
describes characters but has no attachment or equipment extension, UGC platforms keep their slot lists closed.

Options per axis:

1. **Scope of the standard**: per-game contracts reconciled by Studio; a fixed universal slot list; **one core
   document with per-game profiles**.
2. **Where game specifics live**: free-form fields anywhere; separate profile documents; **namespaced `ext` objects
   inside one document, plus namespaced rules**.
3. **Slot kinds**: animations only; one generic "item"; **animation, asset (with roles) and socket, with families for
   extensible lists**.
4. **Packaging**: monolithic only; fragments only; **both, chosen by review and reuse unit, with bundles**.
5. **Manifest**: one per package kind; **one manifest for every kind**.
6. **Rules**: each game ships code; **one core vocabulary with parameters, namespaced extensions with `checkedBy`**.
7. **Messages**: polling only; a proprietary event format; **CloudEvents through an outbox, signed webhooks and a pull
   feed**.
8. **Auth for games**: user tokens; **project keys (publishable and secret, scoped)**.

## Decision

1. **The Ekza Game Protocol 1.0** has five documents — `ekza.game-contract.v1`, `ekza.package.v1`,
   `ekza.validation-report.v1`, `ekza.event.v1`, `ekza.contract-index.v1` — and **profiles** (`<game>.<name>.v<N>`)
   whose data lives only under `ext` and in namespaced rules. Profiles a document does not mark `required` are
   optional for readers; a game must be fully servable by generic tools unless it says otherwise.
2. **Versioning**: the major in the schema id, additive minors in `schemaVersion`, `minReaderVersion` for safe
   forward reading (strict parsing for understood minors); `revision = sha256-` of canonical JSON (the asset-catalog
   rule, a subset of RFC 8785); compatible/breaking classification; stable ids with a `retired` list Hub enforces.
   Games conform at G0 Listed, G1 Described, G2 Validated, G3 Live.
3. **Model**: game → targets (`character`, `any`, `item`, `vehicle`, `prop`) → slots defined once per game, keyed by
   gameplay identity, shared through `usedBy`; slot kinds `animation`, `asset` (roles handheld, projectile, throwable,
   deployable, attachment, effect) and `socket`; each target has checklist sections and **offers** (`accepts`), one per
   package kind, each mapped to one Hub requirement id; **families** are bounded extensible lists.
4. **Defaults are the game's** and never shipped; the generic vocabulary carries **markers** (named times in a clip)
   and **anchors** (named points in an asset).
5. **One manifest** `ekza.package.v1` in `asset.extras.ekza_package_v1` for every package kind (`character`,
   `animation-pack`, `asset-pack`, `accessory`); fills bind by animation or root-node index.
6. **One package per review unit and per reuse unit**: body-bound content in the character package; separately equipped
   or reusable content in fragments; **bundles** let a person author once and submit several packages approved
   atomically. OMOBA 1.0: the character package stays one VRM with its clips; gear is one `asset-pack` GLB per set, the
   proven Wildspark set, which later also fills the rocket and trap slots.
7. **Runtime composition per slot**: equipped fragment → character package → default; per-slot fallback; `mustFill`
   sets all or none; wires carry content-addressed release references.
8. **Validation**: one core rule vocabulary (`pack`, `rig`, `clip`, `asset`, `socket`, `rights`) with contract
   parameters; namespaced game rules with `checkedBy`, run only in the game's sandboxed builder and its runtime, deferred
   in tools that lack them; unknown core ids fail closed; reference implementations in TypeScript (MIT) and Rust (MIT OR
   Apache-2.0) with core fixtures in a protocol repository and profile fixtures in each game; strict at the gates,
   lenient at runtime.
9. **Messages**: HTTP + JSON with `Idempotency-Key` and RFC 9457 errors; **CloudEvents 1.0** events (`io.ekza.gp.*`)
   from a transactional outbox, delivered by **Standard Webhooks**-signed webhooks and a cursor **pull feed**;
   `ekza-studio-submit/v1` stays the person-present submit and gains bundles in v1.1.
10. **Auth**: project keys `ekza_pk_…` (publishable, test channel) and `ekza_sk_…` (secret, scoped); creators by Hub
    session now and a PKCE `studio-upload` token later; agents by device code; decisions only by people on Hub.
11. **Offline**: contracts committed and bundled, release snapshots pulled and pinned by SHA-256, manifests inside the
    hashed package.
12. **Rights per package and fragment**: declared in the file, verified per revision on Hub; bundle gates on all
    members; derivatives declared and licence-checked; revenue shares stored, inactive.

## Alternatives

- **A universal slot list** (one vocabulary for every game) was rejected: games differ in what they play; the closed
  list Studio has (vocabulary v1) already does not match OMOBA.
- **Separate profile documents** were rejected: two fetches, two hashes and two version lines for one game revision;
  `ext` keeps one revision and lets Hub index the core without the profile.
- **Monolithic only** was rejected: a weapon inside a body couples the body to a hero (OMOBA keeps appearance separate
  from build) and cannot be reused, reviewed or equipped alone. **Fragments only** was rejected: a body and its clips
  belong together and a person should not assemble parts; bundles give the single experience.
- **One manifest per kind** was rejected: four parsers and four rule sets for one shape.
- **Game rules as code everywhere** (including browsers) was rejected for 1.0: arbitrary code in tools and Hub; portable
  WebAssembly rule modules remain a later option.
- **Polling only** was rejected for third-party games and tools; it stays the fallback (the feed).
- **Static-token webhooks** were rejected for HMAC signatures (replay and forgery protection).
- **A registered glTF vendor extension** for the manifest was deferred: `asset.extras` already works in every loader
  and is hashed; registration is an owner question.

## Consequences

- OMOBA's in-flight C0 emits `ekza.game-contract.v1` with `ext["omoba.character.v1"]` into
  `shared/assets/catalog/game-contract.json` and uses the renamed rule ids; Studio's in-flight C1 reads one document
  schema and dispatches profiles by `ext` key (its model is already game-agnostic). Both deltas land before the C0
  freeze (about one agent-day each).
- A new public repository holds the schemas, the core fixtures and the TypeScript and Rust reference implementations;
  the SDK gains a `gp` feature; Hub gains generic contract storage, requirements derived from offers, a builder table
  instead of a CHECK constraint, bundles, an outbox, webhooks, a feed, project keys and usage reports.
- OMOBA's asset-catalog requirements become asset slots (gear first; rocket and trap when the engine loads them);
  existing gun sets stay valid through name binding.
- ADR 0010 §1 is amended when C2 lands (T1 = `animation-pack`, T2 key = `ekza_package_v1`); ADR 0024's names are
  amended as listed in CHARACTER-CONTRACT-SPEC v0.2 §15.
- Owner decisions: the repository and licences, outbound webhooks, usage aggregates, onboarding of third-party games,
  the glTF vendor prefix, revenue-share storage (`GP-Q1` … `GP-Q12`).
