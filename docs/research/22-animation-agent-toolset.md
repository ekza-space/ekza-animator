# 22 — Animation agent toolset: tools, schemas, "see" tools, recipes and evaluation

> Research note for Ekza Animator, milestone **M-AI** (the scripting/MCP bridge of FR-EXT-06, pulled forward from M5).
> Date: 2026-10-19. Status: proposal for review; nothing here is decided until the owner accepts it.
> Scope: **which tools an LLM agent gets** to help with character animation in the editor, how they are named,
> typed, budgeted and implemented over the operator registry, how the agent *sees* and *measures* its own work, where
> "motion recipes" live (tools, MCP prompts or resources), what a later text-to-motion tool looks like, and **how the
> toolset is evaluated** — scripted in CI and, optionally, against a real model. The transport (stdio server, live
> WebSocket bridge to the open tab, pairing, presence) and the security model of the bridge belong to the sibling M-AI
> notes; this note only states what the toolset needs from them.
> Inputs: [ARCHITECTURE](../../ARCHITECTURE.md), [MVP-SPEC](../MVP-SPEC.md) §4.5 (editor-core contracts, `OperatorMap`),
> §4.8 (test API), §4.9 (operator catalog), §4.11 (behaviours), [M2A-SPEC](../M2A-SPEC.md) (IK, tween, Dope Sheet,
> loop clips), the M6a spec's `ParamDef`, `RunSource` and Adjust Last contracts, [research 08](08-extensibility-modeling.md)
> §5.2 and §8 (operators as the agent API, trust tiers), [research 05](05-landscape.md) §2.3, §2.4, §3.7 (Cascadeur MCP,
> VRMA Lab agent mode, AI motion sources), [ADR 0008](../adr/0008-operator-tool-editor-registries.md),
> [ADR 0013](../adr/0013-editor-history.md), [ADR 0017](../adr/0017-ai-generation-boundary.md), and the sibling M-AI
> notes [20](20-mcp-state-and-dcc-servers.md) (MCP state, DCC servers) and [21](21-agent-bridge-architecture.md)
> (bridge, grants, revert, tool-layer contracts). Where this note and note 21 overlap, §16 lists what each note takes
> from the other.
> Method: read-only review of `packages/editor-core` (operators, runner, edit kernel, history, evaluation),
> `packages/rig` (inverse solve, limb match, foot pivots), `packages/editor` (test API, services) and the headless test
> kit; the MCP specification revision 2026-07-28 and its changelog; the TypeScript SDK repository, npm metadata and
> the published v2 server package (how it reports input-validation failures), all checked 2026-10-19; Anthropic's
> tool-design guidance, the Claude vision and Claude Code MCP documentation; the published tool lists of existing DCC
> MCP servers; model licences read from their licence files. Items marked **(unverified)** come from secondary
> sources only.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|---|---|
| D1 | **37 task-level tools in 11 groups** (§4), not one tool per operator; a **core profile of 7** loads upfront, the rest are found through tool search. A generic `operator_run` covers the remaining ~100 operators. The bridge's connection tools (note 21: `editor_connect`, `projects_list`, `project_close`) come on top and are not counted. | Anthropic's guidance: "more tools don't always lead to better outcomes", consolidate multi-step workflows into one tool. Community DCC servers land in the same range (Cascadeur: 36 named tools + an opt-in script tool; Maya: 29–30; Blender: 9 + arbitrary Python). |
| D2 | **Units live in field names**: `…Deg`, `…M`, `…Frame(s)`, `…Seconds`, `…Percent`, `…Factor`. Tools speak degrees and metres; every response carries the clip's `fps` and range. | The operators mix units today (`channel.setValues` takes radians, `graph.keys.setFields` display degrees); an LLM must never have to guess. |
| D3 | **Address things by name**: control template key (`fk.upperArm.L`), display name (`L Upper Arm`) or VRM humanoid bone (`leftUpperArm`); clips and characters by name; body parts by the M2a `BodyPart` ids. IDs are accepted but never required. | Anthropic: resolve opaque IDs to meaningful names. The test API already accepts template keys for controls (MVP-SPEC §4.8). |
| D4 | **Three posing levels**: raw channel values (Channel Box parity), **goals** (aim a bone in character space, place an IK hand/foot, look at a point), and **recipes** (parametric motions). Reads return bone directions in character space next to Euler values, plus per-control "axis hints". | LLMs are weak at Euler-order arithmetic; they are good at "point the arm down and slightly forward". `rig` already has `solveBoneChannels`, `ikControlForEndWorld`, `matchIkToFk` to implement goals. |
| D5 | **One tool call = one operator run = one undo step** labelled `AI: …`. Every write goes through an explicit-target operator (§6.3) with `RunSource 'api'` and note 21's `actor`; tools never write the store directly, write keys rather than session overrides, and never touch the user's selection, playhead, clipboard, camera or preferences unless the tool exists to do that and the user granted `view`. | ADR 0008 (no action bypasses the registry), ADR 0013 (one gesture = one step); the owner's "any agent action is undone with Mod+Z"; note 21 D2/D3. |
| D6 | **The agent sees and measures**: `view_capture` (one frame or a contact sheet of up to 16 frames from preset cameras, with trails, ghosts and contact marks), `view_plot_curves`, and four `analyze_*` tools (contacts and sliding, loop seam C0/C1, arcs/spacing/pops/oscillation, before/after diff). | The model must check its own work; images are cheap when sized deliberately (a 768×432 still ≈ 448 visual tokens, an 8-frame sheet at 1024×512 ≈ 703). |
| D7 | **Two capture backends behind one `CaptureService`**: live = WebGL offscreen render of the real scene at any frame; headless = a deterministic pure-TypeScript **schematic** renderer (bones, joints, floor, trails) encoded as PNG with `fflate`. A CPU-skinned shaded raster is a later option. | Headless Node has no WebGL; CI must not need a browser (repository CPU rules); deterministic bytes allow golden tests. |
| D8 | **Motion recipes are one tool (`recipe_apply`)**, workflows are **MCP prompts** (user-invoked slash commands), reference material is **MCP resources**. | MCP prompts are "user-controlled": the model cannot call them mid-task. Recipes must be callable by the model, deterministic and testable; workflows ("block a walk", "polish this clip") are plans the user starts. |
| D9 | **`operator_run` schemas**: hand-written **zod 4** wire schemas per operator, type-checked against `OperatorMap` (compile-time conformance test), names resolved to IDs by the tool layer; operators that declare M6a **`ParamDef`** lists use `paramSchema()` directly. JSON Schema draft 2020-12 via `z.toJSONSchema()`, frozen in note 21's committed tool manifest. This adds `zod` (MIT, already the v2 SDK's peer) to `agent-tools`' allowed dependencies. | `OperatorMap` uses branded IDs, `void`, `Uint8Array` and undocumented units, so generating schemas from the TS types gives correct shapes but unusable descriptions; ParamDef was designed for exactly this (M6a §4.1). |
| D10 | **Schema hygiene for real clients**: object at the root (no root `anyOf/oneOf/allOf`), property names `^[A-Za-z0-9_.-]{1,64}$`, valid 2020-12, descriptions ≤ 1,500 characters with the "when to use" first, deterministic tool order. A CI lint enforces it. | Claude Code drops or rewrites tools that violate the Claude API's schema rules and cuts descriptions at 4,096 characters (upfront) or 16,384 (deferred); MCP 2026-07-28 asks for deterministic `tools/list` order for prompt caching. |
| D11 | **Results are compact and budgeted**: a `detail: concise\|detailed` switch on reads, paging with a cursor, a per-tool token budget tested in CI, and errors that teach (`code`, `message`, `hint`, `candidates`). Long text never exceeds ~8k tokens (Claude Code warns at 10k and truncates at 25k). | Anthropic's token-efficiency and "steering" error guidance; Claude Code's documented limits. |
| D12 | **Evaluation suite AE-01…AE-17** with numeric graders that read the document through the kernel (never the agent's tool output): a scripted reference agent, adversarial "bad agent" scripts and a seeded fuzzer run in CI under Vitest in Node; a real-model driver (Anthropic API or the Claude Code CLI) runs manually with a key from the environment and reports pass@k, tool calls, tokens and errors. | Anthropic: realistic multi-call tasks with verifiable outcomes and a held-out set; repository rule: no paid APIs and no browser in CI. |
| D13 | **Text-to-motion is a later tool** behind the ADR 0017 server gateway, run as an MCP task (`io.modelcontextprotocol/tasks`). First candidate for self-hosting: **NVIDIA Kimodo** SOMA models (code Apache-2.0; weights under the NVIDIA Open Model License; verify before use). HumanML3D-trained models (MoMask, MotionGPT, MDM, T2M-GPT) are non-commercial through AMASS/SMPL; **HY-Motion 1.0** excludes the EU, UK and South Korea and caps at **1 M** MAU (research 05 says 100 M: corrected here). | Licence facts read from the licence files (§11). |
| D14 | **Names are group-prefixed `snake_case`** (`pose_set`, `keys_retime`, `analyze_loop`, `operator_run`), so related tools sit together in `tools/list` and in tool-search hits. Note 20 (and an earlier sketch of note 21) uses verb-first names (`set_pose`, `run_operator`); note 21 now uses these; §16 maps the rest. The LLM eval runs both schemes once (§12.2) before the M-AI spec freezes names. | Anthropic found that prefix- vs suffix-style namespacing has "non-trivial effects" on tool-use evals, varying by model, and recommends choosing by your own evaluation. |
| D15 | **Note 21's bridge contracts apply to every tool**: grants (`read`/`edit`/`files`/`view`) as access classes, the `project` handle, `clipRevision`/`ifClipRevision` with the `stale` error, waiting for the user's gesture to end, a forward **selective revert** (`edit.revertSteps`) when user steps interleave, and **no borrowed selection**: selection-driven operators run through explicit-target arguments or a runner-level selection scope. | One contract for the bridge and the toolset. These rules close three traps of a toolset-only design: undo restoring a temporarily borrowed selection, an undo-based revert destroying later user edits, and edits racing the user's drag (§16). |

---

## 1. What an animation agent needs, and what goes wrong without design

### 1.1 Failure modes of LLM agents in a DCC, and the counter-measure in this toolset

| Failure mode | Typical symptom | Counter-measure |
|---|---|---|
| **Units guessed** | radians typed as degrees (a "1.57" rotation of 1.57°), seconds typed as frames | unit suffixes in every field name (D2); a heuristic warning when all rotation values are within ±π and non-zero ("looks like radians") |
| **Euler and axis confusion** | positive `rz` raises the left arm but lowers the right; rotate orders differ per control (`yxz` shoulders, `xzy` forearms) | goal tools (`pose_aim`, `ik_set_target`), bone directions in reads, axis hints computed by finite differences (§3.6) |
| **Time confusion** | keys at scene frames vs clip frames; fractional frames; 24 vs 30 fps | clip frames only, `fps` and range in every response, `…Seconds` fields only where the user speaks seconds (clip length, recipes) |
| **No eyes** | the agent "believes" a wave looks right | `view_capture` contact sheets, `analyze_*` numbers, `view_plot_curves` |
| **Token blow-up** | dumping 50k keys or 30 screenshots into context | paging and `detail`, curve *summaries* before raw keys, small images, sheets instead of many stills |
| **Disturbing the user** (live mode) | selection replaced, playhead moved, clipboard overwritten, preferences changed, unkeyed overrides dropped | tools carry explicit targets; selection-driven operators get explicit-target arguments or a runner-level selection scope, never a borrowed selection (§7.3); no clipboard use; no frame changes (D5) |
| **Unrecoverable edits** | a 20-call session leaves a mess | one undo step per call; checkpoints and `history_revert`, a forward revert that never destroys later user edits; `analyze_diff` against a checkpoint |
| **Stale reads** (live mode) | the agent edits a clip the user changed after the agent read it | `clip.revision` in every envelope, `ifClipRevision` on writes, `stale` error (note 21 §4.3) |
| **Scope creep** | "make the hand wave" also changes the legs | every write takes an explicit target; evals penalise collateral change (§12.4) |
| **Prompt injection through content** | a clip name or VRM meta field says "ignore previous instructions…" | strings from documents are returned as quoted data, length-limited and stripped of control characters; no tool reads files or the network in live mode (§14) |

### 1.2 Prior art (checked 2026-10-19)

| Tool | What the agent gets | Lesson for us |
|---|---|---|
| **Cascadeur 2026.2** (Nekki) | a built-in "simple" MCP server "making it possible to connect it to external AI tools – for example, to control the software using a LLM like Claude" (CG Channel) | the animation-tool market already expects MCP |
| **cascadeur-mcp** (gprethesh, MIT, community) | 36 named tools — scene, rig summary, `get_pose`, `set_pose` (delta rotations in degrees), `set_keys`, `set_interpolation`, `sample_motion` (trajectories, path lengths, maximum step), `mirror`, camera/framing, `capture_viewport` (PNG through MCP), FBX import/export, curated actions — plus `cascadeur_run_script`, **disabled by default** behind `--allow-scripts` | the same size and grouping as our catalogue; mixed units in its reads (quaternions plus Euler radians) are what D2 avoids; script execution is opt-in and dangerous, our escape hatch runs only operators |
| **MCP for Blender** (formerly blender-mcp; MIT, ~31.6k stars) | 9 tools: `execute_blender_code`, `look` (viewport from a camera, "an auto-framed multi-angle sheet, or an animation strip"), `get_scene_info`, asset search/generation | contact sheets and multi-angle views are the expected "see" primitive; arbitrary code needs a safe mode |
| **Maya community MCPs** | ~29–30 tools through the command port, plus arbitrary Python | none official; Python execution is the common escape hatch, which our operator-only design avoids |
| **VRMA Lab** (Apache-2.0) | `window.vrmaLab.{inspect, edit, review, validate, exportVrma, undo, redo}` and a deterministic **quad-view review render** (research 05 §2.3) | review renders with fixed framings; read-back validation after export |
| **Text-to-VRMA** (MIT) | LLM-authored keyframes, 3-candidate comparison, loop closing | LLMs can block simple motions; cleanup is the editor's job |

---

## 2. Design principles

1. **Few, high-level, task-shaped tools.** A tool does what an animator asks for in one sentence ("offset the left arm
   two frames", "make this loop"), not what one menu item does. Consolidate read→decide→write chains inside the tool.
2. **Explicit units, frames and spaces** in names and descriptions (§3.2–3.4).
3. **Names over IDs** (§3.1); ambiguity is an error with candidates, never a silent guess.
4. **Compact, structured results with budgets**: `structuredContent` plus the same JSON minified in one text block
   (the spec's backward-compatibility SHOULD), summaries before raw data, paging (§3.7).
5. **Errors that teach**: tool execution errors (`isError: true`, which clients SHOULD feed back to the model) with a
   recovery hint and candidates, including input-validation failures; protocol errors only for unknown tools and
   malformed requests (§3.8).
6. **Every write is undoable, attributed and atomic**: one tool call → one operator run → one transaction → one history
   step labelled `AI: <what>`; checkpoints group steps for revert (§6.4).
7. **The user's session state belongs to the user** (live mode): selection, current frame, unkeyed overrides, active
   tool, clipboards, camera, panel layout and preferences are untouched unless the tool's purpose is to change them
   and the user granted `view` (`timeline_set`, `pose_set {key: 'pose_only'}`). Other agent writes are keys, never
   overrides.
8. **See, measure, iterate**: every write result suggests the cheapest check (`view_capture` frames, an `analyze_*`
   call); recipes and fixes report their own before/after metrics.
9. **Same tools in live and headless hosts**: tools are written against `EditorApp`, never against the browser; only
   capture fidelity and file access differ (§6.1).
10. **Determinism**: same document + same arguments → same result bytes (seeded IDs in tests, deterministic PNGs),
    so CI can replay scripted agents.
11. **Stateless protocol, explicit handles**: MCP 2026-07-28 removed protocol sessions; anything that spans calls
    (checkpoints, paged cursors, headless projects) is a server-minted opaque handle passed as an argument, with its
    lifetime stated in the tool description, as the spec's "Stateful Tools" guidance recommends.

---

## 3. Conventions

### 3.1 Addressing

| Thing | Accepted forms | Default when omitted | Resolution errors |
|---|---|---|---|
| project (note 21) | opaque handle: a paired tab `tab_…` or a headless project `prj_…` (from `editor_connect`, `project_load` or `projects_list`) | the only paired tab or open project; error if several | `not_found` with the `projects_list` result; `expired_handle` when the pairing ended or a headless project was closed or timed out |
| character | name (`Seed-san`), `CharacterId` | the active character; error if several and none active | `not_found` with the character list |
| clip | name (unique per character, ADR 0010 rules), `ClipId` | the character's active clip | `not_found` with the clip list |
| control | template key (`fk.upperArm.L`, `ik.leg.R`, `pole.arm.L`, `cog`, `root`, `sec.<node>`), display name (`L Upper Arm`, case-insensitive), VRM humanoid bone (`leftUpperArm` → the control that drives it: `fk.upperArm.L`, or `ik.arm.L` when the tool asks for an IK effector), `ControlId` | — | `not_found` / `ambiguous` with up to 5 fuzzy candidates, each as `key (Display Name, bone)` |
| body part | M2a `BodyPart`: `root`, `torso`, `head`, `arm.L`, `arm.R`, `fingers.L`, `fingers.R`, `leg.L`, `leg.R`; plus `all` | — | — |
| bone (world reads, metrics) | VRM humanoid name (`leftFoot`, `leftToes`, `head`), glTF node name for non-humanoid rigs | — | `not_found` with the humanoid list |
| channel | `tx ty tz` (metres), `rx ry rz` (degrees), `sx sy sz` (factor), `@<attr>` (`@ikFk`, `@roll`, `@twist`; unit from the attribute definition: angle → degrees) | per tool: all keyable channels | `not_keyable` / `locked_channel` |
| limb | `leg.L`, `leg.R`, `arm.L`, `arm.R` (rig `LimbId`) | — | `limb_missing` (rig without IK; hint: `rig.addLimbIk` via `operator_run`) |

Template keys are deterministic per rig (`<rigId>:<templateKey>`, ARCHITECTURE §4.2), so names stay valid across
sessions and reloads; IDs from older sessions remain valid as long as the record exists. A write call touches at most
one character (note 21 §4.2); multi-character jobs are several calls.

### 3.2 Units

| Quantity | Tool unit | Field suffix | Operators underneath |
|---|---|---|---|
| rotation channels, angles, attribute angles | degrees | `Deg` | radians in `channel.setValues`/`applyChannelEdits`; display degrees in `graph.keys.setFields` |
| translation, distances, heights | metres | `M` (`Cm` only in analysis output) | metres |
| scale | factor (1 = rest) | `Factor` | factor |
| tween amount | percent, −150…150 (overshoot allowed) | `Percent` | slider units (same numbers) |
| time | clip frames (float; integers recommended) | `Frame`, `Frames` | clip frames |
| durations the user states in seconds | seconds | `Seconds` | converted with the clip's rational fps |
| frame rate | number (`30`, `24`, `29.97` → 30000/1001, `23.976` → 24000/1001) | `fps` | rational `Fps {num, den}` |
| speeds | metres per second, degrees per frame | `Mps`, `DegPerFrame` | — |

### 3.3 Time

- Every frame argument is a **clip frame** of the addressed clip, as shown in the time slider; scene frames never
  appear at the tool boundary (the mapping is `sceneStart` + fps ratio, MVP-SPEC §4.11.8).
- Tools may read or write any frame **without moving the user's playhead** (re-entrant `evaluateAt`, ARCHITECTURE §5).
  Only `timeline_set` moves the playhead.
- Frames outside the clip range are an `out_of_range` error with the range and the hint "extend the range with
  `clip_update` or pass `extendRange: true`" (write tools offer that flag).
- Every response that touches time starts with the envelope `clip: {name, fps, rangeFrames: [start, end], loop}`.

### 3.4 Spaces

- **Character space** (canonical, MVP-SPEC §4.11.9): +Y up, **+Z forward (the character faces +Z)**, **+X is the
  character's left**, metres, origin at the character root. Named directions accepted by goal tools: `up`, `down`,
  `forward`, `back`, `left`, `right` (the character's), and sums (`down+forward`), or a vector.
- **Control local channels**: the Channel Box values (`rx ry rz` in the control's rotate order, in its offset group's
  frame; zero = rest).
- World space is never used at the tool boundary; the character root's placement in the scene is irrelevant to
  animation tasks and would confuse comparisons.

### 3.5 Response envelope

```json
{
  "ok": true,
  "character": "Seed-san",
  "clip": { "name": "wave", "fps": 30, "rangeFrames": [0, 60], "loop": false, "revision": 17 },
  "data": { "...": "tool-specific" },
  "undo": { "label": "AI: Set pose (3 controls) @ f12", "step": 41 },
  "warnings": ["fk.hand.L rz: 1.2 looks like radians; values are degrees"],
  "next": "Check with view_capture {frames:[0,12,24], views:['front']}"
}
```

This object is the MCP `structuredContent`, repeated as minified JSON in one text block (note 21 §4.1). `undo` appears
on writes only; `next` is one short suggestion, omitted when nothing useful applies. `clip.revision` is note 21's
per-clip `clipRevision` counter: every write tool accepts `ifClipRevision` and fails with `stale` when the user
changed the clip since the agent's read. Strings that come from the document (clip names, tags, VRM meta, node names)
are quoted data, at most 120 characters each, marked `untrusted: true` when they come from imported files.

### 3.6 Axis hints (`rig_describe {detail: 'detailed'}`)

For each keyable rotation channel of a control, the tool evaluates the rig at rest with +10° on that channel and
reports how the driven bone's tip moves in character space, e.g. `fk.upperArm.L rz +10°: tip up 4.1 cm, out 0.4 cm`;
`fk.upperArm.R rz +10°: tip down 4.1 cm`. This is rig-agnostic (works for generic 1:1 rigs and M6b rigs) and costs one
evaluation per channel, cached per rig version. Humanoid controls also get a plain-language label where the rig is
known (`fk.lowerArm.L: elbow (hinge); flexion = ry−`), derived from the same numbers, never hard-coded per model.

### 3.7 Budgets

| Tool kind | Default response | Hard cap | Mechanism |
|---|---|---|---|
| summaries (`scene_summary`, `analyze_loop`) | ≤ 600 tokens | 2k | fixed shape |
| reads (`rig_describe`, `pose_read`, `curves_summary`) | ≤ 1.5k (`concise`) | 8k (`detailed`) | `detail`, filters by body part |
| raw keys (`keys_read`) | ≤ 2k | 8k per page | `cursor` paging, `range`, `channels` filter; truncation notice says how to page |
| writes | ≤ 400 | 1.5k | counts and changed values, not full curves |
| images | see §8.4 | 2,000 px long edge | sizes chosen per view; at most one image per call |

Token counts in CI use the Anthropic token-counting rule of thumb (≈ 3.5 characters per token for minified JSON) and are
re-measured with the real tokenizer in the optional LLM runs. Claude Code shows a warning above 10,000 tokens and
truncates at 25,000 by default (`MAX_MCP_OUTPUT_TOKENS`); results without images above 50,000 characters are saved to a
file instead of being shown, so staying under ~8k tokens keeps every result inline.

### 3.8 Errors that teach

Tool execution errors are returned with `isError: true` and this body:

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "No control 'leftHandIK' on Seed-san.",
    "hint": "IK effectors are named ik.arm.L / ik.leg.L. Arms are FK by default; ik_set_target switches them.",
    "candidates": ["ik.arm.L (L Arm IK)", "fk.hand.L (L Hand, leftHand)"],
    "retryable": true
  }
}
```

| Code | When | Hint pattern |
|---|---|---|
| `not_found`, `ambiguous` | name resolution | candidates; the right tool to list things |
| `out_of_range` | frame outside the clip | the range; `extendRange` or `clip_update` |
| `locked_channel`, `not_keyable` | channel edits | which channels are keyable on this control |
| `limb_mode` | FK edit on an IK-driven limb or the reverse | `ik_set_target` / `ensureIk`, or switch with `operator_run rig.ikFk.switch` |
| `humanoid_only` | aim/mirror/recipes on a generic rig | which tools work on generic rigs |
| `busy` | the user kept dragging past the wait limit (writes wait for a gesture to end, note 21 §5.6) | retry after a moment |
| `stale` | `ifClipRevision` no longer matches: the user changed the clip | read again (`keys_read`/`pose_read`), then redo the edit |
| `not_granted`, `paused` | the call needs a grant the user has not given (`edit`, `files`, `view`), or the user paused the agent | which grant, and that only the user can give it in the Agent panel |
| `expired_handle` | a checkpoint, cursor or `project` handle is unknown or expired | how to get a fresh one (`history_checkpoint`, repeat the read, `projects_list`/`project_load`) |
| `read_only` | project opened read-only (newer schema) | save as a copy is not available; ask the user |
| `confirm_required` | destructive call without `confirm: true`, or the user declined the editor's confirmation | what will be lost |
| `limit` | too many targets/frames | the limit and how to split |
| `unsupported` | capability missing in this host (shaded capture headless, files in live mode) | the alternative |
| `poll_failed` | an operator's `poll` refused | the operator's own reason, verbatim |
| `invalid_args` | schema-invalid arguments, or schema-valid but semantically wrong (end before start) | the failing path, the expected shape and a minimal valid example |
| `internal` | a bug | "report this; the document was rolled back" (the runner rolls back on exceptions) |

The 2026-07-28 tools specification lists input-validation errors among **tool execution errors** ("actionable
feedback that language models can use to self-correct"); only unknown tools and malformed requests are JSON-RPC
protocol errors. SDK v2's `McpServer` already turns a schema failure into an `isError` result, but with a generic
message ("Input validation error: Invalid arguments for tool …"). The adapter therefore validates with the tool's
own zod schema first and returns the `invalid_args` body above.

---

## 4. Tool catalogue (37 tools)

Columns: **R/W** read-only or write; **Ann.** MCP annotations (`ro` readOnlyHint, `dx` destructiveHint, `id`
idempotentHint; `openWorldHint` is false for every tool); **Backing** the operator or kernel function underneath
(*new* = new explicit-target operator, *+args* = additive optional target arguments on an existing operator; §6.3);
**Ph.** phase (1 = M-AI.1, 2 = M-AI.2, §13). **★** = core profile (loads upfront via `_meta["anthropic/alwaysLoad"]`;
the user can override).

**Access class** (note 21 §4.5, §5.7 grants): every read-only tool (R) is `read`; every document write (W) is `edit`;
group J is `files`; `timeline_set`, `pose_set {key: 'pose_only'}` and `clip_create`/`clip_update {activate: true}` in
live mode are `view`; `operator_run` takes the class of the operator it runs (§7.3). Every tool also accepts the
optional `project` handle (§3.1), and every W tool accepts `ifClipRevision` (§3.5).

### A. Scene and document reads

| Tool | Purpose and key arguments | R/W | Ann. | Backing | Ph. |
|---|---|---|---|---|---|
| `scene_summary` ★ | Characters, active clip per character (fps, range, loop, key count), playhead (live), dirty flag, last 3 history labels, host mode and capabilities (capture fidelity, file access). No args. | R | ro | session, store queries | 1 |
| `rig_describe` ★ | Controls of a character: key, display name, side, body part, driven bone, keyable channels, rotate order, mirror partner, limbs (IK/FK state, `ikFk` value, pole), custom attributes with units and ranges. `bodyParts?`, `detail` (detailed adds axis hints, §3.6, and rest-pose bone directions). | R | ro | `DocQueries`, `RigProgram.limbs`, `bodyPartOf`, `controlVisibility` | 1 |
| `keys_read` | Raw keys of controls/channels in a frame range: `[frame, valueDeg\|M, inTangent, outTangent, flags]` rows per curve, breakdown flags, infinity. `targets`, `rangeFrames?`, `cursor?`. | R | ro | store, `channelUnit`, `toDisplayValue` | 1 |
| `curves_summary` | Per curve: key count, value min/max with frames, extremes, overshoot beyond neighbouring keys, Euler jumps > 90°/frame, tangent-type histogram, infinity, static value. `targets`, `rangeFrames?`. The cheap first look before `keys_read`. | R | ro | compiled curves | 1 |
| `pose_read` ★ | Pose at frames or over a sampled range: `space: channels` (Channel Box values) / `world` (bone position M, unit direction, character-space Euler XYZ deg) / `both`; `frames[]` (≤ 8) or `rangeFrames + stepFrames` (≤ 64 samples) for trajectories. Evaluates the keyed animation (`withUserOverrides: false` by default) and reports `userOverrides: n` when the user has unkeyed edits there. | R | ro | `evaluateAt`, `controlWorld`, `PoseBuffers` | 1 |

### B. Posing

| Tool | Purpose and key arguments | R/W | Ann. | Backing | Ph. |
|---|---|---|---|---|---|
| `pose_set` ★ | Set channel values of many controls at one frame: `set: [{control, rotateDeg?{x,y,z}, translateM?{x,y,z}, scaleFactor?, attrs?{name: value}}]`, `mode: absolute\|relative`, `key: key\|pose_only`, `tangent?`. `key` (default) writes keys and warns when the user has an unkeyed override on the same channel and frame (it hides the new key until the user changes frame or keys). `pose_only` is an unkeyed proposal at the user's current frame that the user accepts with `S`: live only, `view` access. | W | — (relative mode is not idempotent) | *new* `pose.setAt` (`ensureCurve`, `writeKeyAt`, Channel Box unit conversion; `applyChannelEdits` only for `pose_only`) | 1 |
| `pose_aim` | Goal posing of FK chains: point a bone in a character-space direction or toward a bone/point, keeping twist; head/neck "look at" split over neck and head. `aims: [{bone, direction \| towardBone \| towardPointM, weight?}]`, `frame`. | W | — | *new* `pose.goals` (`solveBoneChannels`, `eulerNear`) | 1 |
| `ik_set_target` | Place an IK hand or foot: `limb`, position (`absoluteM` in character space, `relativeM`, or `nearBone + offsetM`), optional `rotateDeg`, pole direction, `ensureIk: auto\|never` (auto: switch an FK arm to IK with match, keyed seamlessly). | W | — | *new* `pose.goals` (`ikControlForEndWorld`, `matchIkToFk`) | 1 |
| `pose_transfer` | Copy a pose from one frame (or clip) to other frames, optionally mirrored: `controls\|bodyParts`, `fromFrame`, `fromClip?`, `toFrames[]`, `mirror: none\|flip\|leftToRight\|rightToLeft`. Covers copy/paste pose, mirror pose and holds without the user's clipboard. | W | — | *new* `pose.transfer` (`makePoseClipboard`, `mirrorPose`, `applyPoseClipboard`) | 1 |
| `pose_reset` | Reset controls to rest at frames (keyed). `controls\|bodyParts`, `frames[]`. | W | id | `pose.resetToRest` *+args* (`frames`, `controls`) | 1 |

### C. Keys and timing

| Tool | Purpose and key arguments | R/W | Ann. | Backing | Ph. |
|---|---|---|---|---|---|
| `keys_set` ★ | Write keys in one step: `keys: [{control, channel, frame, value, tangent?, breakdown?}]` (≤ 2,000), or `keyPoseAt: {controls\|bodyParts\|all, frames[]}` to key the evaluated pose. Writes regardless of the user's auto-key preference. | W | — | *new* `key.write` (`writeKeyAt`, `ensureCurve`) | 1 |
| `keys_delete` | Delete keys by targets and frames or range; `confirm: true` when more than 500 keys (note 21 Q-AI-4). | W | dx | *new* `key.delete` (`deleteKeys`) | 1 |
| `keys_retime` | Time edits on targets: `mode: offset` (`offsetFrames`, `wrap` for loops), `scale` (`factor`, `pivotFrame`), `warp` (`[[oldFrame, newFrame], …]` piecewise-linear), `insert_time`, `delete_time`; `ripple`, `retimeBreakdowns`. | W | — | *new* `key.retime` (`moveKeys`, `scaleKeys`, `insertTime`, new warp/wrap) | 1 (warp 2) |
| `keys_tween` | Tween/breakdown at frames on targets: `mode: tween\|neighbor\|ease\|pushPull\|toDefault`, `amountPercent` (−150…150), `frames[]`, `breakdown`. | W | — | `key.tween` *+args* (`frames`, `targets`; `tweenEdits`) | 1 |
| `clip_make_loop` | Make a clip cycle: `method: match_ends\|blend\|cycle_only`, `blendFrames`, `rootTravel: cycle_offset\|in_place\|keep`; sets `loop`, cyclic infinities (cycle-aware tangents, M2A §5.23); returns seam metrics before/after; `dryRun`. | W | — | *new* `clip.makeLoop` | 1 |
| `feet_plant` | Remove foot sliding: lock each foot over contact intervals (auto-detected or given) with blends at the edges; IK feet edit the IK control curves, FK feet use the Plant Feet solve per frame. Returns slide before/after. | W | — | *new* `pose.plantContacts` (`plantFeetChannels`, `footPivotWorlds`) | 2 |

### D. Curve cleanup

| Tool | Purpose and key arguments | R/W | Ann. | Backing | Ph. |
|---|---|---|---|---|---|
| `curves_set_interpolation` | Tangent type per key range (`auto`, `spline`, `clamped`, `linear`, `flat`, `step`, `plateau`), `side`, `broken`, `weighted`, pre/post `infinity`. `targets`, `frames?\|rangeFrames?`. | W | id | `graph.tangent.*`, `graph.infinity.set`, `graph.curve.setWeighted` *+args* (`keys`, `curves`) | 1 |
| `curves_euler_filter` | Euler filter on rotation curves of targets; returns flips fixed per curve. | W | id | `graph.eulerFilter` *+args* (`controls`) | 1 |
| `curves_simplify` | Key reduction with `toleranceDeg` (0.1), `toleranceM` (0.0005); `dryRun` reports before/after and max error. | W | — | `graph.curves.simplify` *+args* (`curves`; `reduceKeys`) | 1 |

### E. Analysis (all read-only, shared library `motion-analysis`, §9)

| Tool | Purpose and key arguments | Ph. |
|---|---|---|
| `analyze_contacts` | Foot (and optional hand) contact intervals, slide per interval (cm), max slide speed, GMD-style skating ratio, floor penetration; `feet`, `rangeFrames?`, thresholds optional (scaled by character height). | 1 |
| `analyze_loop` | Seam continuity of a loop clip: worst channels by C0 and C1 jump, bone position/rotation and velocity mismatch at the seam, a verdict (`seamless` / `pops` / `hitches`). | 1 |
| `analyze_motion` ★ | Per target (bones, controls, body parts), chosen `metrics[]`: `oscillation` (cycles, period, amplitude), `pops` (angular-speed spikes, Euler flips), `spacing` (ease classification per segment, optional per-frame chart), `arcs` (path length, sharp turns), `holds`, `speed`, `hyperextension`, `penetration`. | 1 (`arcs`, `hyperextension` 2) |
| `analyze_diff` | Difference between two states: clip vs clip, frame vs frame, or now vs a checkpoint; RMS/max angle (deg) and position (cm) per body part. Detects collateral change. | 2 |

### F. See

| Tool | Purpose and key arguments | Ph. |
|---|---|---|
| `view_capture` ★ | One image: a still (`frames: [12]`) or a contact sheet (`frames: [0,6,…]`, ≤ 16, or `frames: 'keys'\|'extremes'\|{every: n}`) from `views` (≤ 3 of `front`, `side`, `three_quarter`, `back`, `top`, `shot`, `follow`), `crop: body\|upper_body\|legs\|hands\|head`, `overlays: {trails: [bones], ghosts: none\|prev_next, contacts, controls, grid}`, `fidelity: auto\|shaded\|schematic`. Frame numbers and view names are burned into each tile. | 1 (trails, ghosts 2) |
| `view_plot_curves` | A value-vs-frame plot of ≤ 6 channels (degrees/metres), keys and breakdowns marked, seam marked on loops, optional overlay of a checkpoint's curves, plus a numeric summary. | 2 |

### G. Clips

| Tool | Purpose and key arguments | R/W | Ann. | Backing | Ph. |
|---|---|---|---|---|---|
| `clip_create` | New or duplicated clip: `name`, `fps?`, `durationFrames\|durationSeconds`, `loop?`, `duplicateOf?`, `activate` (default true in headless, false in live unless asked). | W | — | `clip.new`, `clip.duplicate` | 1 |
| `clip_update` | Rename, `fps` with `keep_seconds\|keep_frames`, range, loop flag, root motion, slot, tags, contact frame, `activate`. | W | — | `clip.rename`, `clip.setSettings`, `clip.setActive` | 1 |
| `clip_delete` | Soft-delete a clip; `confirm: true` required. | W | dx | `clip.delete` | 2 |

### H. Recipes

| Tool | Purpose and key arguments | R/W | Ph. |
|---|---|---|---|
| `recipe_apply` | Parametric motion written as keys in one step: `recipe` (`wave`, `nod`, `head_shake`, `breathe`, `idle_sway`, `look_at`, `walk_cycle_block`), `clip?`, `startFrame`, `params` (per recipe, §10.2). Returns what it wrote and its own metrics. | W | 2 |

### I. History and timeline

| Tool | Purpose and key arguments | R/W | Ann. | Ph. |
|---|---|---|---|---|
| `history_checkpoint` | Mark the current history position: returns an opaque `checkpoint` handle (lifetime stated in the description: the pairing in live mode, the `prj_…` project in headless mode); `list: true` returns the last N steps with labels and actor (this agent, another agent, the user). | R* | ro | 1 |
| `history_revert` | Revert this agent's own steps: `to: checkpoint` (all of them since) or `steps: [stepId]`. When only this agent's steps lie above the target it undoes them (exactly like `Mod+Z`); otherwise it runs note 21's **selective revert** (`edit.revertSteps`: one new `AI: Revert …` step, compare-before-restore per merge unit), which leaves user steps alone and lists the fields it skipped because the user changed them since. `includeUserSteps: true` also undoes interleaved user steps and always asks the user first. `dryRun` lists what would change. | W | dx | 1 |
| `timeline_set` | Live only, `view` grant: move the user's playhead, set the playback range, play/stop — to *show* the user something. Warns that a frame change drops the user's unkeyed overrides and refuses while any exist unless `confirm: true`. | W (U state) | id | 2 |

\* `history_checkpoint` writes nothing to the document; it records a step id.

### J. Files

| Tool | Purpose and key arguments | R/W | Ann. | Ph. |
|---|---|---|---|---|
| `export_clip` | `kind: vrma\|animation_glb\|bake_into_model`, `clips`, `fileName?`, `profile?`, `reduce` (default on), `rootMotion?`, `acknowledgeLicense?`. Returns artifacts `{fileName, bytes, sha256, lints, readBack}`. Live: the editor shows its confirm before the browser download; headless: writes under the configured workspace `exports/`. | W (files) | dx (overwrites in headless) | 1 |
| `project_save` | Save `.ekzanim` (live: the editor's save flow; headless: workspace path, `overwrite` flag). | W (files) | — | 1 |
| `project_load` | Headless: open a `.ekzanim`, import a `.vrm`/`.glb` or a `.vrma` clip from the workspace, or load a bundled sample; returns a `prj_…` project handle (note 21 §5.5). Live: replaces the user's project, so it always asks the user. | W | dx (replaces the open project) | 1 |

### K. Escape hatch

| Tool | Purpose and key arguments | Ph. |
|---|---|---|
| `operators_list` | Search the operator registry: `query?`, `category?`, `ids?`, `includeSchema` (default false). Returns `{id, label, category, undoable, available, reason?, argsSummary}`; schemas only on request. | 1 |
| `operator_run` | Run one allow-listed operator: `id`, `args`, `context?` (`controls`, `keys: [{control, channel, frames}]`, `panel`; no `frame`), `dryRun?` (poll only). `context` maps onto the operator's explicit-target arguments or the runner-level selection scope; it never becomes the user's selection (§5.6, §7.3). Units are the operator's own (documented per field). | 1 |

**Count**: 5 + 5 + 6 + 3 + 4 + 2 + 3 + 1 + 3 + 3 + 2 = **37**. M-AI.1 ships 31 of them; `feet_plant`, `analyze_diff`,
`view_plot_curves`, `clip_delete`, `recipe_apply` and `timeline_set` follow in M-AI.2 (§13).

---

## 5. Selected contracts

Schemas below are the JSON Schema (draft 2020-12) the server publishes; in code they are zod 4 objects with
`.describe()` texts, converted by `z.toJSONSchema()` (default target draft 2020-12).

### 5.1 `pose_set`

```json
{
  "name": "pose_set",
  "title": "Set pose",
  "description": "Set Channel Box values of one or more controls at one clip frame and key them (one undo step). Rotations are DEGREES in each control's own rotate order; translations METRES; frames are clip frames. For limbs prefer pose_aim or ik_set_target; use rig_describe {detail:'detailed'} to see which way each axis moves a bone. key:'pose_only' leaves an unkeyed pose at the user's current frame for the user to accept (live mode, needs the View grant).",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["frame", "set"],
    "properties": {
      "character": { "type": "string", "description": "Character name; default the active character." },
      "clip": { "type": "string", "description": "Clip name; default the active clip." },
      "frame": { "type": "number", "description": "Clip frame." },
      "mode": { "enum": ["absolute", "relative"], "default": "absolute" },
      "key": { "enum": ["key", "pose_only"], "default": "key" },
      "tangent": { "enum": ["auto", "spline", "clamped", "linear", "flat", "step"] },
      "extendRange": { "type": "boolean", "default": false },
      "ifClipRevision": { "type": "integer", "description": "clip.revision from your last read; the call fails with 'stale' if the user changed the clip since." },
      "project": { "type": "string", "description": "Project handle (tab_… or prj_…); default the only open project." },
      "set": {
        "type": "array", "minItems": 1, "maxItems": 100,
        "items": {
          "type": "object", "additionalProperties": false, "required": ["control"],
          "properties": {
            "control": { "type": "string", "description": "fk.upperArm.L, 'L Upper Arm' or leftUpperArm." },
            "rotateDeg": { "type": "object", "additionalProperties": false,
              "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "z": { "type": "number" } } },
            "translateM": { "type": "object", "additionalProperties": false,
              "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "z": { "type": "number" } } },
            "scaleFactor": { "type": "object", "additionalProperties": false,
              "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "z": { "type": "number" } } },
            "attrs": { "type": "object", "additionalProperties": { "type": "number" },
              "description": "Custom attributes by name without '@' (e.g. {\"roll\": 20}); angle attributes in degrees." }
          }
        }
      }
    }
  },
  "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false }
}
```

Result `data`: `{frame, changed: [{control, channel, beforeDeg|M, afterDeg|M}], keyed, skipped: [{control, channel,
reason}]}` (changed list capped at 60 rows with a count), plus `warnings` for channels where the user has an unkeyed
override at that frame.

### 5.2 `pose_aim` (goal posing)

```json
{
  "frame": 12,
  "aims": [
    { "bone": "leftUpperArm", "direction": "up+left", "keepTwist": true },
    { "bone": "leftLowerArm", "direction": "up" },
    { "bone": "head", "towardPointM": [0.4, 1.5, 1.0], "split": { "neck": 0.4, "head": 0.6 } }
  ]
}
```

Semantics: for each aim in order (parents first), compute the bone's current world direction (rest bone axis =
direction to its first child), the minimal rotation that maps it onto the target direction in character space
(`keepTwist` removes the swing-twist twist component), compose it onto the bone's world rotation, convert with
`solveBoneChannels` and `eulerNear` to the driving control's channels, and key them. FK only: a bone driven by an IK
limb at `ikFk > 0` returns `limb_mode` with the hint to use `ik_set_target`. Result: achieved direction and the
remaining angular error per aim (joint limits and parent constraints can prevent an exact match).

### 5.3 `keys_retime`

```json
{
  "targets": { "bodyParts": ["arm.L"] },
  "mode": "offset",
  "offsetFrames": 2,
  "wrap": true
}
```

`wrap: true` on a loop clip moves keys that leave the range to the other end (cyclic offset, the standard way to add
overlap to a cycle); without `wrap` they are clamped and reported. `mode: "warp"` takes
`"warp": [[0, 0], [10, 14], [24, 24]]` (piecewise-linear time map over the given anchors; keys between anchors are
interpolated in time, values untouched). Result: keys moved, keys merged on collision, new contact frame if the clip's
`contact` moved.

### 5.4 `view_capture`

```json
{
  "frames": [0, 6, 12, 18, 24, 30, 36, 42],
  "views": ["side"],
  "crop": "body",
  "overlays": { "trails": ["leftHand"], "contacts": true, "grid": true },
  "fidelity": "auto",
  "tilePx": 256
}
```

Returns one PNG (or WebP in live mode for shaded captures) plus `data.tiles: [{frame, view, rectPx}]`, `fidelity`,
`camera` (position, target, orthographic or not) and `visualTokens` (≈ ⌈w/28⌉·⌈h/28⌉, §8.4). Sheets fill a grid of at
most 4 columns of 256² tiles (8 columns of 192² tiles for 9–16 frames); with two or three views each view takes its
own block of rows in the same frame order, so the long edge stays ≤ 1,568 px and is never downscaled (§8.4).

### 5.5 `analyze_contacts` result

```json
{
  "ok": true,
  "clip": { "name": "walk", "fps": 30, "rangeFrames": [0, 32], "loop": true },
  "data": {
    "thresholds": { "heightM": 0.03, "speedMps": 0.25, "scaledForHeightM": 1.62 },
    "feet": {
      "L": { "contacts": [[0, 13]], "slideCm": [3.8], "maxSlideMps": 0.41, "penetrationCm": 0.0 },
      "R": { "contacts": [[16, 29]], "slideCm": [0.2], "maxSlideMps": 0.04, "penetrationCm": 0.6 }
    },
    "skatingRatio": 0.094,
    "verdict": "left foot slides 3.8 cm during contact 0-13"
  },
  "next": "feet_plant {feet:['L']} or keys_read on ik.leg.L tx/tz frames 0-13"
}
```

### 5.6 `operator_run`

```json
{
  "id": "graph.tangent.set",
  "args": { "type": "flat", "side": "both" },
  "context": { "keys": [{ "control": "cog", "channel": "ty", "frames": [0, 16, 32] }] }
}
```

The tool resolves `context` (names → IDs) and hands it to the operator in one of two ways, never by writing the
user's selection:

1. **Explicit-target arguments** where the operator has them (`graph.tangent.set {keys?}` in this example, §6.3):
   `context.keys` becomes `args.keys`.
2. Otherwise **note 21's runner-level scope**: an additive `RunContext.selection?: SelectionSnapshot` that
   selection-driven operators read through one helper (`selectionOf(ctx)`) instead of
   `app.session.getState().selection`; the runner keeps recording the user's real selection as
   `selectionBefore`/`selectionAfter`. Operators not yet moved to the helper are not callable with `context`.

Setting the user's selection, running and restoring it was rejected: on v0.2.0 the runner records `selectionBefore`
from the session when the run starts and annotates `selectionAfter` inside the transaction (`operators/runner.ts`),
and undo/redo restore those snapshots, so the user's next `Mod+Z` would put the agent's temporary selection into the
user's session; the borrowed selection would also be visible while an async `prepare` awaits. There is no
`context.frame`: an operator that acts at the current frame needs an explicit `frame` argument first, because moving
the playhead drops the user's unkeyed overrides.

The tool then runs `app.runUntyped(id, args, { panel, source: 'api', actor, signal })` and returns the
`OperatorResult`, the undo label and counts. A `cancelled` result becomes a `poll_failed` error with the operator's
reason.

---

## 6. Architecture of the toolset

### 6.1 Packages and hosts

```
packages/motion-analysis/   headless: contacts, seam, oscillation, pops, spacing, arcs, diff (anim-core, rig)
packages/agent-tools/       headless: AgentToolDef registry, resolver, units, envelopes, errors, budgets,
                            the 37 tools, recipes, operator wire schemas (editor-core, rig, io, motion-analysis, zod)
packages/schematic-render/  headless: pure-TS rasteriser (lines, discs, text 5×7 font, plots) → PNG via fflate
packages/mcp-server/        Node: MCP SDK adapter (stdio), headless host or live-bridge relay (sibling notes)
packages/agent-evals/       private, test-only: tasks, graders, fixtures builders, drivers, reports
packages/editor/            live host: CaptureService over the ViewportManager (WebGL offscreen), bridge endpoint
```

Layering (additions to `tooling/check-deps.mjs`): `motion-analysis` and `schematic-render` sit beside `rig`/`io`
(headless, no DOM); `agent-tools` sits beside `editor-core`'s consumers and must not import React, DOM, WebGL or the MCP
SDK; only `mcp-server` imports the SDK; `editor` may import `agent-tools` (to run tools in the tab, and later for an
in-editor AI panel). Nothing in the editor's first-visit route imports `agent-tools`: the live endpoint is a lazy chunk
loaded when the user enables the bridge (the 900 kB route gate stays untouched).

**Live host**: the tools run *in the tab* against the user's `EditorApp`; the Node MCP server is a relay that
forwards `tools/call` and returns results. **Headless host**: the MCP server creates `createEditorApp({services})` in
Node (the same production kernel the headless tests use, with recording services) and runs the same tools. Only two
capabilities differ, declared in `scene_summary.host`:

| Capability | Live | Headless |
|---|---|---|
| capture fidelity | `shaded` (WebGL) and `schematic` | `schematic` (shaded raster later) |
| files (`files` grant) | exports and saves as a browser download after the editor's confirm, or transfers to and from the server's workspace folder when the user allows it; `project_load` replaces the user's project after a confirm (note 21 §5.7) | read/write inside the workspace folder(s) the server allows; no other paths |
| `pose_only` proposals, `timeline_set`, clip activation (`view` grant) | yes | `unsupported` (no user session) |

### 6.2 The tool contract (sketch)

```ts
// packages/agent-tools/src/types.ts
import type { z } from 'zod';
import type { EditorApp } from '@ekza-studio/editor-core';

export type AgentHost = 'live' | 'headless';
export interface AgentToolDef<I extends z.ZodObject, O extends z.ZodType> {
  readonly name: string;                       // snake_case, ≤ 40 chars, group prefix ('pose_', 'keys_', …)
  readonly title: string;
  readonly description: string;                // ≤ 1,500 chars; first sentence = when to use it
  readonly input: I;                           // root is always an object (no root combinators)
  readonly output: O;                          // published as outputSchema
  readonly annotations: { readonly readOnly: boolean; readonly destructive?: boolean; readonly idempotent?: boolean };
  readonly hosts: readonly AgentHost[];
  readonly core?: boolean;                     // → _meta["anthropic/alwaysLoad"]
  readonly budget: { readonly tokens: number; readonly image?: { readonly maxEdgePx: number } };
  run(ctx: AgentToolContext, args: z.output<I>): Promise<AgentToolResult<z.output<O>>>;
}
export interface AgentToolContext {
  readonly app: EditorApp;
  readonly host: AgentHost;
  readonly capture: CaptureService | null;
  readonly files: AgentFileAccess | null;      // headless workspace only
  readonly resolve: Resolver;                  // names → ids, with candidates for errors
  readonly actor: RunActor;                    // { kind: 'agent', id, name } (note 21 §4.2): labels, presence
  readonly signal: AbortSignal;
}
export type AgentToolResult<O> =
  | { readonly ok: true; readonly data: O; readonly images?: readonly AgentImage[]; readonly undo?: UndoInfo;
      readonly warnings?: readonly string[]; readonly next?: string }
  | { readonly ok: false; readonly error: AgentToolError };
export interface AgentToolError {
  readonly code: string; readonly message: string; readonly hint: string;
  readonly candidates?: readonly string[]; readonly retryable: boolean;
}
export interface CaptureService {
  capture(req: CaptureRequest): Promise<{ readonly bytes: Uint8Array; readonly mime: 'image/png' | 'image/webp';
    readonly width: number; readonly height: number; readonly fidelity: 'shaded' | 'schematic';
    readonly tiles: readonly { readonly frame: number; readonly view: string; readonly rect: readonly [number, number, number, number] }[] }>;
}
```

Note 21 §4.1 adds the bridge fields on top: `access` (the grant a call needs, possibly per argument, e.g. `pose_set
{key: 'pose_only'}` → `view`), `confirm`, `needs`, and on the context `capabilities`, `progress`, `confirm`,
`presence` and `download`. The MCP adapter publishes `input`/`output` as JSON Schema through `z.toJSONSchema()` into
the committed tool manifest (note 21 §4.6). `EditorServices` gains `capture?: CaptureService | null` (additive; null
in Node unless the schematic renderer is injected). The registry is contributable later (`app.contribute({ kind:
'agentTool', def })`, ADR 0008 style), so trusted extensions can add tools; sandboxed plugins never can (research 08
§8.3).

### 6.3 Writes go through operators: what is new

Selection-based operators (`graph.*`, `key.tween`, `key.deleteAtFrame`) and current-frame operators (`key.set`,
`channel.setValues`, `pose.paste`) cannot serve an agent that must not move the user's selection or playhead, and
`pose.copy` writes the user's clipboards. M-AI therefore adds explicit-target operators (all `flags.undo`, one
transaction, registered `internal` so menus do not show them, listed by `operators_list`):

| New operator | Args (stored units) | Built from |
|---|---|---|
| `key.write` | `{clip, keys: [{control, channel, frame, value, inType?, outType?, breakdown?}] }` or `{clip, poseAt: {controls, frames}}` | `ensureCurve`, `writeKeyAt`, `evaluateAt` |
| `key.delete` | `{clip, targets, frames? \| range?}` | `deleteKeys` |
| `key.retime` | `{clip, targets, mode, …, wrap, ripple}` | `moveKeys`, `scaleKeys`, `insertTime`, new `warpKeys`, `wrapKeys` |
| `pose.setAt` | `{clip, frame, edits, key: 'force' \| 'none'}` | `'force'`: `ensureCurve` + `writeKeyAt` at any frame with the Channel Box unit conversions (`applyChannelEdits` itself writes only at the playhead and merges session overrides); `'none'` (the `pose_only` proposal): `applyChannelEdits` at the playhead only |
| `pose.goals` | `{clip, frame, aims[], ikTargets[]}` | `solveBoneChannels`, `ikControlForEndWorld`, `matchIkToFk`, the IK/FK switch workflow |
| `pose.transfer` | `{clip, fromClip?, fromFrame, toFrames, controls, mirror}` | `makePoseClipboard`, `mirrorPose`, `applyPoseClipboard` (no session clipboard) |
| `clip.makeLoop` | `{clip, method, blendFrames, rootTravel}` | infinity writes, end-key matching, blend window |
| `pose.plantContacts` | `{clip, contacts, method, blendFrames}` | `plantFeetChannels`, IK foot curve edits |
| `edit.revertSteps` (note 21 D4) | `{steps}` | inverse of the recorded agent batches, compare-before-restore per merge unit (doc's `PatchUndoManager` logic as a pure helper) |

Additive optional arguments on existing operators (no change when absent): `pose.resetToRest {frames?}`,
`key.tween {frames?, targets?}`, `graph.tangent.set|break|unify`, `graph.curve.setWeighted`, `graph.infinity.set`,
`graph.curves.simplify` and `graph.eulerFilter` take `{keys?}` / `{curves?}` / `{controls?}`. The edit kernel helpers do
the work, so tools, panels and agents keep one behaviour (ADR 0008 §1). Selection-driven operators without such
arguments become callable with `operator_run {context}` only after they read the selection through note 21's
`selectionOf(ctx)` helper (§5.6).

### 6.4 History, attribution and checkpoints

- Every agent run passes `RunContext { source: 'api', actor, signal }` (M6a `RunSource`; `actor` and `signal` are
  note 21's additive fields); the runner prefixes the history label (`AI: Set pose (3 controls) @ f12`), stores the
  actor on the step and scopes coalescing by actor, and the shell shows the label in toasts and, in M2c, in the
  History panel. One tool call is one operator run, so one `Mod+Z` undoes one agent action (the owner's requirement).
- `history_checkpoint` records `{stepId, docVersion}`. `history_revert {to}` undoes when only this agent's steps lie
  above the checkpoint; otherwise it runs `edit.revertSteps` (a forward step that never destroys later user edits and
  lists what it skipped). `includeUserSteps: true` also undoes interleaved user steps and always asks the user, who
  sees exactly which steps go. Agents never call `edit.undo`/`edit.redo` through `operator_run`. Checkpoints die with
  the pairing (live) or the project handle (headless).
- Concurrency (live): while the user drags (the runner would answer `cancelled: 'gesture in progress'`) an edit waits
  for the commit or cancel, up to note 21's `gestureWaitMs` (15 s), then fails with `busy`; reads proceed. Edits of
  one agent run strictly in arrival order. Agent and user share one history in M-AI; whether the agent becomes its own
  actor with a separate undo stack in M3 (per-user undo already exists in `doc`) is an open question (§15).
- M6a compatibility (note 21 §5.9): an agent run of an operator with `params` records a `LastRun` with
  `source: 'api'`, so the user can tune an AI-made extrude or bevel in the Last-op card (labelled AI);
  `edit.repeatLast` polls false while `lastRun.source === 'api'`, so the user's `G` never replays an agent's
  operation on the user's selection.

---

## 7. `operator_run`: schemas from `OperatorMap` and `ParamDef`

### 7.1 Options compared

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Generate from TS types** (`ts-json-schema-generator` 2.9.0, MIT) at build time from `operators/args.ts` | compiler walks `OperatorMap[K]['args']` | zero duplication; exact shapes | branded IDs become `string & {…}` noise; `void`, `Uint8Array`, intersections; **no units or semantics** (`value: number` is radians in one op, degrees in another); comments are sparse; a build step with the TS compiler | drift check only |
| **B. zod 4 wire schemas per operator** (`zod` 4.6.7, MIT) | `OPERATOR_WIRE: { [K in keyof OperatorMap]?: { schema, toArgs } }` | descriptions with units per field; names → IDs in `toArgs`; runtime validation; `z.toJSONSchema()` emits draft 2020-12 (its default); the v2 MCP SDK takes Standard Schema directly | hand-written; must be kept in sync | **chosen** for `OperatorMap` |
| **C. TypeBox** (`typebox` 1.4.2, MIT) | JSON Schema objects with inferred static types | JSON Schema native | a second schema library next to zod; no gain over B | no |
| **D. M6a `ParamDef`** | `paramSchema(def.params)` + `extraArgs` | one source for card, INPUTS, option boxes **and** agents (that was its purpose); units are kinds (`angle`, `distance`, `fraction`) | only scalar params; operators without `params` need B | **chosen** for operators that declare `params` (all `mesh.*` in M6a) |

### 7.2 Keeping B honest

```ts
// packages/agent-tools/src/operators/wire.ts
export interface OperatorWire<K extends keyof OperatorMap> {
  readonly schema: z.ZodObject;                                       // what the agent sends (names allowed)
  toArgs(wire: z.output<this['schema']>, r: Resolver): OperatorArgs<K>;   // names → branded IDs, display → stored units
}
export const OPERATOR_WIRE: { readonly [K in keyof OperatorMap]?: OperatorWire<K> } = { /* … */ };
```

1. **Compile-time conformance**: `toArgs` must return exactly `OperatorArgs<K>` (the mapped type above fails `tsc`
   on drift); a type test asserts `OperatorArgs<K>` → wire → args round-trips for every entry.
2. **Coverage test**: every registered, non-internal operator whose args are JSON-representable has a wire schema, a
   `ParamDef` list, or an entry in the policy table below with a reason.
3. **Drift check (option A as a test)**: generate the TS-derived schema and compare property names and required sets
   with the wire schema minus the documented extras; a mismatch fails CI with the field name.
4. **Units**: wire schemas keep the operator's own units and say so in every numeric description ("radians"); the
   high-level tools are the degree-based path. Converting units inside `operator_run` was rejected: it would make the
   same operator mean two things depending on the caller (scripts, tests and keymaps call it in stored units).

### 7.3 Policy: what `operator_run` may call

| Policy | Operators | Why |
|---|---|---|
| **denied** | `file.open`, `file.openProject`, `file.importModel`, `file.importAnimation` (bytes args), `file.recover`, `file.discardRecovery`, `file.autosaveNow`, `ui.*`, `prefs.*`, `workspace.*`, `view.setNavProfile`, `view.manipulatorSize`, `edit.copy`/`edit.paste`, `pose.copy`/`pose.paste`, `graph.keys.copy`/`graph.keys.paste` (clipboards), `key.toggleAutoKey`, `edit.undo`/`edit.redo` (agents use `history_revert`) | user files, user preferences, user clipboards, the user's undo navigation and UI are not the agent's; file intake has `project_load` |
| **confirm** (`confirm: true` arg, plus host prompt via the destructive annotation) | `file.new`, `clip.delete`, `rig.addLimbIk`, `rig.setFootParams`, `clip.setSettings` with `fps` (structural) | data loss or structural rewrites |
| **allowed** | everything else, with note 21's grant per operator: `edit` for `flags.undo` operators, `view` for those that change U-state (`select.*`, `view.*` camera and display operators, live only), `files` for exports | undoable, or a visible U-state change the user granted |

The policy table is data in `agent-tools` and is unit-tested against the registry, so a new operator is denied until
someone classifies it. Extensions classify their own operators through note 21's proposed additive field
`OperatorDef.agent?: { policy, access, confirm }` (research 08 §8 trust tiers decide who may set it).

---

## 8. "See" tools

### 8.1 Backends and fidelity

| Fidelity | Where | How | Cost |
|---|---|---|---|
| **shaded** | live tab | `ViewportManager` renders a preset camera into a `WebGLRenderTarget` at the tile size; the pose of any frame comes from `evaluateAt` into side `PoseBuffers`, written to the bones for the render and restored in the same task (`scheduleBeforeFrame`, so the user never sees a flicker); manipulators, selection highlights and spring bones are off; controls only if `overlays.controls`; encoded with `OffscreenCanvas.convertToBlob` (PNG or WebP) | ~5–15 ms per 256² tile on the reference machine (estimate; to be measured) |
| **schematic** | everywhere (headless default, CI) | pure TypeScript: project bone segments with the same camera presets, draw tapered segments (width ∝ bone radius), joint discs, head disc, L/R/C colours from the rig tokens (`#4f8dff`, `#ff5f69`, `#ffd84d`), floor line and 10 cm grid, contact marks, trails with frame ticks, ghosts at 30 % alpha, frame/view labels in a 5×7 bitmap font; PNG via `fflate` deflate (already an `io` dependency, MIT) | < 20 ms per sheet; deterministic bytes |
| **shaded raster** (later) | headless | CPU skinning (4 influences) + flat-shaded triangle raster with a z-buffer | a few hundred lines; only if schematic proves too abstract in the LLM evals |

When WebGL capture fails in the live host (lost context, hidden-tab throttling), it falls back to the schematic
renderer and says so (`fidelity: 'schematic'`; note 21 §5.10). A headless Chrome renderer was rejected for the
headless host: heavy, and the repository's CPU rules forbid browser work in CI.

### 8.2 Cameras

Presets are computed from the character's rest bounds (`pointBounds`, `fitCameraFrame` and `fitOrthoHeight`, already
in `viewport/src/framing`; the headless renderer mirrors that framing math on bone positions, since `viewport` depends
on three and the headless packages must not) and are **orthographic** for `front`, `side` (from the character's left),
`back` and `top` (measurable arcs and contacts), perspective 30° for `three_quarter` (front-left, 45°), the document's
shot camera for `shot`, and `follow` = `three_quarter` translating with the hips' horizontal position (travelling
walks). `crop` reframes to the bounds of a bone set. Camera parameters are returned so the model can reason about
left/right in the image ("the character's left is image right in `front`").

### 8.3 Curve plots

`view_plot_curves` draws value (degrees or metres; normalised optional) against clip frames for ≤ 6 curves with keys
as dots, breakdowns as diamonds, the seam on loops, and an optional dashed overlay of the same curves at a checkpoint.
The numeric summary next to it (extremes, overshoot, flips, key count) is what the model should rely on for numbers;
the picture is for shape (eases, overshoot, steps).

### 8.4 Image budgets

Claude bills an image as ⌈width/28⌉ × ⌈height/28⌉ visual tokens and downscales above 1,568 px / 1,568 tokens
(standard tier) or 2,576 px / 4,784 tokens (Claude 4.7 and later); requests with more than 20 images reject images
larger than 2,000 px on a side. Defaults:

| Image | Size | Visual tokens |
|---|---|---|
| still, one view | 768 × 432 | 28 × 16 = **448** |
| still, square crop (hands, head) | 512 × 512 | 19 × 19 = **361** |
| contact sheet 8 frames × 1 view (256² tiles, 4 × 2) | 1,024 × 512 | 37 × 19 = **703** |
| contact sheet 16 frames (8 × 2, 192² tiles) | 1,536 × 384 | 55 × 14 = **770** |
| sheet 8 frames × 2 views | 1,024 × 1,024 | 37 × 37 = **1,369** |
| curve plot | 896 × 448 | 32 × 16 = **512** |

Every image stays ≤ 2,000 px on its long edge. Animated GIFs are useless (Claude reads only the first frame), so motion
is shown as sheets, trails and ghosts. Claude Code shows MCP images inline and saves the full-resolution bytes to the
session's `tool-results` directory, so a client agent can crop them further.

---

## 9. Analysis metrics (`motion-analysis`)

Notation: clip frames `f ∈ [s, e]`, fps `F`, character height `H` (rest bounds), scale `k = H / 1.7 m`; positions in
character space. All thresholds below are defaults scaled by `k` (distances) and `F` (frame windows); tools accept
overrides and echo the thresholds they used.

| Metric | Definition | Default thresholds |
|---|---|---|
| **contact** | foot point `p` (ball pivot for IK legs from `footPivotWorlds`, else the toes joint; the heel too) is in contact at `f` when height above the floor `< h_c` **and** horizontal speed `< v_c`, with 1-frame hysteresis and minimum length 2 frames (Cascadeur's fulcrum heuristic: near the ground and nearly still) | `h_c = 0.03·k` m, `v_c = 0.25·k` m/s; floor = lowest foot point at rest |
| **slide** | horizontal path length of `p` inside each contact interval; max slide speed | report in cm |
| **skating ratio** (GMD) | fraction of frames where a foot is below 5 cm and skids more than 2.5 cm per frame (Karunratanakul et al., Guided Motion Diffusion, §6.1; evaluated on HumanML3D, which is sampled at 20 fps); reading the 2.5 cm as per-frame skid at 20 fps gives 0.5 m/s, which is how it is computed here so it does not depend on fps (our interpretation; the paper does not state the rate) | reported for comparability with motion-generation papers |
| **penetration** | depth of the lowest foot point below the floor | flag > 1 cm·k |
| **seam C0 / C1** | for loop clips, per animated channel: `\|v(e) − v(s)\|` and `\|slope_left(e) − slope_right(s)\|` (the test API's `curveSlope` semantics; E2E-M2A-23 already gates `cog tx`); per bone: position and geodesic rotation jump and velocity mismatch `\|(p(e) − p(e−1)) − (p(s+1) − p(s))\|`; `cycleOffset` channels compared after removing the per-cycle offset | seamless: C0 ≤ 1e-6, slope ≤ 1e-3 per frame; world ≤ 1 mm, ≤ 0.2° |
| **pops** | angular speed `ω_b(f)` = geodesic angle between bone rotations at `f` and `f+1`; a pop is `ω > max(3·median_window(ω), 30°·30/F)` or an angular acceleration spike `\|ω(f+1) − ω(f)\| > 15°·(30/F)²`; an **Euler flip** is a channel jump > 90°/frame with a quaternion change < 10° | window 9 frames |
| **oscillation** | signal = a channel value, or the first principal component of a point's position in a parent bone's frame; detrend, count zero crossings with hysteresis at 10 % of peak-to-peak; cycles = crossings / 2; period, peak-to-peak amplitude | — |
| **spacing** | per-frame displacement `d(f) = \|p(f+1) − p(f)\|` of a point; between consecutive keys or extremes classify `ease_in` (falling), `ease_out` (rising), `even` (coefficient of variation < 0.15), `hold` (`d < 0.5 mm·k`) | chart returned only with `detail: detailed` (mm, rounded) |
| **arcs** | path length vs chord, sharp turns (turning angle > 60° while speed > 0.2 m/s·k), straight-line ratio | — |
| **holds** | runs ≥ 3 frames where all channels of a target change less than 0.05° / 0.1 mm (dead holds vs moving holds) | — |
| **hyperextension** | knee/elbow bend past straight against the hinge axis of the IK limb (M2A §5.2.1) | flag > 2° |
| **diff** | per body part, RMS and max of geodesic local-rotation differences (deg) and root position difference (cm) between two states over aligned frames | — |

The same library powers the eval graders' *reports*, but graders recompute their pass/fail quantities with an
independent minimal implementation on raw bone worlds (§12.4), and a test compares both on the fixtures.

---

## 10. Motion recipes: tool, prompts and resources

### 10.1 Where recipes belong

| Mechanism | Who triggers it | Fit |
|---|---|---|
| **MCP tool** (`recipe_apply`) | the model, any time in a task | **parametric motions**: deterministic, unit-explicit, testable, one undo step; the agent composes and then refines them with the regular tools |
| **MCP prompt** | the user (Claude Code lists them as `/<server>:<prompt>`; arguments are split on whitespace, one token each) | **workflows and plans**: "block a walk cycle", "polish this clip", "review this clip"; the prompt injects a checklist that names the tools; it does not generate motion itself |
| **MCP resource** | the application or the user (`@` mention in Claude Code; Claude Code also gives the model list/read tools) | **reference**: conventions, rig map with axis hints, animation principles cheat sheet, recipe parameter docs |

The MCP spec defines prompts as user-controlled ("designed to be user-controlled … explicitly select them"), so a
recipe the agent needs in the middle of a task cannot be a prompt.

### 10.2 Recipe catalogue (`recipe_apply`)

All recipes are humanoid-only, scale distances by `k`, write into the given clip (default active) starting at
`startFrame`, use IK feet when the legs are IK, and return what they keyed plus their own metric check.

| Recipe | Parameters (defaults) | What it writes | Self-check |
|---|---|---|---|
| `wave` | `side: L\|R`, `cycles: 3`, `durationSeconds: 2`, `raise: high\|mid` (high), `amplitudeDeg: 25`, `overlapFrames: 2`, `easeFrames: 4` | upper arm aimed up-out, forearm bent, hand oscillating about its dominant axis with the forearm leading by `overlapFrames`, ease in/out | oscillation cycles = `cycles` |
| `nod` / `head_shake` | `cycles: 2`, `durationSeconds: 1.5`, `amplitudeDeg: 15`, `decay: 0.3` | neck/head pitch (yaw for shake) split 40/60, decaying amplitude, returns to the start pose | cycles, end pose ≤ 0.5° |
| `breathe` | `periodSeconds: 3.5`, `amplitudeDeg: 2`, `shoulders: true` | chest/upper chest pitch, small shoulder lift, cyclic infinities, loop | seam C0/C1 |
| `idle_sway` | `periodSeconds: 4`, `swayM: 0.02`, `hipCounterDeg: 2` | cog lateral sway with hips counter-roll, planted IK feet, breathing layered if requested | contacts: no slide |
| `look_at` | `target: bone \| pointM \| direction`, `atFrame`, `holdFrames`, `blendFrames: 6` | neck/head (and eyes later) aim with ease | aim error |
| `walk_cycle_block` | `cycleFrames: 32` (at 30 fps), `strideM: 0.55` (scaled by leg length), `inPlace: true`, `footLiftM: 0.08`, `bobM: 0.025`, `hipYawDeg: 6`, `armSwingDeg: 20` | the four key poses per step (contact, down, passing, up) on IK feet and cog, the second step by `pose.mirrorAnimation {offset: 'halfCycle'}`, cyclic infinities, cycle-aware tangents, loop | contacts per foot = 1 per cycle, skating ratio, seam C1 |

Recipes are code in `agent-tools/src/recipes/` built only from the goal helpers and the edit kernel; each one is
also an eval reference solution (§12), so a recipe regression fails CI.

### 10.3 Prompts (user-invoked)

| Prompt | Arguments | Injected plan |
|---|---|---|
| `block_walk_cycle` | `character`, `seconds` | `rig_describe` → `clip_create` (loop) → `recipe_apply walk_cycle_block` → `view_capture` side sheet → `analyze_contacts` → adjust timing/poses → `analyze_loop` |
| `polish_clip` | `clip` | Euler filter → contacts → loop seam → spacing/pops → overshoot and overlap suggestions → ask before broad changes |
| `fix_foot_sliding` | `clip` | `analyze_contacts` → `history_checkpoint` → `feet_plant` → `analyze_diff` to confirm the upper body is unchanged |
| `make_seamless_loop` | `clip` | `analyze_loop` → `clip_make_loop` → `view_plot_curves` of the worst channels |
| `review_clip` | `clip` | read-only critique: contact sheet + metrics, no writes |

### 10.4 Resources and server instructions

Resources: `ekza://guide/conventions`, `ekza://guide/principles` (timing/spacing, arcs, overlap, contact poses —
written for this project, MIT), `ekza://rig/{character}` (the `rig_describe` detailed table), `ekza://recipes`.

Server `instructions` (Claude Code keeps up to 4,096 characters and uses them for tool search), draft:

> Ekza Animator edits character animation in an open project. Units: angles in degrees (fields end in Deg), distances
> in metres (M), time in clip frames (Frame/Frames) unless a field ends in Seconds; every response states the clip's
> fps and range. Character space: +Y up, +Z forward (the character faces +Z), +X is the character's LEFT. Address
> controls by template key (fk.upperArm.L, ik.leg.R, cog, root), display name, or VRM bone name (leftUpperArm); clips
> and characters by name. Loop: scene_summary → rig_describe once per character → act (pose_*, keys_*, recipe_apply) →
> check (analyze_*, view_capture) → iterate. Each write is one undo step labelled "AI: …"; call history_checkpoint
> before large changes and history_revert if the result is worse. Prefer pose_aim and ik_set_target over raw Euler
> values for limbs. Legs are IK by default, arms FK. Change only what the user asked for. operator_run is the fallback
> when no tool fits; its operators use their own units (see each schema).

---

## 11. Later: text-to-motion tools

**Shape**: `motion_generate {prompt, durationSeconds, startPose?: 'current' | frame, endPose?, rootPathM?, candidates:
1–3, seed?, model?}` and `motion_inbetween {fromFrame, toFrame, prompt?}`; long-running, so they run as MCP tasks (the
2026-07-28 revision moved tasks into the official `io.modelcontextprotocol/tasks` extension with polling via
`tasks/get`). Generation happens behind the ADR 0017 gateway (`ekza-gen/v1`, server-side keys and GPUs, provenance by
construction); results are imported as new clips through the normal import and retarget path (M2b humanoid retarget
from SMPL/SOMA skeletons to the VRM humanoid), tagged with AI provenance, and then cleaned with the toolset
(`feet_plant`, `curves_simplify`, `clip_make_loop`). The agent's value is directing and cleaning, as research 05 already
concluded for AI motion sources.

**Licences (read from the licence files on 2026-10-19)**:

| Model | Code | Weights / training data | Commercial use | Notes |
|---|---|---|---|---|
| MDM (Tevet et al.) | MIT | HumanML3D (AMASS) + SMPL | **no** — AMASS forbids training "for commercial use", SMPL is non-commercial (commercial via Meshcapade) | research baseline |
| T2M-GPT | Apache-2.0 | HumanML3D / KIT-ML | **no** (same data) | |
| MoMask | MIT | HumanML3D / KIT-ML | **no** (same data) | strong quality, masked tokens |
| MotionGPT (OpenMotionLab) | MIT | HumanML3D + SMPL | **no** | also motion → text |
| MotionLCM | no SPDX licence detected by GitHub | HumanML3D | **no / unclear** | real-time |
| HY-Motion 1.0 (Tencent, 2025-12-30) | Tencent HY-Motion 1.0 Community License | 1.0 B (Lite 0.46 B); ≥ 24–26 GB VRAM | **restricted**: "does not apply in the European Union, United Kingdom and South Korea"; licensees above **1 million** MAU must ask Tencent; outputs must not "improve any other AI model"; outputs may not be used outside the territory | research 05 lists a 100 M MAU clause; the licence text says 1 M |
| Kimodo (NVIDIA, 2026-03; v1.1 2026-04; v1.2 SOMA models since) | Apache-2.0 (`nv-tlabs/kimodo`, GitHub licence metadata) | SOMA (30-joint) and Unitree G1 models: NVIDIA Open Model License; SMPL-X model: NVIDIA R&D Model License | SOMA/G1: **yes per NVIDIA's model cards (verify before shipping)**; SMPL-X: no | text + constraints (poses, end effectors, paths); ~17 GB VRAM, < 3 GB with the text encoder on CPU; `RP` checkpoints are trained on proprietary Rigplay data and `SEED` checkpoints on the Bones-SEED dataset **(unverified, secondary source)**: dataset terms need checking |
| ARDY (NVIDIA) | Apache-2.0 | NVIDIA Open Model Agreement (research 05) | check | used by Text-to-VRMA |
| Hosted: Uthana, Cartwheel, DeepMotion SayMotion | — | provider terms | via the gateway | research 05 §2.4 |

Recommendation for the later item: a `selfhost` adapter for **Kimodo SOMA** behind the gateway (after a licence review
of the weights and the SEED data), hosted adapters for Uthana/Cartwheel, and never a HumanML3D-trained checkpoint in a
commercial profile. Weights are downloaded at deploy time and never vendored (ADR 0017 decision 9).

---

## 12. Evaluation suite

### 12.1 Harness

```
packages/agent-evals/
  tasks/AE-01-wave.ts …        task = { id, prompt, variants, setup(fixtures) → project, scope, grader, budget,
                                         reference: ToolCall[], adversarial: { name, calls: ToolCall[] }[] }
  fixtures/                    deterministic builders over the bundled samples (Seed-san, Polybot, Quaternius UAL)
  graders/                     independent metric code on raw PoseBuffers (§12.4)
  drivers/scripted.ts          plays ToolCall[] through a real MCP client ↔ server pair (in-memory transport)
  drivers/anthropic.ts         Messages API loop: MCP tools → API tools, tool_result with images, max turns/calls
  drivers/claude-code.ts       `claude -p` with the stdio server in an MCP config (local only)
  report/                      JSON + Markdown: pass, score, calls, errors, tokens, visual tokens, wall time
```

Tasks run against the **headless host** over the real protocol (an in-memory linked transport pair,
`InMemoryTransport.createLinkedPair()`, which both SDK lines ship), so schema problems, budgets and error shapes are
exercised exactly as a client sees them. Graders read the final document through the kernel (`evaluateAt`, bone
worlds) and, for export tasks, the exported bytes through `io`'s readers — never the agent's tool outputs.

### 12.2 Modes

| Mode | Runs in CI | Purpose | Pass rule |
|---|---|---|---|
| **reference** | yes (Vitest, Node) | each task's scripted solution passes its grader on every variant | 100 % |
| **adversarial** | yes | known-bad scripts (two waves instead of three, loop flag only, delete all foot keys, delete every other key) must **fail**; a no-op script fails every task | 100 % fail |
| **fuzz** | yes, fixed seed, 200 calls | random schema-valid tool calls on fixtures: no `internal` errors, every response within budget, undoing all agent steps restores the starting snapshot byte for byte (the existing undo-exactness check), `history_revert` to the first checkpoint does too, and every non-`view` call leaves the session U-state (selection, time, overrides, tools, clipboards, prefs) deep-equal (note 21's invariant test) | 0 violations |
| **schema lint** | yes | every tool: object root, no root combinators, property-name regex, valid 2020-12 (Ajv 2020), description ≤ 1,500 chars with a "when to use" sentence, deterministic order, outputSchema present, examples validate | 0 violations |
| **LLM** | **no** (manual or scheduled with a key) | real model on the dev split and the held-out split, `--trials 3`; transcripts saved; once before names freeze, a naming A/B (D14: the same manifest emitted with group-prefixed and verb-first names) | report pass@1 and pass^3, no gate |
| **Claude Code** | no (local) | same tasks through the real client (tool search, output limits, image handling) | report |

Real-model runs follow ADR 0017's rule for paid APIs: never in CI, keys only from the environment, a spend cap per run.
Browser work stays out of the eval loop; one Playwright spec in real Chrome checks the live capture path (repository
CPU rules: local Chrome GPU only, never SwiftShader).

### 12.3 Tasks

Each task has variants (character Seed-san VRM 1.0 / Polybot VRM 0.x A-pose, side L/R, counts, durations, fps 30/24);
one variant per task is **held out** and never used while tuning tool descriptions. Distances scale with `k`, frame
windows with `F`. "Collateral" = every control outside the task's scope changes by ≤ 0.5° / 2 mm·k (checked in every
grader).

| ID | Prompt (variant 1) | Setup | Grader (pass when all hold) | Ph. |
|---|---|---|---|---|
| AE-01 | "Make a new 2-second clip where Seed-san waves her left hand three times above the shoulder." | rest pose | hand position relative to the upper chest, first principal component: **3 cycles**; peak-to-peak ≥ 5 cm·k **or** hand-orientation oscillation ≥ 20° p-p about its dominant axis; oscillation window 2.0 s ± 0.2 s; hand above the shoulder joint ≥ 80 % of the window; other arm ≤ 5° RMS; collateral | 1 |
| AE-02 | "Make Polybot nod 'yes' twice within 1.5 s and end in the starting pose." | rest | head pitch relative to the chest: 2 downward peaks, amplitude 10–30°; yaw and roll RMS ≤ 3°; final pose within 1° of the start; duration ≤ 1.5 s | 1 |
| AE-03 | "Create a 4-second seamless breathing idle." | rest | `loop` on; range = 4 s ± 1 frame; chest/upper-chest pitch 1 cycle, 0.5–4° p-p; seam C0 ≤ 1e-6 and C1 ≤ 1e-3 per frame on every animated channel; limbs ≤ 2° | 1 |
| AE-04 | "This walk hitches when it loops. Make it seamless without changing how it looks." | UAL walk loop with the last 3 frames re-keyed off-cycle | seam: bone positions ≤ 2 mm·k, rotations ≤ 0.5°, C1 ≤ 0.05°/frame; RMS pose change vs the original over the middle 80 % ≤ 2° | 1 |
| AE-05 | "The left foot slides during the walk. Fix it." | walk with a 3 cm·k sinusoidal drift injected into `ik.leg.L` during its contact | max slide per contact ≤ 1 cm·k, total ≤ 2 cm·k (contacts from the clean fixture); upper body RMS change ≤ 2°; root travel within 2 %; no new pops | 2 |
| AE-06 | "Make the whole clip 1.5× slower, same poses." | an attack clip | range ×1.5 ± 1 frame; fps unchanged; pose at `1.5·t` matches the original at `t` within 0.5°; `contact` frame scaled | 1 |
| AE-07 | "Move the left foot's contact two frames later." | walk loop | left heel-strike frame +2 exactly (cyclic); right foot contacts unchanged; seam still passes AE-04's seam test | 1 |
| AE-08 | "Give the arms follow-through: they should trail the body by 2 frames." | walk loop | cross-correlation lag of each upper-arm rotation vs the original = +2 frames (cyclic); amplitude within 5 %; seam passes | 1 |
| AE-09 | "Clean up the flips in the spine." | clip with ±360° and gimbal-equivalent Euler flips injected | orientation at every frame equal to the original (geodesic ≤ 0.1°); no Euler channel jump > 30°/frame | 1 |
| AE-10 | "This mocap is too dense to edit. Reduce the keys without visibly changing the motion." | every-frame keys + 0.05° noise | key count ≤ 40 % of the original; bone rotation error ≤ 0.5°, position ≤ 2 mm·k at every frame | 1 |
| AE-11 | "When the right arm stops at frame 20, add an overshoot that settles." | arm move 0→20 then hold | overshoot beyond the final value 5–20 % of the move amplitude; settles within ±1° by frame 20 + 12·F/30; final pose = target ± 0.5° | 1 |
| AE-12 | "Pose: arms relaxed at the sides with a slight elbow bend, head turned 30° to her left." | T-pose model, new clip, frame 0 | upper-arm direction within 25° of down, abducted 5–25°; elbow flexion 5–30°; arms symmetric within 5°; head yaw +30° ± 5° toward the character's left (+X); feet unchanged | 1 |
| AE-13 | "Have the right hand touch the top of the head from frame 30 to 40." | idle clip | right-hand bone within 6 cm·k of the head-top point for frames 30–40; no elbow hyperextension; frames outside 20–50 unchanged | 1 |
| AE-14 | "Block an in-place walk cycle, about one second." | rest pose, legs IK | loop + seam C1; each foot: one contact per cycle, duty 35–65 %, phase difference 0.5 ± 0.08 cycle; skating ratio ≤ 2 %; foot travel relative to the hips 0.35–0.8 × leg length; cog vertical bob 2 cycles per loop; arm swing opposite to the same-side leg (correlation < −0.5) | 2 |
| AE-15 | "Export the wave as wave.vrma and save the project." | AE-01 result | one VRMA artifact named `wave.vrma`; `io` reads it back; frame count = clip range; read-back pose error ≤ 1e-4 rad (the existing export read-back check); project saved | 1 |
| AE-16 | "Why does the left foot slide around frames 12–18? Don't change anything; tell me the cause." | sliding caused by one of: a stray IK foot key, `ikFk` blended to 0.5, a hips translation key | the agent calls the eval-only tool `submit_answer {cause, control, rangeFrames}`: cause correct, control correct, range overlap ≥ 70 %; document unchanged | 1 |
| AE-17 | "Try making the idle more energetic; then undo everything you did." | idle clip; variant 2: the harness injects a user edit (an `operator` run without an actor) on another control between the agent's steps | variant 1: the document equals the starting snapshot exactly; variant 2: the agent's changes are gone and the user's edit is intact (selective revert); in both, history shows ≥ 1 AI step and no user step was undone | 1 |

`submit_answer` exists only in the eval server build. AE-01, AE-02, AE-03, AE-14 double as recipe tests: their
reference scripts call `recipe_apply` in M-AI.2 (earlier they use `pose_aim` and `keys_set`).

### 12.4 Grader integrity

- **Independent computation**: graders compute pass/fail quantities from raw `PoseBuffers` with a minimal separate
  implementation (zero crossings, slide path length, seam deltas), so a bug in `motion-analysis` cannot make the agent
  and the grader agree on a wrong number; a unit test compares grader and library on every fixture.
- **No over-strict checks**: graders accept any valid solution (wrist-only or forearm wave; IK or FK fixes; blend or
  match-ends loops) and judge outcomes, not tool sequences (Anthropic warns against verifiers that reject correct
  responses).
- **Collateral and restraint** are part of every grade; AE-16 and AE-17 test reading without writing and clean revert.
- **Held-out variants** are excluded from description tuning; changes to tool descriptions are reviewed against the
  dev split only.
- **Scores**: each grader returns `score ∈ [0, 1]` (fraction of conditions met, weighted) and `pass`; reports include the
  failing condition with its measured value.

### 12.5 Metrics per run

Pass and score per task and variant; pass@1, pass^k (all k trials pass) for LLM runs; tool calls, distinct tools, tool
errors by code, retries after errors, input/output tokens, images and visual tokens, wall time, undo steps created,
checkpoints used, revert count. Call counts and error codes guide tool consolidation and description fixes, as
Anthropic's evaluation guidance recommends.

---

## 13. Phasing and estimates

| Phase | Content | Estimate (agent-days) |
|---|---|---|
| **M-AI.1** | `agent-tools` infrastructure (resolver, units, envelopes, errors, budgets, registry, schema lint) 1.5; reads (5) 1; posing (5) incl. `pose.goals` 2; keys/timing (5 of 6, warp later) and the new operators 2; curves (3) 0.5; clips create/update, history (2), files (3) 1.5; `operators_list`/`operator_run` with wire schemas for ~60 operators and the policy table 1.5; `motion-analysis` + 3 analyze tools 1.5; `view_capture` live (WebGL) 1 + schematic renderer and sheets 1.5; eval harness (reference, adversarial, fuzz, schema lint, Anthropic driver) 1.5, fixture builders 1, 15 tasks 2.5 | **≈ 20** |
| **M-AI.2** | `feet_plant`, `analyze_diff`, `view_plot_curves`, `clip_delete`, `timeline_set`, warp retime, trails/ghosts, arcs/hyperextension metrics 3; recipes (6 + walk block) 3; prompts and resources 0.5; AE-05, AE-14 + recipe references 1; Claude Code driver 0.5 | **≈ 8** |
| Later | text-to-motion (`motion_generate`, `motion_inbetween`) with the ADR 0017 gateway and MCP tasks; shaded CPU raster; MCP Apps inline preview; agent tools from trusted extensions; in-editor AI panel over the same registry | separate |

These estimates cover the **tools** only; note 21 §11 estimates the bridge, runtimes and editor UI at ≈ 12.5
agent-days with no overlap, so the full M-AI (live + headless) is **≈ 32 agent-days**, plus ≈ 8 for M-AI.2. The
earlier conversational estimate of 8–12 agent-days for the whole M-AI does not hold once both halves are counted.
Scoping M-AI.1 down to ~20 tools (no goal posing, no live capture, 8 tasks) would fit ≈ 11–12 days (≈ 19 with note
21's minimum bridge slice) but drops the two things that make agents useful for animation: goal-based posing and
eyes. Recommendation: keep goal posing and both capture backends in M-AI.1; move recipes to M-AI.2.

---

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| LLMs pose poorly from numbers even with goal tools | low-quality blocking; disappointed users | goal tools + see/measure loop; recipes for common motions; set expectations: agents excel at chores (loop, retime, cleanup, mirror, diagnose), not hero animation; text-to-motion later |
| Image tokens accumulate over long sessions | context exhaustion, cost | small defaults, sheets instead of stills, one image per call, `crop` |
| Units confusion through `operator_run` (radians) | wrong rotations | degree-based high-level tools first; radians stated in every wire-schema description; the "looks like radians" warning in high-level tools |
| Agent edits disturb the user in live mode | lost selection, clipboard, playhead or unkeyed overrides | explicit-target operators and a runner-level selection scope (never a borrowed selection), denied clipboard/prefs/undo operators, `view` grant for U-state changes, edits wait for the user's drag, note 21's invariant tests |
| Schema drift between `OperatorMap` and wire schemas | runtime failures | compile-time conformance, coverage and TS-derived drift tests |
| Client schema rules change (root combinators, name limits, description cuts) | tools silently dropped by a client | schema lint in CI; Claude Code driver runs before releases |
| MCP churn: 2026-07-28 made the protocol stateless; v2 SDK is young; v1 supports only up to 2025-11-25 | rework of the server layer | tools are SDK-independent (`agent-tools` has no SDK import); the adapter is thin |
| Grader gaming or flakiness with real models | false confidence | independent graders, adversarial scripts, held-out variants, pass^k; LLM runs never gate CI |
| Prompt injection through document strings or imported files | the agent follows planted instructions | strings returned as quoted, length-limited data; no network or file tools in live mode; destructive tools need `confirm` and the host's approval |
| Motion-model licences (non-commercial data, territory clauses) | legal exposure if shipped | licence table (§11), commercial profile allow-list, legal review before the later item |
| Estimate | M-AI.1 is about twice the earlier guess | phase split (§13); owner decides the scope cut |

---

## 15. Open questions for the owner

| # | Question | Default chosen here |
|---|---|---|
| Q1 | MCP SDK line: v2 `@modelcontextprotocol/server` 2.3.1 (protocol 2026-07-28, Standard Schema, Apache-2.0 for new code) or v1 `@modelcontextprotocol/sdk` 1.32.1 (MIT, protocol ≤ 2025-11-25)? | v2 if the bridge spike confirms Claude Code and Claude Desktop interoperate; both licences pass the repository allow-list |
| Q2 | M-AI.1 scope: full (≈ 20 agent-days, goal posing + both capture backends; ≈ 32 with note 21's bridge) or reduced (≈ 12; ≈ 19 with the minimum bridge)? | full |
| Q3 | Should agent steps share the user's undo history (Mod+Z undoes the agent) or become a separate actor in M3? | shared in M-AI; revisit with M3 per-user undo |
| Q4 | `operator_run`: expose by default, or only with a server flag? | on by default (operators are undoable and policy-filtered; unlike script execution in other DCC servers) |
| Q5 | Live-mode exports: allow the agent to trigger a browser download after the editor's confirm, or never? | allowed with the editor's confirm |
| Q6 | Which characters and fps variants form the held-out eval split, and what model/budget for scheduled LLM runs? | Polybot variants held out; manual runs on the current Claude model with a per-run cap |
| Q7 | Text-to-motion: pursue Kimodo SOMA as the first self-hosted model (after licence review), or hosted providers only? | hosted first, Kimodo after review; HY-Motion and HumanML3D checkpoints never in commercial profiles |
| Q8 | Headless "see" fidelity: is the schematic renderer enough, or should the CPU shaded raster be in M-AI.2? | schematic; decide after the first LLM eval run compares schematic vs shaded on the same tasks |
| Q9 | Tool naming: group-prefixed (`pose_set`, `operator_run`) or verb-first (`set_pose`, `run_operator`) as in note 20's sketch? | group-prefixed; one LLM A/B run (§12.2) before the M-AI spec freezes the manifest |

---

## 16. Reconciliation with notes 20 and 21

The three M-AI notes were written in parallel and cross-reviewed on 2026-10-19. Note 21 now uses this note's tool
names and contracts; this note adopts note 21's bridge rules. The M-AI spec should take both as one contract.

**From note 21, applied to every tool here**

| Rule | Where here |
|---|---|
| Grants `read`/`edit`/`files`/`view` as each tool's access class; `pose_only`, clip activation and `timeline_set` are `view` | §4 intro, §6.1 |
| `project` handle (`tab_…`, `prj_…`) and the connection tools `editor_connect`, `projects_list`, `project_close` (not counted in the 37) | D1, §3.1 |
| `clipRevision` / `ifClipRevision` and the `stale` error | §3.5, §3.8, §5.1 |
| Edits wait for the user's drag (`gestureWaitMs`), then `busy`; edits of one agent run in arrival order | §3.8, §6.4 |
| Selective revert `edit.revertSteps` with compare-before-restore when user steps interleave | §4 I, §6.3, §6.4, AE-17 |
| No borrowed selection: explicit-target arguments or the runner-level `RunContext.selection` scope; no `context.frame` | §5.6, §7.3 |
| Agents never call `edit.undo`/`edit.redo`; `OperatorDef.agent?` for extensions | §7.3 |
| `RunContext.actor`/`signal`, actor-scoped coalescing; Repeat Last refuses `source: 'api'` runs | §6.4 |

**From this note, used by note 21**: the 37-tool catalogue and names (§4), units, addressing, spaces, envelope and
budgets (§3), the `AgentToolDef`/`AgentToolContext` contract (§6.2, extended by note 21 §4.1), the explicit-target
operators (§6.3), the schematic renderer and `motion-analysis` packages (§6.1), zod wire schemas (§7), the
`operator_run` policy table (§7.3), and LastRun with `source: 'api'` so the user can tune an AI-made bevel (§6.4).

**Names in note 20 and in the earlier sketch of note 21 → this catalogue** (for readers of those drafts and for the
D14 naming A/B):

| Earlier sketch | Here |
|---|---|
| `get_editor_info`, `list_clips` | `scene_summary` (host, capabilities, grants, clips) and the server instructions (§10.4) |
| `list_controls` | `rig_describe` |
| `get_curves` | `curves_summary` (first look), `keys_read` (raw keys) |
| `get_pose`, `sample_motion` | `pose_read` (`frames[]`, or `rangeFrames` + `stepFrames`) |
| `analyze_motion {checks}` | `analyze_contacts`, `analyze_loop`, `analyze_motion`, `analyze_diff` |
| `capture_view`, `capture` | `view_capture` (stills and sheets), `view_plot_curves` |
| `set_pose` (with IK targets) | `pose_set`, `pose_aim`, `ik_set_target` |
| `set_keys`, `delete_keys` | `keys_set`, `keys_delete` |
| `move_keys`, `scale_keys` | `keys_retime` (`offset`, `scale`, `warp`, `insert_time`, `delete_time`) |
| `tween_keys`, `insert_breakdown` | `keys_tween` (`breakdown: true`) |
| `set_tangents`, `euler_filter`, `simplify_curves` | `curves_set_interpolation`, `curves_euler_filter`, `curves_simplify` |
| `make_loop` | `clip_make_loop` |
| `mirror` | `pose_transfer {mirror}` (poses); `operator_run pose.mirrorAnimation` (whole animation) |
| `ikfk_switch`, `ikfk_match` | `ik_set_target {ensureIk: 'auto'}`; `operator_run rig.ikFk.*` for the rest |
| `clip_create`, `clip_duplicate`, `clip_rename`, `clip_settings` | `clip_create {duplicateOf?}`, `clip_update` |
| `undo_last_ai_step`, `revert_ai_steps` | `history_revert` |
| `open_document`, `new_document`, `import_model`, `import_animation` | `project_load` |
| `save_project`, `export_clips` | `project_save`, `export_clip` |
| `set_view` | `timeline_set`; camera framing through `operator_run view.*` (`view` grant) |
| `list_operators`, `describe_operator`, `run_operator` (note 20 F5) | `operators_list {includeSchema}`, `operator_run` |

Error codes are `snake_case` as in §3.8 (`read_only` where note 21 writes `read-only`).

---

## Sources

MCP specification and SDK (read 2026-10-19):

- MCP 2026-07-28 changelog (stateless protocol, server-minted handles, deterministic tool order, tasks extension,
  2020-12 schemas): https://modelcontextprotocol.io/specification/2026-07-28/changelog
- Tools (names, annotations, structured content, output schema, error handling, stateful handles):
  https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- Prompts (user-controlled): https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
- Schema (`ToolAnnotations`): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
- TypeScript SDK (v2 server/client packages, Standard Schema, v1 branch): https://github.com/modelcontextprotocol/typescript-sdk
- npm: https://www.npmjs.com/package/@modelcontextprotocol/sdk (1.32.1, MIT) ·
  https://www.npmjs.com/package/@modelcontextprotocol/server (2.3.1, Apache-2.0)

Tool design and client behaviour:

- Anthropic, "Writing effective tools for agents — with agents" (consolidation, namespacing and evals, response
  format, steering errors, held-out sets): https://www.anthropic.com/engineering/writing-tools-for-agents
- Claude vision (formats, visual-token cost, size limits): https://platform.claude.com/docs/en/build-with-claude/vision
- Claude Code MCP (output limits, images, schema rules, description limits, tool search, `_meta` keys, prompts as
  commands): https://code.claude.com/docs/en/mcp
- zod JSON Schema conversion (`z.toJSONSchema`, draft 2020-12 default): https://zod.dev/json-schema

Prior art:

- Cascadeur 2026.2 with a "simple" MCP server (CG Channel, 2026-08-06):
  https://www.cgchannel.com/2026/08/nekki-releases-cascadeur-2026-2-with-animation-layers/
- cascadeur-mcp (community) and its tool list: https://github.com/gprethesh/cascadeur-mcp ·
  https://github.com/gprethesh/cascadeur-mcp/blob/main/docs/tools.json
- MCP for Blender (renamed from blender-mcp): https://github.com/ahujasid/mcp-for-blender
- Maya community MCP servers (examples): https://glama.ai/mcp/servers/@Jeffreytsai1004/maya-mcp ·
  https://glama.ai/mcp/servers/@bdeda/maya_mcp
- VRMA Lab and Text-to-VRMA: [research 05](05-landscape.md) §2.3

Metrics:

- Guided Motion Diffusion (foot skating ratio, §6.1): https://arxiv.org/abs/2305.12577 ·
  https://arxiv.org/html/2305.12577v3

Motion models and licences:

- HY-Motion 1.0 and its licence: https://github.com/Tencent-Hunyuan/HY-Motion-1.0 ·
  https://github.com/Tencent-Hunyuan/HY-Motion-1.0/blob/master/License.txt
- Kimodo code (Apache-2.0): https://github.com/nv-tlabs/kimodo · documentation (models, licences, VRAM):
  https://research.nvidia.com/labs/sil/projects/kimodo/docs/getting_started/quick_start.html ·
  model card: https://huggingface.co/nvidia/Kimodo-SOMA-SEED-v1.1
- MoMask: https://github.com/EricGuo5513/momask-codes · MotionGPT: https://github.com/OpenMotionLab/MotionGPT ·
  T2M-GPT: https://github.com/Mael-zys/T2M-GPT · MDM: https://github.com/GuyTevet/motion-diffusion-model ·
  HumanML3D: https://github.com/EricGuo5513/HumanML3D · MotionLCM: https://github.com/Dai-Wenxun/MotionLCM
- AMASS licence: https://amass.is.tue.mpg.de/license.html · SMPL model licence: https://smpl.is.tue.mpg.de/modellicense.html

Repository context: [MVP-SPEC](../MVP-SPEC.md) §4.5, §4.8, §4.9, §4.11; [M2A-SPEC](../M2A-SPEC.md) §4.5, §4.9, §5.2,
§5.13, §5.14, §5.23; [ARCHITECTURE](../../ARCHITECTURE.md) §4–§5, §12, §16; [research 08](08-extensibility-modeling.md)
§5.2, §8; [ADR 0008](../adr/0008-operator-tool-editor-registries.md); [ADR 0013](../adr/0013-editor-history.md);
[ADR 0017](../adr/0017-ai-generation-boundary.md); the M6a specification (`ParamDef`, `RunSource`, `LastRun`).
