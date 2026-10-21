# ADR 0010 — Ekza integration tiers and the `ekza:animation` contract

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [03](../research/03-ekza-reuse-audit.md) §2.1, §5–§7, §9 (R7, R12), [02](../research/02-formats-gltf-vrm.md)
  §5.5, §14, [06](../research/06-collaboration.md) §11, [09](../research/09-ui-ux-spec.md) §10.5,
  [04](../research/04-web-stack.md) §13; the registry's profile checks (issue codes `source_too_large`,
  `source_format`, `source_humanoid`, `rendition_format`, `rendition_external_data`, `rendition_skeleton`,
  `rendition_animation`).

## Context

Ekza Studio should help the Ekza ecosystem: export formats today, upload later. Facts from research 03: Ekza
Space plays embedded `idle`/`walk` from an avatar VRM; OMOBA admits avatars with five named clips but plays its
own retargeted library for VRM humanoids; the registry knows only `avatar` and `weapon` kinds and rejects any JSON
key named `uri`; no Ekza service accepts animation assets yet. `@ekza/avatar-renderer` peers `three <0.186` and is
not on npm. The design review found that the clip metadata contract (`contactSeconds`, `tags`, `derivedFrom`)
could not be authored because clips had no such fields, that lint codes did not match the registry's issue codes,
that `model/vrma` has no registry or IANA meaning, and that the Hub → Studio direction had no contract.

## Decision

1. **Tiers** (the labels T0–T3 are reserved for Ekza integration; plugin trust levels are named data / trusted /
   sandboxed, ADR 0008)

   | Tier | Deliverable | Ecosystem change | Milestone |
   |---|---|---|---|
   | **T0** | `.vrm`/`.glb` with appended slot-named clips (surgeon), `.vrma` per clip, animation-only `.glb`, Tier-0 lints, export profiles and metadata | none | **MVP** |
   | **T1** | Typed asset `ekza:animation:<uuid>`, profile `universal / vrma-humanoid-v1` (builder `none`, format `vrma`, ≤ 8 MiB, 1–32 animations) | registry migration + validator + Hub UI; SDKs; Space/OMOBA consumers | M4a |
   | **T2** | Avatar-owned animation sets: `asset.extras.ekza_animation_set_v1` slot → clip in `desktop / humanoid-glb-v2` | OMOBA reads aliases from the hashed asset | M4a+ |
   | **T3** | "Publish to Ekza" from Ekza Studio (device-code login, new `studio-upload` scope) | registry account scope | M4a |

2. **Metadata contract** (written by every exporter in the MVP), inside `asset.extras` so it is covered by the
   content hash (types: MVP-SPEC §4.4 `EkzaAnimationV1`, `EkzaClipMetaV1`):

   ```json
   "ekza_animation_v1": {
     "schema": 1, "rig": "vrm-humanoid" | "gltf-nodes",
     "clips": [{ "index": 0, "name": "wave", "slot": "wave" | null, "loop": false, "fps": 30,
                 "durationSeconds": 1.6, "rootMotion": "hips" | "in-place",
                 "contactSeconds": 0.4 | null, "tags": ["emote"],
                 "derivedFrom": [{ "title": "Universal Animation Library", "author": "Quaternius",
                                   "license": "CC0-1.0", "sourceSha256": "<hex>" | null }],
                 "redistributable": "yes" | "no" | "unknown" }],
     "provenance": { "tool": "ekza-animator", "toolVersion": "0.1.0",
                     "projectSha256": "<hex|null>", "baseSha256": "<hex|null>",
                     "derivedFrom": [ /* union of the clips' derivedFrom */ ] }
   }
   ```

   Rules: no key named `uri` in any letter case anywhere; lowercase hex SHA-256; deterministic key order; no
   timestamps. `ekza_animator_bake_v1` appears only in surgeon outputs (ADR 0005). All downloads use MIME
   **`model/gltf-binary`** (the registry maps `vrma` to it; no `model/vrma` type exists).
3. **Authoring the metadata.** `ClipRecord` carries `contact` (clip frames → `contactSeconds`), `tags` and
   `provenance { derivedFrom[], redistributable }`, editable in the clip settings. Import fills provenance
   (research 03 R7, §7.5 item 5): embedded clips inherit the avatar's VRM meta (title, authors, licence,
   `allowRedistribution`); clip or node names matching `/mixamo/i` force `redistributable: 'no'`; VRMA or GLB of
   unknown origin get `'unknown'`; bundled samples pass their known licence; new clips are `'yes'` with an empty
   `derivedFrom`.
