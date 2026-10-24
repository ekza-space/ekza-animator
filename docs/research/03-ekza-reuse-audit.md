# 03 — Ekza codebase reuse & integration audit

- Date: 2026-10-17
- Scope: what Ekza Animator can reuse from existing Ekza 3D code without lowering quality, which conventions its exports must follow, and how to connect "upload animation to Ekza" to the typed-asset lifecycle.
- Method: read-only review of the sibling repositories listed in §1, plus three small local experiments run in a scratch directory and not committed: a glTF Transform round trip of a VRM 1.0 file, an inspection of `@pixiv/three-vrm-animation@3.5.5`, and npm/crates.io metadata queries. File references take the form `repo/path:line` and are relative to the Ekza umbrella checkout.
- Status: research input for the architecture and roadmap documents. Nothing in it is decided until the owner accepts it.

---

## 0. TL;DR

1. **Reuse ideas and small pure functions. Do not use the Ekza runtime packages as the editor's foundation.** `@ekza/avatar-renderer` is a good *viewer*: it normalizes height, owns its mixer, parses the file twice and pulls the Draco decoder from a CDN. It is also pinned to `three >=0.137 <0.186`, while our target is `three@0.186.1`. The Animator needs a document model with an exact round trip, which is a different job. Copy and adapt about six MIT functions (with attribution). Treat the rest as reference material.
2. **Verified blocker for "bake into VRM": glTF Transform 4.5.1 silently drops `VRMC_vrm` on read and write.** It logs `Missing optional extension, "VRMC_vrm"` and writes a file with no VRM metadata. The registry rejects such a file (`ekza-registry/backend/app/services/studio.py:105`), and Space and OMOBA stop treating it as a humanoid. Baking must therefore either (a) use an **append-only GLB patcher** that keeps the original JSON and BIN bytes, the same technique as OMOBA's `scripts/retarget_animations.py`, or (b) register pass-through extension classes for every VRM extension. Recommendation: (a) for VRM/VRM-derived files, glTF Transform for plain glTF and for VRMA.
3. **No Ekza game uses user-authored humanoid clips from an uploaded avatar today, except Ekza Space for `idle` and `walk`.** OMOBA detects VRM metadata and retargets its own motion library (`omoba-bevy/client/src/player/animation.rs:499-503`). It plays embedded clips only through operator-configured `animation_aliases` (`omoba-bevy/client/src/combat_visuals.rs:698`). The `humanoid-glb-v1` admission check needs five named clips to *exist*. It does not need them to be played. A real integration needs a new typed kind plus game work (§7).
4. **Proposed integration:** a new typed asset `ekza:animation:<uuid>` with the protocol-owned profile `universal / vrma-humanoid-v1` (builder `none`, format `vrma`, ≤ 8 MiB). Metadata goes in hashed `asset.extras.ekza_animation_v1`, following the precedent of `ekza_handheld_v1`. Tier 0, which works with no ecosystem change, exports `.vrm` with appended clips and `.vrma` files for manual upload or for use in Space.
5. **Collaboration:** `ekza-rust-server` cannot host collaborative editing as it stands. It is Socket.IO, uses whole-state last-writer-wins plus `serverRevision`, ties rooms to Solana space NFTs, keeps state in one process and has no license file. Plan on Yjs (`yjs@13.6.33`, MIT): `@y/websocket-server@0.1.5` or `@hocuspocus/server@4.7.1` for the MVP, with `yrs@0.28.0` (MIT, Rust) as the long-term path. That can live as a separate axum service that reuses only the Ekza *account-session protocol*.

---

## 1. What was audited

| Repository | Commit (date) | License | Stack relevant to us |
| --- | --- | --- | --- |
| `ekza-avatar-renderer` | `33c417c` (2026-08-26) | MIT | three 0.185.1 (dev), peer `three >=0.137 <0.186`, R3F 8.18.0 (dev), peer `@react-three/fiber >=8.8.0 <10`, React 18.3.1 (dev), peer `react >=18 <20`, `@pixiv/three-vrm` 3.5.5 (exact dep), tsup, vitest 4.1.10. **Not on npm**: consumed as a git dependency pinned by commit and built in `prepare`. |
| `core` (Ekza Space web) | `acbc034` (2026-09-22) | MIT | Vite 6, React 18, R3F 8.18.0, drei 9.122.0, Rapier 1.5.0, three 0.185.1, Socket.IO client |
| `ekza-registry` | `90e7850` (2026-10-05) | **No license file** (treat as all rights reserved for copying) | FastAPI + Supabase SQL migrations; Studio web on Remix with R3F 8, React 18.3.1, three 0.185.1 |
| `omoba-bevy` | `0c0585c` (2026-10-11) | MPL-2.0 (client/passport/scripts), AGPL-3.0-only (server); see its `LICENSING.md` | Bevy 0.19.1; Python stdlib build scripts |
| `ekza-bevy-sdk` | `a9a253c` (2026-10-05) | MIT OR Apache-2.0 | Rust, Bevy 0.19.1, v0.9.0 |
| `ekza-stellar-sdk` | `41882a7` (2026-09-21) | MIT | TS, tsup. **Not on npm**: git dependency. Root peer `@solana/web3.js ^1.90.0` (not optional) |
| `ekza-rust-server` | `fe105b2` (2026-09-21) | **No license file** | axum 0.8.8, socketioxide 0.18.1, tokio |
| `doc` (public docs) | `fc65841` (2026-10-06) | not declared in repo | Docusaurus |

---

## 2. Reuse table

Legend: **DEP** = depend on the package as is. **COPY** = copy and adapt into the Animator under MIT, keeping an attribution header with the source repo and commit. **REF** = read for the algorithm or contract, write our own. **NO** = do not use.

### 2.1 `ekza-avatar-renderer` (MIT, same owner)

