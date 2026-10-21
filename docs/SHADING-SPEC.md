# SHADING-SPEC — Basic shading without UVs (Lambert and Blinn)

- Status: v1.0 (2026-10-21), built on `feat/shading` (from `dev` d748932). Owner request in [TODO](../TODO.md)
  ("Basic shading without UVs"): Maya Hypershade-lite — Lambert and Blinn materials, no UVs, assigned to objects or
  selected faces, flat/smooth; export Lambert → roughness 1 / metallic 0, Blinn → roughness from glossiness plus
  `KHR_materials_specular`.
- Decision record: [ADR 0019](adr/0019-swatch-shaders.md) (a swatch is the shader; swatches table version 2 instead of
  core schema 4).
- Builds on [M6A-SPEC](M6A-SPEC.md) §5.19 (colour model, palette export), §4.7 (shading modes), §6.2 (palette
  operators); where this file and M6A-SPEC differ, this file wins for the items below.

## 1. Model: every swatch is a shader

The per-face colour truth stays the palette **slot** (`paint` face layer → `SwatchRecord`). A swatch now also carries
its shading model, so a swatch is what Maya calls a material with its shading group: every face painted with the slot
shares it. Assigning a material to faces or objects is painting them with a swatch, so every existing flow works
unchanged — Apply in the Palette panel (selected faces, or every face of the selected objects), the Paint Colour tool,
Fill Shell, Select by Swatch, Replace Swatch, palette variants (`palette.duplicate` copies shaders too).

| field | type | default | meaning |
| --- | --- | --- | --- |
| `shader` | `'lambert' \| 'blinn'` | `'lambert'` | shading model |
| `glossiness` | number 0…1 | 0.5 | Blinn highlight tightness (ignored by Lambert) |
| `specular` | 8-bit sRGB triple | `[255, 255, 255]` | Blinn highlight colour and strength (ignored by Lambert); white is the glTF default dielectric reflectance, darker is weaker, a hue tints it |

Flat and smooth shading are not material properties: they stay the mesh's hard edges (Soften/Harden, `faceted`) and
the pane's Flat display flag; the Blinn highlight follows the same normals, so a faceted mesh shows one highlight per
face and a soft one a continuous highlight.

## 2. Document schema and migration

- `SwatchRecord` gains `shader`, `glossiness`, `specular` (flat fields: the table merges per field, so a concurrent
  colour edit and shader edit both survive).
- **Swatches table version 1 → 2** (`TableDef.version` of `swatches` = 2, `migrations[0]`): pure, idempotent; adds the
  three fields with their defaults when missing. Old files load as Lambert with today's look. The core
  `SCHEMA_VERSION` stays 3 (schema 4 is reserved for M6b, M6B-SPEC §4.1 — ADR 0019).
- Repairs (every load, M6A-SPEC §4.2 rules): an unknown `shader` becomes `'lambert'`; a non-finite `glossiness` becomes
  0.5, others are clamped into 0…1; a malformed `specular` becomes white, a well-formed one is clamped and rounded like
  `srgb`.
- Validation: `shader` ∈ {lambert, blinn}, `glossiness` finite in 0…1, `specular` three integers 0…255.
- Forward compatibility: a v0.3.0 build (swatches table version 1) opens a document written by this build read-only
  (the documented newer-table rule, `migrateSnapshot`/`store.load`); `requiredWriterVersion` is unchanged.
- `emptySnapshot` and every store snapshot write `tableVersions.swatches = 2`; the test fixture builder
  `makeTestSwatch` writes the defaults.

## 3. Viewport

- Shadings `colours` (Model default) and `lit` draw each face with its swatch's shader inside mesh-view's existing
  surface program (no three.js lit materials, no extra chunk): Lambert = the existing soft clay rig (ambient + key +
  fill) on the swatch colour; Blinn = the same diffuse plus a Blinn-Phong highlight of the key light:
  `spec = linear(specular) · keyHighlight · min(4, (n + 2) / 32) · max(0, N·H)^n` with
  `n = clamp(2/α² − 2, 1, 2048)`, `α = r²`, `r = 1 − glossiness` (the GGX-equivalent Blinn-Phong exponent of the
  exported roughness, so viewport and export agree: glossiness 0.5 → n = 30). `H` uses the true view direction
  (perspective) or +Z (orthographic panes).
- `shaded` (clay) and `wire` are unchanged: no paint, no highlight. Face orientation shows its own colours. Selection,
  hover and soft-selection tints apply on top as before.
