# ADR 0019 — Swatch shaders: a palette swatch is the material, versioned by its table

- Status: Accepted (2026-10-21, with [SHADING-SPEC](../SHADING-SPEC.md) v1.0).
- Inputs: owner request "Basic shading without UVs" ([TODO](../../TODO.md)); [M6A-SPEC](../M6A-SPEC.md) §4.2, §5.19;
  [M6B-SPEC](../M6B-SPEC.md) §4.1 (schema v4); ADRs 0002, 0011, 0015.

## Context

Authored meshes have one colour truth: the per-face palette slot, resolved through `SwatchRecord`. The owner asked for
Lambert and Blinn materials assignable to objects and selected faces, without UVs, exported to glTF PBR. Two choices
had to be made: where a material lives, and how the document format records the new fields.

## Decision

1. **A swatch is the shader.** `SwatchRecord` gains `shader` (`lambert` | `blinn`), `glossiness` and `specular`; faces
   keep pointing at slots. Like a shading group in a leading commercial desktop DCC, every face of a slot shares its
   material, so painting, fill, select-by-swatch, replace and palette variants are the material assignment flows; no
   new face layer, no material table, no kernel change. A "new material" is a new swatch (`palette.assignMaterial`).
2. **Versioned by the swatches table, not the core schema.** The swatches `TableDef.version` becomes 2 with a pure,
   idempotent migration that adds the defaults (old files load as Lambert). The core `SCHEMA_VERSION` stays 3: schema
   4 is M6b's (M6B-SPEC §4.1, "schema v4 never appears in a v0.3.x build"), and a per-table change is what
   `TableDef.version` exists for. Consequence: a build with swatches version 1 (v0.3.0) opens documents of this build
   read-only, the documented newer-table rule.
3. **Shaders apply to `lit` meshes.** The mesh material preset stays the switch between unlit and shaded export:
   `unlit` keeps `KHR_materials_unlit` and ignores shaders (with a lint warning when a Blinn swatch is used), `lit`
   writes one material per shader group. Assign New Material turns its targets `lit`.
4. **The viewport draws shaders in mesh-view's own surface program** (a Blinn-Phong term on the existing light rig, a
   per-corner attribute), not with three.js lit materials: no new chunk, no second render path, the same flat/smooth
   normals.

## Consequences

- One record patch re-shades every face of a swatch, like a colour edit; a palette variant can change shaders per team.
- A face cannot have a colour and a shader from different sources: a red Blinn and a red Lambert are two swatches.
- Merging: the three fields merge independently (merge unit per field).
- Older v0.3.0 builds open new documents read-only, even when every swatch is Lambert.
