# 12 — Low-poly game asset and character workflow

- Date: 2026-10-18
- Scope: what a low-poly artist needs to take a stylized character and a prop from an empty scene to files that pass
  the Ekza profiles (Ekza Space, OMOBA). Covers style targets, triangle budgets, deformation topology, colour and UV
  strategy, normals, materials, LODs, export validation and an end-to-end acceptance scenario. The modeling tool
  map, the mesh kernel and the rigging/skinning maths are covered in sibling notes. This note sets the **requirements**
  those notes must satisfy for low-poly work.
- Method: specs and loader sources read at pinned versions (glTF 2.0 spec source, three.js r186 `GLTFLoader` /
  `GLTFExporter` / `BufferGeometryUtils`, Bevy `v0.19.1` `bevy_gltf`, VRM 1.0 and MToon 1.0 specs,
  `@pixiv/three-vrm-materials-mtoon@3.5.5`, `meshoptimizer@1.3.0` typings). Sibling Ekza repositories were read
  without changes (`omoba-bevy`, `ekza-registry`, `core`). The shipped OMOBA GLBs and our two sample avatars were
  measured with a throwaway GLB-JSON parser in a scratch directory (triangles = index count / 3, vertices =
  `POSITION.count`, PNG headers for texture sizes, skin-weight histograms). Nothing measured was modified.
- Status: research input for the modeling iteration plan. Budgets and defaults are proposals until the owner
  accepts them (§15).

---

## 0. Decisions in one screen

