# Your character in Ekza Space and OMOBA

How a character you modelled and rigged in Ekza Studio becomes an avatar in the Ekza ecosystem (tier T0 of
[ADR 0010](../adr/0010-ekza-integration-tiers.md): export a file, upload it yourself). The one-click "Publish avatar to
Ekza" (T3) comes later ([ROADMAP M4a](../ROADMAP.md#m4a--ekza-t1t3--1520-agent-days-in-this-repo--ecosystem-work)).

**One file serves both**: a **VRM 1.0** avatar (`.vrm`). Ekza Space shows it and plays the clips you put in it;
OMOBA uses its VRM humanoid skeleton and plays OMOBA's own motion library on it. The plain GLB export
(`local/generic`) is for local tests and other engines, not for Ekza.

## 1. Before you rig

- **T-pose**: arms straight out along ±X, legs straight down. Quick Rig fits an A-posed model and flags it, but the
  VRM export refuses it (`skel.tpose`); an A-pose fix arrives after the MVP. Elbows and knees may bend a little in
  depth (the template's rest flexion, up to 15° toward the hinge).
- **Facing +Z, standing on the ground, centred on x = 0**: Quick Rig checks this and offers *Center and ground* and
  *Rotate to face +Z* (one undo step each).
- Real-world size helps (metres): Space and OMOBA scale avatars to their own height rules.

## 2. Rig, skin, add clips

In the **Rig & Skin** tab follow the checklist ([README](../README.md#rig--skin-from-cubes-to-a-vrm-in-minutes)):
① Quick Rig → Create Skeleton, ② fit joints, ③ Bind Skin, ④ fix weights, ⑤ try clips from the Clip Library.
**Use Clip** puts a starter-pack clip into your project with its slot (`idle`, `walk`, `run`, `attack`, `cast`, `hit`,
`death`, `dance`, `jump`) when the slot is free; you can edit it in Animate like any clip, or set a clip's slot in
the clip settings. Only clips with a slot are exported with **Clips: slots**.

## 3. Export

**File › Export Character…** (or ⑥ in the checklist):

1. **VRM Meta…**: a name and at least one author are required; pick a licence preset (**Open — CC0** first; *Open
   with credit — CC BY 4.0*, *Personal*, or *Custom* for every VRM permission). The licence travels in the file.
2. **Render Thumbnail**: the VRM thumbnail is a square image of your avatar (a warning until you render it).
3. Profile **Ekza avatar — Space and OMOBA (VRM 1.0)**, Clips **slots**. The Validation rows are the gate: errors
   block Export, warnings and info do not.

The file is checked on export with OMOBA's own runtime rules (the `vrm.*` lints): one `VRMC_vrm` 1.0 extension, a
GLB of at most 50 MiB with a JSON chunk of at most 4 MiB, at most 4,096 nodes and 64 humanoid bones, the 15 required
bones (hips, spine, head, both upper and lower arms, hands, upper and lower legs, feet) with standard parents,
TRS-only nodes with positive uniform scale, no external `uri`, `extensionsRequired` limited to
`KHR_materials_unlit` and `KHR_texture_transform` (a Blinn swatch's `KHR_materials_specular` is used, not required),
and every mapped bone a joint of a skin under scene 0. It also passes glTF-Validator and vrm-validator, and it
re-exports byte-identically.

Developers can run OMOBA's validator on the file too, with a local `omoba-bevy` checkout:
`node tooling/omoba-validate.mjs my-avatar.vrm` (it prints "skipped" without one).

## 4. Upload to Ekza Hub

Ekza Hub is the publishing site (formerly the registry's "Studio" site, [DECISIONS-OPEN §H](../DECISIONS-OPEN.md#h-naming-ekza-studio-and-ekza-hub-2026-10-19)).
Upload the `.vrm` there as a new **avatar** (or a new revision of yours). It accepts VRM only — the humanoid, meshes
and skins must be in the file, buffers and images embedded, at most 50 MiB — which is what the export above writes.

## 5. What happens next

| Where | What it uses | Your clips |
|---|---|---|
| **Ekza Space** | the VRM 1.0 avatar (`universal / vrm-humanoid-v1`) | played: the embedded slot clips (`idle`, `walk` first) |
| **OMOBA** | the VRM humanoid skeleton; its builder derives the game's model from your VRM | not played: **OMOBA plays its own motion library on your VRM** |

So for OMOBA the skeleton and the skinning matter most: check Bind Skin with a few library clips (⑤) before you
export — that is the kind of motion OMOBA will put on your avatar.

## Licences of the starter pack

The Clip Library's starter pack is **Universal Animation Library by Quaternius, CC0 1.0**: you may use, change and
ship the clips (and avatars carrying them) without credit; crediting Quaternius is appreciated. Each clip keeps that
provenance in the file's `ekza_animation_v1` block.
