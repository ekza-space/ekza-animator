# 02 — File formats and the IO pipeline (glTF 2.0, VRM, VRMA)

> Research note for **Ekza Animator** (working name). Date: 2026-10-17.
> Scope: glTF 2.0 animation semantics, three.js loader/exporter behaviour, glTF Transform, VRM 0.x / 1.0, VRM Animation (`.vrma`), retargeting, other export formats, the editor's internal animation representation, and a concrete import → model → export pipeline.
> Versions checked today: `three@0.186.1`, `@pixiv/three-vrm@3.5.5` (+ `3.6.0-beta.0` on `next`), `@pixiv/three-vrm-animation@3.5.5`, `@gltf-transform/core@4.5.1`, `gltf-validator@2.0.0-dev.3.10`, `bevy_gltf@0.19.1` (the version OMOBA uses).
> Companion notes: `03-ekza-reuse-audit.md` (ecosystem integration, metadata schema, upload tiers). This note owns format semantics and the IO algorithms; where both touch the same topic, the names here match note 03 (`ekza_animator_bake_v1`, `ekza_animation_v1`).

---

## 0. TL;DR — decisions

| # | Question | Recommendation |
|---|---|---|
| D1 | Source of truth for animation | The **project file** (`.ekzanim`). It holds Maya-style scalar F-curves (Bezier/Hermite keys with tangent types, per-node rotate order) on **zeroed controls**, plus imported **baked layers** (sampled quaternion streams). Every glTF/VRMA output is a *derived, sampled* artifact. |
| D2 | Rotation authoring | **Euler curves** per control (Maya model), with an Euler filter and an explicit rotate order. Quaternion-slerp curves are a post-MVP per-node option. Humanoid control values are expressed **relative to the VRM T-pose in normalized space**, so a zero value is the T-pose. |
| D3 | What we write to glTF | Evaluate the rig, then **resample at the clip fps** (default 30), convert to unit quaternions with **hemisphere continuity**, apply **error-bounded key reduction**, and write **`LINEAR`** samplers (`STEP` for channels that are stepped throughout). **Never write `CUBICSPLINE` into VRMA.** For plain GLB it stays an opt-in "compact" mode, post-MVP. |
| D4 | Bake into an existing GLB/VRM | An **append-only GLB patcher** ("surgeon"): keep the original JSON objects and the BIN bytes, append accessors, bufferViews, animations and BIN bytes, and record an `asset.extras.ekza_animator_bake_v1` baseline marker so a re-bake can roll back. This is lossless by construction for VRM 0.x/1.0, Draco, meshopt, KTX2 and unknown extensions. **Do not** round-trip through three's `GLTFExporter` or through glTF Transform (both drop VRM). |
| D5 | Animation-only GLB and VRMA writers | Build fresh documents with **glTF Transform** (`Document` API), plus a small Ekza-owned `VRMC_vrm_animation` extension class. **One clip per `.vrma`.** VRMA uses a T-pose skeleton with **identity rest rotations**, so the stored rotations are exactly the normalized local rotations. |
| D6 | Imports, MVP | GLB, VRM 0.x/1.0 (embedded clips), VRMA. **P1:** FBX (Mixamo) and BVH via the three.js loaders and a bone-map retarget, and `.gltf` with external buffers. |
| D7 | Other exports | BVH writer (easy, P1/P2). FBX through an MIT JS exporter behind an adapter interface (P2, needs DCC round-trip tests). **USDZ is not useful for skinned characters**, because three's exporter has no UsdSkel. Ekza JSON clip formats (renderer library, OMOBA motion rows) are adapters "later": consumers should learn to read VRMA instead. |
| D8 | Validation | Run Khronos **glTF-Validator** (JS build, ~300 KB, Apache-2.0) in a Web Worker on every export and in CI. Add Ekza lints (VRMA rules, Bevy name-path rules, clip names) and byte-preservation tests for the surgeon. |
| D9 | `KHR_animation_pointer` | **Ignore on write** (no MVP need; unsupported by three core, glTF Transform and Bevy). **Tolerate on read**: skip channels without `target.node` and warn. Revisit for material, camera and light animation. |

---

## 1. glTF 2.0 animation model (normative essentials)

Source: glTF 2.0 spec §3.11 "Animations" and Appendix C, plus `animation.sampler.schema.json`.

### 1.1 Structure

`animations[i] = { name?, channels[], samplers[], extras? }`
- `channel = { sampler, target: { node?, path } }`. `path ∈ {translation, rotation, scale, weights}`.
- `sampler = { input, output, interpolation = "LINEAR" }`. `input` is a SCALAR float accessor holding times in seconds. `output` holds the values.
- Samplers in one animation **may** use different inputs. Several channels **may** share one sampler (and one input accessor), which saves space when times are identical.

| `path` | Accessor type | Component types | Meaning |
|---|---|---|---|
| `translation` | VEC3 | float32 | XYZ |
| `rotation` | VEC4 | float32, snorm8, unorm8, snorm16, unorm16 | XYZW unit quaternion (W is the scalar, last) |
| `scale` | VEC3 | float32 | XYZ |
| `weights` | SCALAR | float32, snorm8, unorm8, snorm16, unorm16 | Morph target weights. For each frame, *N* targets lie end to end, so `count = N × frames` |

### 1.2 MUST / SHOULD rules we have to honour when writing

| Rule | Spec text (paraphrased) | Validator code |
|---|---|---|
| Input times | Floats, `time[0] >= 0`, **strictly increasing** | `ACCESSOR_ANIMATION_INPUT_NEGATIVE`, `ACCESSOR_ANIMATION_INPUT_NON_INCREASING` |
| Input bounds | The input accessor **MUST** define `min` and `max` | `ANIMATION_SAMPLER_INPUT_ACCESSOR_WITHOUT_BOUNDS` |
| No NaN/Inf | Floating-point animation data MUST NOT contain them | `ACCESSOR_INVALID_FLOAT` |
| Unique target | Within one animation each (node, path) pair is used **once** | `ANIMATION_DUPLICATE_TARGETS` |
| No matrix | A node with `matrix` MUST NOT have T/R/S targeted | `ANIMATION_CHANNEL_TARGET_NODE_MATRIX` |
| Weights need morphs | `weights` only on nodes whose mesh has morph targets | `ANIMATION_CHANNEL_TARGET_NODE_WEIGHTS_NO_MORPHS` |
| Output count | LINEAR/STEP: `count(out) = count(in)`. CUBICSPLINE: `3 × count(in)`, and at least 2 keys | `ANIMATION_SAMPLER_OUTPUT_ACCESSOR_INVALID_COUNT` |
| Unit quaternions | Rotation outputs must be unit length | `ACCESSOR_ANIMATION_SAMPLER_OUTPUT_NON_NORMALIZED_QUATERNION` |
| No byteStride | BufferViews used by animation accessors MUST NOT define `byteStride` | `ANIMATION_SAMPLER_ACCESSOR_WITH_BYTESTRIDE` |
| Alignment | `accessor.byteOffset` and `accessor.byteOffset + bufferView.byteOffset` must be multiples of the component size (4 for float) | `ACCESSOR_*_ALIGNMENT` |
| Clamping | Before the first key and after the last key the output is **clamped** to the nearest end | — |
| Skinned node | Animating TRS of the node that *holds* a skinned mesh has no visual effect | `ANIMATION_CHANNEL_TARGET_NODE_SKIN` (warning) |
| Non-linear time | Time warps must be sampled into linear time by the exporter | — |
| Runtime semantics | glTF defines **no** looping, blending or playback order. Best practice: each animation is a self-contained "action" | — |

Writer pitfalls that follow from these rules:
- Compute `min`/`max` **after** `Math.fround`. The validator compares the declared bounds with the stored float32 values, so bounds taken from float64 can mismatch.
- After `fround`, two adjacent sample times can collapse to the same float32. Drop the duplicate before writing. Float32 resolution at 3600 s is about 2.4e-4 s, which is fine for 120 fps.
- If an animated joint uses `matrix`, decompose it into TRS in the JSON. That edit is lossless only when the matrix has no shear. Refuse otherwise.

### 1.3 Interpolation, exactly

Let `t_d = t_{k+1} − t_k` and `t = (t_c − t_k) / t_d`.