| Module / symbol | Decision | Justification |
| --- | --- | --- |
| `AvatarModel` (`src/AvatarModel.tsx:74`) | **NO** for the editor; **DEP later** for a "Preview as Ekza Space" panel | It owns an `AnimationMixer`, so the editor cannot drive time. It rescales the model to `targetHeight` (`AvatarModel.tsx:173-189`), which conflicts with authoring in real units. It parses the same URL twice: `useLoader(GLTFLoader)` plus `buildVrmAsset`. It supports only `idle`/`walk`/an exact name. A parity preview panel *should* use the real renderer so creators see exactly what Space shows. That requires the peer range to be widened to `three <0.187` first (§3). |
| `AvatarPreview` (`src/AvatarPreview.tsx:157`) | **NO** | Has its own `WebGLRenderer` and OrbitControls, so it is a separate canvas and cannot join our viewport system. |
| `detectVrmKind(json)` (`src/vrm.ts:30`) | **COPY** | 6-line pure classifier (`VRM` → vrm0, `extensionsUsed` contains `VRMC_vrm` → vrm1). Registry (`profile_checks.py:47` `vrm_format`) and OMOBA (`passport/src/humanoid.rs` `parse_bones`) agree, except that OMOBA also rejects files that declare both. Add that check. |
| `AVATAR_VRM_LOADER_OPTIONS = { autoUpdateHumanBones: false }` (`src/vrm.ts:47`) | **REF** (important) | Documents the key three-vrm pitfall: embedded clips target **raw** glTF nodes, and `vrm.update()` would overwrite them from the normalized rig. The editor must choose one authoritative rig per mode (§5.2). |
| Draco loader with decoder from `https://www.gstatic.com/draco/versioned/decoders/1.4.3/` (`src/vrm.ts:37`) | **NO** (pattern only) | An OSS desktop-class tool should not depend on a third-party CDN at runtime (privacy, offline use, CSP). Self-host the decoder from `three/examples/jsm/libs/draco/`. |
| `AvatarBufferCache` (`src/bufferCache.ts`, 32 MiB LRU) | **REF** | A good concurrent-dedupe LRU, but the editor holds one or two documents and should keep the original bytes in its own document store (needed for append-only bake and hashing). |
| `readEmbeddedAvatarHeightScale` (`src/normalization.ts:42`) | **COPY** | It defines the `extras.ekza.avatar.heightScale` contract that the Animator must preserve and display (§6.4). |
| `normalizeAvatarBounds` (`src/normalization.ts:60`) | **COPY** (for the preview/validation panel only) | Lets us *show* the height Space will produce. Never apply it to the edited scene. |
| `measureAvatarSpatialBounds` (`src/bounds.ts:94`) | **COPY** | Correct skinned and morph-aware bounds. It handles both `applyBoneTransform` and the older `boneTransform`. Use it for camera framing, the "height check" and ground-contact checks. Runs on the CPU per vertex, so use it on demand and never per frame. |
| `fitAvatarPreviewCamera` (`src/previewFraming.ts:33`) | **COPY** | Framing for fixed cameras and thumbnails. Covers portrait and landscape and is guarded against degenerate input. |
| `resolveDrivenParentBone`, `sortBonesByDepth` (`src/humanoidRetarget.ts:147`, `:228`) | **COPY** | Pure helpers over `VRMHumanBoneParentMap`. Useful for retargeting and for building the humanoid control-rig hierarchy when optional bones (`upperChest`, `neck`, `shoulder`, `toes`) are missing. |
| `flipYawQuaternion` / `flipYawPosition` (`src/humanoidRetarget.ts:122-138`) | **REF** | The conversion between VRM 0.x and VRM 1.0 conventions (negate x and z). `@pixiv/three-vrm-animation` does the same thing internally (§5.5). |
| `SerializedHumanoidClip`, `retargetHumanoidClip` (`src/humanoidRetarget.ts:23-39`, `:279`) | **NO** as authoring format; **REF** for math | It stores rotations as **int16-quantized** quaternions (`QUAT_SCALE = 32767`, `:87`) resampled to a fixed fps. That is fine for playback and lossy for editing, since every reload drifts and tangent intent is lost. Tracks bind by `node.uuid`, which is runtime-only. VRMA is the standard interchange for the same idea. |
| `sharedAnimationData.ts` (5 clips: `idle`, `walk`, `attack`, `cast`, `death`; about 95 KB, baked from Quaternius UAL, CC0) | **REF** | Use the CC0 *source* instead. That is the Quaternius Universal Animation Library glTF checked into `omoba-bevy/assets-src/animations/` (13+ clips at full rate). Ship it as a starter library converted to VRMA by our own pipeline. |
| `useSharedAvatarClips` `autoUpdateHumanBones` toggle (`src/sharedAnimations.ts:150-157`) | **REF** | The correct pattern for playing normalized-rig clips (VRMA) on a VRM in Space. It is needed for the Space integration (§7.4). |
| `scripts/bake-shared-animations.mjs` | **REF** | Its world-delta bake math (`delta = R_world(t) · R_world_rest⁻¹`, `:305`) and its VRM 0.x thumb alias table (`:24`) are worth reading. Its hand-rolled GLB reader assumes non-interleaved data (`:76`), ignores sparse accessors and cannot read `EXT_meshopt_compression`. Use glTF Transform for reading. |
| Tests (`test/*.test.ts`) | **REF** / reuse **fixtures** | `vrm1Retarget.test.ts` already runs a node-only GLTFLoader with an image-decoding stub, which is a pattern we need for headless export tests. The fixture `test/fixtures/vrm1-sample.vrm` is CC0 (NeonGlitch86 collection, Open Source Avatars) and safe to vendor with attribution. |

### 2.2 `core` (Ekza Space, MIT)