| # | Decision | Why (evidence) |
|---|---|---|
| L1 | **Low-poly = polygonal box modeling of stylized characters and props, palette-coloured, game-ready.** No sculpting, no NURBS surfaces, no texture painting, no normal maps in this iteration. | The owner's ask ("good base, no crazy complexity"). Every shipped OMOBA prop is authored this way: 76–1,464 triangles, flat colours, no textures (§1.2). |
| L2 | **The editable colour truth is a per-face palette index**, not UVs and not vertex colours. UVs, `COLOR_0` or per-colour materials are *derived at export*. | One source gives three outputs: a palette texture (works everywhere, including MToon), vertex colours (no texture) or one material per colour (OMOBA's current prop style). Recolouring and team-colour variants become one palette edit. |
| L3 | **Default export: one material + one small palette PNG per asset**, with every face corner's UV collapsed onto its swatch centre. | MToon 1.0 states "In MToon, vertex colors are ignored"; three-vrm's `MToonMaterial` defaults `ignoreVertexColor = true`. A collapsed UV has zero screen-space derivatives, so the GPU samples mip 0 at the swatch centre: exact colour, no mip bleeding (§4.3). One material = one draw call (VRChat's mobile "Excellent" rank allows exactly 1 material slot). |
| L4 | **Hard/soft edges are an edge flag; export splits vertices along hard edges and always writes `NORMAL`.** The viewport shows exactly what the file will show. | glTF has one index per vertex for all attributes, so faceting needs split vertices. Omitting `NORMAL` ("implicit flat normals") works in three.js and Bevy but not reliably elsewhere and breaks MToon outlines (§5). |
| L5 | **Rest pose is the VRM 1.0 T-pose, authored from a built-in humanoid template** with identity rest rotations, ~21 joints, grounded at Y = 0, facing +Z. | Space requires VRM 1.0 (`vrm-humanoid-v1` ↔ `vrm1`). The T-pose definition is normative (arms parallel to X, palms −Y, feet along +Z, grounded at Y = 0, positive uniform scale). Identity rests make VRMA export trivial (02 D5). |
| L6 | **Two first-class skinning styles: smooth (≤ 4 influences) and rigid/segmented (1 influence).** | Our low-poly sample Polybot has 95 % single-influence vertices; OMOBA's Verdant Dragon is 100 % rigid. Rigid skinning is a legitimate low-poly look *and* the easiest auto-skin result. |
| L7 | **An authored character must become the same document records as an imported VRM**, so FK/IK controls, Dope Sheet, Graph Editor, VRMA export and Ekza lints work with no extra step. | This is what makes the tool "turnkey": modeling feeds the M1/M2a animation stack unchanged (FR-RIG-01). |
| L8 | **A new "author" writer exports models built in the editor** (full VRM 1.0 / GLB from the document). The surgeon (append-only bake) stays for imported files only. | A model made from scratch has no original bytes to preserve. glTF Transform plus write-only `VRMC_vrm` / `VRMC_materials_mtoon` extension classes, deterministic output. |
| L9 | **Budgets are advisory presets, not registry rules.** Technical limits that break a runtime are errors. | The registry has no triangle limits. Bevy truncates to `JOINTS_0`/`WEIGHTS_0` and caps skins at 256 joints. The handheld profile rejects any extension other than `KHR_materials_unlit`/`KHR_texture_transform`, wherever it appears in the JSON. |
| L10 | **No LODs in this iteration.** A generic "Reduce" operator (meshoptimizer) is a later item that also serves AI-generated meshes. | At 1.5–3k triangles a character needs no LOD. No Ekza consumer reads glTF LODs: `MSFT_lod` is absent from the three r186 `GLTFLoader` list and from the Bevy 0.19.1 extension table. |
| L11 | **Validation is part of the workflow, not a final step**: a live budget HUD and a "game-ready" checklist per target profile, then glTF-Validator, VRM validator and Ekza profile lints at export. | Extends the existing lint system (ADR 0010 §4) with `mesh.*`, `vrm.tpose.*` and `ekza.handheld.*` codes (§10.3). |
| L12 | **Interaction vocabulary follows Maya, with Blender's best low-poly ideas** (modal numeric extrude, adjust-last-operation panel, smooth-by-angle, rotate edge, select similar). | It matches the animation side and the owner's muscle memory. Low-poly needs no Maya-only feature, so nothing is lost by borrowing Blender's faster modal ideas (§12). |

---

## 1. What "low-poly" means for Ekza

### 1.1 Style families the tool must support

| Family | Look | Geometry | Colour | Shading in file | Typical Ekza use |
|---|---|---|---|---|---|
| **Faceted** | visible flat facets, crisp silhouettes | 50–3k tris, hard edges everywhere | flat palette swatches | split vertices, per-face normals | OMOBA props, weapons, environment |
| **Smooth palette** | soft toy-like forms, flat colour zones | 1.5–5k tris, mostly soft edges, hard at creases | flat swatches (optionally ramps) | shared vertices, soft normals | characters (Polybot-like), creatures |
| **Segmented / rigid** | robot, toy, puppet; parts never stretch | separate shells per bone | flat swatches | either | robots, mechs, stylized NPCs |
| **Toon-lit** | any of the above under cel shading | same | same | same + MToon on VRM | Ekza Space avatars |

Out of scope for this iteration: hand-painted textures, texel-density-driven unwrapping, PBR texture sets, normal or
AO bakes, the PS1-style "affine textures + vertex jitter" look (a render-side effect, not a modeling one).

### 1.2 Measured Ekza reference assets

| Asset (repo) | Tris | Verts | Verts/tri | Materials | Textures | Joints | Skin style | File |
|---|---:|---:|---:|---:|---|---:|---|---:|
| OMOBA world props: colossus, hook, lantern, orb, pillar (`client/assets/cosmetics/standard`) | 76–120 | 160–232 | 1.9–2.3 | 2–3 unlit | none | – | – | 8–10 KB |
| OMOBA Wildspark rocket / trap | 808–820 | 1,368–1,656 | 1.7–2.1 | 4 | none | – | – | 51–63 KB |
| OMOBA handhelds: dagger, scepter, hammer, sword, bow, repeater (`client/assets/weapons`) | 222–352 | 370–648 | 1.7–1.9 | 3–5 (mostly unlit) | none | – | – | 16–26 KB |
| OMOBA ranged handhelds: launcher, Wildspark repeater | 1,044–1,464 | 1,968–2,472 | 1.7–1.9 | 5 | none | – | – | 74–75 KB |
| OMOBA boss "Verdant Dragon" | 2,092 | 5,624 | 2.7 | 6 | none | 9 | **100 % rigid** | 319 KB (with Idle/Walk) |
| Polybot (our VRM 0.x sample, CC0) | 2,130 | 1,722 | 0.81 | 1 (unlit + MToon) | one 1024² PNG, 186 KB, 2,314 unique colours | 55 | **95 % rigid** | 0.97 MB |
| 15 bundled OMOBA avatar GLBs (VRM 0.x) | 6,200–15,858 (median 11,223) | 6,447–29,012 | 0.6–3.9 | 1–3 | 1–3 PNGs, 1024²–2048² | 40–75 | smooth | 5.0–11.3 MB |
| Seed-san (our VRM 1.0 sample) | 45,058 | 34,059 | 0.76 | 17 | 15 PNGs | 5 skins (23/7/1/21/80) | smooth | 10.9 MB |

What the numbers say:

1. **Project-authored OMOBA art is already low-poly and flat-shaded** (verts/tri ≈ 2 means split vertices per face)
   and uses **one unlit material per colour with no textures**. Our tool should reproduce this style natively and
   offer a cheaper single-material variant of it.
2. **Bundled third-party avatars are 3–7× heavier** than the owner's 1.5–3k target and carry 1–5 MB PNGs. A 2048²
   RGBA8 texture is 16 MiB of GPU memory before mips. A palette sheet is ≤ 64 KiB (§4.3). For OMOBA on phones this is
   the single biggest saving low-poly authoring buys.
3. **Rigid skinning is common** in the low-poly references we already ship, so the auto-skin step must offer it.

---

## 2. Budgets

### 2.1 External reference points (verified)

| Source | Triangles | Materials | Bones | Other |
|---|---|---|---|---|
| VRChat mobile "Excellent" / "Good" / "Medium" / "Poor" | 7,500 / 10,000 / 15,000 / 20,000 | 1 / 1 / 2 / 4 | 75 / 90 / 150 / 150 | skinned meshes 1 / 1 / 2 / 2; texture memory 10 / 18 / 25 / 40 MB |
| VRChat PC "Excellent" / "Good" | 32,000 / 70,000 | 4 / 8 | 75 / 150 | – |
| Bevy 0.19.1 `bevy_gltf` | – | – | `MAX_JOINTS = 256` per skin | only `JOINTS_0`/`WEIGHTS_0` read (4 influences) |
| three.js r186 `GLTFLoader` | – | – | – | only `JOINTS_0`/`WEIGHTS_0` mapped (`skinIndex`/`skinWeight`) |
| OMOBA humanoid validator | – | – | ≤ 64 human bones, ≤ 4096 nodes | ≤ 50 MiB, JSON ≤ 4 MiB |
| OMOBA / registry handheld profile | – | – | static only | ≤ 8 MiB, ≤ 64 nodes, ≤ 16 meshes, ≤ 512 primitives |

OMOBA runs the **same** `omoba / desktop / humanoid-glb-v1` selector on iOS and Android
(`omoba-bevy/docs/ekza-production-avatars.md`), so "desktop" assets are in practice mobile assets. Ekza Space is a
three.js page that also runs on phones. The low-poly preset therefore targets **mobile first**.

### 2.2 Proposed budget presets (advisory; warnings, never export blockers)

Triangles are counted after triangulation, over all primitives of the asset.

| Asset class | `lowpoly-mobile` target | warn above | `web` warn above | `pc` warn above | Notes |
|---|---:|---:|---:|---:|---|
| Hero / player character | 1,500–3,000 | 5,000 | 10,000 | 32,000 | owner's target; Polybot 2,130; VRChat mobile Excellent 7,500 |
| NPC / minion (crowds) | 300–1,000 | 1,500 | 3,000 | 10,000 | many on screen at once |
| Boss / large creature | 2,000–6,000 | 8,000 | 15,000 | 32,000 | Verdant Dragon 2,092 |
| Handheld weapon / tool | 100–600 | 1,500 | 3,000 | 5,000 | OMOBA 222–1,464 |
| Small world prop | 50–300 | 800 | 2,000 | 5,000 | OMOBA 76–120 |
| Medium prop / structure | 300–1,500 | 3,000 | 6,000 | 15,000 | – |
| Building / landmark | 1,000–5,000 | 8,000 | 15,000 | 40,000 | – |

Per-asset resource presets for `lowpoly-mobile`:

| Resource | Character | Prop | Rule type |
|---|---|---|---|
| Materials (draw calls) | 1 (warn > 2) | 1 (warn > 4) | budget warning |
| Textures | one palette sheet ≤ 128² (warn > 256²); with a decal region ≤ 512² | same | budget warning |
| Skinned meshes | 1 (warn > 2) | 0 | budget warning |
| Joints | template 21–33 (warn > 75) | – | budget warning; **error > 256** (Bevy) |
| Influences per vertex | ≤ 4, prefer ≤ 2 | – | **error > 4 at export** (pruned with a warning instead of silently truncated by runtimes) |
| Vertices per primitive | ≤ 65,535 (uint16 indices) | same | info: switch to uint32 otherwise |
| Image size | ≤ 4096² each, ≤ 32 MP total | same | warning; **error** for the handheld profile (the registry's browser preflight bounds for handhelds) |

### 2.3 Triangle allocation for a 2k humanoid (guide, shown in the template's help)

| Region | Tris | Cross-section | Notes |
|---|---:|---|---|
| Head + hair | 350–500 | 8–10 sides | largest silhouette share; eyes as painted faces |
| Neck | 20–40 | 6–8 sides | 1 loop |
| Torso + hips | 350–450 | 8–10 sides | waist loop, chest loop, hip diagonals |
| Arms (×2) | 140–220 each | **6–8 sides** | ≥ 2 loops at elbow, shoulder + armpit loops |
| Hands (×2) | 60–150 each | mitten + thumb | full fingers only with the finger option (§8.1) |
| Legs (×2) | 200–280 each | **6–8 sides** | ≥ 2 loops at knee, hip loop |
| Feet (×2) | 50–100 each | box | toe loop if `toes` joints are used |
| **Total** | **≈ 1,900–2,800** | | |

Rationale: at OMOBA's top-down camera a character covers a small part of the screen, so silhouette and colour read
first. Six to eight sides per limb is the usual low-poly cross-section that still deforms. Extra triangles go to the
head and to joint loops, not to straight limb segments.

---

## 3. What each Ekza runtime actually supports

Verified in source at the pinned versions. A tick means the runtime renders the feature as authored.

| Feature | three.js r186 `GLTFLoader` (Space props, our viewport) | three-vrm 3.5.5 MToon (Space avatars) | Bevy 0.19.1 `bevy_gltf` (OMOBA) | Registry / OMOBA validators |
|---|---|---|---|---|
| `COLOR_0` vertex colours | ✓ (`material.vertexColors = true`; kept linear, warns if the working colour space is not linear) | **✗ ignored** (spec: "vertex colors are ignored"; `ignoreVertexColor` defaults to true) | ✓ (`Mesh::ATTRIBUTE_COLOR`, RGB/RGBA, u8/u16/f32) | allowed |
| Missing `NORMAL` | ✓ `flatShading = true` | – (MToon outlines need normals) | ✓ duplicates vertices and computes flat normals | allowed |
| Split-vertex hard edges | ✓ | ✓ (outline cracks at splits, §5.3) | ✓ | allowed |
| `KHR_materials_unlit` | ✓ `MeshBasicMaterial` | MToon takes precedence when both exist | ✓ `unlit` | allowed, the only extension besides `KHR_texture_transform` that may be required |
| `VRMC_materials_mtoon` | via three-vrm | ✓ | ✗ (renders the core glTF material) | allowed on VRM, **rejected** on handheld |
| Sampler `NEAREST`/`LINEAR` | ✓; mipmaps generated only for mipmap min filters | ✓ | ✓ mapped 1:1 from the glTF sampler; PNGs get no generated mips | – |
| `JOINTS_1`/`WEIGHTS_1` (> 4 influences) | ✗ | ✗ | ✗ | – |
| `KHR_mesh_quantization`, `EXT_meshopt_compression`, Draco | ✓ | ✓ | **✗** | handheld rejects all of them |
| `MSFT_lod` / glTF LODs | ✗ | ✗ | ✗ | – |
| `KHR_materials_variants` | ✗ (core) | ✗ | ✗ | – |

Consequences:

- Anything that must look the same in Space (MToon) and in OMOBA (core material) needs its colour in the **base
  colour texture**. Vertex colours are fine for plain GLB props and never for VRM avatars.
- Ekza exports never use mesh compression or quantization. At low-poly sizes it saves nothing worth the
  incompatibility (§10.1 size estimate).
- The OMOBA look (unlit painted colours) and the Space look (MToon toon shading) come from **one file**: core
  material = palette texture + `KHR_materials_unlit` (OMOBA), plus `VRMC_materials_mtoon` on VRM exports (Space).
  Polybot is built exactly this way.

---

## 4. Colour, UVs and materials

### 4.1 Options compared

| Option | How it works | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Palette sheet + collapsed UVs** | Each face corner's UV is set to the centre of its swatch in a small PNG | Works in every runtime including MToon; 1 material; recolour = edit the PNG; team-colour variants = another PNG | Colour boundaries split vertices (a UV seam) | **Default** |
| **B. Gradient ramps** | Swatch is a vertical ramp; face UV.v follows a projection axis | Cheap gradients (foliage, sky-lit tops) | UVs no longer collapsed, so mips matter; needs cell padding | Should-have (§4.3) |
| **C. Vertex colours (`COLOR_0`)** | Per-corner linear RGB | No texture at all; per-vertex blends | **Ignored by MToon**; colour seams still split vertices; colour-space conversion trap | Export option for plain GLB props |
| **D. One material per colour** | Faces grouped into primitives per palette index | No texture, no UVs; matches OMOBA's existing props | One draw call per colour; many primitives | Export option (OMOBA-style props) |
| **E. Unwrapped painted texture** | Real UV layout + painted image | Detail (faces, logos) | Needs an unwrap tool and a painter: scope explosion | Later; a **decal region** covers faces/eyes (§6) |

### 4.2 Data model requirement (for the mesh kernel note)

| Level | Attribute | Notes |
|---|---|---|
| Document | `Palette { id, swatches: [{ id, name, srgb: [r,g,b], kind: 'flat' \| 'ramp', ramp?: [srgbA, srgbB] }] }`, shared by assets | sRGB in the UI and in storage; converted only at export |
| Face | `paint: swatchId` (default: the palette's first swatch), `materialSlot` (default 0) | the editable truth for colour |
| Face (optional) | `uvOverride` (decal projection into a texture region) | only for decal faces |
| Edge | `hard: boolean` | §5 |
| Vertex | position; skin weights (sparse `jointId → weight`) | weights live on topological vertices, never on corners (§8.4) |
| Derived at export | corner UV (from `paint` or `uvOverride`), corner normal (from hard edges), `COLOR_0` (option C), primitive grouping (option D) | never stored as authoring data |

Operators the paint data needs: *Paint face* (click/drag over faces), *Fill* (connected faces of the same swatch),
*Select by swatch* (Blender's "select similar"), *Replace swatch*, *Palette swap* (map swatch → swatch for a variant),
*Sample* (eyedropper from a face). All are ordinary undoable operators (08 D4).

### 4.3 Palette sheet specification (proposed `ekza-palette-v1`)

- **Layout**: 8 × 8 grid of **8 × 8 px cells → 64 × 64 px** (64 swatches). Larger palettes double to 128 × 64 then
  128 × 128 (256 swatches). Ramp cells occupy a full column (8 px wide, sheet-tall) on the right edge.
- **UV of a flat swatch** `s` at cell `(i, j)`: `((i + 0.5) / cols, (j + 0.5) / rows)` for every corner of every face
  painted with `s`.
- **Why it is exact**: all corners of a triangle share one UV, so `dFdx(uv) = dFdy(uv) = 0`, the GPU selects mip 0
  and samples the cell centre. Bilinear filtering at the centre of a ≥ 2 px uniform cell returns the cell colour.
  The colour shifts with distance that palette users report (small but *non-collapsed* islands at high mip levels)
  cannot occur. Ramp faces are not collapsed, so ramps get a 1 px gutter and a ≥ 4 px cell width.
- **Sampler**: `magFilter: NEAREST (9728)`, `minFilter: LINEAR (9729)`, `wrapS/T: CLAMP_TO_EDGE (33071)`. three.js
  then skips mip generation (it generates mips only for mipmap min filters) and Bevy has none to use, so the behaviour
  is the same in both runtimes.
- **Encoding**: PNG, 8-bit RGB (alpha only if a swatch is transparent), **sRGB-encoded** as glTF requires for
  `baseColorTexture`. Embedded through a `bufferView` with `mimeType: "image/png"`. Never a `uri`, never WebP/KTX2
  (needs extensions that Bevy and the handheld profile do not accept).
- **Determinism**: the PNG encoder runs with fixed settings and no timestamp chunks, so the same palette gives
  byte-identical images (03 §6.1 determinism rule).
- **Variants**: a team-colour or skin variant is a second palette sheet. It is exported as a separate file
  (`hero_red.vrm`, `hero_blue.vrm`), because `KHR_materials_variants` has no Ekza consumer. A runtime palette swap
  in OMOBA would be a game-side feature (open question Q-LP-4).

### 4.4 Material presets

| Preset | Core glTF material (what Bevy and plain three.js render) | VRM add-on (what Space renders) | Default for |
|---|---|---|---|
| **Unlit palette** | `baseColorTexture` = palette, `baseColorFactor` = 1, metallic 0, roughness 1, `KHR_materials_unlit` (in `extensionsUsed`, never `extensionsRequired`) | `VRMC_materials_mtoon` with `shadeColorFactor` = 1, `shadingToonyFactor` = 1, `outlineWidthMode: none`, so it also looks unlit in Space | **props, OMOBA heroes** (OMOBA's "unlit painted" art direction) |
| **Toon palette** | same as unlit | MToon with shade colour ≈ 0.7–0.8 × lit, toony 0.9, shift 0 | **Space avatars** |
| **Lit palette** | same texture, metallic 0, roughness 1, no unlit | MToon as above | props in lit scenes |

`alphaMode` is `OPAQUE`; `MASK` only for cut-out cards (leaves); `doubleSided` false unless a face is flagged
two-sided (thin cards). Emissive is off. `KHR_materials_emissive_strength` is never written in Ekza profiles,
because the handheld validator rejects it.

### 4.5 Colour-space rules (classic trap)

- UI colour pickers and stored swatches are **sRGB**.
- PNG texels are **sRGB** (glTF requires it for base colour).
- `baseColorFactor` and `COLOR_0` are **linear**: "the factor value is a linear multiplier", and `COLOR_0` "values
  are used as-is" (glTF 2.0, *Metallic-Roughness Material*). Convert with the exact sRGB EOTF when writing them.
- Round-trip test: export → re-import → sample each face → equals the swatch within 1/255.

---

## 5. Normals, hard edges and triangulation

### 5.1 Authoring model

- **Edge flag `hard`** (Maya *Harden/Soften Edge*, Blender *Mark Sharp*). New primitives in the low-poly template
  start **all hard** (faceted). *Soften/Harden by angle* (Maya *Set Normal Angle*, Blender *Smooth by Angle*) sets
  flags from the dihedral angle (default 30°). It is a one-shot operator, not a live modifier: Blender 4.1 moved
  auto-smooth into a modifier, and users reported the friction of re-applying it after edits.
- Smooth normals are area- and angle-weighted averages over the faces around a vertex inside each smoothing region
  bounded by hard edges.
- The viewport derives normals the same way the exporter does: **WYSIWYG**. There is no separate "flat shading"
  viewport mode that the file would not reproduce.

### 5.2 glTF encoding

- glTF uses one index per vertex for all attributes ("it is not possible to specify separate index values for
  positions and normals"). The exporter builds corner keys `(vertexId, normal, uv, colour)`, deduplicates them and
  writes `NORMAL` explicitly.
- Cost of faceting: a quad-dominant faceted mesh needs ≈ 2 vertices per triangle (4 per quad), against
  ≈ 0.5–0.8 for smooth meshes (measured: OMOBA props 1.7–2.3 vs avatars 0.6–0.8). At 3k triangles that is ≈ 6k
  vertices, about 0.3 MB of attributes. The cost is negligible, so the tool never trades shading correctness for
  vertex count.
- **Not used: omitting `NORMAL`** to get "implicit flat normals". The spec allows it, three.js and Bevy honour it,
  but not every importer computes them (CesiumJS, for example, renders such models unlit). It also cannot express
  mixed hard/soft shading. At most it could be a later size option for fully faceted static props.

### 5.3 Pitfalls the tool must surface

| Pitfall | Effect | Tool response |
|---|---|---|
| Non-planar quad on a faceted mesh | the hidden diagonal shows as a crease, and changing triangulation changes the look | *Show triangulation* overlay; *Flip/Spin triangle edge* (Maya *Flip Triangle Edge*, Blender *Rotate Edge*) stored as a per-face diagonal choice; deterministic triangulation so the export matches the viewport; lint `mesh.nonplanar-faceted` (info, > 2°) |
| Concave n-gons | ear-clipping may produce slivers | lint `mesh.ngon-concave` (warning); *Triangulate* operator |
| MToon outline on hard edges | outline extrudes along split normals, leaving gaps at every hard edge | lint `mtoon.outline-hard-edges` (warning); outline off in the presets |
| Collapsed UVs and tangents | MikkTSpace tangents degenerate with zero UV area | harmless without normal maps; the low-poly presets never write `normalTexture` or `TANGENT` |
| Mirrored geometry with negative scale | flipped winding, rejected by OMOBA and VRM | *Mirror* writes real geometry; lint `ekza.positive-uniform-scale` (error) |

---

## 6. UVs beyond the palette

| Need | Tool | Phase |
|---|---|---|
| Flat colour | implicit palette UVs (§4.3) | **iteration (must)** |
| Gradients | ramp swatches + projection axis per face set | iteration (should) |
| Eyes, mouth, emblem | **decal region**: import a PNG into a reserved area of the sheet (e.g. 64² inside a 128² sheet); *Planar project* selected faces into it with move/scale/rotate handles | iteration (should) |
| Box / cylindrical projection for a prop's detail texture | projection operators writing `uvOverride` | later |
| UV editor (view islands, move/scale/rotate, pin) | 2D editor in the curve-editor canvas stack | later |
| Automatic unwrap + packing | `xatlas` (WASM; `xatlas-three@0.2.1`, MIT, last release 2024-09) and `potpack@2.1.0` (ISC) | later (also for AI-generated meshes) |
| Texture painting | – | out of scope |

VRM 1.0 expressions can drive `textureTransformBinds` (offset/scale a texture region). That is the classic
low-poly face-animation trick (blink = swap the eye decal) and needs no blendshapes. It is listed as later work
because neither OMOBA nor Space plays VRM expressions today.

---

## 7. Deformation-friendly topology for low-poly characters

### 7.1 The rest pose dictates the hard joints

VRM 1.0 requires the T-pose: body along +Z, symmetric about X = 0, grounded at Y = 0, arms and hands parallel to X
with palms facing −Y, thumbs 45° between X and +Z, shoulders "relaxed and lowest", all node transforms with positive
uniform scale. Animation then spends most of its time with the arms **down**, about 70–90° from rest (07 §5.2). The
shoulder is therefore the worst-deforming region in every VRM character, and the template must put its extra
geometry there. An A-pose bind would deform better but is not allowed in VRM, so we do not offer it.

### 7.2 Joint-by-joint guidance (encoded in the template and the topology lint)

| Joint | Minimum loops (low-poly) | Placement | Why |
|---|---|---|---|
| Elbow, knee | **2** (one either side of the pivot); 3 at ≥ 3k tris | pivot slightly toward the back of the elbow / front of the knee; loops perpendicular to the bone | a single loop collapses when the joint bends; two loops tolerate imprecise pivots |
| Shoulder | 1 loop at the shoulder ring + **1 armpit support loop**; loops radiate from the deltoid at roughly 45° | the clavicle (`shoulder`) joint carries part of the raise | rest pose is arms-up; the region rotates the most |
| Hip | 1 diagonal loop from crotch to hip crest per side | `upperLeg` pivot at the hip socket, not the pelvis centre | leg raise and sit poses |
| Wrist, ankle, neck | 1 loop | at the pivot | small rotations |
| Waist / spine | 1 loop at each spine joint (`spine`, `chest`) | – | twist and bend |
| Fingers (option) | 1 loop per knuckle | – | only with full fingers |

The Polycount wiki's Limb and Shoulder Topology pages (Brian Tindall's *Articulation* diagrams, the "muscle-contour
vs bendy-straw" comparison) are the reference collection to link from the in-app help.

### 7.3 Rigid / segmented alternative

Separate shells per bone, 100 % weight to one joint, overlaps hidden by ball joints, sleeves or armour rims. Zero
skinning artefacts, trivially auto-skinned, and the look of two of our reference assets (§1.2). The template ships
both a "smooth" and a "segmented" body.

### 7.4 What the tool can check automatically (after the rig is fitted)

| Lint | Rule |
|---|---|
| `topo.joint-loops` | for each mapped joint, count edge loops whose centroid lies within ±25 % of the adjacent bone lengths from the pivot and that encircle the bone axis; warn below the table minimum |
| `topo.symmetry` | every vertex has a mirror partner within 1 mm (when symmetry is on) |
| `mesh.non-manifold`, `mesh.zero-area-face`, `mesh.loose-geometry`, `mesh.inconsistent-winding` | standard hygiene (warnings; zero-area faces are dropped at export) |
| `vrm.tpose.*` | facing +Z, arms within 5° of ±X, feet along +Z, min Y of the bound mesh in [−5 mm, +5 mm] |

---

## 8. Rig and skin requirements for low-poly (maths in the rigging note)

### 8.1 Humanoid template

| Option | Joints | VRM bones |
|---|---:|---|
| Core (default) | 21 | `hips, spine, chest, neck, head`, and per side `shoulder, upperArm, lowerArm, hand, upperLeg, lowerLeg, foot, toes` |
| + `upperChest` | 22 | for long torsos |
| + mitten fingers | 33 | per side: thumb chain (3) + one finger chain (3) mapped to the **middle** finger bones |
| + full fingers | 51 | all VRM finger bones |

- `chest` and `neck` are always present (OMOBA requires them for VRM 0.x, and they cost nothing).
- Rest rotations are **identity**, positions only, so the authored rest is the normalized rest (02 D5, 07 §15).
- Root: a non-humanoid `Root` node at the origin; the skinned mesh node sits at identity (glTF ignores its
  transform: "the transform of the skinned mesh node MUST be ignored").
- Fitting: drag joint markers in front/side views with symmetry. *Auto-fit* places them from the mesh bounds and
  cross-section analysis. VRM T-pose lints run live.

### 8.2 Binding

| Mode | Method | Use |
|---|---|---|
| **Rigid by part** | each connected shell → the joint whose bone segment is nearest its centroid (user can reassign) | segmented style |
| **Rigid by nearest bone** | each vertex → nearest bone segment, restricted to the hierarchy side (Maya *Closest in Hierarchy* idea) | quick start for smooth meshes |
| **Smooth** | distance-falloff or heat-diffusion weights (Maya *Heat Map*, Blender bone heat; Baran and Popović 2007), pruned to ≤ 4 influences and normalized | default for smooth style |
| Later | geodesic voxel binding (Maya; robust on messy or AI meshes) | AI-generated meshes |

### 8.3 Weight tools (minimum set)

Paint *Add / Replace / Smooth / Scale* with a radius brush, *Flood*, *Hammer* (average from neighbours), *Copy/paste
vertex weights*, *Mirror weights* L↔R by VRM bone name, *Prune* (< 0.01), *Normalize*, joint isolate, and a
weight-heat display. Every stroke is one undo step.

### 8.4 Correctness rules (errors at export)

- ≤ 4 non-zero influences per vertex (runtimes read only `JOINTS_0`/`WEIGHTS_0`). Weights are float32 and sum to 1
  within the validator's `2e-7 × nonzero` tolerance. glTF also requires at most one non-zero weight per joint per vertex.
- **Split vertices share weights**: weights live on topological vertices, so faceted splits can never crack.
  Test: under the range-of-motion clip, every pair of exported vertices from one source vertex stays at distance
  ≤ 1e-6 m.
- No vertex without weights; no weights on `Root`.

### 8.5 Range-of-motion (ROM) clip

A built-in clip on any humanoid (generated, not stored): arms down/forward/up, elbows 0–140°, knees 0–120°,
hip flexion, spine twist ±30°, head turn ±60°, 4 s at 30 fps. Artists scrub it while painting weights. It reuses the
animation evaluator, so it costs little. It is how Maya artists test deformation and the most useful single
skinning aid.

---

## 9. LODs

- **This iteration: none.** Characters at 1.5–3k triangles do not need them. No Ekza runtime consumes glTF LOD
  data (§3), and the registry profiles carry one model per rendition.
- **Later: *Reduce* operator** on `meshoptimizer@1.3.0` (MIT): `simplifyWithAttributes` with locked hard-edge and
  palette-seam vertices (`vertex_lock`) and the `Permissive`/`Regularize` flags, plus `remesh` for AI-generated
  meshes. LOD export (separate nodes or files) only once a consumer asks for it, for example Bevy's
  `VisibilityRange` in OMOBA.

---

## 10. Export and validation

### 10.1 Author writer (new; the surgeon stays for imported files)

1. Evaluate the document at rest: meshes with frozen transforms, skins, humanoid map.
2. Triangulate deterministically (stored diagonal choices; ear clipping for n-gons).
3. Build corners → derive normal, UV / colour / primitive grouping per the colour output (A/B/C/D) → deduplicate →
   uint16 indices when < 65,536 vertices.
4. Write with glTF Transform: one buffer, `Scene0` only, TRS nodes only (no `matrix`), positive uniform scales,
   `POSITION`/`NORMAL` float32, `TEXCOORD_0` float32, `JOINTS_0` uint8 (uint16 if > 255 joints), `WEIGHTS_0` float32.
5. VRM: write-only `VRMC_vrm` (specVersion `"1.0"`, humanoid, required meta `name`, `authors`, `licenseUrl`
   `https://vrm.dev/licenses/1.0/`, licence fields from the export dialog) and `VRMC_materials_mtoon` extension
   classes. Clips come from the existing samplers (ADR 0005).
6. Deterministic output: stable key order, no timestamps, fixed PNG encoder settings.

Size estimate for a 2,500-triangle faceted character with 5 clips: ≈ 5k vertices × 52 B ≈ 260 KB of attributes,
≈ 15 KB of indices, < 4 KB palette, ≈ 100 KB of clips (21 joints × 30 fps × ~1.5 s × 5 clips). Under 0.5 MB,
against 5–11 MB for the bundled avatars.

### 10.2 Ekza target profiles

| Export profile (ours) | Registry profile | Must hold |
|---|---|---|
| `ekza/space-avatar-v1` (exists, ADR 0010) | `universal / vrm-humanoid-v1` | VRM 1.0 (`VRMC_vrm` only, never both versions), `humanBones` present, meshes and skins present, GLB ≤ 50 MiB, no `uri` key anywhere (any case), one embedded buffer, 4-byte-aligned chunks, JSON ≤ 8 MiB; Space plays `idle`/`walk` if embedded |
| `ekza/omoba-humanoid-v1` (exists) | `desktop / humanoid-glb-v1` | the above + clips `idle, walk, attack, cast, death` (exact lowercase), JSON ≤ 4 MiB, ≤ 64 human bones, ≤ 4096 nodes, `extensionsRequired ⊆ {KHR_materials_unlit, KHR_texture_transform}`, TRS only, positive uniform scales, required bones incl. both hands |
| **`ekza/omoba-handheld-v1` (new)** | `desktop / handheld-glb-v1` | GLB ≤ 8 MiB, **static** (no skins, no animations), one scene, ≤ 64 nodes, ≤ 16 meshes, ≤ 512 primitives, ≤ 1 M vertices, decoded geometry ≤ 64 MiB, **every `extensions` key, `extensionsUsed` and `extensionsRequired` ⊆ {`KHR_materials_unlit`, `KHR_texture_transform`}**, `POSITION` float VEC3, hashed `asset.extras.ekza_handheld_v1 { bone: rightHand\|leftHand, offset ±0.3 m, rotation_degrees ±360, scale 0.25–2 }`, origin at the grip, +Y along the shaft, +Z towards the fingertips, metres |
| `local/generic` (exists) | – | plain GLB; vertex-colour and per-colour-material outputs allowed |

The handheld row comes from `ekza-registry/backend/app/services/handheld_checks.py` and
`omoba-bevy/docs/profiles/handheld-glb-v1.json`. The registry has no licence file, so the rules are re-implemented
from the documented contract, not copied (03 §2.3).

### 10.3 New lint codes (proposal, same table shape as ADR 0010 §4)

| Code | Rule | Local | Ekza profile |
|---|---|---|---|
| `mesh.budget.tris` / `.materials` / `.textures` / `.joints` | preset thresholds (§2.2) | info / warning | warning |
| `mesh.influences` | > 4 influences (pruned on export) | warning | error if unpruned |
| `mesh.weights-unnormalized`, `mesh.unweighted-vertex` | §8.4 | error | error |
| `mesh.zero-area-face`, `mesh.non-manifold`, `mesh.loose-geometry`, `mesh.inconsistent-winding` | hygiene | warning | warning |
| `mesh.nonplanar-faceted`, `mesh.ngon-concave` | §5.3 | info / warning | info / warning |
| `mesh.skinned-node-transform` | skinned mesh node not identity | warning | warning |
| `ekza.positive-uniform-scale` | every node scale positive and uniform (VRM T-pose 2.1, OMOBA) | error | error |
| `ekza.no-matrix-node` | TRS only | error | error |
| `vrm.tpose.facing` / `.arms` / `.feet` / `.grounded` / `.symmetry` | §7.4 | warning | error |
| `vrm.meta-required` | `name`, `authors[≥1]`, `licenseUrl` | error | error |
| `mtoon.outline-hard-edges` | §5.3 | warning | warning |
| `tex.size` | ≤ 4096² each, ≤ 32 MP total | warning | warning; error for `ekza/omoba-handheld-v1` |
| `ekza.handheld.*` | every row of §10.2 handheld | – | error |
| `bevy.max-joints` | > 256 joints in a skin | error | error |

### 10.4 Validators in the export path

1. **Khronos glTF-Validator** (`gltf-validator@2.0.0-dev.3.10`, Apache-2.0) in the IO worker: zero errors to
   download (extends FR-EXP-09 to authored files).
2. **VRM validator** (`vrm-validator@2.0.0-dev.3.10`, Apache-2.0, a community fork of glTF-Validator with VRM
   checks, repository `mrxz/vrm-validator`): zero errors for VRM profiles. Pin it, and keep our own `vrm.*` lints
   as the contract because the fork's maintenance is uncertain.
3. **Ekza lints** (§10.3 + ADR 0010).
4. **Read-back**: reload the bytes with three `GLTFLoader` + three-vrm in the worker. Compare triangle count,
   joint count, humanoid map and palette samples.
5. **Cross-repo check (CI job, optional)**: OMOBA's `validate-runtime-vrm` and handheld `validate_model` on the
   acceptance outputs. These are Rust binaries in another repository, so the job runs only where that checkout
   exists.

---

## 11. End to end: what an artist needs, and what exists today

| Step | Artist does | Capability needed | Status |
|---|---|---|---|
| 1 Start | New → *Low-poly humanoid* / *Prop* / *Handheld* | templates with metres, Y-up, ground grid at Y = 0, +Z facing arrow, X symmetry plane, height guide, budget HUD | **iteration (must)** |
| 2 Reference | load front/side concept PNGs | image planes in ortho views | iteration (should) |
| 3 Block out | primitives (cube, N-sided cylinder, low sphere, plane) with editable creation parameters | primitives + adjust-last-operation panel | **must** |
| 4 Shape | component modes (Maya F9/F10/F11, Ctrl+Tab), tweak (`` ` ``), soft select (`b`), snapping (`x`/`v`), symmetry | selection model with components (08 D8), soft selection, snapping providers | **must** |
| 5 Topology | extrude, inset, bevel (1–2 segments), insert edge loop, multi-cut/connect, bridge, merge/target weld/collapse, delete/dissolve, fill hole, mirror + merge seam, separate/combine, flip triangle edge, triangulate | mesh operators (tool-map note) | **must** |
| 6 Shade | harden/soften, by angle, triangulation overlay | §5 | **must** |
| 7 Colour | palette editor, paint/fill/select-by/replace swatch, palette variants | §4 | **must**; ramps, decal region should |
| 8 Validate | watch HUD; open the game-ready checklist for a target profile | §10.3 lints live | **must** |
| 9 Rig | humanoid template, fit markers, T-pose lints | §8.1 | **must** |
| 10 Skin | bind (rigid/smooth), paint, mirror weights, ROM clip | §8.2–8.5 | **must** |
| 11 Animate | FK/IK controls, keys, Dope Sheet, Graph Editor, tweens, loops | M1 + M2a, unchanged (L7) | **exists** |
| 12 Starter motion | apply CC0 idle/walk/run/attack/cast/death | VRMA import exists (FR-IO-07); a CC0 VRMA starter pack converted once from the Quaternius UAL (03 §4) | iteration (should) |
| 13 Prop in hand | preview the weapon in the character's hand | attach by `ekza_handheld_v1` grip to `rightHand`/`leftHand` in the viewport | iteration (should) |
| 14 Export | VRM 1.0 / GLB / handheld GLB, profile picker | author writer (§10.1), new handheld profile, validators | **must** |
| 15 Publish | upload to Ekza Studio | manual upload (T0) works today; in-app publish is M4a (T3) | exists (manual) |

Exit criterion for "turnkey": steps 1–14 complete inside the editor, with no other tool and no file conversion.

---

## 12. Maya or Blender, seen from low-poly work

The full comparison is in [research 11](11-blender-vs-maya-modeling-ux.md). This section only records what the low-poly workflow needs from it. The low-poly operation set is the same in both tools. What differs is the interaction, and that favours a hybrid:

- **From Maya** (vocabulary, keys, consistency with the animation side): component modes F9/F10/F11 and
  Ctrl+Tab multi-component, tweak mode, soft select on `b`, snapping on `x`/`c`/`v`, custom pivot on `d`,
  Multi-Cut (Ctrl+click inserts an edge loop), Connect, Target Weld (drag to merge, middle-drag to centre),
  Harden/Soften Edge, Set Normal Angle, RMB marking menus for component switching, construction-history-style
  editable creation parameters.
- **From Blender** (speed): modal extrude/inset/bevel with typed numeric input and axis keys, the *Adjust Last
  Operation* panel, symmetry as a mode, Smooth by Angle, Rotate Edge, Select Similar (by swatch/material), the
  palette/UV-collapse colouring trick.
- **Low-poly needs nothing that only one of them has.** Choosing Maya vocabulary costs nothing here. A Blender
  keymap preset can come later through the existing keymap registry (01 MN-07).

---

## 13. Acceptance scenario AS-LP — "Lowpoly Lad and his sword"

Run by a Maya-experienced tester in Chrome on a fresh profile with only built-ins (template, palette preset). A
scripted twin (AS-LP-S) replays the same operator log headlessly in CI. Times are recorded, not gating:
character ≤ 90 min, prop ≤ 15 min, rig + skin ≤ 30 min, walk ≤ 30 min.

**A. Character (1,500–3,000 tris)**

*Revised in MODELING-PLAN v0.2 §8 (design review): Part A starts from a cube with the humanoid template providing only
guides, the budget HUD and symmetry; front and side reference image planes are set first; Multi-Cut, Target Weld,
Combine + Bridge with divisions, soft select and Slide Edge are each required at least once; the budget is ≤ 3,000
tris with no lower bound; the generated body mesh becomes a separate short check (A′).*

1. New → *Low-poly humanoid (smooth)*. The HUD shows `0 / 3,000 tris · 0 / 1 materials`. Symmetry is on.
2. Block out from a cube (torso, hips, legs by extrude + insert loop), 8-sided cylinders (arms, extruded from the
   shoulder faces), a cube with one bevel (head), mitten hands (box + thumb extrude), feet (boxes extruded along +Z).
3. Joint topology: ≥ 2 loops at each elbow and knee, a shoulder ring + armpit loop, a hip diagonal, 1 loop at
   wrists, ankles, neck and waist.
4. Shading: all hard, then soften by angle on the head; check the triangulation overlay and flip one diagonal.
5. Colour: 8–16 swatches; paint skin, clothes, hair; eyes as painted faces (or a decal if built).
6. Checks: tris ∈ [1,500, 3,000]; 1 material; 1 texture ≤ 128²; 0 non-manifold edges, 0 zero-area faces, 0 loose
   vertices; mirror partners within 1 mm; min Y = 0 ± 5 mm; all transforms frozen (`ekza.positive-uniform-scale`
   passes).

**B. Prop (sword, 80–400 tris)**
1. New → *Handheld*: grip gizmo at the origin (+Y shaft, +Z fingers).
2. Cube → blade (extrude, merge the tip to centre), cross-guard (extrude), 6-sided handle, pommel. Same palette,
   2–4 swatches, all hard edges.
3. Preview in Lowpoly Lad's right hand.
4. Checks: tris ∈ [80, 400]; static; ≤ 16 meshes; grip metadata within bounds.

**C. Rig and skin**
1. Rig → humanoid template (core 21 joints); fit markers with symmetry; `vrm.tpose.*` pass.
2. Bind → Smooth; play the ROM clip; fix the shoulders with Smooth/Replace; mirror weights L→R.
3. Checks: every vertex weighted; ≤ 4 influences; weight sums within tolerance; split-vertex crack distance
   ≤ 1e-6 m over the ROM clip; no weights on `Root`.
4. Variant C′: *segmented* template with *Rigid by part*. Same checks, 100 % single-influence vertices.

**D. Animate**
1. Controls appear exactly as for an imported VRM (FK + IK legs; FR-RIG-01, M2a).
2. Author a 1 s in-place walk loop at 30 fps with IK legs, reusing M2a's walk acceptance (planted feet, closed loop).
3. Add rough `idle`, `attack`, `cast`, `death` clips (starter VRMA pack if built) for OMOBA admission.

**E. Export and validate**
1. `ekza/space-avatar-v1` → `lowpoly-lad.vrm`: glTF-Validator 0 errors; VRM validator 0 errors; Ekza lints 0
   errors; read-back equal (tris, joints, humanoid map, palette samples within 1/255); three-vrm 3.5.5 plays `walk`
   in the e2e harness; file < 1 MiB.
2. `ekza/omoba-humanoid-v1` → passes the registry-equivalent checks with the five clips. Optional: OMOBA
   `validate-runtime-vrm` OK.
3. `ekza/omoba-handheld-v1` → `lowpoly-sword.glb`: only allowed extensions anywhere; grip metadata hashed and in
   bounds; < 100 KB. Optional: OMOBA handheld `validate_model` OK.
4. Determinism: export twice, and export again after reopening the `.ekzanim` → byte-identical files.
5. (Owner, optional) upload both to Ekza Studio and preview.

**AS-LP-S (CI)**: the same build as an operator script. It runs the mesh, rig, skin and export steps in Node and the
viewport steps in the SwiftShader e2e project, and asserts golden counts, validator results and file hashes.

Caveat to state in the release notes: OMOBA **admits** a humanoid with these clips but plays its own retargeted
motion library on VRM avatars (03 §5.3). "Passes the OMOBA profile" is therefore not "plays our walk in OMOBA". Ekza
Space does play embedded `idle`/`walk`.

---

## 14. Must-have for the modeling iteration vs later (from this topic)

**Must**
1. Per-face palette paint data, palette editor, paint/fill/select/replace/variant operators, palette sheet writer.
2. Hard-edge flags, angle operator, WYSIWYG normals, triangulation overlay and stored diagonal choice.
3. Low-poly templates (humanoid smooth/segmented, prop, handheld) with guides and the budget HUD.
4. Humanoid template rig (core 21 joints, identity rest), marker fitting, VRM T-pose lints.
5. Rigid and smooth auto-skin, minimum weight tools, mirror weights, ROM clip, the §8.4 correctness rules.
6. Authored characters become the same records as imported VRMs (L7).
7. Author writer for VRM 1.0 and GLB, the material presets, colour outputs A and D, the handheld export profile, the
   §10.3 lints, glTF-Validator and VRM validator in the worker, deterministic output.
8. AS-LP and AS-LP-S green.

**Should**
1. Ramp swatches; decal region with planar projection.
2. Vertex-colour output (C) for plain GLB.
3. Image planes; prop-in-hand preview; CC0 VRMA starter pack.

**Later**
1. UV editor, projections, xatlas unwrap, texture painting.
2. Reduce/remesh, LOD export, retopology over a reference mesh (Maya Quad Draw-style), geodesic voxel binding:
   the toolset AI-generated meshes need.
3. VRM expressions via texture transforms, blendshapes.
4. Runtime palette swap in OMOBA (game-side), registry budget fields for mobile profiles.

---

## 15. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scope creep into UV editing, painting, sculpting | iteration never ends | palette-first decision (L2/L3); E-row items stay "later" |
| Vertex colours used on VRM avatars | colours vanish in Space (MToon ignores them) | palette texture is the default; `COLOR_0` only in `local/generic` |
| sRGB/linear mix-ups | washed-out or dark colours | §4.5 rules + round-trip test |
| Shoulder deformation in the T-pose bind | artists blame the tool | template topology, ROM clip, rigid style as fallback |
| Triangulation instability | faceted shading flickers between exports; tri counts drift | stored diagonals, deterministic triangulation, golden tests |
| Weight cracks on split vertices | holes in faceted characters | weights on topological vertices (§8.4) + crack test |
| OMOBA admission ≠ playback | "my walk doesn't play in OMOBA" | caveat in the export dialog (ADR 0010 §6 already warns) |
| Bevy 0.20 (released 2026-10-08) changes loader behaviour | OMOBA output differs after its upgrade | re-run the §3 matrix when OMOBA moves off 0.19.1 |
| VRM validator fork goes stale | false positives or missing checks | pin it; our `vrm.*` lints are the contract |
| Budgets ignored by the registry | heavy assets still publish | advisory presets now; propose registry budget fields later (Q-LP-6) |

---

## 16. Open questions for the owner

| ID | Question | Proposed default |
|---|---|---|
| Q-LP-1 | Default material preset for characters: unlit (OMOBA look) or toon-lit (Space look)? | Unlit palette for props and OMOBA, toon palette when the target is Space |
| Q-LP-2 | Accept the budget presets of §2.2 (hero 1,500–3,000, warn at 5,000)? | yes |
| Q-LP-3 | Fingers in the template: none, mitten (thumb + middle chain) or full? | mitten as default, full as an option |
| Q-LP-4 | Should OMOBA support a runtime palette swap (team colours) so one file serves both teams? | ask the OMOBA owner; exports stay one file per variant meanwhile |
| Q-LP-5 | Export VRM 0.x too, or VRM 1.0 only? | VRM 1.0 only (Space `vrm-humanoid-v1`, OMOBA accepts both) |
| Q-LP-6 | Should registry profiles gain advisory mobile budgets (tris, materials, texture memory)? | propose after the iteration, based on AS-LP data |
| Q-LP-7 | Ramp swatches and the decal region: in this iteration or the next? | ramps in, decal region in if time allows |
| Q-LP-8 | Ship a CC0 VRMA starter pack (derived from the Quaternius UAL) with the app? | yes, as bundled samples with credits |

---

## Sources

Specifications
- glTF 2.0 specification (meshes, implicit flat normals, `COLOR_n` linear and multiplying base colour,
  skinning attribute rules, samplers): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html ; source:
  https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc
- `KHR_materials_unlit`: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit
- VRM 1.0 humanoid (positive scale rule, bone list):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
- VRM T-pose (definitions 1.1–1.8, 2.1):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md
- VRM 1.0 meta (required `name`, `authors`, `licenseUrl`):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md
- VRM 1.0 expressions (`textureTransformBinds`):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/expressions.md
- MToon 1.0 ("vertex colors are ignored", unlit fallback, outline implementation):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md

Runtimes and libraries (read at the pinned tag or package version)
- three.js r186 `GLTFLoader` (supported extensions, `COLOR_0` → `vertexColors`, missing normals → `flatShading`,
  `JOINTS_0`/`WEIGHTS_0` only, mipmap rule): https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js
- three.js r186 `GLTFExporter`: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/exporters/GLTFExporter.js
- three.js r186 `BufferGeometryUtils` (`mergeVertices`, `toCreasedNormals`):
  https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/BufferGeometryUtils.js
- `@pixiv/three-vrm-materials-mtoon@3.5.5` (`ignoreVertexColor` default true):
  https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm-materials-mtoon
- Bevy `v0.19.1` `bevy_gltf` (extension table, `MAX_JOINTS = 256`, flat-normal generation, attribute mapping,
  sampler mapping): https://github.com/bevyengine/bevy/blob/v0.19.1/crates/bevy_gltf/src/lib.rs ,
  https://github.com/bevyengine/bevy/blob/v0.19.1/crates/bevy_gltf/src/loader/mod.rs ,
  https://github.com/bevyengine/bevy/blob/v0.19.1/crates/bevy_gltf/src/vertex_attributes.rs ,
  https://github.com/bevyengine/bevy/blob/v0.19.1/crates/bevy_gltf/src/loader/gltf_ext/texture.rs
- Bevy releases (0.20.0 on 2026-10-08): https://github.com/bevyengine/bevy/releases
- Bevy mipmaps for glTF PNGs (not generated by default): https://github.com/bevyengine/bevy/pull/1685 ,
  https://github.com/DGriffin91/bevy_mod_mipmap_generator
- meshoptimizer 1.3.0 (MIT; `simplifyWithAttributes`, flags, `remesh`): https://github.com/zeux/meshoptimizer
- Khronos glTF-Validator: https://github.com/KhronosGroup/glTF-Validator ; VRM validator fork:
  https://github.com/mrxz/vrm-validator
- npm registry, checked 2026-10-18: `meshoptimizer@1.3.0` MIT (2026-09-25), `gltf-validator@2.0.0-dev.3.10`
  Apache-2.0 (2024-10-22), `vrm-validator@2.0.0-dev.3.10` Apache-2.0 (2024-11-07), `@gltf-transform/core@4.5.1` MIT,
  `@pixiv/three-vrm@3.5.5` MIT, `three-mesh-bvh@0.9.16` MIT, `xatlas-three@0.2.1` MIT (2024-09-28),
  `potpack@2.1.0` ISC, `manifold-3d@3.5.4` Apache-2.0, `three-bvh-csg@0.0.18` MIT.

Budgets and practice
- VRChat Performance Ranks (PC and mobile limits): https://creators.vrchat.com/avatars/avatar-performance-ranking-system/ ;
  source: https://github.com/vrchat-community/creator-docs/blob/main/Docs/docs/avatars/avatar-performance-ranking-system.md
- Polycount wiki, Limb Topology: http://wiki.polycount.com/wiki/Limb_Topology ; Shoulder Topology:
  http://wiki.polycount.com/wiki/ShoulderTopology
- Palette texturing practice: https://www.blendernation.com/2020/05/21/texturing-low-poly-art-with-color-palettes/ ;
  swatch size and smearing: https://cgcookie.com/community/10156-help-with-texturing-a-low-poly-model-with-a-colour-pallette ;
  colour shift from mip-mapping small islands: https://discussions.unity.com/t/using-one-material-for-nearly-the-whole-world/682877
- Missing-normal handling in other importers: https://github.com/CesiumGS/cesium/issues/6506
- Blender 4.1 modeling release notes (Smooth by Angle, sharpness attributes):
  https://developer.blender.org/docs/release_notes/4.1/modeling/
- Maya Modeling Toolkit hotkeys: https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Modeling/files/GUID-DAD42E62-3E23-4A00-93E9-4F4A193F3057.htm
- Maya smooth-skin bind methods: https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-EEFC3BE1-B386-4664-BD19-8688C58D1618.htm ;
  Geodesic Voxel binding: https://help.autodesk.com/cloudhelp/2018/ENU/MayaLT-CharacterAnimation/files/GUID-5EFDB81B-E332-4D6C-B1BB-0B989AD2F2C7.htm
- Baran and Popović, "Automatic Rigging and Animation of 3D Characters" (SIGGRAPH 2007):
  https://people.csail.mit.edu/ibaran/papers/2007-SIGGRAPH-Pinocchio.pdf

Ekza repositories (read-only; paths relative to the Ekza umbrella checkout)
- `omoba-bevy/docs/humanoid-motion.md` (supported skeletal input), `omoba-bevy/docs/handheld-weapons.md`,
  `omoba-bevy/docs/profiles/handheld-glb-v1.json`, `omoba-bevy/docs/ekza-production-avatars.md` (mobile uses the
  desktop selector), `omoba-bevy/assets-src/{skills,weapons,bosses}/README.md` (low-poly pilot assets, unlit
  painted materials), shipped GLBs under `omoba-bevy/client/assets/`.
- `ekza-registry/backend/app/services/{studio.py,profile_checks.py,handheld.py,handheld_checks.py}`,
  `ekza-registry/docs/creator-loop-implementation.md` (handheld v1 protocol, browser preflight limits).
- `core/src/features/profile/studioAvatar.ts` (50 MiB avatar limit),
  `core/src/features/world-builder/useRoomProgram.ts` (GLB props by URL).
- This repository: `fixtures/models/polybot.vrm`, `fixtures/models/seed-san.vrm` (ADR 0012), research 02, 03, 07,
  08, ADR 0005, ADR 0010.