- **STEP:** `v = v_k`.
- **LINEAR** (not rotation): `v = (1−t)·v_k + t·v_{k+1}`.
- **LINEAR rotation = slerp** (SHOULD). With `a = acos(|v_k·v_{k+1}|)` and `s = sign(v_k·v_{k+1})`:
  `v = sin(a(1−t))/sin(a) · v_k + s · sin(a·t)/sin(a) · v_{k+1}`.
  The sign term makes slerp take the short path even when consecutive quaternions are in opposite hemispheres. **Do not rely on it:** write hemisphere-continuous data anyway (§6.3), because CUBICSPLINE and some runtimes do not apply the flip.
- **CUBICSPLINE** (Hermite). Each key stores `[a_k (in-tangent), v_k (value), b_k (out-tangent)]`:

  `v(t) = (2t³−3t²+1)·v_k + t_d·(t³−2t²+t)·b_k + (−2t³+3t²)·v_{k+1} + t_d·(t³−t²)·a_{k+1}`

  - The tangents are **derivatives in value units per second**. The formula scales them by `t_d`, so the stored numbers do *not* depend on segment length. A consequence used in §6.6: splitting a segment at any `t*` is exact if the new key gets `v(t*)` and `v'(t*)` as its in- and out-tangent.
  - Rotation results **MUST be normalized** after evaluation. Exporters SHOULD avoid `v_k = −v_{k+1}`, which can produce a zero quaternion.
  - `a_1` and `b_n` SHOULD be zero.
  - For `weights`, the CUBICSPLINE layout per key is `a_1..a_N, v_1..v_N, b_1..b_N`.

### 1.4 Coordinate conventions

glTF is right-handed and **+Y up**, in **metres**. The front of an asset faces **+Z**, and its left side faces +X. VRM 1.0 follows this convention. **VRM 0.x models face −Z** (§4).

### 1.5 `KHR_animation_pointer`

- Status: **Complete, ratified by Khronos.** A channel uses `target.path = "pointer"`, leaves `target.node` undefined, and carries `target.extensions.KHR_animation_pointer.pointer = "/materials/0/pbrMetallicRoughness/baseColorFactor"` (a JSON Pointer into the glTF Object Model). Any *mutable* property can be animated: material factors, KHR_texture_transform, camera FOV, light intensity, node TRS, and others.
- Support matrix:

| Consumer | Support |
|---|---|
| three.js r186 `GLTFLoader` core | **No.** Listed as "supported by separately registered plugins": `@needle-tools/three-animation-pointer` (MIT, 1.1.3, three ≥ 0.165). Core skips channels whose `target.node === undefined`. |
| three.js `GLTFExporter` | No |
| glTF Transform 4.5.1 | No (not in `@gltf-transform/extensions`) |
| Bevy 0.19 (`bevy_gltf`) | **No** (table in `bevy_gltf` docs) |
| `@pixiv/three-vrm-animation` | No (uses only `target.node`) |
| Ekza Registry profile check | Requires `channel.target.node` to be an int, so pointer channels fail `humanoid-glb-v1` admission |

- Decision: **do not emit it.** A future "prop/material animation" feature can emit pointer channels into a separate clip. The writer would then have to add `KHR_animation_pointer` to `extensionsUsed`, and never to `extensionsRequired`, so that core readers still load the file.

---

## 2. three.js: how clips are loaded, and what export loses

### 2.1 `GLTFLoader` (r186) → `AnimationClip`

| Aspect | Behaviour (from source) | Consequence for us |
|---|---|---|
| Track type | `rotation` → `QuaternionKeyframeTrack`, `translation`/`scale` → `VectorKeyframeTrack`, `weights` → `NumberKeyframeTrack` | — |
| Track name | `${node.name \|\| node.uuid}.${property}`. Names are sanitized by `PropertyBinding.sanitizeNodeName` and made unique by `parser.createUniqueName` | Names are **not** a stable identity. Map Object3D → glTF node index with **`parser.associations.get(obj).nodes`** |
| Interpolation | `STEP` → `InterpolateDiscrete`. `LINEAR` → `InterpolateLinear` (quaternions use `slerpFlat`, short path). `CUBICSPLINE` → a custom factory that creates `GLTFCubicSplineInterpolant` / `GLTFCubicSplineQuaternionInterpolant` (normalizes), flagged with `createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true` | Values arrays hold 3× data for CUBICSPLINE. Any code that rebuilds a track with `new QuaternionKeyframeTrack(name, times, values)` **silently drops the cubic interpolant** |
| Normalized outputs | `_getArrayFromAccessor` de-normalizes int outputs to float | — |
| Morph weights on multi-primitive meshes | The node becomes a `Group` of meshes, and one weights channel is **duplicated into one track per primitive mesh** | When writing back, collapse the tracks to one channel on the node |
| Channels without `node` | Skipped (`continue`) | Pointer channels vanish silently. Warn the user |
| Extras | `animation.extras` → `clip.userData`. Node extras → `object.userData` | Our clip metadata in `animations[i].extras` is visible after import |
| Unknown extensions | `object.userData.gltfExtensions[name]` (raw JSON, **with indices of the original file**) | Usable for reading, never for re-export |

### 2.2 `GLTFExporter` (r186): what survives and what does not

| Item | Preserved? | Notes |
|---|---|---|
| Node hierarchy, TRS, names | Yes (re-indexed) | Indices change, so every index-based extension reference breaks |
| Skins | Re-derived | `inverseBindMatrices` are **recomputed** from `skeleton.boneInverses · bindMatrix`. Usually equivalent, not byte-identical |
| Morph targets | Yes | Names go through `extras.targetNames` |
| Animations: LINEAR/STEP | Yes | `InterpolateDiscrete` → STEP. Everything else → LINEAR |
| Animations: CUBICSPLINE | Only if the track still carries the GLTF cubic factory flag | Three's own `InterpolateSmooth` is exported as **LINEAR** (a TODO in the source). `mergeMorphTargetTracks` **throws** on CUBICSPLINE weights |
| Materials | Standard/Basic plus a list of KHR material extensions | `ShaderMaterial` is "not supported", so **VRM MToon is lost** |
| Textures | Re-encoded through canvas (`maxTextureSize`) | Possible quality and size change. KTX2 must be decompressed first |
| `extras` | All of `userData` is serialized to `extras` | Runtime junk can leak into the file |
| Unknown extensions | Only with `includeCustomExtensions`, from `userData.gltfExtensions` | Re-emitted with **stale indices**. Root-level extensions (`VRMC_vrm`, `VRM`) are **dropped** |
| Draco / meshopt / KTX2 | Not written | Compression is lost |

**Conclusion:** `GLTFExporter` is acceptable only for writing *new* minimal documents, which is what bvh2vrma does for VRMA. It is never acceptable for "save my VRM with the new clips".

### 2.3 Other three.js IO pieces

- `FBXLoader`: FBX ASCII ≥ 7.0 or binary ≥ 6400. It loads Mixamo animations as `AnimationClip` named `mixamo.com`.
- `BVHLoader`: parses `HIERARCHY` and `MOTION` with arbitrary channel orders.
- `USDZExporter` (r186) can now write **node transform animation** (`xformOp:*.timeSamples`, `animationFrameRate` 60 by default), but it has **no skinning or UsdSkel**. Skinned characters export as static meshes. See §8.

---

## 3. glTF Transform: where it fits and where it must not be used

- `@gltf-transform/core@4.5.1` (MIT). On read: an **unknown extension listed in `extensionsRequired` throws** (`Missing required extension`). An unknown *optional* extension is **dropped with a warning** (`Missing optional extension, "VRMC_vrm"`). Note 03 reproduced this drop on the CC0 VRM 1.0 fixture.
- Writing *glTF textures* is derived from material/extension references. Images referenced **only** from an unregistered extension (MToon shade or matcap textures, VRM thumbnails) are at risk even when the extension JSON is carried through. So a VRM round trip needs **full, index-aware extension classes** for `VRM` (0.x), `VRMC_vrm`, `VRMC_springBone`, `VRMC_springBone_extended_collider`, `VRMC_node_constraint`, `VRMC_materials_mtoon` and `VRMC_materials_hdr_emissiveMultiplier`. JSON pass-through is not enough.
- A third-party package exists: `gltf-transform-vrm-extensions@0.1.10` (MIT, first published 2026-03, single maintainer, **no repository listed** on npm). Treat it as a **reference only**, not as a dependency, for the lossless path.
- `@gltf-transform/extensions` has **no `KHR_animation_pointer`**.
- Useful pieces for us:
  - `Document` / `Accessor` / `Animation` / `AnimationSampler` / `AnimationChannel` API for **fresh** documents (animation-only GLB, VRMA).
  - `resample()` from `@gltf-transform/functions`, built on `keyframe-resample` (BlueOak-1.0.0, a WASM or JS build). It removes keyframes that lerp/slerp/step reproduce within `tolerance = 1e-4`. Good as a final lossless-ish pass. It is **not** a replacement for the error-bounded reducer in §6.4, because its tolerance is in raw component units, not in degrees or millimetres.
  - `prune()` / `dedup()` for the optional "compact" pass, **only** on documents whose every extension is registered.

