# Ekza Animator

**An open-source, browser-based character animator for glTF and VRM, with a Maya-grade workflow.**

Load a rigged GLB or a VRM 0.x/1.0 avatar, get circle controls on its bones, key poses, retime them on the time
slider, shape the motion in a Graph Editor with Maya's tangent model, then bake the clips back into the original
file — every original JSON value and every byte of its binary buffer preserved — or export VRMA and animation-only
GLB. Part of the Ekza ecosystem; usable on its own.

> **Status: pre-alpha — design complete (reviewed), implementation starting.** This repository currently contains
> the research, architecture and build specification. Code arrives with milestone M0 (scaffold) and M1 (MVP,
> tagged as the public alpha `v0.1.0`). See [docs/ROADMAP.md](docs/ROADMAP.md) for live status.

<!-- Screenshots / GIF: added with the M1 release (split view with locked shot camera + Graph Editor). -->

## Why

No open-source, web-native tool combines a professional Graph Editor (auto/spline/clamped/linear/flat/stepped
tangents, break/unify, weighted handles), an on-model control rig, VRM/VRMA-first round trips that also write back
into GLB, and a path to real-time multiplayer animation. The closest web neighbours are copyleft and cover one or
two of these ([research 05](docs/research/05-landscape.md)). Ekza Animator is MIT-licensed and built so that
collaboration, plugins and spline modeling can be added without rewriting the core.

## What the first alpha (M1) is for

In-place loops, idles, gestures, upper-body emotes and full-body blocking. Legs are FK in M1: when you move the
centre of gravity, **Pose → Plant Feet** puts the feet back where you pinned them (one click per key); feet can
still slide between keys. Leg IK is the first item after the alpha (M2a). There is no Dope Sheet (the time slider
does range moves and scales), no animation layers and no facial expressions in VRMA yet.

## Features

