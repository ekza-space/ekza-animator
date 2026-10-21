# ADR 0020 — M6b MVP cut: the owner flow first, VRM 1.0 as the OMOBA deliverable, a CC0 clip library

- Status: Accepted (2026-10-22, with [M6B-SPEC](../M6B-SPEC.md) v1.2 §0).
- Inputs: the owner's request of 2026-10-22 (the flow quoted in M6B-SPEC §0.1); M6B-SPEC v1.1 (the full Rig & Skin
  workspace, ≈ 70.5 agent-days); the OMOBA runtime admission rules read in `omoba-bevy` (`passport/src/humanoid.rs`,
  `scripts/retarget_animations.py`) and the Quaternius UAL fixture already in this repository; ADRs 0005, 0010, 0012,
  0015, 0019.

## Context

M6B-SPEC v1.1 specifies a complete Maya-style rigging workspace: joint tools, Quick Rig, binding, weight tools, the
weight table, constraints, control-shape editing, imports recovery and the character writer. M6a shipped as `v0.3.0`
and basic shading as `v0.3.1`, so the staging plan of M6B-SPEC §2.2 (a `m6b/dev` branch while M6a is still open) no
longer applies. The owner's goal is narrower and more concrete: model a character, place markers in the front and side
views, get a VRM humanoid skeleton, fit it quickly, skin it in one click, and look at animations — then export a VRM
that OMOBA admits.

Research in `omoba-bevy` corrected an assumption of v1.1: OMOBA has no skeleton of its own and does not play the
plain five-clip GLB of a user avatar; it admits a VRM (0.x or 1.0) humanoid under explicit runtime limits and plays its
own motion library on it. User clips play in Ekza Space.

## Decision

1. **An MVP cut binds M6b first** (M6B-SPEC §0, which wins over the rest of the spec): C0, C1, C2 (templates and
   Quick Rig as the main entry), C3 (only the joint edits the flow needs), C4, C5 merged into C6 (paint brush, flood,
   display, X-mirror), C7 (workspace shell, Validation as the export gate), C10 (VRM 1.0 writer) and a new package
   **C12 clip library**; constraints (C8a/C8b), control-shape editing (C9) and imports recovery (C11) are deferred with
   their spec text kept. Ten packages including integration.
2. **Quick Rig v2**: nine user markers (head top, chin/neck, pelvis; shoulder, elbow, wrist, knee, ankle, toe on the
   right side, mirrored), pre-placed by a deterministic One-Click guess; the front view edits x/y and the side view z/y,
   and an orthographic drag never changes the hidden axis; the VRM humanoid skeleton (Standard 33 by default) previews
   live from a pure fit that the commit reuses bit for bit. T-posed models are required for VRM export in the MVP;
   the A-pose path follows later.
3. **VRM 1.0 is the one avatar deliverable** for model-sourced characters: `ekza/space-avatar-v1` writes it for Space
   and OMOBA alike, and OMOBA's runtime rules (file and JSON size, node and bone counts, the 15 required bones,
   standard parent relations, TRS only, positive uniform scale, the `extensionsRequired` subset, every mapped bone in a
   skin under scene 0, specVersion 1.0) become `vrm.*` lints on the written bytes. The plain GLB stays a
   `local/generic` export; the five-clip `ekza/omoba-humanoid-v1` bake is not offered for model-sourced characters.
4. **A CC0 starter pack of clips** is converted once from the Quaternius UAL fixture to VRMA on the VRM humanoid (the
   world-space delta method proven in OMOBA's retarget script, the Rigify `DEF-*` bone map ported from it), by a
   reproducible tooling script with a `--check` mode, and the outputs (VRMA files, a manifest with SHA-256 per file,
   licence and credit) are **committed** under `apps/web/public/library/animations/` and served as static files from
   the app's own origin. This is a deliberate exception to ADR 0012's rule that `public/` holds only generated copies:
   the static deploy needs the files without a build-time conversion, and `--check` keeps them reproducible.
5. **Preview never touches the document**: a session-only `preview` evaluation channel source plays a converted clip;
   any document change stops it. **Use Clip** reuses the shipped VRMA import path, so a library clip becomes an
   ordinary editable clip on the character's controls in one undo step — for rigged models and imported VRMs alike.
6. **Branching**: the MVP integrates on `m6b/mvp` (from `dev`) and merges into `dev` once, at the end; M6a files are
   edited directly by the owning M6b package for the three contract requests the flow needs (CR-2, CR-4, CR-7); the
   other requests keep their fallbacks until their features return.

## Consequences

- The owner gets the whole loop in ≈ 48.5 agent-days instead of ≈ 70.5, with a critical path of ≈ 22 working days.
- Schema v4 lands complete in the MVP (roles, rename-proof keys, VRM meta, thumbnails, test clips), so the deferred
  features need no further schema change; swatches table version 2 (ADR 0019) is untouched by it.
- Users with A-posed models must straighten the arms before a VRM export until the A-pose path returns.
- The repository carries ≈ 4 MiB of derived VRMA files; their provenance and licence are recorded per file.
- Weight editing on imported avatars, constraints, sword props and control-shape styling wait for the post-MVP
  packages; the menus show only what works.
- The OMOBA validator is run locally by the integration agent (it lives in another repository); CI relies on the
  equivalent `vrm.*` lints.