**Rule:** glTF Transform writes documents *we* create. The original user file is changed only by the surgeon (§5).

---

## 4. VRM 0.x vs VRM 1.0 (what the IO layer must know)

| Aspect | VRM 0.x | VRM 1.0 |
|---|---|---|
| Root extension | `extensions.VRM` (no vendor prefix) | `extensions.VRMC_vrm` (+ `VRMC_springBone`, `VRMC_node_constraint`, `VRMC_materials_mtoon`, …) |
| Facing in glTF space | **−Z** | **+Z** (glTF convention) |
| Rest pose | T-pose. UniVRM exports with **no rest rotations** (normalized) | **VRM T-pose** with *arbitrary* rest rotations allowed. The CC0 sample in `ekza-avatar-renderer` has **51 of 52** human bones with non-identity rest rotation |
| Humanoid map | `humanoid.humanBones: [{bone, node}]` (array) | `humanoid.humanBones: { [bone]: {node} }` (object) |
| Required bones | 1.0 set **plus `chest`, `neck`** | 15: `hips, spine, head`, `left/right UpperLeg, LowerLeg, Foot`, `left/right UpperArm, LowerArm, Hand` |
| Optional bones | — | `chest, upperChest, neck, leftEye, rightEye, jaw, left/right Shoulder, Toes`, and 30 finger bones (55 bones in total) |
| Thumb names | `ThumbProximal, ThumbIntermediate, ThumbDistal` | `ThumbMetacarpal, ThumbProximal, ThumbDistal`. Map: v0 `Proximal → Metacarpal`, v0 `Intermediate → Proximal` |
| Expressions | `blendShapeMaster.blendShapeGroups[].presetName`: `a,i,u,e,o, blink, blink_l, blink_r, joy, angry, sorrow, fun, lookup/down/left/right, neutral` | `expressions.preset`: `aa, ih, ou, ee, oh, blink, blinkLeft, blinkRight, happy, angry, sad, relaxed, surprised, lookUp/Down/Left/Right, neutral`, plus `custom` |
| v0 → v1 expression names | `a→aa, i→ih, u→ou, e→ee, o→oh, joy→happy, sorrow→sad, fun→relaxed, blink_l→blinkLeft, blink_r→blinkRight, lookup→lookUp …` (`three-vrm-core` `v0v1PresetNameMap`) | — |
| Scale | — | Humanoid bone scale MUST be positive and should be uniform (T-pose def. 2.1) |

VRM T-pose (1.0, normative): the model stands along +Z, is symmetric about X = 0 and grounded at Y = 0. Arms, hands and the four fingers run parallel to the X axis with palms facing −Y. Thumbs point 45° between X and +Z. Shoulders are relaxed and lowest.

### 4.1 Normalized versus raw bones in `@pixiv/three-vrm`

- `vrm.humanoid.getRawBoneNode(name)` returns the real glTF node. `getNormalizedBoneNode(name)` returns a synthetic `Object3D` from `VRMHumanoidRig`, added under `gltf.scene`. Every normalized node has an **identity rest rotation**, is positioned at the raw bone's rest world position (relative to the nearest existing human parent), and is parented through `VRMHumanBoneParentMap`, which skips missing optional bones.
- `humanoid.update()` copies normalized → raw when `autoUpdateHumanBones` is true (the default). The per-bone formula, from `VRMHumanoidRig.update()`:

  ```
  q_raw_local = P⁻¹ · N · P · L_rest
    P      = rest world rotation of the raw node's glTF *parent*
    L_rest = rest local rotation of the raw node
    N      = normalized local rotation (rest-relative, world-aligned axes)
  hips: raw.position = inverse(rawParent.matrixWorld) · normalizedHips.worldPosition
  ```

  The inverse, used when we import raw clips into normalized space, is `N = P · q_raw_local · L_rest⁻¹ · P⁻¹ = P · q_raw_local · W⁻¹` with `W = P · L_rest` (the rest world rotation of the bone). This matches the VRMA spec's "NormalizedLocalRotation" (`W · L⁻¹ · q · W⁻¹`) and the VRMA loader (`q.premultiply(parentWorldRest).multiply(worldRest⁻¹)`).
- **Pitfall** (already handled in `ekza-avatar-renderer/src/vrm.ts`): embedded clips target **raw** nodes, so the loader must use `autoUpdateHumanBones: false`. Otherwise `vrm.update()` overwrites the mixer every frame. Normalized clips (VRMA, the shared library) need it set to `true`. The editor must use **one authoritative writer per bone per mode** (§6.1).
- VRM 0.x ↔ 1.0 facing conversion is a conjugation by a 180° yaw `Y = (0,1,0,0)`:
  `q' = Y·q·Y⁻¹ = (−x, y, −z, w)` and `p' = (−x, y, −z)`. This is an involution, so applying it twice is the identity. `three-vrm-animation`, the three-vrm Mixamo example and `ekza-avatar-renderer` (`flipYawQuaternion`) all apply exactly this when `metaVersion === "0"`. `VRMUtils.rotateVRM0(vrm)` instead rotates the whole scene by π, which is what `ekza-avatar-renderer` does with `facingCorrection`.
- **Left/right mirror** of a pose in +Z-facing normalized (world-aligned) space, as OMOBA uses for derived motions: swap the `left*` and `right*` bone streams, then `q' = (x, −y, −z, w)` and hips `p' = (−x, y, z)`. This is the reflection through the YZ plane (`S R S`). It holds for both world deltas and normalized locals, which makes it the basis for Maya-style "Mirror pose" and "Flip pose" commands.

---

## 5. Export target 1 — bake into the original GLB/VRM losslessly ("surgeon")

### 5.1 Why append-only

Nothing else preserves *everything* that we do not understand: VRM 0.x/1.0 extensions with node, material, texture and image indices, MToon, spring bones, constraints, Draco, meshopt (including fallback buffers), KTX2, `KHR_*` material extensions, extras and Ekza metadata such as `extras.ekza.avatar.heightScale`. If no existing array index moves, every reference stays valid. OMOBA already ships this technique (`omoba-bevy/scripts/retarget_animations.py`: `BinAppender`, `rollback_to_baseline`, marker `asset.extras.omoba_retarget`). We generalize it.

### 5.2 Algorithm

```
input : original bytes B (GLB/VRM), clips C[] (sampled + reduced, per raw node index)
1  parse GLB: header(magic 0x46546C67 'glTF', version 2, length) → JSON chunk (0x4E4F534A)
   → BIN chunk (0x004E4942). Keep B as an ArrayBuffer; never mutate it.
2  json = JSON.parse(jsonChunk). bin = slice of B (zero-copy view).
   The GLB-stored buffer is buffers[0] with no `uri`. If it is missing (no BIN chunk), create one.
3  if asset.extras.ekza_animator_bake_v1 exists and baseSha256 matches the rollback check:
       truncate animations/accessors/bufferViews to base counts and the BIN view to baseBinLength
   (refuse rollback, and append instead, if another tool's marker such as `omoba_retarget`
    records a larger baseline, i.e. the other tool ran after us)
4  for each clip: names must be unique within the file (case-insensitive trim, matching the
   renderer's merge rule). A clip with an existing name **replaces that entry in place**, so the
   animation index stays stable. The old accessors become orphans (see 5.4).
5  for each channel: append float32 data to an append-buffer, 4-byte aligned;
       one bufferView per accessor (no byteStride, no target);
       input accessor: SCALAR FLOAT with min/max taken from float32-rounded values;
       output accessor: VEC3/VEC4/SCALAR FLOAT (snorm16 rotations only in "compact" mode);
       share one input accessor across channels with identical time arrays (hash the times).
6  ensure every animated node has no `matrix` (decompose to TRS, or refuse on shear).
7  write asset.extras.ekza_animator_bake_v1 = { baseAnimations, baseAccessors,
       baseBufferViews, baseBinLength, baseSha256 } (only if it is not already present)
   and asset.extras.ekza_animation_v1 (clip metadata; schema in note 03 §7.1).
   Set asset.generator only if absent (keep provenance). Never touch extensionsUsed/Required.
8  buffers[0].byteLength = baseBin + appended. Serialize JSON and pad with 0x20.
   Pad BIN with 0x00. Total length = 12 + 8 + json + 8 + bin.
9  output = new Blob([header, jsonChunkHeader, json, binChunkHeader, originalBinView,
                     appendedBin, pad]). Blob concatenation avoids copying a 50 MB original.
10 validate (§10). Report sha256 and size.
```

