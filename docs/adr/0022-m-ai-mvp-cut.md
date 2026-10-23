# ADR 0022 — M-AI MVP cut: AI control over MCP first, character setup for agents, the rest later

- Status: Proposed (2026-10-23, with [MCP-SPEC](../MCP-SPEC.md) v0.3 §0.4); becomes Accepted when the owner accepts
  the cut and takes the bundle decision ([DECISIONS-OPEN §N.6](../DECISIONS-OPEN.md#n6-mvp-cut-and-port-2026-10-23),
  M-AI-MVP-2).
- Inputs: the owner's request of 2026-10-23 ("Сделай ИИ управление через MCP": AI control of the editor through MCP,
  as an MVP to release); MCP-SPEC v0.2 (the full M-AI, ≈ 55 agent-days); the D0, P1 and P2 branches (`mcp/*`, built
  on `dev` of 2026-10-19 and never run together); `dev` of 2026-10-23 with M6a, M6b (MVP), shading and Auto-Rig;
  ADRs 0018, 0020, 0021.

## Context

[ADR 0018](0018-agent-bridge-mcp.md) decided the architecture: one curated tool layer over the operator registry, a
stdio MCP server with a headless runtime, and a paired loopback bridge to the open tab. MCP-SPEC v0.2 planned it as
nine packages plus integration. Three of them (D0, P1, P2) were built on a `dev` that has since moved by 888 commits:
the package scope was renamed, M6a added modeling and its runner hooks (coerced args, LastRun, extrude sessions), M6b
added Rig & Skin with lazy operator chunks and test poses, and Auto-Rig added a second shell whose wizard steps are
operator compositions. The editor is now a modeling, rigging and animation studio, so "let an AI help" includes
"rig this model and add a walk", which v0.2 left out (it denied every M6a/M6b operator).

The `/editor` route sat 2,864 B under its 900,000 B gate (and 600 B under the Auto-Rig eager-delta limit) before the
port; the agent kernel contracts are eager by nature (the runner, the history, the scope reads of shipped operators).

## Decision

1. **Port, then cut.** D0, P1 and P2 are merged onto `dev` (`mai/port`) with every conflict resolved toward `dev`'s
   behaviour, and the agent-only code is moved behind lazy chunks: the ten explicit-target operators, the runner's
   actor helpers, the viewport's temporary pose and the restore planner. The remaining eager cost is measured and
   handed to the owner, not absorbed by raising gates (MCP-SPEC §0.3).
2. **The MVP is the live loop plus headless files**: the stdio server with headless projects and the workspace
   sandbox, the paired bridge with grants and confirmations, a minimal Agent panel (connect, grants, Pause,
   Disconnect, the audit log with Undo/Show per step, Revert all AI changes), a live `view_capture`, and the 24
   ported tools plus the connection, view, file and setup tools (37 tools). Operator escape hatch, analysis tools, headless
   pictures, the full evaluation suite, resume after a dropped socket, HTTP and the npm publish wait (spec text kept).
3. **Character setup is a first-class agent workflow**: five new tools (`model_inspect`, `model_fix`, `rig_create`,
   `library_list`, `library_use`) and two new `project_*` kinds run the Auto-Rig compositions, so an agent and the
   wizard produce the same document; compositions forward the actor so every inner step is an `AI: …` step; rigging
   in the user's tab needs Edit + View and a confirmation. Modeling and weight painting stay denied to agents.
4. **Acceptance**: four CI scenarios (headless and live, animation and rigging) and one recorded real Claude Code
   session against the live editor as the release gate, instead of pass@1 over 25 graded tasks.
5. **Phase B** builds the rest in four parallel packages with disjoint files (B1 server and headless, B2 bridge, B3
   agent UI and capture, B4 rig tools) plus an optional B5 that moves the shipped operators' agent branches out of
   the first visit.

## Consequences

- The release carries AI control after ≈ 15.5 agent-days of phase B plus integration instead of ≈ 45 more for the
  full v0.2 plan; an agent can block animation, clean curves, rig a model, add a library clip and export a VRM.
- Agents work blind in headless mode until P5 returns (numbers, no pictures); `operator_run` users wait for P3.
- `ViewportManager.agentHost()` became async and the explicit-target operators are absent from the registry until
  first use — contract changes recorded in MCP-SPEC §0.2.
- The bundle gates need an owner decision (≈ +6 kB on both routes, or B5 first) before `mai/port` merges with a green
  `check:size`.