| Module | Decision | Justification |
| --- | --- | --- |
| `src/engine/avatar/height.ts` (`DEFAULT_WORLD_AVATAR_HEIGHT = 2.5`, scale clamps `0.5..2` / instance `0.1..4`) | **REF** (contract) | It defines how Space sizes avatars, which feeds §6.4. |
| `src/engine/types.ts:30` `PlayerAnimationState = "idle" \| "walk"` | **REF** (contract) | Space triggers only these two states. `components/character.tsx:542,573` passes only `animState`. |
| `src/engine/player/*`, `runtime/PhysicsWorldViewport.tsx` (Rapier) | **NO** | Gameplay and physics are irrelevant to an editor. |
| `src/engine/runtime/WorldViewport.tsx` | **NO** | 36 lines of `KeyboardControls` + `Canvas`. Our multi-viewport layout needs `drei` `<View>` / scissor rendering instead. |
| `features/world-builder/RoomObjects.tsx` (`TransformControls`, `fixRedTranslateArrowDirection` at `:52` mutates drei's private `_gizmo`) | **NO** | It patches private internals and is tied to R3F 8 / drei 9. Professional DCC-grade manipulators (rotate rings, view-plane handle, trackball, local/world/gimbal modes) need our own gizmo layer. |
| `features/world-builder/useRoomProgram.ts` + `realtime/protocol.ts` (whole `RoomProgramState`, `updatedAt`, server `stale_revision`) | **REF** (anti-pattern for us) | Whole-document last-writer-wins with optimistic revision checks. It is fine for rooms and wrong for two people keying the same timeline (§8). |
| `assets/avatarAssets.ts` (`ipfs://`, `ar://`, `blob:`, gateways) | **COPY** (optional) | Small URL resolver. Useful if the Animator opens Ekza avatars by IPFS URI. |
| `features/avatar/purchasedAvatarPolicy.ts:9-10`, `features/profile/studioAvatar.ts:2` | **REF** | Space accepts only `vrm-humanoid-v0` paired with format `vrm0` and `vrm-humanoid-v1` paired with `vrm1`, up to 50 MiB. |

### 2.3 `ekza-registry` (no license file, so integration target only)

| Module | Decision | Justification |
| --- | --- | --- |
| `backend/app/services/studio.py:45` `validate_model`, `:81` `check_embedded` | **REF** (contract we must pass) | GLB v2 with exact length, JSON chunk ≤ 8 MiB and 4-byte aligned, exactly one embedded buffer, BIN chunk 4-byte aligned. It rejects **any** JSON key named `uri` in any letter case, **anywhere**, including inside `extras`. For avatars it requires VRM `humanBones`, `meshes` and `skins`. |
| `backend/app/services/profile_checks.py:118` `check_rendition` | **REF** | Required clips are checked by `name` only, plus `channel.target.node` bounds. |
| `backend/app/services/handheld.py:67` / `handheld_checks.py` | **REF** (template) | The pattern to copy *in the registry* for a new animation validator: bounded JSON, extension allow-list, decoded-bytes budget (`MAX_DECODED_BYTES = 64 MiB`, `MAX_ACCESSOR_COUNT = 1,000,000`), and hashed metadata in `asset.extras.<name>_v1`. |
| `supabase/migrations/202609190001_game_integration.sql:28-42, 427-441` and `202610010001_typed_assets.sql:3-13` | **REF** | Profile documents and check constraints that must be extended (§7.2). |
| `web/app/lib/studio-assets.ts:3-8`, `web/app/components/3d/animations.ts`, `UploadedModel.tsx:75-80` | **REF** | Upload kinds (avatar = `.vrm` ≤ 50 MB, weapon = `.glb` ≤ 8 MB) and the preview's **clip-name allow-list** (§5.4). |
| Any code copy | **NO** | No license is declared. Ask the owner to add one (the ecosystem standard appears to be MIT) before any snippet moves into the OSS Animator. |

### 2.4 `omoba-bevy` (MPL-2.0 / AGPL-3.0-only, the consumer)

| Module | Decision | Justification |
| --- | --- | --- |
| `passport/src/lib.rs:131` `validate_humanoid_profile` | **REF** (contract) | GLB JSON, skins with valid joints, no external `uri` in `buffers`/`images`, and clips `idle`, `walk`, `attack`, `cast`, `death` (`:171`) whose channels target valid nodes. |
| `passport/src/humanoid.rs` (`HumanoidRig::from_glb`, limits at `:17-19`, `validate_required_extensions` at `:322`, `required_bones` at `:377`, `semantic_parent`) | **REF** (contract) | JSON ≤ 4 MiB, GLB ≤ 50 MiB, `extensionsRequired` ⊆ {`KHR_materials_unlit`, `KHR_texture_transform`}, ≤ 64 human bones, VRM 1.0 `specVersion == "1.0"`, VRM 0.x `specVersion` starting `0.`, no file declaring both. Required bones: hips, spine, head, both arms (upper/lower/hand), both legs (upper/lower/foot), plus chest and neck for VRM 0.x. |
| `client/src/humanoid/retarget.rs:22` `RetargetBasis::new` | **REF** (math) | Facing alignment derived from rest geometry: up = head − hips, side = leftHand − rightHand, forward = side × up. Hips scale = hips-above-feet ÷ source hips-to-feet. It is robust to arbitrary node orientations, and our retarget preview should mirror it so Animator previews match OMOBA. |
| `client/assets/animations/humanoid-motion-v1.json` (schema 1: `bones`, `clips[*].{times, world_rotation_deltas, hips_world_deltas, looping}`, `contacts`) | **REF** | Conceptually the same data as VRMA (world rotation deltas from a T-pose rest). It defines the **`contact`** concept (seconds to the impact pose) that our metadata should carry (§7.1). The data is derived from CC0 source, but some rows are project-authored edits, so do not copy the file. Re-derive from CC0. |
| `scripts/retarget_animations.py` (append-only GLB injection, marker `asset.extras.omoba_retarget`, `:46`, `:452-470`) | **REF** (technique to replicate) | Proven way to add clips without rewriting VRM data. We reimplement it in TS. MPL-2.0 is file-level copyleft, so copying would force that file to stay MPL. |
| `scripts/ekza_build_rendition.py`, `ekza_publish.py:67, :348` | **REF** | The builder contract (`--source --output-dir`, one JSON line on stdout, exit 0/2) is the model for any future animation builder. |
| `client/src/player/animation.rs:499-546, 612-640` | **REF** (integration gap) | Shows when embedded clips are used (non-VRM models: matched by substring `idle`, `walk`/`run`/`sprint`/`jog`, `attack`, `cast`/`spell`, `death`/`die`) and when they are ignored (VRM humanoids). |

### 2.5 SDKs and server

| Module | Decision | Justification |
| --- | --- | --- |
| `ekza-stellar-sdk/src/passport/index.ts:119` `downloadVerifiedRendition` | **DEP** (git-pinned subpath import `@ekza/stellar-sdk/passport`) | It has no imports, verifies sha256 and size, and supports `AbortSignal`. Good for "Open avatar from Ekza". |
| `ekza-stellar-sdk/src/catalog/index.ts:187` `RegistryClient` (`/v2/avatars`, device-code login `/v1/account/device`, `/poll`, `/session`, `/library`) | **DEP after an upstream PR** | Hard-coded to Space (`SPACE_PROFILE = "vrm-humanoid-v1"`, and `validateRendition` at `:67` requires `platform === "universal"`). It needs a generic `assets({kind, project, platform, profile})`. The root `peerDependencies["@solana/web3.js"]` is not optional, so npm 7+ installs Solana web3 into an animation tool. Mark it optional upstream. |
| `ekza-stellar-sdk/src/avatars` (Metaplex/Solana NFT decoding) | **NO** | The Solana layer is frozen (ADR 0001) and out of scope for the Animator. |
| `ekza-bevy-sdk/src/assets.rs` (`AssetKind`, `CatalogAsset`, `StoreAsset`, `asset_slug`, `validate_item`) | **REF** (Rust contract, must be extended) | `AssetKind` has only `Avatar` and `Weapon`, and unknown kinds fail closed (`:18-24`). `validate_item` requires `rendition.format == "glb"` (`:128` onward), so VRMA would fail. |
| `ekza-rust-server` (Socket.IO presence/rooms, `realtime/ekza.rs` account plus approved-avatar verification) | **REF** | See §8. Reuse the *protocol idea* that the server verifies an Ekza account session and approved catalogue IDs itself. Do not reuse the code: there is no license, and it is coupled to Solana room ownership. |

---

## 3. Version and compatibility matrix

| Package | Animator target (2026-10-17) | Ekza avatar-renderer | Space (`core`) | Studio web | Consequence |
| --- | --- | --- | --- | --- | --- |
| `three` | 0.186.1 | peer `>=0.137 <0.186`; dev 0.185.1 | 0.185.1 | 0.185.1 | Installing the renderer next to three 0.186.1 gives an `ERESOLVE` peer conflict on npm. pnpm warns and the result is untested. **Action:** upstream PR widening to `<0.187` plus CI against 0.186.1, *or* keep the renderer out of the Animator until needed. |
| `@react-three/fiber` | 9.8.2 (peer `react >=19 <19.4`, `three >=0.156`) | peer `>=8.8.0 <10`; dev 8.18.0 | 8.18.0 | 8.18.0 | The renderer's API surface (`useFrame`, `useLoader`) exists in R3F 9, so it is compatible in principle but never tested on 9. |
| `react` | 19.3.1 | peer `>=18 <20`; dev 18.3.1 | ^18.2 | 18.3.1 | OK. |
| `@react-three/drei` | 10.7.9 (peer R3F ^9, React ^19) | – | 9.122.0 | ^9.122.0 | No drei code can be shared across major versions. Do not copy Space/Studio drei usage verbatim. |
| `@pixiv/three-vrm`, `-animation`, `-core` | 3.5.5 (peer `three >=0.137`, MIT) | 3.5.5 | via renderer | via renderer | Same major version everywhere. Pin exact `3.5.5` to match the renderer and avoid two three-vrm copies. |
| `@gltf-transform/core` / `extensions` | 4.5.1 (MIT) | – | – | – | Drops VRM extensions unless pass-through classes are registered (§5.1). |
| Bevy (games) | – | – | – | – | OMOBA and `ekza-bevy-sdk` use 0.19.1. The glTF loader there sees only standard glTF animation. VRMA would need a game-side parser (§7.4). |

Rule for the Animator: **one copy of `three` and one copy of three-vrm in the bundle.** Anything from Ekza that we depend on must declare them as peers. The renderer already does: three-vrm is an exact *dependency* there, three is a peer.

---

## 4. Licenses and provenance of reusable assets

| Asset | License | Use in Animator |
| --- | --- | --- |
| Quaternius Universal Animation Library (source glTF in `omoba-bevy/assets-src/animations/`) | CC0 1.0 | Starter clip library: convert to VRMA and credit it as good practice. |
| `vrm1-sample.vrm` (NeonGlitch86, Open Source Avatars) | CC0 | Test fixture and default demo avatar. |
| Open Source Avatars collections (100Avatars R1–R3, Grifters Squaddies, ToxSam, Halloween Rising, Xmas Chibis, NeonGlitch86) | CC0 | Demo and fixtures allowed. |
| VIPE Heroes Genesis (in the same dataset) | CC-BY 4.0 | Avoid as a default. If used, it needs attribution UI. |
| OMOBA-derived motion JSON / project-edited motions | MPL-2.0 project edits on top of CC0 (see `LICENSING.md`) | Do not copy. Re-derive from CC0. |
| Third-party clips users import (e.g. clips from a web auto-rigging service) | Often **not redistributable** as standalone animation files | The Animator must record provenance and warn before an Ekza upload (§9, R7). |

---

## 5. Verified technical findings that shape the architecture

### 5.1 glTF Transform drops VRM extensions (verified locally)

Experiment: `@gltf-transform/core@4.5.1` + `ALL_EXTENSIONS`, `NodeIO.readBinary` followed by `writeBinary` on the CC0 VRM 1.0 fixture.

```
Missing optional extension, "VRMC_vrm".
before extensionsUsed [ 'KHR_materials_specular', 'VRMC_vrm' ]
after  extensionsUsed [ 'KHR_materials_specular' ]
before root ext [ 'VRMC_vrm' ]   after root ext [ ]
nodes 67 67   size 1590520 -> 1574936
```

The same happens to `VRM` (0.x), `VRMC_springBone`, `VRMC_materials_mtoon`, `VRMC_node_constraint` and others. `three`'s `GLTFExporter` also cannot carry VRM. Consequences:

- **"Bake into VRM" must be append-only.** Parse the original GLB and keep `json` (as a JS object, edited only by appending to `accessors`, `bufferViews` and `animations`, and by setting `asset.extras` markers). Keep the original `BIN` bytes untouched and append animation data after 4-byte padding. Then update `buffers[0].byteLength` and the chunk lengths. Index-based VRM references stay valid because no existing index moves. This is exactly what `omoba-bevy/scripts/retarget_animations.py` does (`BinAppender`, `rollback_to_baseline`).
- **Idempotency marker:** write `asset.extras.ekza_animator_bake_v1 = { baseAnimations, baseAccessors, baseBufferViews, baseBinLength, baseSha256 }`. A re-bake first rolls back to that baseline. Keep the key distinct from OMOBA's `omoba_retarget`, because the OMOBA builder will run after us on the same bytes.
- glTF Transform remains the right tool for **plain glTF** and for **writing VRMA**. Implement a small `VRMCVrmAnimation` Extension class (root-level `humanoid.humanBones[*].node`, `expressions`, `lookAt`) so node indices are remapped correctly.

### 5.2 Raw-bone versus normalized-bone animation in three-vrm

- Embedded glTF clips in a VRM target **raw** nodes. The renderer therefore loads with `autoUpdateHumanBones: false` (`ekza-avatar-renderer/src/vrm.ts:47`).
- VRMA clips and the Ekza shared library target **normalized** bones (`humanoid.getNormalizedBoneNode`) and need `autoUpdateHumanBones: true` (`sharedAnimations.ts:150-157`).
- Recommendation for the Animator data model: author humanoid motion on the **normalized rig** (VRM T-pose rest with identity local rotations, so it is engine-independent, maps 1:1 to VRMA and makes the controls' rest pose trivial). Then **bake to raw nodes** only when exporting into a VRM/GLB. Baking means sampling, per frame, the raw node local TRS after `vrm.humanoid.update()`. Non-humanoid bones (skirts, tails, accessories, spring-bone chains) get their own raw-node tracks and appear only in VRM/GLB exports, never in VRMA.

### 5.3 OMOBA ignores embedded humanoid clips

`client/src/player/animation.rs:499` sets `is_humanoid` when the source has a `VRM` or `VRMC_vrm` extension. That holds for every Studio `humanoid-glb-v1` rendition, because the builder keeps VRM in `extensionsUsed` (`scripts/convert_vrm_to_glb.py` header). In that case the game calls `runtime.ensure(...)`, which retargets `humanoid-motion-v1.json`. Embedded clips are used only through `animation_aliases` in the operator-controlled combat-visuals config (`combat_visuals.rs:698-724`). The OMOBA builder also **appends** its own `idle`/`walk`/`attack`/`cast`/`death` after any clips already in the source. So a creator's baked clips survive in the rendition bytes and still go unused. This needs to be said plainly in the Animator UI ("Space: idle/walk used; OMOBA: not yet").

### 5.4 Studio preview shows only allow-listed clip names

`ekza-registry/web/app/components/3d/UploadedModel.tsx:75-80` filters clip names (exact, case-sensitive) against `animations.ts`:
`tpose, idle, walk, run, jump, attack, death, hit, stagger, crouch, fly, climb, swim, dance, wave, emote, celebrate`.
**`cast` is missing.** OMOBA requires it, and `ARCHITECTURE.md` already lists this as a known gap. The Animator's clip-name picker should default to this vocabulary plus `cast` (§6.3). Studio should add `cast` (a one-line PR).

### 5.5 VRMA in three.js (`@pixiv/three-vrm-animation@3.5.5`, inspected)

- Load-only: `VRMAnimationLoaderPlugin` and `createVRMAnimationClip(vrmAnimation, vrm)`. There is **no exporter**, so the Animator writes VRMA itself (glTF Transform plus a custom extension class).
- Every glTF animation in a `.vrma` becomes one `VRMAnimation` (`gltf.userData.vrmAnimations = clips.map(...)`). The spec says the first animation is the default, and other tools (UniVRM) may read only that one. **Export one clip per `.vrma`** for interoperability. Multi-clip packs are an Ekza-only option.
- Hips translation is rescaled by `humanoid.normalizedRestPose.hips.y / vrmAnimation.restHipsPosition.y`. For VRM 0.x targets, x and z are negated (rotation x/z, position x/z). VRMA is therefore canonical in VRM 1.0 space (+Z forward) and is retargeted at load.
- Spec rules ([VRMC_vrm_animation-1.0](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md)): `specVersion` must be `"1.0"`. Humanoid nodes rest in the **VRM T-pose**. Only `hips` may carry translation, and no humanoid bone may carry scale. Expression weight = node translation **x**, clamped to 0..1. `lookAt` uses a node rotation converted to yaw/pitch (extrinsic ZXY). `leftEye`/`rightEye` must not be mapped. The `.vrma` extension is recommended ([vrm.dev](https://vrm.dev/en/vrma/)).

### 5.6 Lossy representations in the ecosystem

| Where | Representation | Loss |
| --- | --- | --- |
| renderer shared library | int16 quaternions, fixed fps, constant-track collapse at ε = 4e-3 | quantization, resampling, small motions flattened |
| OMOBA motion JSON | f32 world deltas rounded to 7 decimals, 24 fps (`times[1] = 0.0416667`) | resampling |
| Any glTF export | sampled `LINEAR`/`STEP` keys | Bezier/Hermite tangent intent and Euler curves are lost |

The Animator's **own project file is the only lossless source of truth**: curves, tangents, rotation order, control rig and constraints. Every Ekza export is a derived, sampled artifact.

---

## 6. Conventions our exports must satisfy

### 6.1 Container rules (strictest rule wins across registry, OMOBA and Space)

| Rule | Value | Enforced by |
| --- | --- | --- |
| Container | glTF 2.0 **binary** (`glTF` magic, version 2, declared length = file length) | registry `studio.py:45`, OMOBA `humanoid.rs` |
| Chunks | exactly one JSON chunk followed by at most one BIN chunk, both 4-byte aligned | registry, OMOBA |
| Buffers | exactly **one** embedded buffer, `byteLength ≤ BIN length` (OMOBA allows ≤ 3 bytes of padding) | registry, OMOBA |
| External data | **no `uri` key anywhere in the JSON, in any letter case**, including `extras` and data URIs | registry `check_embedded` (`studio.py:81`) |
| JSON chunk size | ≤ **4 MiB** to pass OMOBA's local humanoid validator; hard limit 8 MiB in the registry | OMOBA `MAX_HUMANOID_JSON_BYTES`, registry `profile_checks.py:36` |
| `extensionsRequired` | ⊆ {`KHR_materials_unlit`, `KHR_texture_transform`}. Never *add* required extensions (no required Draco/meshopt/`KHR_animation_pointer`) | OMOBA `humanoid.rs:322` |
| VRM metadata | keep the **original** `VRM` or `VRMC_vrm` block byte-for-byte (append-only bake); never declare both | registry `studio.py:105`, OMOBA `parse_bones` |
| File size | avatar source ≤ 50 MiB (`EKZA_STUDIO_MAX_SOURCE_BYTES` default); proposed animation ≤ 8 MiB; thumbnail PNG ≤ 5 MiB | registry `config.py:97-98` |
| Upload filename | avatar uploads must end in `.vrm` (Studio UI check), weapons `.glb` | `web/app/lib/studio-assets.ts:3-8` |
| Determinism | same project produces byte-identical output: stable JSON key order, no timestamps in `asset.generator`/`extras` | needed so that "rendition named by content hash" dedupes (`rendition-profiles.md`) |

### 6.2 Humanoid skeleton naming

- **Canonical bone names: VRM 1.0 `VRMHumanBoneName`**, the same as three-vrm. Thumb chain: `ThumbMetacarpal → ThumbProximal → ThumbDistal`.
- VRM 0.x thumb names are shifted one joint (`ThumbProximal → ThumbIntermediate → ThumbDistal`). Map them with the alias table in `ekza-avatar-renderer/scripts/bake-shared-animations.mjs:24`. OMOBA's motion library uses the 0.x-style names and its retargeter adapts VRM 1.0 thumbs (`humanoid.rs` doc comment on `HumanoidRig::bones`).
- Required for OMOBA runtime binding: `hips, spine, head, left/right UpperArm/LowerArm/Hand, left/right UpperLeg/LowerLeg/Foot`, plus `chest` and `neck` for VRM 0.x. Clips should key all of them.
- Bind by **semantic humanoid map**, never by node names. OMOBA states "Bone names are never used for binding" (`client/src/humanoid.rs` module doc), and the handheld grip uses semantic `rightHand`/`leftHand`.

### 6.3 Clip names (proposed "Ekza clip slot vocabulary v1")

| Slot | Required by | Used at runtime by | Loop |
| --- | --- | --- | --- |
| `idle` | OMOBA admission, Space | Space (`animState`), OMOBA (non-VRM or alias) | yes |
| `walk` | OMOBA admission, Space | Space, OMOBA | yes |
| `run` | – (OMOBA `STATES` in the motion library) | OMOBA runtime | yes |
| `attack`, `cast` | OMOBA admission | OMOBA (contact time matters) | no |
| `death` | OMOBA admission | OMOBA | no (hold last pose) |
| `tpose` | Studio preview pseudo-clip | Studio, `AvatarModel` (`tpose` stops all clips) | reserved; never export a clip with this name |
| `jump, hit, stagger, crouch, fly, climb, swim, dance, wave, emote, celebrate` | – | Studio preview allow-list | per clip |

Rules: lowercase `[a-z][a-z0-9_]{0,31}`, unique per file. Lookup is case-insensitive in Space (`AvatarModel.tsx:145-150`) and exact in OMOBA validation (`lib.rs:171`) and in Studio preview, so **always emit lowercase exact names**. Avoid substrings OMOBA's non-VRM fallback might mis-match (e.g. a clip called `idle_walk`).

### 6.4 Space, facing, height, root motion

| Topic | Convention | Source |
| --- | --- | --- |
| Units | metres, Y-up, right-handed (glTF) | glTF 2.0; OMOBA motion JSON `coordinate_system` |
| Facing | VRM 1.0 and VRMA face **+Z**. VRM 0.x faces −Z (Space adds a π yaw, `AvatarModel.tsx:114`; three-vrm-animation negates x/z) | renderer, three-vrm-animation |
| Height | Hosts normalize *visible skinned bounds*. Space world height is 2.5 (`core/src/engine/avatar/height.ts:5`); renderer default `targetHeight` is 1 and preview height is 1.45. Optional model multiplier `extras.ekza.avatar.heightScale` (root `extras` or `asset.extras`). The renderer clamps it to 0.1..10, while Space and the realtime server clamp it to **0.5..2**, so keep authored values within 0.5..2 | `normalization.ts:42`, `height.ts`, `ekza-rust-server` README |
| Root motion | Space and the shared library drive `hips.position` (`sharedHipsPosition` default true). OMOBA "never animate[s] the authoritative player root" and plays locomotion in place with hips deltas scaled by hips height | `AvatarModel.tsx`, `client/src/humanoid.rs` doc |
| Export policy | Never animate the scene root or the armature root. Put translation **only on `hips`**, as in VRMA. Store `rootMotion: "in-place" \| "hips"` per clip (§7.1). Loops must close (last pose = first pose, hips drift removed; OMOBA's `loop_processing` does the same) | VRMA spec, `humanoid-motion-v1.json` `source.loop_processing` |
| Sampling | Export `LINEAR` (quaternion slerp) at a fixed rate. Default **30 fps**, option 24/60 (OMOBA library 24 fps, renderer bake 24–30). Use `STEP` only for fully stepped curves. Avoid `CUBICSPLINE`: the readers support it, but it cannot represent weighted tangents or Euler curves anyway | – |
| Rotation storage | Unit quaternions with hemisphere continuity (flip sign when `dot(q[k-1], q[k]) < 0`, as OMOBA does) | `retarget_animations.py:440-443` |

### 6.5 Per-target matrix

| Target | What we emit | Works today? |
| --- | --- | --- |
| Ekza Space (`universal / vrm-humanoid-v1`, builder `none`) | `.vrm` with appended clips `idle`, `walk` (others ignored) | **Yes.** Embedded clips win over the shared library. |
| OMOBA (`desktop / humanoid-glb-v1`) | `.vrm` with the 5 required clips (or let OMOBA's builder append its own) | Admission passes, but the clips are **not played** (§5.3) |
| Ekza Mirror (`ios / arkit-body-v1`) | – | Not applicable: ARKit-driven, `embeddedAnimation: false` |
| DCC / other engines | `.glb` animation-only (raw skeleton) and `.vrma` | Yes |

---

## 7. Integration path: "upload animation to Ekza"

### 7.0 Tiers

| Tier | Deliverable | Ecosystem changes | Value |
| --- | --- | --- | --- |
| **T0 (MVP, no external change)** | Export `.vrm` with appended, slot-named clips, `.vrma` per clip, animation-only `.glb`, PNG poster. The user uploads the `.vrm` as a **new avatar revision** in Studio | none | Space plays custom `idle`/`walk`. Studio previews allow-listed clips |
| **T1** | Typed asset `ekza:animation:<uuid>`, profile `universal / vrma-humanoid-v1` | registry (migration, validator, UI), SDKs, Space and OMOBA consumers | Reusable motions across every avatar and game: emotes, idles, victory poses |
| **T2** | "Animation set" owned by an avatar revision: profile `desktop / humanoid-glb-v2` where `asset.extras.ekza_animation_set_v1` maps slot → embedded clip | OMOBA reads aliases from the *hashed asset* instead of operator config (generalizes `apply_alias`, `animation.rs:509-546`) | Character-specific moves, no retarget |
| **T3** | Direct "Publish to Ekza" from the Animator | new account scope `studio-upload` (today the device flow issues only `library` / `space-session` scopes) | One-click creator loop |

### 7.1 Metadata the Animator emits (hashed, inside the GLB/VRMA JSON)

Placement follows the handheld precedent (`asset.extras.ekza_handheld_v1`). The metadata is covered by the content hash and therefore reviewed with the bytes. It must contain **no key named `uri`** in any letter case.

```json
{
  "asset": {
    "version": "2.0",
    "generator": "Ekza Animator 0.1.0",
    "extras": {
      "ekza_animation_v1": {
        "schema": 1,
        "rig": "vrm-humanoid",
        "clips": [
          {
            "index": 0,
            "name": "wave",
            "slot": "wave",
            "loop": false,
            "fps": 30,
            "durationSeconds": 1.6,
            "rootMotion": "in-place",
            "contactSeconds": null,
            "tags": ["emote"]
          }
        ],
        "provenance": {
          "tool": "ekza-animator",
          "toolVersion": "0.1.0",
          "projectSha256": "<sha256 of the .ekzanim project snapshot>",
          "baseSha256": "<sha256 of the avatar this was authored on, or null>",
          "derivedFrom": [{ "title": "Universal Animation Library", "author": "Quaternius", "license": "CC0-1.0" }]
        }
      },
      "ekza_animator_bake_v1": {
        "baseAnimations": 0, "baseAccessors": 312, "baseBufferViews": 300,
        "baseBinLength": 1489104, "baseSha256": "<sha256 of the pre-bake file>"
      }
    }
  }
}
```

- `ekza_animator_bake_v1` appears only in baked `.vrm`/`.glb` files (§5.1). VRMA files carry only `ekza_animation_v1`.
- `contactSeconds` mirrors OMOBA's `contacts` table, measured from clip start to the impact pose. Games use it for presentation sync only, never for damage authority.
- Hashing: SHA-256 (lowercase hex) over the exact file bytes, as the registry, SDKs and passport compute it. The Animator shows `sha256` and `sizeBytes` in its export manifest so a creator can match the Studio record.
- Bounds for the registry validator (proposal): ≤ 32 clips per file, ≤ 120 s per clip, ≤ 64 human-bone channels per clip plus expressions, decoded accessor bytes ≤ 64 MiB (same budget as `handheld_checks.py`).

### 7.2 Registry changes (T1)

| Area | Change |
| --- | --- |
| Migration (new, additive) | `studio.avatars.asset_kind` check gains `'animation'` (currently `('avatar','weapon')`, `202610010001_typed_assets.sql:3-4`). `rendition_profiles.format` and `renditions.format` checks gain `'vrma'` (`202609190001_game_integration.sql:35` and the `renditions.format` check). `studio_action` asset-kind guard (`typed_assets.sql:62-63`) and the conversion guard (`:110-112`) get an animation branch with source validation (`source_validation_origin = 'source-validator'`). |
| Profile row | `('universal','vrma-humanoid-v1',1,<protocol owner>,'none','vrma', {"source":{"assetKind":"animation","formats":["vrma"],"maxBytes":8388608,"humanoid":true},"rendition":{"format":"vrma","container":"glTF-binary-2","selfContained":true,"maxBytes":8388608,"animations":{"min":1,"max":32},"metadata":"asset.extras.ekza_animation_v1"}})`, plus `project_accepts` rows for `ekza-space` and `omoba` when their consumers ship |
| Validator | New `backend/app/services/animation.py`, modelled on `handheld.py`: GLB rules from §6.1; `extensionsUsed ∋ VRMC_vrm_animation`, `specVersion == "1.0"`, `humanoid.humanBones.hips` present; **no** `VRM`/`VRMC_vrm`, `meshes` or `skins`; channels target only mapped humanoid nodes, expression nodes or the lookAt node; `translation` only on hips and expression nodes; no `scale` on humanoid nodes; finite values; the `ekza_animation_v1` schema; decoded-size budget |
| API | `NewAsset.asset_kind: Literal["avatar","weapon","animation"]` (`api/studio.py:85-86`); `/v2/assets?kind=` Literal (`api/avatars_v2.py:92-96`); `upload()` max bytes for the animation kind; `validate_model(asset_kind="animation")`; `integration.MEDIA_TYPES["vrma"] = "model/gltf-binary"` (no registered media type exists for VRMA); `profile_checks.check_source/check_rendition` gain the `vrma` format |
| Identity | `ekza:animation:<uuid>`, emitted automatically by `integration.py:323` (`f"ekza:{kind}:{id}"`) |
| Studio web | `assetUploads.animation = { extension: ".vrma", maxBytes: 8 MiB }`. A preview that plays the VRMA on a CC0 reference avatar via three-vrm-animation, plus the creator's own avatar if saved. Add `cast` to the preview vocabulary. Add game instructions for the new kind |
| Docs | `doc/docs/developers/typed-assets.md` gets an "Animation" row and an "Animation profile v1" section. Add the profile to `rendition-profiles.md` |

### 7.3 SDK changes (T1)

| SDK | Change |
| --- | --- |
| `ekza-bevy-sdk` (`src/assets.rs`) | `AssetKind::Animation` (`as_str "animation"`, `directory "animations"`, `max_bytes` 8 MiB); `validate_asset_id` for the `ekza:animation:` + UUID form; `asset_slug` for the new kind (recommend the full-length `sha256(id + "\n" + sha)` algorithm used for avatars, documented once); `validate_item` format check per kind (`"vrma"`). Adding an enum variant breaks exhaustive matches in consumers, so release it as 0.10.0. |
| `ekza-stellar-sdk` | Generic `RegistryClient.assets({ kind, project, platform, profile })` and `validateRendition(r, selector)`; mark `@solana/web3.js` peer optional (`peerDependenciesMeta`); optionally publish to npm so the Animator can install it from the registry instead of a git dependency |

### 7.4 Game and runtime changes (T1/T2)

| Consumer | Change |
| --- | --- |
| **Space** (`core` + `ekza-avatar-renderer`) | Renderer: add an `extraClips`/`vrmaUrls` input that loads VRMA through `VRMAnimationLoaderPlugin` and builds clips with `createVRMAnimationClip`. Turn on `autoUpdateHumanBones` while normalized-bone clips play (same pattern as `sharedAnimations.ts:150-157`). Core: emote picker and a realtime event such as `emote { id, startedAt }`. `ekza-rust-server` must verify the ID against its own approved-catalogue read, as it already does for `ekza-v2:` avatar references (`realtime/ekza.rs`). Widen the renderer's three peer to `<0.187`. |
| **OMOBA** | Passport: `validate_animation_profile(bytes)` mirroring the registry rules; an `animation_store` modelled on `weapon_store.rs`. Client: a VRMA → `MotionClip` converter. For each frame, world delta = `R_world(t) · R_world_rest⁻¹` from the VRMA's own T-pose nodes; `source_reference_facing = +Z`; hips deltas normalized by the VRMA hips height. Feed the result to the existing `RetargetBasis` (`humanoid/retarget.rs:22`). Loadout: cosmetic slots first (idle override, emote, victory). Server: admission like weapons (`server/src/passport_admission.rs`). For T2, read slot aliases from hashed `asset.extras.ekza_animation_set_v1` instead of only `combat_visuals` config. |
| **Mirror** | None. |

### 7.5 What Ekza Animator must implement (checklist)

1. A GLB reader that preserves raw JSON and BIN (for append-only bake) **and** a glTF Transform `Document` view for analysis and plain-glTF/VRMA writing.
2. Exporters: `vrm-bake` (append-only), `vrma` (one clip per file by default), `glb-anim` (animation-only, raw skeleton), `png-poster`.
3. A built-in **profile linter** that runs §6.1 rules plus profile documents fetched from `GET /v1/profiles/{platform}/{profile}`, so creators see the same issue codes Studio would show (`source_too_large`, `rendition_animation`, ...). Ship static copies for offline use.
4. Deterministic serialization and a SHA-256 manifest per export.
5. Provenance and license capture per clip (§9, R7).
6. Open from Ekza: `downloadVerifiedRendition` (hash-checked) for avatars the user can access.
7. (T3) Upload: device-code login, then `POST /v1/studio/assets` `{assetKind}`, `PUT /v1/studio/revisions/{id}/source`, `PUT …/thumbnail`, `POST …/submit` (routes in `ekza-registry/backend/app/api/studio.py:144-232, 299-345`). This requires a new token scope. The existing device tokens are deliberately limited to `library` and `space-session`.

---

## 8. Collaboration: can existing realtime code host it?

| Question | Finding |
| --- | --- |
| Transport | Socket.IO JSON events with per-socket token buckets (`ekza-rust-server/src/limits.rs`). Usable for presence. No binary CRDT sync. |
| Concurrency model | Whole `RoomProgramState` plus `serverRevision`; a mismatch returns `stale_revision`. Under two-hand keyframing one user's edits are rejected constantly. |
| Authority | Edit rights come from Solana space NFT ownership or on-chain editors. That is unrelated to animation sessions. |
| Scale | One process with in-memory presence; the README notes a shared adapter would be needed. |
| License | None declared. |
| Verdict | **REF only.** Use Yjs (MIT): a `Y.Doc` per session, one sub-document per character/take, awareness for cursors and selection and the current frame. Server for the MVP: `@y/websocket-server@0.1.5` (the `y-websocket@3.1.0` package no longer ships a server) or `@hocuspocus/server@4.7.1`, which adds auth hooks and persistence. Long term: `yrs@0.28.0` (MIT) or the `yrs-axum@0.8.2` glue in a separate axum service. It could live next to `ekza-rust-server` and reuse its *pattern* of verifying an Ekza account session server-side (`POST /v1/account/session`) with a new scope such as `animator-session`. |

---

## 9. Risks

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | VRM metadata lost on export (glTF Transform or GLTFExporter round trip) | Uploaded avatar rejected (`invalid_vrm`), or loses springs, MToon and expressions | High (verified) | Append-only baker; golden-file test that diffs the original JSON against the baked JSON excluding the appended arrays; byte-compare of the original BIN prefix |
| R2 | Creators expect OMOBA to play their clips | Support load, trust | High | UI target matrix (§6.5); T1/T2 roadmap; document it in `typed-assets.md` |
| R3 | Version skew (three 0.186 vs renderer peer < 0.186; R3F 9 vs 8; drei 10 vs 9) | Duplicate three instances, broken `instanceof`, install failures | Medium | Do not import Ekza renderers into the editor core. Upstream peer-range PR plus CI. One three copy, enforced with a pnpm `overrides` + `dedupe` check in CI |
| R4 | Raw versus normalized rig confusion | Double-applied or overwritten poses, mirrored VRM 0.x motion | Medium | Single authoring space (normalized). Explicit bake step. Tests on both the VRM 0.x and VRM 1.0 fixtures, including the "foot swings forward" assertion pattern from `vrm1Retarget.test.ts` |
| R5 | Lossy round trips (int16 library, sampled glTF) treated as source | Curves degrade with each edit | Medium | The project file is the source of truth. Imports of sampled clips are marked "baked" and offer curve-fitting/key-reduction with an error bound |
| R6 | Thumb naming and optional-bone gaps between VRM 0.x and 1.0 | Broken fingers, retarget errors | Medium | Canonical VRM 1.0 names, alias table, driven-parent resolution (`resolveDrivenParentBone`) |
| R7 | Licensing: copying from unlicensed repos (registry, rust-server) or copyleft files (OMOBA MPL/AGPL); users uploading non-redistributable clips (e.g. clips from the auto-rigging service) | Legal exposure for an OSS project and the registry | Medium | COPY only from MIT repos with attribution headers. Ask the owner to license the registry and rust-server. A provenance field per clip, plus a pre-upload warning when the source is unknown or non-redistributable |
| R8 | `uri` key anywhere in extras | Registry rejects the upload | Low–Medium | A linter rule, plus a schema forbidding the key, case-insensitively |
| R9 | JSON chunk > 4 MiB (many clips × channels, verbose extras) | OMOBA local validator rejects | Low | Linter limit. Keep extras small. Animation data goes in BIN only |
| R10 | Untrusted GLB input in the browser (sparse accessors, huge counts) | Tab out-of-memory or freeze | Medium | Pre-parse budgets copied from `handheld_checks.py` limits (1M accessor elements, 64 MiB decoded); parse in a Worker |
| R11 | CDN-loaded Draco decoder (renderer pattern) | Offline failure, privacy, CSP | Low | Self-host the decoder |
| R12 | Height-scale clamp mismatch (0.1..10 vs 0.5..2) | Model looks right in the Animator preview and wrong in Space | Low | The Animator clamps to 0.5..2 and warns |
| R13 | Collaboration on a non-CRDT server | Lost edits | High if attempted | Yjs from day one in the data layer (doc-shaped store), even single-user |

---

## 10. Open questions for the owner

1. T1 standalone `ekza:animation` kind vs T2 avatar-owned animation sets: which ships first? Recommendation: T1 for emotes and idles, T2 later.
2. Should OMOBA accept user animations only in **cosmetic slots** (idle override, emote, victory), or also for combat actions? Combat clips affect telegraphing and readability.
3. Who owns `universal / vrma-humanoid-v1`: the protocol (an operator project like `ekza`) or Space? The docs say "a profile belongs to the protocol", so recommend protocol ownership with both games accepting it.
4. Should the registry also store the Animator **project file** (`.ekzanim`) as a private source object, so revisions stay editable? That needs a new `studio.objects` kind.
5. License `ekza-registry` and `ekza-rust-server` (MIT?) so small helpers can be shared with the OSS Animator.
6. Approve a new device-flow scope (`studio-upload`) for one-click publish, or keep manual upload in the MVP?
7. Collaboration hosting: a separate `ekza-collab` service (Hocuspocus/yrs) or a module inside `ekza-rust-server`?

---

## 11. Sources

External (checked 2026-10-17):
- VRMC_vrm_animation 1.0 specification: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md
- VRM Animation overview (status, `.vrma` recommendation, supporting tools): https://vrm.dev/en/vrma/
- glTF Transform custom extensions (registration required for read/write): https://gltf-transform.dev/extensions
- npm registry metadata: `@pixiv/three-vrm@3.5.5`, `@pixiv/three-vrm-animation@3.5.5` (peer `three >=0.137`, MIT); `@react-three/fiber@9.8.2` (peer `react >=19 <19.4`, `three >=0.156`); `@react-three/drei@10.7.9` (peer R3F ^9, React ^19); `@gltf-transform/core@4.5.1` (MIT); `next@16.4.2` (peer React ^18.2 \|\| ^19); `yjs@13.6.33`, `y-websocket@3.1.0` (client only), `@y/websocket-server@0.1.5`, `@hocuspocus/server@4.7.1` (all MIT). `@ekza/avatar-renderer` and `@ekza/stellar-sdk` return 404, so they are not published to npm.
- crates.io: `yrs` 0.28.0 (MIT, https://github.com/y-crdt/y-crdt), `yrs-axum` 0.8.2 (MIT), `y-sweet` 0.9.1 (MIT).

Local (sibling repositories, read-only): every `repo/path:line` cited above, at the commits listed in §1.
