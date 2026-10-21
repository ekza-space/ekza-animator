# Architecture Decision Records

Each ADR records one decision: context, decision, alternatives, consequences. From milestone M0 on, ADRs are
immutable once accepted: a later ADR supersedes an earlier one, which is then marked `Superseded by NNNN`. The set
below was accepted on 2026-10-17 and **revised once, before any implementation, after the design review of the
same day (rev. 2)**; each revised ADR says so in its status line.

Names: on 2026-10-19 the editor was renamed from Ekza Animator to **Ekza Studio** and the publishing site from Ekza
Studio to **Ekza Hub** ([DECISIONS-OPEN §H](../DECISIONS-OPEN.md#h-naming-ekza-studio-and-ekza-hub-2026-10-19)).
The ADRs use the new names; that edit is editorial and does not revise any decision.

Code sketches inside ADRs are illustrative. The normative TypeScript contracts are in
[MVP-SPEC §4](../MVP-SPEC.md#4-shared-contracts); where an ADR snippet and §4 differ, **§4 wins**.

| # | Title | Status |
|---|---|---|
| [0001](0001-app-shell-monorepo-toolchain.md) | App shell, monorepo and toolchain | Accepted |
| [0002](0002-document-store-and-collaboration-readiness.md) | Document store and collaboration readiness | Accepted (rev. 2) |
| [0003](0003-time-rotation-and-curve-engine.md) | Time units, scene clock, rotation representation and curve engine | Accepted (rev. 2) |
| [0004](0004-rig-model.md) | Rig model: controls-only keying, zero pose = rest, normalized humanoid space | Accepted (rev. 2) |
| [0005](0005-export-strategy.md) | Export strategy: surgeon bake, LINEAR resampling, VRMA and animation-only GLB writers | Accepted (rev. 2) |
| [0006](0006-viewport-rendering.md) | Viewport rendering: one canvas, custom ViewportManager, imperative scene sync | Accepted (rev. 2) |
| [0007](0007-graph-editor-canvas2d.md) | Graph Editor and time slider on Canvas2D | Accepted (rev. 2) |
| [0008](0008-operator-tool-editor-registries.md) | Operators, tools, panels, keymaps and contribution registries | Accepted (rev. 2) |
| [0009](0009-license.md) | License: MIT + DCO, Apache-2.0 islands, no copyleft | Accepted (rev. 2) |
| [0010](0010-ekza-integration-tiers.md) | Ekza integration tiers and the `ekza:animation` contract | Accepted (rev. 2) |
| [0011](0011-project-file-format.md) | Project file format `.ekzanim` | Accepted (rev. 2) |
| [0012](0012-sample-assets.md) | Sample avatars and test fixtures | Accepted (rev. 2, erratum) |
| [0013](0013-editor-history.md) | Editor history: document undo plus unkeyed session edits | Accepted |
| [0014](0014-mesh-kernel.md) | Mesh kernel: radial-edge structure of arrays, write log, deterministic operations | Accepted (2026-10-19, M6A-SPEC v1.0) |
| [0015](0015-mesh-storage-in-the-document.md) | Mesh storage in the document: revision refs, content-addressed chunks, claims, undo | Accepted (2026-10-19, M6A-SPEC v1.0) |
| [0016](0016-modeling-interaction-paradigm.md) | Modeling interaction paradigm: Maya base, Blender semantics, one keymap per preset | Accepted (2026-10-19, M6A-SPEC v1.0) |
| [0017](0017-ai-generation-boundary.md) | AI 3D generation boundary: server gateway, provider-agnostic contract, provenance by construction | Proposed (2026-10-18, rev. 2026-10-19); items 7–8 Accepted with M6A-SPEC v1.0 |
| [0019](0019-swatch-shaders.md) | Swatch shaders: a palette swatch is the material, versioned by its table | Accepted (2026-10-21, SHADING-SPEC v1.0) |
| [0020](0020-m6b-mvp-cut.md) | M6b MVP cut: the owner flow first, VRM 1.0 as the OMOBA deliverable, a CC0 clip library | Accepted (2026-10-22, M6B-SPEC v1.2 §0) |

ADRs 0014–0016 were accepted on 2026-10-19 with the M6a build spec [`../M6A-SPEC.md`](../M6A-SPEC.md) v1.0, whose
§4 holds their normative contracts (where an ADR sketch and the spec differ, the spec wins; its §12.2 lists the
refinements); ADR 0017's provenance items 7–8 were accepted with it, the rest waits for the M7 spec. They extend, and
do not supersede, ADRs 0002, 0005, 0008, 0011 and 0013. The plan they serve is
[`../MODELING-PLAN.md`](../MODELING-PLAN.md).

Status values: `Proposed`, `Accepted`, `Superseded by NNNN`, `Rejected`. All ADRs are owner-overridable defaults;
the owner-facing list, including the design-review outcomes, is [`../DECISIONS-OPEN.md`](../DECISIONS-OPEN.md).
