# ADR 0008 — Operators, tools, panels, keymaps and contribution registries

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [08](../research/08-extensibility-modeling.md) D4, D7, D10, §3.1, §3.7, §5–§8, §11,
  [09](../research/09-ui-ux-spec.md) §1, §7, §13.4, [01](../research/01-maya-animation-features.md) §4,
  [05](../research/05-landscape.md) §3.7.

## Context

Maya ("everything is a command"), Blender (operators), VS Code (commands + contribution points) and Excalidraw
(actions) converge on one registry of named, parameterized, undoable actions that every UI surface calls.
Retro-fitting this later is the most expensive rewrite (08). The registry must also serve hotkeys with Maya
muscle memory under browser constraints, tests, a future scripting/agent API and plugins. The design review
found three problems in v0.1: operators could be async while transactions are synchronous, yet the text said
"nested operator calls merge into the outer transaction"; operator arguments were untyped across seven parallel
work packages; and the ADR promised registries (importers, exporters, export profiles, control shapes, record
types) that the contracts did not have.

## Decision

1. **Operators run in two phases** (contract: MVP-SPEC §4.5, runner rules §4.11.0):
   - `poll(ctx, args)` → `true` or a reason (shown as the disabled tooltip);
   - `prepare(ctx, args)`, optional and **async**: file I/O, parsing, hashing, `store.open`, dialogs, and
     `app.run` of other operators for pure dispatchers (`file.open`, `edit.copy`). It never writes the document.
   - `apply(ctx, args, prepared)`, **synchronous**: for `flags.undo` the runner wraps it in exactly one
     `store.transact` and records one history step; `app.run` inside `apply` throws `nested-run`.
   Operators compose by calling the **edit kernel** (`applyChannelEdits`, `beginChannelEditGesture`, `moveKeys`,
   `scaleKeys`, `setKeyHandle`, `setTangentTypes`, `insertKeyOnCurve`, `deleteKeys`, `ensureCurve`) and
   workflow functions, never by running other operators inside a transaction. Tools and panels use the same kernel,
   so a manipulator drag, a Graph Editor drag and a typed Channel Box value obey identical keying rules.
2. **Typed arguments**: `operators/args.ts` defines `OperatorMap { '<id>': { args; result } }` as a contract;
   `app.run(id, args?)` is type-checked against it; `app.runUntyped` serves keymaps, menus, plugins and the test
   API. Extensions add entries by declaration merging. IDs are `<area>.<object>.<verb>`.
3. **Tools** are per-panel interaction modes with an internal state machine (`ToolDef` → `ToolInstance` with
   pointer, wheel and key handlers, `cancel`, cursor). Manipulators belong to the viewport. Camera navigation is
   not a tool; it runs under any tool (Maya Alt-navigation) and in 2D editors follows the navigation profile.
   Event routing in a panel: active drag/modal → active tool → panel default (navigation) → pass through.
4. **Panels** (`PanelDef` in `@ekza-studio/editor`): id, kind (open string), title, component, key scope,
   multi-instance flag. Registration is **explicit** (`register<Name>Panel(registry)` called from
   `registerBuiltinPanels`), never a side effect of importing a module. Panel view state is per-user workspace
   state, never in the document.
5. **Keymaps are data**: `KeyBinding { chord, op, args?, scope, trigger }` on **`KeyboardEvent.code`** with a `mod`
   modifier (Ctrl on Windows/Linux, Cmd on macOS). Scope resolution: focused text input (only Esc/Enter/Tab and
   `mod+S`/`mod+Z` outside text editors) → active drag → **panel under the pointer** → global. Tap/hold (200 ms)
   for Space. One preset in M1, `maya`; mouse-versus-trackpad differences live in the **navigation profile**
   (ADR 0006), not in a second keymap preset. Browser-reserved chords are never bound (research 09 §7.6). Labels
   via `navigator.keyboard.getLayoutMap()` when available. Every binding targets an operator (dialogs open through
   `ui.open`, Esc through `edit.escape`).