### 5.3 What to write for each node kind

| Node kind | Channels written | Notes |
|---|---|---|
| Humanoid bones | `rotation` for **every** bone the rig drives. A constant bone gets a 1-key LINEAR sampler (valid, and three and Bevy treat it as constant). `translation` only on `hips` | Self-contained clips: switching clips must not leave a stale pose. Values are **raw local** TRS from the formula in §4.1 |
| Non-humanoid deform joints the user animated (tail, props, twist bones keyed by hand) | Raw `rotation`/`translation`/`scale` as animated | Written only to GLB/VRM, never to VRMA |
| Spring-bone chain joints (`VRMC_springBone`, VRM0 `secondaryAnimation`) | **None** by default | Simulated at runtime. Keyed values would fight the simulation. Option "bake simulation" applies only to non-VRM consumers |
| `VRMC_node_constraint` destination nodes | **None** for VRM consumers. Optional bake for plain-GLB consumers (Bevy has no VRM runtime) | Lint: warn when a curve targets a constrained node |
| Scene root / armature root | **Never** | Note 03 §6.4: put translation only on hips, and keep root motion as metadata |
| Morph weights (expressions) | `weights` channels on mesh nodes, **only for non-VRM consumers** | three-vrm's expression manager rewrites morph influences every update, so for VRM consumers expressions belong in VRMA |
| `scale` on any bone | Only if a curve really animates scale | Blender writes T/R/S for every node (the CC0 fixture has 65 × 3 channels). Skip scale to avoid noise |

### 5.4 Orphans and compaction

Replacing a pre-baseline clip leaves its accessors and bufferViews unreferenced. The glTF-Validator reports them as `UNUSED_OBJECT` (info). **Do not delete or re-index them in the surgeon**, because unknown extensions may index bufferViews (`EXT_structural_metadata`, Draco, and others). Offer an explicit **"Optimize file"** command that runs a glTF Transform `prune` only when every extension in `extensionsUsed` is registered with a real implementation. Otherwise leave the bytes and show the orphaned size.

### 5.5 Ecosystem facts that constrain baking

- **Bevy (OMOBA)** binds clips by the **name path** from the animation root (`AnimationTargetId::from_names`). It *ignores* a channel when "part of its hierarchy is missing a name". It does not support sparse input accessors, `KHR_animation_pointer`, `KHR_mesh_quantization`, `EXT_meshopt_compression`, Draco or `KHR_texture_basisu` syntax. With duplicate clip names, the **later** clip wins in `named_animations`. Lints: every ancestor of an animated node must have a non-empty name, and no two siblings on an animated path may share a name. **Never rename nodes** in the surgeon.
- **Ekza Registry** `humanoid-glb-v1` (OMOBA) requires a self-contained GLB (no `uri` in `buffers` or `images`), at least one skin with valid joints, clips named `idle, walk, attack, cast, death` with channels whose `target.node` is an int, and ≤ 50 MiB. `vrm-humanoid-v1` (Space) keeps VRM metadata, and the runtime provides `idle` and `walk`.
- **Ekza Space renderer gotcha** (`ekza-avatar-renderer/src/AvatarModel.tsx`): `useSharedAvatarClips({ enabled: sharedAnimations && embedded.length === 0 })`. If **any** clip is embedded, the shared `idle`/`walk` library is **not fetched**. Baking only a `wave` clip into a VRM therefore removes Space's idle and walk. Mitigations: (a) the "Bake for Ekza Space" preset warns and offers to include retargeted CC0 `idle`/`walk`; (b) the renderer drops the `embedded.length === 0` gate, because `mergeAvatarClips` already merges by name. Prefer (b) (owner decision, see §13).
- **OMOBA builder** appends its five library clips after any clips already present, and its marker baseline then covers our data. Animator bakes must target the **source VRM**, not a downloaded rendition. Note 03 §5.3 adds that OMOBA currently plays humanoid motion from `humanoid-motion-v1.json`, not from embedded clips.

---

## 6. Internal representation vs. what we write (the key design question)

### 6.1 Three layers

| Layer | Representation | Lives in | Lossless? |
|---|---|---|---|
| **Authoring** | Scalar F-curves per animatable attribute on **controls** (and optionally joints): `tx ty tz rx ry rz sx sy sz` + custom attrs (IK/FK blend, space switch, expression weights, lookAt yaw/pitch). Keys with Maya-like tangents. Plus **baked layers** (dense per-joint quaternion and vector streams from imports or mocap) | `.ekzanim` | Yes |
| **Evaluation** | `evaluate(clip, t) → PoseBuffer`: struct-of-arrays `Float32Array` of raw joint local TRS, plus the normalized humanoid locals as a by-product. Controls → constraints/IK → joints | memory (Worker or main) | — |
| **Interchange** | Sampled, reduced glTF samplers (raw nodes for GLB/VRM; normalized identity-rest skeleton for VRMA) | `.glb`/`.vrm`/`.vrma` | No (tangent intent, Euler, rig and constraints are lost) |

Why not store quaternion keys with Bezier tangents as the source of truth?
1. Animators edit **per-axis** curves in a graph editor. Maya's default rotation interpolation is per-channel Euler, so its graph editor shows `rotateX/Y/Z`. Quaternion splines (squad, cubic quaternion) cannot be shaped per channel.
2. glTF cannot store Bezier tangent *types* (auto, clamped, flat, plateau…), broken/unified state, weighted handles, infinity modes or rotate order. Those must live in the project anyway.
3. Rig output (IK, constraints, space switches, layers) is non-linear, so any interchange format needs evaluation plus sampling regardless of the authoring curve type.

### 6.2 Curve data model (proposal; units and semantics)

```ts
type TangentType = 'auto' | 'spline' | 'clamped' | 'linear' | 'flat'
                 | 'step' | 'stepNext' | 'plateau' | 'fixed';
type InfinityMode = 'constant' | 'linear' | 'cycle' | 'cycleOffset' | 'oscillate';

interface Key {
  id: string;                 // stable ID (CRDT-friendly; never an array index)
  frame: number;              // float64, in project frames (sub-frame allowed)
  value: number;              // SI: metres, radians, unitless (scale, weights)
  inType: TangentType; outType: TangentType;
  inSlope: number; outSlope: number;   // value units per frame; resolved for auto types
  inWeight?: number; outWeight?: number; // handle x-length as a fraction of the segment (weighted curves); default 1/3
  broken: boolean;            // false = unified tangents
}
interface Curve {
  id: string;
  target: { nodeId: string; attr: 'tx'|'ty'|'tz'|'rx'|'ry'|'rz'|'sx'|'sy'|'sz'|`custom:${string}` };
  weighted: boolean;
  pre: InfinityMode; post: InfinityMode;
  keys: Key[];                // sorted by frame
}
interface BakedTrack {        // imported or mocap data, editable via layers/offsets
  jointId: string; space: 'raw' | 'normalized';
  fps: number; startFrame: number;
  rotation?: Float32Array;    // xyzw per frame, hemisphere-continuous
  translation?: Float32Array; scale?: Float32Array;
}
interface ProjectTime { fps: { num: number; den: number } } // 24, 25, 30, 30000/1001, 60…
```

- Store **time in frames** and **fps as a rational**, as Maya and DCC tools do. Convert to seconds only on export (`t = frame · den / num`).
- Store angles in **radians** and display degrees in the UI. Slopes are in value per frame.
- **Rotate order** is per node and uses Maya semantics. **Maya `xyz` = three.js `'ZYX'`** (reverse the letters). three's `Euler('XYZ')` builds `Rx·Ry·Rz` (column vectors, intrinsic X first), while Maya `xyz` applies X first in the parent frame, i.e. `Rz·Ry·Rx`. Blender's `XYZ` Euler also equals three's `'ZYX'`. Put this mapping in a single function covered by a unit test.
- **Zeroed controls:** a control's channel values are relative to its offset, the analogue of Maya's `offsetParentMatrix` / joint orient. For humanoid FK controls the offset is the VRM T-pose in normalized space, so **zero = T-pose**, which matches VRMA and three-vrm. If an animator wants bone-aligned axes, give the control an orientation `O` relative to the world-aligned normalized frame:
  `N = O · R_euler(rx, ry, rz; order) · O⁻¹`.
  The curves stay readable (X down the bone) while the stored meaning stays normalized.