4. **Lints and export profiles.** Lint codes use the registry's issue code where one exists, otherwise a
   namespaced code. Export profiles are **data** (`ExportProfileDef`, same shape as the registry's
   `GET /v1/profiles/{platform}/{profile}`; static offline copies ship in `io`): built-ins `ekza/space-avatar-v1`
   (`universal/vrm-humanoid-v1`, bake, ≤ 50 MiB), `ekza/omoba-humanoid-v1` (`desktop/humanoid-glb-v1`, bake,
   required clips `idle, walk, attack, cast, death`), `ekza/vrma-humanoid-v1` (proposed T1 profile, VRMA, ≤ 8 MiB)
   and `local/generic`.

   | Code | Rule | Local | Ekza profile |
   |---|---|---|---|
   | `rendition_external_data` | no `uri` key anywhere (any case); no external buffer or image | error | error |
   | `rendition_format` | original `VRM`/`VRMC_vrm` block value-equal; never both VRM versions | error | error |
   | `source_too_large` | file size ≤ profile `maxBytes` (one code for every export kind; v0.3 integration, WP-4 W4-2) | warning | error |
   | `source_humanoid` | humanoid map with `hips` (VRM/VRMA profiles) | error | error |
   | `rendition_animation` | the profile's required clips exist and every channel targets a node | — | error |
   | `rendition_skeleton` | skins with valid joints (bake profiles) | error | error |
   | `ekza.chunk-alignment` | one JSON chunk then at most one BIN chunk, 4-byte aligned, lengths consistent | error | error |
   | `ekza.single-buffer` | exactly one embedded buffer | warning | error |
   | `ekza.json-chunk-size` | JSON chunk ≤ 4 MiB (OMOBA); > 8 MiB is always an error | warning | error |
   | `ekza.extensions-required` | `extensionsRequired ⊆ {KHR_materials_unlit, KHR_texture_transform}`, never extended by us | warning | error |
   | `ekza.slot-name` | exported names match `[a-z][a-z0-9_]{0,31}`; `tpose` never exported | warning | error |
   | `ekza.unique-names` | clip names unique, case-insensitive (local: warning since the v0.3 integration, MVP-SPEC §4.11.13, WP-4 W4-1) | warning | error |
   | `ekza.hips-only-translation` | humanoid clips translate only hips | warning | error |
   | `ekza.unit-quaternions` | rotation outputs unit length (1e-6) | error | error |
   | `ekza.provenance-unknown` | a clip's `redistributable` is `unknown` | warning | warning |
   | `ekza.non-redistributable` | a clip's `redistributable` is `no` | warning | error |
   | `ekza.height-scale-range` | `extras.ekza.avatar.heightScale` within 0.5..2 (Space/realtime clamp, 03 R12) | warning | warning |
   | `vrma.*` | no scale, hips-only translation, no eyes, exactly one animation, `specVersion "1.0"`, channels only on humanoid nodes | error | error |
   | `surgeon.matrix-node` / `surgeon.no-rollback` / `surgeon.preexisting-missing-track` | ADR 0005 | error / warning / warning | same |
   | `bake.large-rotation-step` | consecutive samples > 90° apart | warning | warning |
   | `bevy.*` (M1-stretch) | ancestors of animated nodes named; no duplicate sibling names on animated paths | warning | warning |

5. **Clip slot vocabulary v1**: `idle, walk, run, attack, cast, death, jump, hit, stagger, crouch, fly, climb,
   swim, dance, wave, emote, celebrate`; `tpose` is reserved and never exported. Clip display names are free
   text; the exported glTF animation name is the slot when set, else the sanitized clip name.
6. **Interop warnings** (informational, MVP): "Ekza Space uses only `idle` and `walk`"; "embedding any clip makes
   the current Space renderer skip its shared idle/walk library"; "OMOBA admits but does not play custom humanoid
   clips yet"; "plain GLB consumers do not evaluate VRMC_node_constraint"; VRM meta licence gate for baking a
   modified avatar (`modification: prohibited` or `allowRedistribution: false` → explicit acknowledgement;
   separate VRMA always allowed).
7. **No runtime dependency on `@ekza/avatar-renderer` or `@ekza/stellar-sdk` in the MVP.** Small MIT helpers are
   copied with attribution (ARCHITECTURE §13). A "Preview as Ekza Space" panel (M2c) first **emulates** Space's
   rules in our viewport (visible-bounds height normalization with `heightScale` clamped to 0.5..2, `idle`/`walk`
   selection, the shared-library gate). Using the real renderer requires these upstream changes: an injectable
   `DRACOLoader`/decoder path (no gstatic CDN), npm publication or a tagged tarball (today a git dependency built
   in `prepare`, which pnpm 10 blocks and `minimumReleaseAge` does not cover), and a three peer range `<0.187`.
8. **Hub → Studio (contract defined now, implemented in M4a)**: deep link
   `/editor?open=ekza:avatar:<uuid>&sha256=<hex>` downloads the avatar's rendition through the registry and
   verifies its SHA-256 before loading; an iframe embed uses a versioned `postMessage` protocol
   `ekza-studio-embed/v1`: host → editor `open { asset, sha256 }`, editor → host `ready`,
   `exported { kind, fileName, sha256, bytes }` (transferable), `error { code, message }`, with origin allow-lists
   on both sides. Owned jointly with Ekza Hub (React 18 stays isolated behind the iframe, research 04 §13).
9. The Ekza Studio **project file** is not uploaded in T1; storing it as a private registry source object is an owner
   question (Q-EKZA-7).

## Alternatives

Waiting for registry support before shipping any Ekza feature delays value; T0 works today in Space. Defining a
new JSON clip format for Ekza was rejected: VRMA is the standard interchange (02 Q3, 03 §0). A bespoke
`model/vrma` MIME was rejected: no registry or IANA meaning.

## Consequences

- MVP exports already carry everything T1 validators need (metadata incl. provenance, profile-clean containers,
  registry-aligned issue codes).
- Upstream PRs suggested (owner decision, DECISIONS-OPEN §C): renderer drops the `embedded.length === 0` gate;
  injectable decoder path; npm publication; three peer `<0.187`; Hub adds `cast` to its preview vocabulary;
  the embed protocol above.
- T1/T3 (M4a) depend only on M1 plus work in other repositories, so they are scheduled independently of
  collaboration auth (M4b); tracking issues in the registry, SDK and game repositories open during M2.