6. **Contribution registries shipped in M1**, each used by the built-ins exactly as extensions will use them:

   | Registry | Where | Built-ins registered through it |
   |---|---|---|
   | operators, tools, keymap bindings, menus | `EditorApp` (`app.contribute`) | every §4.9 operator, viewport/graph tools, `MAYA_KEYMAP`, menu bar items |
   | importers (`ImporterDef`) | `EditorApp` | `.glb/.vrm` model, `.vrma`, `.ekzanim(.json)` |
   | exporters (`ExporterDef`) | `EditorApp` | `bake-into-model`, `animation-glb`, `vrma` |
   | export profiles (`ExportProfileDef`, data) | `EditorApp` | Ekza Tier-0 profiles and generic local profiles (ADR 0010) |
   | panels (`PanelDef`) | `@ekza-studio/editor` | viewport, graph, timeline, outliner, clips, channel box, attributes |
   | control shapes | `@ekza-studio/anim-core` | circle, halfCircle, square, cube, sphere, diamond, arrow4, star, cross, lollipop |
   | rig op kinds | `@ekza-studio/rig` | none in M1 (constraint/solver slots); `ik2` in V1 |
   | document tables (`TableDef`) | `@ekza-studio/doc` | the 12 built-in tables, with per-table versions |

   Identifiers are open strings (panel kinds, scopes, tool ids, export kinds, shape kinds) with exported built-in
   constants. **Unknown data survives**: tables without a registered `TableDef` load as opaque, transactable tables
   in the `scene` partition and are written back unchanged; unknown fields are preserved. Plugin *loading* is not in
   M1.
7. **Plugin trust tiers** (post-1.0, research 08 §8.3) are named **data**, **trusted** and **sandboxed** — never
   T0–T3, which are reserved for Ekza integration tiers (ADR 0010). Data packs (keymaps, control shapes, rig
   templates, export profiles) and trusted dev-mode extensions come in V1; sandboxed third-party plugins
   (opaque-origin iframe + async RPC) after 1.0. Evaluation-time and interactive extensions stay trusted.
8. **Selection is per-user session state** with components from day one: `{ controls (lead = last), keys:
   Map<KeyId, {key, in, out}>, channels }`, limited to one character in the MVP. Not undoable by default; history
   steps carry selection snapshots and restore them.
9. **History** spans document undo entries and unkeyed session edits (ADR 0013).

## Alternatives

| Alternative | Why not |
|---|---|
| Async `execute` with nested operator calls (v0.1) | Cannot run inside a synchronous transaction; every WP would invent its own nesting semantics. |
| Untyped `run(id, args: unknown)` | Argument shapes would exist only in table prose until integration; mismatches surface only in e2e. |
| Ad-hoc handlers per UI surface | No single place for labels, enablement, undo, hotkeys, tests, scripting. |
| `KeyboardEvent.key` bindings | Breaks on non-Latin layouts (e.g. Russian ЙЦУКЕН) and macOS Option characters. |
| Side-effect registration on import | Tree-shaken away under `"sideEffects": false`; found only in e2e. |
| tldraw `StateNode` dependency | Proprietary licence with production keys; we copy the pattern only. |
| JSON-schema validated args now | V1 (scripting/agents); TypeScript arg types now. |
| A second keymap preset `maya-trackpad` (v0.1) | The differences are navigation gestures, which the navigation profile owns. |

## Consequences

- Every user-visible action is testable headless (`app.run`) and in e2e through the test API.
- A hotkey editor (V1) is a UI over the binding table; the cheat sheet (`?`) is generated from it.
- An operator log (Maya Script Editor echo) is a debug console feature in the MVP and a panel in V1.
- FR-EXT-03/04 (data packs, trusted extensions) and the M6 `curve` record type need no change to core contracts:
  they register through the registries above.