- **Euler filter** (Maya's command) runs on import and on "Convert baked → curves". For each key after the first, choose among `angle + 2πn` and the alternate triple `(x+π, π−y, z+π)` (adjusted to the order's middle axis) to minimize `Σ|Δ|` against the previous key.
- **Quaternion continuity** applies to every sampled stream: if `dot(q_k, q_{k−1}) < 0`, set `q_k = −q_k`. Do this before reduction, before CUBICSPLINE tangent estimation and before writing. OMOBA's retarget and the Ekza bake already do it.

### 6.3 Sampling (export)

| Target | Default rate | Interpolation | Notes |
|---|---|---|---|
| VRMA | **30 fps** (the VRMA spec's guideline) | LINEAR (STEP for stepped channels) | Never CUBICSPLINE (§7.3) |
| Bake into GLB/VRM | the project fps (24/30/60) | LINEAR / STEP | Bevy, three, Unity glTFast and Blender all support LINEAR |
| Animation-only GLB | the project fps | LINEAR / STEP; CUBICSPLINE opt-in (post-MVP) | — |
| Ekza shared library adapters | 24 or 30 fps | — | The OMOBA library uses 24 fps. The renderer bake defaults to 30 and its README uses 24 |

- Sample times `t_i = i / fps` are computed in float64 and stored as float32. The last sample is **exactly the clip end**.
- **Loops:** copy the first pose to the last sample and close the hips drift (OMOBA's `loop_processing` does the same). Make the last→first quaternion pair hemisphere-consistent.
- **Stepped segments** inside a LINEAR channel: add a key at `t_next − ε` (ε = 1 ms, kept strictly increasing after `fround`) holding the previous value. A channel that is stepped throughout is written as a STEP sampler at its key times only. Maya's `stepNext` maps to STEP with each value shifted to the previous key time.

### 6.4 Error-bounded key reduction (export)

A Douglas–Peucker variant on each sampled stream, with interpolation-aware reconstruction:

```
keep = {first, last} ∪ authoredKeyTimes(joint) ∪ stepDiscontinuities
reduce(i, j):                      // reconstruct samples in (i, j) by slerp/lerp of i and j
   m, e = argmax_{i<k<j} err(reconstruct(k), sample(k))
   if e > tol: keep m; reduce(i, m); reduce(m, j)
err_rot(q̂, q)   = 2·acos(min(1, |q̂·q|))                   // radians
err_pos(p̂, p)   = |p̂ − p|
err_scale(ŝ, s) = max_c |ŝ_c − s_c| / |s_c|
err_weight      = |ŵ − w|
```

Tolerances scale with the character, an ACL-style "virtual vertex" heuristic:
- `ε_pos = 0.2 mm × (characterHeight / 1.7 m)`.
- Per joint: `θ_tol(j) = min(θ_cap, ε_pos / max(L_j, L_min))`, where `L_j` is the longest rest-pose distance from joint `j` to any descendant joint (+10% for skin), `L_min = 1 cm`, and `θ_cap = 0.25°`. Example: the hips, about 0.9 m to the fingertips, get θ ≈ 0.013°, while a distal finger is capped at 0.25°.
- For a strict end-effector bound, divide `ε_pos` by the chain depth (errors add along a chain).
- Translation tolerance is `ε_pos`. Scale tolerance is 1e-4 relative. Weights tolerance is 1e-3.
- An optional final pass is glTF Transform `resample()` with tolerance 1e-4, which removes exact-collinear leftovers.

Typical outcome: hand-keyed animation shrinks 3–10×, mocap 1.3–2×.

### 6.5 Size and performance reference

52 human bones (the CC0 fixture), 10 s at 30 fps = 301 samples:

| Encoding | Rotations | Hips translation | Times (shared input) | Total |
|---|---|---|---|---|
| float32 LINEAR, dense | 52 × 301 × 16 B = 250 KB | 3.6 KB | 1.2 KB | **≈ 255 KB** |
| + reduction (hand-keyed, ~5×) | ~50 KB | ~1 KB | per-channel inputs ~10 KB | **≈ 60 KB** |
| snorm16 rotations (core glTF, no extension) | ×0.5 | — | — | opt-in "compact"; three and the Bevy `gltf` crate (`into_f32`) both read it |

JSON overhead is about 150–250 B per channel (sampler, channel, two accessors, bufferView). Sharing input accessors cuts this sharply. Everything runs in a **Web Worker** with transferable `ArrayBuffer`s: sampling 52 joints × 300 frames is sub-millisecond, and rig evaluation with IK dominates.

### 6.6 CUBICSPLINE: when it is exact, and why it stays opt-in

- **Exact mapping** for non-weighted Bezier/Hermite curves on translation, scale and weights: the glTF out-tangent `b_k` is the key's out-slope per second (`outSlope · fps`), and the in-tangent `a_{k+1}` is the next key's in-slope. When x, y and z have different key times, insert keys at the union of times by **exact cubic splitting** (new key = `v(t*)`, tangents = `v'(t*)`). This is lossless because the glTF tangents are absolute derivatives.
- **Not exact:** weighted tangents (handles not at Δ/3), so sample them. Euler rotation curves are never cubic in quaternion space, so the rotation can only be *fitted*: Catmull-Rom tangents on hemisphere-aligned components, with subdivision until `err_rot ≤ θ_tol`.
- Break-even: CUBICSPLINE stores 3× the values per key, so it pays off only if it needs **fewer than one third** of the LINEAR-reduced keys.
- **Consumer caveats:** `@pixiv/three-vrm-animation` rebuilds humanoid rotation tracks with `new QuaternionKeyframeTrack(name, times, values)`, which drops the cubic interpolant, so CUBICSPLINE VRMA **breaks** (§7.3). `GLTFExporter` cannot merge CUBICSPLINE morph tracks. The Ekza `bake-shared-animations.mjs` reads only the middle value of CUBICSPLINE keys and lerps between keys, which approximates. Bevy 0.19 does support it (`CubicKeyframeCurve`).

### 6.7 Import paths into the model

| Source | Lands as | Conversion |
|---|---|---|
| Embedded glTF clips (raw nodes) | `BakedTrack(space:'raw')` per node, kept at the source's sample times (resampled to the project fps only on edit) | VRM: also derive `space:'normalized'` via §4.1, which retargets onto other avatars |
| VRMA | `BakedTrack(space:'normalized')` + expression/lookAt scalar tracks | `VRMAnimationLoaderPlugin` gives normalized tracks directly |
| FBX (Mixamo), BVH | `BakedTrack(space:'normalized')` after the bone-map retarget (§7.4) | — |
| `.ekzanim` | Curves + baked layers verbatim | — |
| Re-import of our own GLB | Baked tracks, **unless** curve source data is embedded and its hash matches (post-MVP §12) | — |

"Convert baked → curves" is an explicit user action: Euler-decompose in the control's rotate order, run the Euler filter, then fit Bezier keys with the same reducer. The tolerances are chosen by the user, with presets "Exact (every frame)", "Fine" and "Simplified".

---

## 7. VRM Animation (`.vrma`)

### 7.1 Spec essentials (`VRMC_vrm_animation` 1.0, status Complete)

- A root extension: `{ specVersion: "1.0" (required), humanoid?: { humanBones: { <bone>: { node } } }, expressions?: { preset?: {<name>: {node}}, custom?: {<name>: {node}} }, lookAt?: { node, offsetFromHeadBone? } }`.
- Intended as a **separate file that contains only animation**. It is not meant to live inside a VRM.
- The first animation is the default. Multiple animations are allowed, but tools may read only the first, so Ekza writes **one clip per file**.
- **Rest pose = VRM T-pose.** Humanoid nodes must not carry **scale** animation. Only **hips** may carry translation. `leftEye`/`rightEye` must not be mapped (gaze goes through `lookAt`). The rest hierarchy should not contain scale. Rest *rotations* are allowed.
- Expressions use the **x component of a node's translation** as the weight, clamped to [0, 1]. `lookUp/Down/Left/Right` must not be animated.
- `lookAt` uses the node's local rotation, converted to yaw (Y) and pitch (X) with **extrinsic ZXY**. Initial gaze is +Z.
- 30 fps is the recommended sampling rate.

### 7.2 How `@pixiv/three-vrm-animation@3.5.5` reads it

- `VRMAnimationLoaderPlugin.afterRoot`: for each humanoid channel it computes
  `N = parentHumanBoneWorldRest · q_file · boneWorldRest⁻¹`. The parent is found by walking `VRMHumanBoneParentMap` to the nearest *mapped* bone, or `hipsParent`.
- Hips translation is transformed by the hips parent's world matrix, so it is effectively an **absolute world position**. `restHipsPosition` is the rest world position of the hips (the loader warns if `y < 1e-3`).
- `createVRMAnimationClip(vrmAnimation, vrm)`:
  - Rotations retarget to `getNormalizedBoneNode(name).name`. For VRM 0.x targets x and z are negated.
  - Hips translation is scaled by `humanoid.normalizedRestPose.hips.position[1] / restHipsPosition.y`, with the same x/z negation for VRM 0.x.
  - Expressions bind to `expressionManager.getExpressionTrackName(name)`. LookAt drives a `VRMLookAtQuaternionProxy`.
- It maps `tracks[iChannel]` to channel `iChannel`. This assumes GLTFLoader produced exactly one track per channel, which `weights` channels and node-less channels break. A VRMA writer must therefore emit **only humanoid, expression and lookAt channels**, all with `node` set.
- If the lookAt node is not a direct child of the root, the loader bakes it (`bakeFrameRate` option), so place the lookAt node **directly under the scene root**.
- Translation tracks on non-hips bones are ignored with a warning, and paths other than translation or rotation **throw**.

### 7.3 Writers that exist (2026-10)

| Writer | Status |
|---|---|
| `@pixiv/three-vrm-animation` | **Load only.** No exporter in 3.5.5 or 3.6.0-beta.0 |
| `vrm-c/bvh2vrma` (MIT, Next.js app) | A ~50-line `GLTFExporterPlugin` (`VRMAnimationExporterPlugin.ts`) that adds `VRMC_vrm_animation` with `humanoid.humanBones` from `root.userData.vrmBoneMap` after three's `GLTFExporter` has written a bone-only skeleton plus clip. Humanoid only (no expressions or lookAt). It is a good reference |
| VRM Add-on for Blender | Lists "VRM Animation" among its features on extensions.blender.org. Use it as an interop test target |
| `gltf-transform-vrm-extensions` | Read and write helpers for VRMA documents. Young, reference only |

### 7.4 Ekza VRMA writer (spec)

1. Skeleton: one node per mapped humanoid bone (never `leftEye`/`rightEye`), parented by `VRMHumanBoneParentMap` over the bones **present in the source avatar**. Do **not** insert non-humanoid intermediate nodes, because the loader composes only human parents. Hips is a child of an identity root. **All rest rotations are identity, all scales 1.** Rest translations are the source's `humanoid.normalizedRestPose` positions, in +Z-facing space (conjugate them if the source is VRM 0.x).
2. With identity rests, `q_file = N` (normalized local) and `hips.translation(t) = normalized hips world position`. `restHipsPosition` is the T-pose hips position, so the loader's hips-height ratio works on any target.
3. Expressions: one node per animated expression, a direct child of the root, named after the expression. Translation track `(w(t), 0, 0)` with w clamped to [0, 1]. VRM 0.x sources are renamed to 1.0 presets (§4).
4. LookAt: one node, a direct child of the root, with a rotation track. Store `offsetFromHeadBone` from the source VRM's lookAt.
5. All samplers are LINEAR (or STEP), and rotations are hemisphere-continuous.
6. Use **glTF Transform** with an Ekza `VRMCVrmAnimation` `Extension` class (root-level property holding `Node` references, so indices are written correctly). Set `extensionsUsed: ["VRMC_vrm_animation"]`, never `extensionsRequired`. Asset extras: `ekza_animation_v1` (note 03 §7.1).
7. Lints before writing: required VRM bones present, no non-hips translation, no scale channels, expression names valid, file contains exactly one animation.

---

## 8. Retargeting

All retargeting goes through **normalized space**, the VRM "NormalizedLocalRotation" intermediate:

```
source raw → N:   N = P_s · q_s · W_s⁻¹            (source rest: P_s parent world, W_s bone world)
N → target raw:   q_t = P_t⁻¹ · N · P_t · L_t       (§4.1)
facing:           if exactly one side is VRM 0.x: N' = (−x, y, −z, w)
hips:             p_t = p_s_world · (hipsRestY_target / hipsRestY_source)   (VRMA, three-vrm, Ekza renderer)
missing optional bones on the target (e.g. no upperChest):
                  D_b = Π N along the source chain (world delta);  N'_child = D_targetParent⁻¹ · D_child
                  (= ekza-avatar-renderer composeWorldRotations; = VRMA "target has fewer bones" rule)
source has fewer bones: drive only the bones present
```

| Pair | How | Notes |
|---|---|---|
| **VRM 1.0 ↔ VRM 0.x** | yaw conjugation, thumb rename, expression rename | Exact |
| **VRMA → any VRM** | `createVRMAnimationClip` | Exact up to the hips scale |
| **Mixamo FBX → VRM** | three-vrm example `loadMixamoAnimation.js` + `mixamoVRMRigMap`: `q' = parentRestWorld · q · restWorld⁻¹` per track, hips × `vrmHipsY / mixamoHipsY` | Mixamo rigs are in centimetres, and the ratio cancels units. It assumes the FBX rest is a T-pose. An A-pose or other source needs a **reference pose** override |
| **Arbitrary GLB rig (Rigify `DEF-*`, UE mannequin, `Bip01`, `mixamorig:`)** | A bone-map preset or auto-map by name, then the world-delta method of OMOBA `retarget_animations.py`: `delta = R_src_world(t)·R_src_ref⁻¹`, `R_tgt_world = A·delta·A⁻¹·R_tgt_ref`, local rotations recovered root to leaf. `A` is the yaw alignment chosen from the rest facing | The reference pose matters: OMOBA uses the UAL `A_TPose` clip's first key as the source reference instead of the bind pose. Expose "pick reference frame" in the UI |
| **Non-humanoid extras** (tails, wings) | Not retargeted, and only written to GLB/VRM | — |

IK-quality retargeting (foot locking, hand contacts, proportions) is post-MVP. The FK delta method is what VRMA, three-vrm and both Ekza pipelines use today, so it defines "compatible".

---

## 9. Other formats: feasibility

| Format | Import | Export | Verdict |
|---|---|---|---|
| **glTF (`.gltf` + `.bin` + images)** | GLTFLoader with a multi-file drop or zip | Surgeon can append a new buffer, or convert to GLB (move image URIs into bufferViews; the bytes stay unchanged) | P1. Ekza requires self-contained GLB anyway |
| **BVH** | three `BVHLoader` + bone map | **Easy writer** (~150 LOC): `HIERARCHY` (offsets from normalized rest positions, `CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation` for the root, 3 rotation channels for the rest), `MOTION Frames/Frame Time`, Euler degrees from normalized locals (rest = zero rotation is native to BVH). Run the Euler filter per channel | P1/P2. Lossy (Euler, no expressions). Good for mocap tools |
| **FBX** | three `FBXLoader` (ASCII ≥ 7.0, binary ≥ 6400) | MIT JS writers exist: `@comfyorg/fbx-exporter-three` 1.0.2 (binary, skinning, TRS + morph animation, presets for Unity/Unreal/Maya/Blender, uses `fflate`) and `three-js-fbx-exporter` 0.1.3 (binary + ASCII 7400/7500). Both are from 2026 and young. The alternative is `assimpjs` (MIT, WASM assimp), which is heavier. Do **not** port Blender's exporter (GPL). The Autodesk SDK is not browser-usable | P2 behind an `Exporter` interface, gated by Blender/Maya/Unity round-trip tests |
| **USDZ** | — | three `USDZExporter` r186 writes node `xformOp` timeSamples but **no UsdSkel or skinning**. Ekza Mirror's `arkit-body-v1` profile has `embeddedAnimation: false` (ARKit drives the skeleton) | **Out of scope** |
| **Ekza shared clip** (`SerializedHumanoidClip`, `ekza-avatar-renderer`) | Decoder in the renderer (`decodeQuaternions`, `retargetHumanoidClip`) | Trivial from normalized streams: parent-local N, VRM 1.0 facing, int16 quantization, hips = world / hipsRestY, constant-track collapse at ε 4e-3 | Later. Prefer that the renderer reads VRMA |
| **OMOBA `humanoid-motion-v1.json`** | — | World rotation deltas `D = Π N` (glTF xyzw), hips world deltas in source metres + `source_hips_height`, `contacts`, `looping`, 24 fps | Later. Prefer an OMOBA VRMA loader (note 03 §7.4) |
| **three `AnimationClip.toJSON`** | — | Trivial | Debug and clipboard only, never a storage format |

---

## 10. Validation and tests

1. **Khronos glTF-Validator** (`gltf-validator@2.0.0-dev.3.10`, Apache-2.0, ~300 KB Dart-compiled JS). It works in browser and Node through `validateBytes(Uint8Array, {maxIssues, ignoredIssues, severityOverrides})`.
   - Lazy-load it in the export Worker. **Block** on errors and **show** warnings.
   - Set `ignoredIssues: ['UNSUPPORTED_EXTENSION']` for `VRM*`. Keep `UNUSED_OBJECT` visible as an info line ("orphaned bytes").
   - Run the same call in CI over golden outputs.
2. **Ekza lints** (our code, pure TS):
   - VRMA rules (§7.4).
   - Bevy name-path rules (§5.5).
   - Clip names unique and matching the target profile (`idle, walk, attack, cast, death` for OMOBA; note 03 §6.3 vocabulary).
   - No `uri` in `buffers` or `images` for Ekza uploads.
   - No animation of spring or constraint nodes.
   - Hips-only translation for humanoid clips.
   - `|q| − 1 < 1e-6`. Normalize in float64 before `fround`.
3. **Surgeon byte-preservation test** (unit test on CC0 fixtures: the `ekza-avatar-renderer` VRM 1.0 sample and VRM 0.x avatars from the CC0 Open Source Avatars set):
   - the original BIN is a byte prefix of the new BIN;
   - JSON is deep-equal except for appended array tails, the replaced `animations[k]` and `asset.extras` markers;
   - after rollback + re-bake with the same input, the output is **byte-identical** (deterministic JSON key order and float formatting).
4. **Load tests** (Playwright, real browser):
   - three-vrm loads the baked VRM: `vrm.meta`, expressions and the spring-bone joint count are unchanged.
   - The exported VRMA plays on a VRM 0.x and a VRM 1.0 target, with pose error ≤ θ_tol versus the editor's evaluation at 10 random times.
   - Golden VRMA files from third-party tools import correctly.
5. **Downstream smoke tests** (later): Bevy loads the baked GLB and finds the named clips (OMOBA CI), and Blender imports the animation-only GLB and the VRMA (VRM add-on).
6. **Hashing**: SHA-256 over the exact output bytes (`crypto.subtle.digest`), shown in the export manifest to match the Registry record.

---

## 11. Recommended pipeline

```
                ┌──────────────────────── IO Worker (pure TS, no React) ────────────────────────┐
 .glb / .vrm ──►│ GlbContainer.parse(bytes) → {json, binView, sha256}   (original kept read-only)│
                │ three GLTFLoader + VRMLoaderPlugin (+DRACOLoader, MeshoptDecoder, KTX2Loader,   │
                │   self-hosted decoders) → display scene + node-index map (parser.associations) │
 .vrma ────────►│ VRMAnimationLoaderPlugin → normalized tracks + expressions + lookAt            │
 .fbx / .bvh ──►│ FBXLoader / BVHLoader + BoneMap preset → retarget (§8)            [P1]         │
                └───────────────────────────────┬──────────────────────────────────────────────┘
                                                ▼
              Project model (.ekzanim): Characters{modelRef sha256, humanoid map, controls, constraints}
                                        Clips{layers: CurveLayer(F-curves) | BakedLayer(streams)}
                                                │ evaluate(t) → PoseBuffer (raw TRS + normalized)
                                                ▼
                        Sampler (fps, loops, steps) → hemisphere fix → reducer (§6.4)
        ┌───────────────────────┬──────────────────────┬────────────────────┬────────────────────┐
        ▼                       ▼                      ▼                    ▼                    ▼
 (1) Bake into original   (2) Animation-only GLB  (3) VRMA (1 clip)    (4) Project file     Adapters (later)
 GLB/VRM: append-only     glTF Transform doc:     glTF Transform +     zip: manifest.json,  BVH, FBX (MIT lib),
 surgeon (§5), raw        skeleton nodes (same    VRMC_vrm_animation   project.json,        Ekza shared clip,
 nodes, marker            names/rest TRS), no     ext (§7.4),          models/<sha256>.*,   OMOBA motion rows
 ekza_animator_bake_v1    mesh, raw channels      normalized, 30 fps   thumbs/
        └───────────────── gltf-validator + Ekza lints + sha256 manifest (§10) ─────────────────┘
```

Suggested module boundaries (all framework-free so they also run in Node for CLI and CI):

| Module | Contents |
|---|---|
| `anim-core` | curves, tangent solver, Euler/quaternion math, rotate-order mapping, Euler filter, sampler, reducer |
| `io-gltf` | GLB container read/write, surgeon, accessor writer, animation-only GLB writer (glTF Transform), validator wrapper |
| `io-vrm` | humanoid tables (VRM0/1 names, required sets, parent map), normalized ↔ raw, facing and mirror, VRMA read/write, expression mapping |
| `io-interop` (P1/P2) | BVH read/write, FBX import + exporter adapter, bone-map presets (Mixamo, Rigify `DEF-*`, UE, `Bip01`) |

**Project file `.ekzanim`** (target 4):
- A zip (`fflate`, MIT) with `manifest.json` (`{format:"ekza-animator-project", schema, appVersion}`), a deterministic `project.json` (sorted keys, stable IDs, JSON Schema published in the repo, forward migrations), optional `models/<sha256>.{vrm,glb}` (embedded originals: required for an offline, self-contained project; optional when the model comes from the Ekza Registry by id + sha256) and `thumbs/`.
- Stable string IDs for every character, control, curve and key keep the model mappable to Yjs `Y.Map` for the planned collaboration mode. Arrays are only for ordered key lists, and those are sorted by frame anyway.

---

## 12. MVP vs later

**MVP must-have (IO scope)**
1. GLB/VRM 0.x/1.0 import with Draco, meshopt and KTX2 decoders (self-hosted, not a third-party CDN), a node-index map, and a VRM humanoid map.
2. Embedded clip import → baked raw tracks, plus a normalized view for VRMs.
3. VRMA import (humanoid + expressions + lookAt).
4. Sampler (fps, loops, steps), hemisphere fix, error-bounded reducer.
5. **Bake into original** via the surgeon with `ekza_animator_bake_v1` rollback, in-place replacement of same-name clips, and Bevy/Registry lints.
6. **VRMA export** (one clip per file, identity-rest skeleton, LINEAR, 30 fps).
7. **Animation-only GLB export.**
8. `.ekzanim` project save and load with schema version 1.
9. glTF-Validator in a Worker, plus surgeon byte-preservation and VRMA round-trip tests on CC0 fixtures.
10. The rotate-order mapping, Euler filter and VRM0/1 facing conversion in one tested module.

**Later**
- FBX/BVH import (P1).
- `.gltf` multi-file import, convert-to-GLB (P1).
- BVH export (P1/P2).
- FBX export adapter (P2).
- CUBICSPLINE "compact" mode for plain GLB.
- snorm16 rotation quantization option.
- "Optimize file" (glTF Transform prune, only when all extensions are known).
- Embedded editable-curve source in exported GLBs (`animations[i].extras.ekza_animator_curves_v1` + a hash of the sampled data), so a re-import restores curves.
- `KHR_animation_pointer` for prop, material and camera animation.
- Spring-bone simulation bake for non-VRM consumers.
- Ekza JSON adapters.
- IK-aware retargeting (foot locking).
- Quaternion-slerp rotation curves.

---

## 13. Risks and open questions

**Risks**
- *Embedded clips disable Space's shared library.* Baking a single custom clip into a VRM removes Space's `idle`/`walk` (§5.5). This needs a renderer change or a preset warning.
- *OMOBA builder and marker interplay.* Both tools append. Rollback must never cross another tool's baseline. Users should bake source VRMs, not renditions.
- *three-vrm-animation silently mis-reads CUBICSPLINE and non-1:1 channel or track layouts*, so the VRMA writer must stay strictly LINEAR or STEP and humanoid/expression/lookAt only.
- *Rotate-order and handedness mistakes* (Maya `xyz` vs three `'XYZ'`; VRM 0.x −Z facing) are the classic source of "the arm bends backwards". Mitigate with one tested module and golden poses.
- *Name-based binding*: three re-sanitizes names and Bevy needs a named ancestor path. Never rename nodes, and lint for missing or duplicate names.
- *Young third-party libraries* (FBX writers, `gltf-transform-vrm-extensions`) may change or be abandoned. Keep them behind interfaces and never on the lossless path.
- *glTF-Validator npm cadence*: the last release was 2024-10. It is fine for core glTF, but it does not validate VRM extensions. Evaluate the VRM consortium's validator for VRM-specific checks.

**Open questions (owner or other researchers)**
1. Should `ekza-avatar-renderer` always load the shared library and fill name gaps (drop the `embedded.length === 0` gate)? Recommended: yes.
2. Default project fps: 30 (matches VRMA) or 24 (matches the OMOBA library)? Recommendation: 30, with 24 and 60 selectable per clip.
3. Should Ekza standardize on **VRMA** as the cross-runtime humanoid clip asset (renderer, OMOBA, Registry `vrma-humanoid-v1`) and retire the two bespoke JSON formats over time?
4. Animation-only GLB for Blender: bones without a skin may import as empties rather than an armature. Should we include the source mesh ("full GLB with clips") or a minimal skin? This needs a Blender test.
5. When baking expressions for non-VRM consumers (OMOBA GLB), should material/texture-transform expression binds be dropped (they need `KHR_animation_pointer`) or should the bake be refused when such binds exist?
6. Should editable curve source be embedded in uploads at all (privacy and size), or only in "working file" exports?

---

## 14. Ekza compatibility conventions (must stay compatible)

| Convention | Where | Our rule |
|---|---|---|
| Normalized, rest-relative, parent-local humanoid rotations; VRM 1.0 (+Z) facing as canonical; VRM 0.x via `(−x, y, −z, w)` | `ekza-avatar-renderer/src/humanoidRetarget.ts` (`flipYawQuaternion`, `retargetHumanoidClip`), `scripts/bake-shared-animations.mjs` | Same canonical space as VRMA. The `io-vrm` facing helper must produce identical numbers |
| Hips = world position / hips rest height, rescaled by the target's hips height | renderer (`readHipsRestHeight`), VRMA loader, three-vrm Mixamo example | Same. VRMA writes absolute hips with `restHipsPosition` |
| Missing optional bones: recompose world deltas and re-parent to the nearest driven ancestor | renderer `composeWorldRotations`, VRMA spec | Same rule in `io-vrm` |
| Embedded clips target raw bones and load with `autoUpdateHumanBones: false`; normalized clips need `true` | renderer `vrm.ts`, `sharedAnimations.ts` | Editor uses a single writer per bone (§4.1); bakes always write raw |
| VRM 0.x thumb aliases | bake script `VRM0_BONE_ALIASES`, three-vrm `thumbBoneNameMap` | Same table |
| Constant-track collapse (ε 4e-3 on int16 quaternions); fixed fps; evenly spaced times | renderer library | Adapter only. Our reducer is error-bounded instead |
| World rotation deltas `D = R_world(t)·R_world_rest⁻¹`; mirror `(x, −y, −z, w)`; hemisphere continuity; 24 fps; `contacts`; `looping` | `omoba-bevy/scripts/export_humanoid_motion.py`, `retarget_animations.py`, `assets-src/animations/README.md` | `D = Π N`. Expose a mirror command. Carry `contactSeconds` and `loop` in `ekza_animation_v1` |
| Append-only GLB injection with a baseline marker; LINEAR float32; idempotent re-run | `omoba-bevy/scripts/retarget_animations.py` (`omoba_retarget`) | The surgeon generalizes it with its own key `ekza_animator_bake_v1` |
| Model metadata `extras.ekza.avatar.heightScale` (root `extras` or `asset.extras`) | renderer `normalization.ts` | The surgeon never touches it |
| Registry rendition rules: self-contained GLB, skins, named clips with int `target.node`, ≤ 50 MiB | `ekza-registry` `profile_checks.py`, migration `202609190001_game_integration.sql` | Lints in the export dialog per target profile |

---

## Sources

- glTF 2.0 specification, Animations §3.11 and Appendix C: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html (source: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc)
- Animation sampler schema: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/animation.sampler.schema.json
- KHR_animation_pointer (Complete, Ratified): https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md ; glTF Object Model: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/ObjectModel.adoc
- three.js r186 sources (inspected): https://unpkg.com/three@0.186.1/examples/jsm/loaders/GLTFLoader.js , https://unpkg.com/three@0.186.1/examples/jsm/exporters/GLTFExporter.js , https://unpkg.com/three@0.186.1/examples/jsm/exporters/USDZExporter.js , https://unpkg.com/three@0.186.1/examples/jsm/loaders/FBXLoader.js , https://unpkg.com/three@0.186.1/examples/jsm/loaders/BVHLoader.js
- three-animation-pointer plugin: https://github.com/needle-tools/three-animation-pointer
- glTF Transform: https://gltf-transform.dev/ ; core 4.5.1 (inspected): https://unpkg.com/@gltf-transform/core@4.5.1/dist/index.js ; resample: https://gltf-transform.dev/modules/functions/functions/resample ; keyframe-resample: https://github.com/donmccurdy/keyframe-resample-wasm
- gltf-transform-vrm-extensions: https://www.npmjs.com/package/gltf-transform-vrm-extensions
- VRM 1.0 humanoid: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md ; T-pose: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md
- VRM Animation spec: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md ; pose conversion: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md ; https://vrm.dev/en/vrma/
- three-vrm: https://github.com/pixiv/three-vrm ; three-vrm-animation 3.5.5 (inspected): https://unpkg.com/@pixiv/three-vrm-animation@3.5.5/lib/three-vrm-animation.module.js ; three-vrm-core 3.5.5 (`VRMHumanoidRig`, `v0v1PresetNameMap`): https://unpkg.com/@pixiv/three-vrm-core@3.5.5/lib/three-vrm-core.module.js ; Mixamo example: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js
- VRM 0.x → 1.0 facing (secondary): https://scrapbox.io/ke456memo/VRM%E3%81%AE%E5%90%91%E3%81%8D%E3%81%AE%E8%A9%B1
- bvh2vrma (MIT): https://github.com/vrm-c/bvh2vrma (`src/lib/bvh-converter/VRMAnimationExporterPlugin.ts`)
- VRM Add-on for Blender: https://extensions.blender.org/add-ons/vrm/
- glTF-Validator: https://github.com/KhronosGroup/glTF-Validator ; issue codes: https://github.com/KhronosGroup/glTF-Validator/blob/main/ISSUES.md ; npm: https://www.npmjs.com/package/gltf-validator
- Bevy glTF 0.19 (supported extensions, animation loading): https://docs.rs/bevy_gltf/0.19.1/bevy_gltf/
- FBX writers: https://github.com/Comfy-Org/fbx-exporter-three , https://github.com/fourthtemple/three-js-fbx-exporter ; assimpjs: https://github.com/kovacsv/assimpjs
- Maya Graph Editor tangents: https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Animation/files/GUID-43A4FE2C-4863-4EA6-B6AE-6D2B6757F6C7.htm ; keyTangent: https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Tech-Docs/Commands/keyTangent.html
- Animation Compression Library (error metric reference): https://github.com/nfrechette/acl
- Local Ekza code inspected (read-only): `ekza-avatar-renderer` (`src/humanoidRetarget.ts`, `src/vrm.ts`, `src/sharedAnimations.ts`, `src/AvatarModel.tsx`, `scripts/bake-shared-animations.mjs`, `test/fixtures/vrm1-sample.vrm`), `omoba-bevy` (`scripts/retarget_animations.py`, `scripts/export_humanoid_motion.py`, `scripts/ekza_publish.py`, `assets-src/animations/README.md`), `ekza-registry` (`backend/app/services/profile_checks.py`, `supabase/migrations/202609190001_game_integration.sql`), `bevy_gltf 0.19.1` crate source.
