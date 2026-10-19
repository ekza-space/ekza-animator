# Architecture Decision Records

Each ADR records one decision: context, decision, alternatives, consequences. From milestone M0 on, ADRs are
immutable once accepted: a later ADR supersedes an earlier one, which is then marked `Superseded by NNNN`. The set
below was accepted on 2026-10-17 and **revised once, before any implementation, after the design review of the
same day (rev. 2)**; each revised ADR says so in its status line.

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
| [0014](0014-mesh-kernel.md) | Mesh kernel: radial-edge structure of arrays, write log, deterministic operations | Proposed (2026-10-18, modeling plan; rev. 2026-10-19 design review) |
| [0015](0015-mesh-storage-in-the-document.md) | Mesh storage in the document: revision refs, content-addressed chunks, claims, undo | Proposed (2026-10-18, modeling plan; rev. 2026-10-19 design review) |
| [0016](0016-modeling-interaction-paradigm.md) | Modeling interaction paradigm: Maya base, Blender semantics, one keymap per preset | Proposed (2026-10-18, modeling plan; rev. 2026-10-19 design review) |
| [0017](0017-ai-generation-boundary.md) | AI 3D generation boundary: server gateway, provider-agnostic contract, provenance by construction | Proposed (2026-10-18, modeling plan; rev. 2026-10-19 design review) |
| [0018](0018-agent-bridge-mcp.md) | Agent bridge: MCP over the operator registry, a paired loopback bridge to the open tab, a headless runtime | Proposed (2026-10-19, M-AI spec; rev. 2026-10-19 design review) |

ADRs 0014–0016 become Accepted when the M6a build spec freezes; ADR 0017 when the M7 spec does (its provenance
items with M6a). They extend, and do not supersede, ADRs 0002, 0005, 0008 and 0011. The plan they serve is
[`../MODELING-PLAN.md`](../MODELING-PLAN.md).

ADR 0018 becomes Accepted when the M-AI build spec ([`../MCP-SPEC.md`](../MCP-SPEC.md)) freezes at its package D0; it
extends, and does not supersede, ADRs 0008 and 0013.

Status values: `Proposed`, `Accepted`, `Superseded by NNNN`, `Rejected`. All ADRs are owner-overridable defaults;
the owner-facing list, including the design-review outcomes, is [`../DECISIONS-OPEN.md`](../DECISIONS-OPEN.md).