| Area | MVP (M1) | Planned |
|---|---|---|
| Open | `.glb`, `.vrm` (VRM 0.x and 1.0), drag-and-drop, bundled samples, `.vrma` as a clip, Draco/meshopt/KTX2 display; embedded clips imported at their own frame rate with key reduction | FBX/BVH/Mixamo with humanoid retarget, `.gltf` multi-file, humanoid mapping for generic rigs (M2b) |
| Control rig | Auto FK rig with circle controls sized from the mesh, offset groups (zero = rest), side colours, `root`/`cog`/hips controls; 1:1 FK rig for any skinned GLB; Pin/Plant Feet; VRM node constraints in the preview | Two-bone leg/arm IK with pole + IK/FK switch (M2a); constraints (M2c); foot roll, space switching (M5) |
| Viewports | One canvas, single / split (locked shot camera + free camera) / quad, Maya and trackpad navigation, F/A framing, display toggles, marquee and click-cycling selection, W/E manipulators (object/world/**gimbal**) | Scale manipulator, onion skin, motion trails, camera bookmarks (M2) |
| Keying | `S`, `Shift+W/E/R`, key selected channels, auto-key, delete keys, static values, undoable unkeyed tweaks | Breakdowns, tween slider, keying by body part (M2a) |
| Time | Time slider with key ticks, scrub, **Shift-drag range move/scale/delete/copy/paste**, playback range, loop/once/oscillate, real-time or every frame, per-clip fps, shared scene clock for several characters | Dope Sheet, ripple, bookmarks → clips, audio (M2) |
| Graph Editor | Canvas2D, exact curves, select keys and handles (click, box, double-click curve), move with axis lock (LMB or MMB), auto/spline/clamped/linear/flat/stepped, break/unify, weighted with lock/free weight, pen-like handles, shape-preserving insert, numeric fields, pre/post infinity, Euler filter, Simplify | Buffer curves, normalized/stacked views, scale/region tools (M2a); smoothing filters, quaternion curves (M5) |
| Clips and poses | Multiple clips per character with Ekza slot, contact frame, tags and provenance; copy/paste/mirror pose; reset to rest | Animation layers, clip sequencing, pose library (M5) |
| Undo | Transactions, one gesture = one step (including unkeyed tweaks), per-user stack | History panel (M2c) |
| Export | Bake into the original GLB/VRM (append-only, safe re-bake), animation-only GLB, VRMA (one clip per file), read-back check, Ekza Tier-0 metadata, export profiles and lints | Export key reduction (M2a), VRMA expressions/lookAt (M2c), BVH/FBX (M5) |
| Projects | `.ekzanim` (zip with source models by SHA-256), JSON debug variant | Autosave (M2a), merge-on-open (M3) |
| Collaboration | Data model, store boundary and conformance suite — verified in CI against a test-only Yjs store | Live sessions with presence and claims (M3), accounts and permissions (M4b) |
| Ekza | Space-compatible exports, slot vocabulary, provenance, registry-aligned lints, interop warnings | Upload as `ekza:animation` asset, one-click publish, open from Ekza (M4a) |
| Modeling | Control shapes use the shared spline type; table and tool registries | Spline modeling, generators (M6) |

Full numbered list: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

## Quickstart (from milestone M0)

Requirements: Node.js 24 LTS (Node 25 works with engine warnings), pnpm 10.32.1, Chrome for end-to-end tests.

```bash
git clone <this repository> ekza-animator
cd ekza-animator
pnpm install
pnpm dev            # http://localhost:3000/editor
pnpm test           # unit + headless tests
pnpm test:e2e       # Playwright (real Chrome; install a browser with `pnpm exec playwright install chromium` on CI)
pnpm run ci         # format, lint, typecheck, layering, fixtures, licences, tests, build, e2e (`pnpm ci` is reserved by pnpm)
```

## Repository layout

```
apps/web/                Next.js 16 shell: landing, /editor client island, e2e specs
packages/anim-core/      math, rotate orders, Euler filter, AnimX-based curve engine, key reduction, shapes (zero deps)
packages/doc/            document records, partitions, store, transactions, preview sessions, undo, snapshots
packages/doc-yjs/        private, test-only Yjs store that runs the full store conformance suite
packages/rig/            auto-rig, rig compiler + stateless kernel, clip sampling, import, mirror, two-bone IK
packages/io/             GLB/VRM/VRMA readers, budgets, bake, surgeon, VRMA + animation GLB writers, lints, .ekzanim
packages/editor-core/    headless editor kernel: session, operators, edit kernel, history, registries, playback
packages/viewport/       one-canvas multi-pane renderer, navigation, picking, manipulators (three.js)
packages/curve-editor/   Canvas2D Graph Editor and time slider
packages/ui/             design tokens, primitives, icons
packages/editor/         React shell: dockview workspace, panels, dialogs, R3F host
packages/headless-tests/ private cross-package tests on the licensed fixtures
fixtures/                redistributable sample avatars and animations (see fixtures/LICENSES.md)
docs/                    research, ADRs, requirements, roadmap, MVP spec, glossary
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, packages and dependency rules, data model, evaluation, rig, IO,
  viewport, Graph Editor, shell, collaboration boundary, extensibility, budgets, testing, and how research
  conflicts were resolved.
- [docs/MVP-SPEC.md](docs/MVP-SPEC.md) — exact MVP scope, pinned dependencies, shared TypeScript contracts,
  operator catalog, keymap, normative behaviours, user stories, e2e scenarios, work packages.
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — numbered functional and non-functional requirements.
- [docs/ROADMAP.md](docs/ROADMAP.md) — milestones M0–M6 and status.
- [docs/adr/](docs/adr/README.md) — architecture decision records.
- [docs/DECISIONS-OPEN.md](docs/DECISIONS-OPEN.md) — owner decisions with the defaults chosen and the design
  review outcomes.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — terms (control, offset group, normalized space, surgeon, …).
- [docs/research/](docs/research/) — the evidence base (Maya features, formats, Ekza reuse, web stack, landscape,
  collaboration, rig math, extensibility, UI/UX).

## Contributing

Contributions are welcome under the [Developer Certificate of Origin](https://developercertificate.org/): sign off
every commit (`git commit -s`; checked in CI). Feature branches merge into `dev`; releases go from `dev` to `main`.
Do not copy code from GPL/AGPL or unlicensed projects; implement features clean-room. Details arrive in
`CONTRIBUTING.md` with milestone M0.

## License

The code is MIT (see `LICENSE`, added in M0). Exceptions:

- `packages/anim-core/src/curve/animx/` is a TypeScript port of [Autodesk AnimX](https://github.com/Autodesk/animx)
  and remains under the Apache License 2.0 with its original notices.
- Files under `fixtures/` are **not** MIT: each is under the licence recorded in
  [fixtures/LICENSES.md](fixtures/LICENSES.md) (CC0-1.0 or the VRM Public License 1.0 with credit).
- Third-party notices for the shipped web app are generated at build time and linked from Help → About.

"Ekza" is a name of the Ekza project and is not licensed for use by forks; product names of other vendors (for
example "Maya-style hotkeys") are used descriptively only.

## Credits

- "Seed-san" VRM 1.0 model by VirtualCast, Inc., [VRM Public License 1.0](https://vrm.dev/en/licenses/1.0/).
- "Polybot" VRM 0.x model by Polygonal Mind (100Avatars), CC0 1.0.
- Universal Animation Library by Quaternius, CC0 1.0.
- Curve evaluation based on Autodesk AnimX (Apache-2.0).
- Built on three.js, React Three Fiber, @pixiv/three-vrm, glTF Transform, dockview and camera-controls (MIT), and
  the Khronos glTF-Validator (Apache-2.0).

Sources, licences and checksums of every bundled asset: [fixtures/LICENSES.md](fixtures/LICENSES.md).