- Plumbing: a per-corner `shade` attribute (u8×4 normalized: specular sRGB, gloss byte — 0 = Lambert, 1…255 = Blinn
  glossiness 0…1) written next to `paint`; `MeshSurface.setData(…, paint, shaders?)`,
  `MeshSurface.setPaint(colours, shaders?)` and `EditMeshView.setPaint(colours, shaders?)` take an optional
  `PaletteShaders` map (slot → `{glossiness, specular}`, Blinn slots only); unchanged shaders upload nothing.

## 4. Export

Static GLB (`file.exportModel`, io author writer). The mesh's material preset decides whether shaders apply:

| preset | materials |
| --- | --- |
| `lit` | one material per shader group (below); Lambert: `metallicFactor` 0, `roughnessFactor` 1, nothing else; Blinn: `metallicFactor` 0, `roughnessFactor` = clamp(1 − glossiness, 0, 1), `KHR_materials_specular` with `specularFactor` = max channel of linear(specular) and `specularColorFactor` = linear(specular) / that max (white → 1 and [1, 1, 1], the glTF defaults; black → factor 0) |
| `unlit` (default for new meshes) | unchanged: `KHR_materials_unlit`, metallic 0, roughness 1, no split; a mesh that paints with a Blinn swatch gets the lint warning `material.unlit-shader` ("…exports flat: set its material to Lit") |

- `KHR_materials_specular` is listed in `extensionsUsed` only when a Blinn material is written, never in
  `extensionsRequired` (a viewer without it shows the roughness only).
- Colour outputs: `palette-texture` — faces of different shaders split into one material per shader, all sampling the
  same palette PNG (Lambert-only meshes write exactly the bytes they wrote before); `vertex-colour` — one material per
  shader, base colour white; `material-per-colour` — one material per swatch as before, now with its shader's factors.
  Primitives are grouped by (material slot, swatch or shader); a shader group is keyed by its exported parameters, so
  swatches with equal shaders share a material. Blinn materials are named `<palette> blinn g<glossiness×100>` (plus the
  specular hex when not white).
- Budget lints count the materials the export writes (shader groups).
- VRM and bake-into-model paths (`colourOutput: 'asset'`) are unchanged: they keep the asset's materials.

## 5. Operators and UI

| operator | args | notes |
| --- | --- | --- |
| `palette.addSwatch` | `+ shader?, glossiness?, specular?` | defaults as §1 |
| `palette.setSwatch` | `+ shader?, glossiness?, specular?` | one undo step per edit |
| `palette.assignMaterial` (**Assign New Material**) | `{shader, meshes?, srgb?, name?}` | new; one transaction, one undo step |

`palette.assignMaterial` (Maya's Assign New Material): targets are the hilited meshes with selected faces in face mode,
else the selected mesh objects (or `meshes`); all must be authored and paint with one palette. It adds a swatch
(`Lambert n`/`Blinn n`, the next free name in the palette; colour = `srgb`, else the colour of the first target face's
swatch, so switching the shader keeps the look) and paints it on the selected faces (face mode) or every face of the
objects; meshes whose preset is `unlit` become `lit` (assigning a shading material asks for shading); the new swatch
becomes active. Refusals: "Select faces or a mesh first", "Imported meshes keep their materials", "The selected meshes
paint with different palettes", "The palette has no free slot left".

UI:
- Palette panel: the active swatch row gets a **Shader** section — Lambert/Blinn choice, Glossiness (slider and number,
  committed on release/Enter, one step each), Specular colour; Blinn swatches show a highlight dot in the grid.
  Buttons **New Lambert** and **New Blinn** run Assign New Material on the selection.
- Menus: Assign New Material › Lambert / Blinn next to Assign Colour in the object and face marking-menu lists; the
  command palette finds it (aliases "Lambert", "Blinn", "Hypershade", "New Material"). No default key (Maya has none).

## 6. Tests

- doc: migration v1 → v2 (defaults, idempotence, the newer-table read-only rule), validation and repairs, snapshot
  table versions.
- io: material factor mapping (Lambert, Blinn, specular split), export grouping per colour output, `extensionsUsed`
  without `extensionsRequired`, Lambert-only bytes unchanged, re-import through glTF Transform with
  `KHR_materials_specular` reading back the factors.
- editor-core: `palette.setSwatch`/`addSwatch` shader args, `palette.assignMaterial` on faces and objects with one undo
  step (undo restores paint, swatch and preset), the unlit lint.
- mesh-view: the `shade` attribute per corner, Lambert zero, uploads only on change.
- e2e (`shading-01-blinn.spec.ts`, local Chrome): a cube, Assign New Material › Blinn on its top face, a pixel probe of
  the highlight differs from the same face as Lambert, and the export has metallic 0 / roughness 1 − glossiness and
  `KHR_materials_specular` in `extensionsUsed` only.
