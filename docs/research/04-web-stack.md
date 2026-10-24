# 04 — Web tech stack & performance architecture

- Date: 2026-10-17
- Scope: the concrete web stack for Ekza Animator (working name) and the runtime architecture that keeps a professional DCC-grade editor at 60 fps in a browser (the interaction reference is a leading commercial desktop DCC, "the desktop DCC" below). Covers the app shell, monorepo, 3D rendering (multi-viewport, picking, gizmos, render-on-demand), the Graph Editor/Dope Sheet renderer, state and undo, workers, docking, UI kit, TypeScript and lint tooling, testing/CI, and the license.
- Method: npm registry metadata pulled on 2026-10-17 (versions, release dates, peer ranges, licenses), official docs and changelogs (links in §17), and reading the published sources of `three@0.186.1`, `@react-three/fiber@9.8.1`, `@react-three/drei@10.7.9` and `dockview-core@8.4.0`. Sibling Ekza repos were read but not changed.
- Version policy: pin **exact** versions released **at least 14 days before 2026-10-17** (cut-off 2026-10-03). Where a newer patch exists, it is listed as "next bump".
- Status: research input. Nothing here is decided until the owner accepts it. Related: `03-ekza-reuse-audit.md` (what to reuse from Ekza code, the VRM round-trip blocker, the collab server options).

---

## 0. TL;DR

1. **Shell: Next.js 16 (App Router) for the product site, with the editor as a client-only island.** The editor is not a Next app. It lives in framework-agnostic packages. Next provides the landing page, docs, the iframe `/embed` route for Ekza Studio, and small HTTP routes (upload proxy, auth callback). A tiny Vite 8 `playground` app proves that the editor can be embedded without Next, and it runs browser tests. Collaboration never runs inside Next, because serverless hosts cannot keep WebSockets open.
2. **Monorepo:** pnpm 11 workspaces with `catalog:` versions, Turborepo 2.11 for cached tasks, and "just-in-time" internal TypeScript packages (no build step until we publish). Layering is enforced with dependency-cruiser: `anim-core` has zero dependencies, `doc`/`rig`/`io` have no React and no DOM, and only `editor` imports React.
3. **3D: one WebGL canvas, many viewports.** A custom `ViewportManager` renders one shared scene through N cameras using scissor rectangles that follow the docking panels. This replaces both drei `<View>` (which gives each view its own portal scene) and multiple `<Canvas>`es (each duplicates GPU memory and costs a WebGL context). `frameloop="demand"` keeps idle cost at zero frames. The pose is evaluated **once per frame**, before all viewports render. No React state ever changes per frame.
4. **Picking:** control curves (desktop-DCC-style rings) are picked analytically in screen space with a pixel tolerance. Skinned meshes are picked with a GPU ID buffer and an async readback (`WebGLRenderer.readRenderTargetPixelsAsync`). The CPU never raycasts a skinned mesh.
5. **Graph Editor, Dope Sheet and time slider use Canvas2D**, not SVG or WebGL. Each has layered canvases, adaptive per-pixel curve sampling, binary-search culling, batched `Path2D` drawing and hit-testing over sorted key arrays. The renderer sits behind a `CurveRenderer` interface, so a WebGL backend can replace it if the M0 benchmark fails.
6. **State has three tiers:** (a) a custom op-log **document kernel**: immutable records, typed-array key buffers, serializable ops with inverses, transactions with gesture coalescing; (b) zustand 5 stores for session and UI state; (c) mutable "hot" buffers for per-frame data. Immer, valtio and jotai are not used for the document. Every op carries stable IDs, so a later Yjs binding translates ops instead of rewriting the store.
7. **Workers:** IO, validation, bake and export run in a module worker. That worker holds a **replica of the document, kept in sync by the same op stream** (the shape collaboration will use later). It talks over a small typed RPC with cancellation and progress. Pose evaluation and Canvas2D drawing stay on the main thread. No SharedArrayBuffer and no COOP/COEP in the MVP.
8. **Docking: dockview 8** (MIT core, zero dependencies). It has floating groups, popout windows, `toJSON`/`fromJSON`, and the `renderer: 'always'` mode that keeps panel DOM alive. It is wrapped in a `WorkspaceHost` adapter because the vendor also sells a commercial tier.
9. **UI:** Tailwind CSS v4 tokens, shadcn components we own, Radix primitives, lucide icons plus our own animation glyphs. CSS Modules are allowed for bespoke widgets.
10. **TypeScript 7.0.2** (native `tsc`, 8–12× faster) for type checking. Because typescript-eslint cannot run on TS 7 (its peer range is `<6.1`), lint with **Oxlint plus type-aware tsgolint 7**, which also covers the React Compiler rules, and format with **Biome 2.5**. Next type-checks through the `tsc` CLI. We still skip its build-time check and type-check the whole monorepo once in CI.
11. **Tests:** Vitest 5 for unit, property and bench tests; Vitest browser mode for canvas/WebGL units; Playwright 1.63 end-to-end on Linux with SwiftShader WebGL (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) and Linux-only screenshot baselines; `gltf-validator` must pass on every exported file.
12. **License: MIT plus DCO sign-off**, matching three.js, R3F, glTF Transform, three-vrm and the Ekza web packages. A separate `TRADEMARKS.md` protects the "Ekza" name. Apache-2.0 is the fallback if corporate contributors ask for an explicit patent grant.

---

## 1. Non-functional requirements (performance budgets)

These budgets turn "as comfortable as the desktop DCC" into numbers we can test. The reference machine is a 2020-class laptop (Apple M1 or a GTX 1650-class GPU), Chrome stable, a 1440×900 CSS-pixel window at DPR 2.

| Scenario | Budget | How it is measured |
| --- | --- | --- |
| Idle editor | **0** WebGL frames, 0 canvas redraws | Playwright + `renderer.info.render.frame` |
| 2 VRM characters (~60k tris, ~100 joints each), 4 viewports, shaded | ≤ 8 ms CPU per frame (leaves room for 120 Hz); 16.7 ms hard limit | `performance.measure` around the scheduler tick |
| Scrub: pointer move → pose visible | same animation frame (≤ 1 frame latency) | input timestamp vs. frame timestamp |
| Pose evaluation: 2 rigs × ~120 controls × 9 channels ≈ 2,200 curves + constraints | ≤ 1 ms | `vitest bench` + in-app counter |
| Graph Editor pan/zoom with 50k keys loaded, ~10k visible | ≤ 8 ms per redraw | M0 benchmark (gates the Canvas2D decision, §5) |
| Drag 1,000 selected keys | ≤ 4 ms per pointer frame (op apply + evaluation + redraw) | bench |
| Undo/redo one gesture | ≤ 5 ms | bench |
| Open a 30 MB VRM | interactive ≤ 3 s (network excluded) | Playwright trace |
| Bake + export 2 characters × 10 s @ 60 fps | ≤ 500 ms, **off the main thread** | worker timing |
| Editor route JS (gzip, excluding fixtures) | ≤ 900 kB first load; landing ≤ 100 kB | `size-limit` in CI |

Browser support: Chromium (primary), Firefox and Safari 26+ (secondary, smoke-tested). Desktop only (minimum 1280×720). Phones are out of scope for the MVP.

---

## 2. App shell: Next.js 16 vs Vite 8

### 2.1 Comparison

| Criterion | Next.js 16 (App Router, Turbopack) | Vite 8 SPA |
| --- | --- | --- |
| Fit for a heavy client-only editor | Good, but only when the editor is a client island (`'use client'` + `dynamic(..., { ssr: false })`); SSR/RSC adds nothing to the editor itself | Native fit: no SSR traps, no `window is undefined` |
| Landing, docs, gallery, SEO | Strong: RSC and static generation | Needs another tool (e.g. Astro/VitePress) |
| Server routes (upload proxy, auth callback, signed share links) | Built in: Route Handlers, `proxy.ts` | Needs a separate server |
| Real-time collaboration server | **Not suitable** on serverless (no long-lived WebSockets) | Not applicable either; it is a separate service anyway |
| Static or self-hosting | `output: 'export'` works; it loses Route Handlers that read the request, rewrites, redirects, **headers**, proxy, Server Actions | Trivial |
| Web Workers | Turbopack supports `new Worker(new URL('./x.ts', import.meta.url))`, magic comments on `new Worker()`, and `turbopackWorkerAssetPrefix` | Native |
| Workspace TS packages | Turbopack transpiles workspace packages automatically; `transpilePackages` is only needed for raw-TS packages in `node_modules` | Native |
| Contributor DX | Familiar; heavier dev server; App Router concepts to learn | Lightest; fastest HMR |
| Vercel/Ekza alignment | Ekza already deploys web apps to Vercel | Static deploy anywhere |

### 2.2 Decision

**Next.js 16 is the product shell. The editor stays framework-agnostic.** This gives the owner his preferred stack and keeps Vite's advantages where they count:

- `apps/web` (Next 16): landing, `/editor` (client island), `/embed` (iframe for Ekza Studio, driven by a `postMessage` API), `/api/*` (upload proxy to the Ekza registry, auth callback). These HTTP routes exist only in the dynamic deploy.
- `apps/playground` (Vite 8): a minimal host that mounts `@ekza-studio/editor` without Next. It is the embedding-conformance test, the perf-bench host and the Vitest browser-mode environment.
- Collaboration (later) runs as a separate WebSocket service (Yjs: `y-websocket`/Hocuspocus first, `yrs` in Rust later; see `03-ekza-reuse-audit.md` §0.5).

Why not embed the editor into Ekza Studio as a package? Studio's web app is Remix 2.16 + React 18.3 + R3F 8 + three 0.185. Our editor package needs React 19 + R3F 9 + three 0.186. The **iframe `/embed` route with a versioned `postMessage` contract** (`open(assetUrl)`, `save → {glb|vrma bytes, metadata}`, `close`) decouples the two release trains. The non-React packages (`anim-core`, `doc`, `rig`, `io`) can still be imported directly by any host.

### 2.3 Making Next work well (rules)

1. **Never import `three`, R3F or the editor from a Server Component.** The only route-level component is a client island:

   ```tsx
   // apps/web/app/editor/EditorIsland.tsx
   'use client';
   import dynamic from 'next/dynamic';
   const Editor = dynamic(() => import('@ekza-studio/editor').then((m) => m.Editor), {
     ssr: false,             // allowed only inside Client Components
     loading: () => <EditorSplash />,
   });
   export function EditorIsland() {
     return (
       <Editor
         // the host owns bundler-specific Worker syntax; packages stay bundler-agnostic
         createIoWorker={() => new Worker(new URL('../../workers/io.worker.ts', import.meta.url), { type: 'module' })}
       />
     );
   }
   ```

   `apps/web/workers/io.worker.ts` contains one line: `import '@ekza-studio/io/worker';`. Packages never call `new Worker(new URL(...))` themselves, so the same package works under Turbopack, Vite, webpack and Remix.
2. **`next.config.ts`:**

   ```ts
   import path from 'node:path';
   import type { NextConfig } from 'next';
   const staticExport = process.env.ANIMATOR_STATIC_EXPORT === '1';
   const config: NextConfig = {
     output: staticExport ? 'export' : undefined,
     reactStrictMode: true,
     // CI type-checks the whole monorepo once with TS 7 (`tsc -b`), see §10
     typescript: { ignoreBuildErrors: true },
     turbopack: { root: path.resolve(__dirname, '../..') }, // monorepo root
     ...(staticExport ? {} : { async headers() { return securityHeaders; } }), // headers are unsupported with export
   };
   export default config;
   ```
3. **Two deploy modes.** *Dynamic* (Vercel, or `next start` / standalone Docker for self-hosting) has the API routes and headers. *Static* (`ANIMATOR_STATIC_EXPORT=1`) produces an editor-only build for GitHub Pages, IPFS or an intranet. In static mode, uploads go straight to the Ekza API with a user token. The editor must never *require* a Next server.
4. **Assets:** self-host the Draco, Meshopt and KTX2 transcoders under `public/decoders/`. No third-party CDN at runtime (offline use, CSP, privacy).
5. **React Compiler:** evaluate `reactCompiler` (Next 16) in M1 behind a perf trace. Leave imperative hot components (viewport host, canvas panels) opted out with `'use no memo'` if the compiler flags ref mutation. The compiler is known to complain about refs that are mutated and also used in JSX (react#29106).
6. **Turbopack is the default** in Next 16 (dev and build). Keep `--webpack` as an escape hatch only. Do not depend on webpack plugins.

---

## 3. Monorepo

### 3.1 Tooling

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | **24 LTS** (`.nvmrc` = `24`, `engines.node` = `^24.15.0 \|\| >=26.0.0`) | Vitest 5 requires `^22.12 \|\| ^24 \|\| >=26`, jsdom 30 requires `^24.15 \|\| >=26`. **Odd release lines such as 25 are outside these ranges.** Node 26 becomes Active LTS on 2026-10-28; move to it in November. |
| pnpm | **11.28.3** (`packageManager` field) | Mature JS line. Supply-chain defaults (`minimumReleaseAge`, `blockExoticSubdeps`). Same lockfile format as pnpm 12, a Rust rewrite released 2026-08-26 that we can adopt later without migration. Node ≥ 22. |
| Turborepo | **2.11.7** | Cached `lint/typecheck/test/build`, `--affected` on PRs. The experimental `turbo boundaries` is optional; dependency-cruiser enforces layering. |
| dependency-cruiser | **18.5.0** | Import rules: no `react` outside `editor`/`ui`/`apps`; no `three` in `anim-core`/`doc`; no DOM in `doc`/`rig`/`io` (they must run in workers and Node). |

`pnpm-workspace.yaml` uses `catalog:` so every package shares one `three`, `react` and `@types/*` version. It sets `minimumReleaseAge: 20160` (14 days, in minutes) to automate the owner's two-week rule, with `minimumReleaseAgeExclude` for urgent security patches.

### 3.2 Package layering (dependency direction is one-way)

```
anim-core  ←  doc  ←  rig  ←  io
    ↑          ↑       ↑       ↑
    └──── curve-editor ┘       │
              ↑   viewport ────┘ (three)
              └──── editor (React 19, R3F 9, dockview, zustand) ──→ ui
                        ↑
            apps/web (Next 16) · apps/playground (Vite 8)
```

- **anim-core:** curve and key math (the AnimX-compatible tangent model, weighted/non-weighted Hermite/Bezier), evaluation, Euler filter, resampling, key reduction. Pure TS, **zero runtime deps**, deterministic. The same code evaluates in the viewport, draws the graph and bakes in the worker, so what you see is what you export.
- **doc:** document schema, records, ops, `applyOp`, transactions, undo, change sets, migrations, serialization.
- **rig:** skeleton and humanoid model (VRM bone map), control rig, constraints, FK/IK. Uses **struct-of-arrays pose buffers** and only `three` *math* classes, never `Object3D`, so it runs in a worker.
- **io:** glTF/GLB/VRM/VRMA import and export, bake, validation, worker entry and RPC (VRM baking is append-only; see 03 §0.2).
- **viewport:** imperative three.js (ViewportManager, cameras with Alt+drag navigation, picking, control shapes, manipulators, overlays) with thin R3F bindings.
- **curve-editor:** Canvas2D Graph Editor, Dope Sheet and time slider. Renderers and interaction controllers have no React dependency; `editor` wraps them.

**Internal packages are just-in-time:** `exports` points at `./src/index.ts`, and the consuming bundler (Turbopack, Vite, Vitest) compiles them. Nothing is built until we publish. Publishing (e.g. for Ekza Studio or third parties) adds `tsdown` builds via `publishConfig.exports` overrides. The npm scope is an open question (§16).

---

## 4. 3D rendering architecture

### 4.1 Versions and renderer

- `three@0.186.1`, `@react-three/fiber@9.8.1`, `@react-three/drei@10.7.9`, `react@19.3.0`.
- **R3F 9 pins React minors.** 9.7.x allows `react <19.3`, 9.8.x allows `>=19 <19.4`. React and R3F must move together. Renovate groups them (§11.5).
- **WebGLRenderer for the MVP.** three.js is now focused on `WebGPURenderer`, with no larger new features planned for `WebGLRenderer`. R3F v10 (first-class WebGPU) is still alpha (`10.0.0-alpha.6`, 2026-10-17), and drei 11 is alpha too. To keep the WebGPU path open, all custom visuals live in `viewport/overlays`. Use addon classes that have WebGPU twins (`three/addons/lines/Line2.js` ↔ `lines/webgpu/Line2.js`). Avoid `onBeforeCompile` hacks on character materials. Revisit at R3F 10 stable.
- **drei is used selectively** (`Grid`, `GizmoHelper`/`GizmoViewcube`, `Environment`, `Bvh` if needed). drei 10.7.9 pulls a wide transitive set (hls.js, mediapipe tasks-vision, troika). Imports are tree-shaken, but install size grows. Nothing in `viewport` depends on drei.

### 4.2 Multi-viewport: options and decision

| Option | GPU resources | Same character in all views | Events/picking | Verdict |
| --- | --- | --- | --- | --- |
| Multiple `<Canvas>` (one per panel) | **Duplicated per WebGL context**: textures, skinned geometry and programs are uploaded N times. Browsers cap live contexts (old ones get lost) | Needs N scenes or manual rendering of a shared scene from N renderers | Simple per canvas | No (memory ×N, context loss risk) |
| drei `<View>` (one canvas, scissor per tracked DOM element) | Shared | **No**: each View is a separate portal scene. The same `Object3D` cannot have two parents, so the character would need N clones | Built-in `compute` per view | Good for marketing pages, wrong for an editor |
| **Custom `ViewportManager` (one canvas, one shared scene, N cameras, scissor)** | Shared | Yes, rendered N times from N cameras | Our own router (pointer → viewport → camera → picking) | **Chosen** |

How `ViewportManager` works (about 300 LoC, modeled on drei `View`'s `setScissor`/`autoClear` handling):

- One `<Canvas>` is fixed full-window *behind* the dockview workspace (`pointer-events: none`; events come from the workspace root). Each viewport panel renders a transparent `<div>` that registers `{ id, element, camera, settings }`.
- Rects come from `ResizeObserver` plus layout events from the docking library, not from `getBoundingClientRect()` every frame.
- Per frame, for each **visible and dirty** viewport: `gl.setViewport` + `gl.setScissor(rect)`, `setScissorTest(true)`, then `render(sceneMain, cam)`. After that comes a per-viewport **overlay pass** (`clearDepth()`, then `render(overlayScene, cam)`) for control rings drawn "on top", manipulators, joint glyphs and the HUD. Overlays scale per camera, so a manipulator keeps a constant pixel size in every view.
- Per-viewport settings: shading (smooth / wireframe-on-shaded / X-ray), show joints/controls/grid, isolate selection, **camera lock**. The owner's split screen is two viewports: a locked "shot" camera and a free camera to rotate in.
- Supported layouts: single, 2-up vertical/horizontal, 4-up (persp / top / front / side), and any dockview arrangement. Floating groups work (the render order follows dockview's z-order). **Popout windows cannot host a viewport**, because a WebGL context cannot draw into another window. Popouts are limited to 2D panels.

### 4.3 Frame scheduling and render-on-demand

The rule is **evaluate once, render many, never through React.**

```
rAF tick (EditorScheduler)
 1. drain input (coalesced pointer events, key state)            ── main
 2. advance clock (playback) or apply scrub time
 3. if doc changed or time changed:
      anim-core evaluate(curves, t) → control values               ── ≤1 ms
      rig solve(constraints, FK/IK) → bone local TRS (SoA buffer)
      write into three Bone.position/quaternion/scale (no allocation)
      scene.updateMatrixWorld()  ── ONCE (scene.matrixWorldAutoUpdate = false)
 4. if any viewport dirty → R3F renders (frameloop="demand", invalidate())
      ViewportManager renders each dirty viewport (main + overlay pass)
 5. redraw dirty 2D canvases (Graph Editor, Dope Sheet, time slider) in the same frame
```

- `<Canvas frameloop="demand">`. Steps 1–3 are registered with R3F `addEffect` (runs once before the roots render). Step 5 is registered with `addAfterEffect`. During playback, the clock calls `invalidate()` every frame. When idle, nothing renders. drei controls that call `invalidate()` keep working. The M0 spike also tries `frameloop="never"` with R3F's `advance(timestamp)` in a fully owned loop, and the simpler variant wins.
- `three` calls `scene.updateMatrixWorld()` inside *every* `render()` when `matrixWorldAutoUpdate` is true. With 4 viewports that is 4 traversals, so we turn it off and update once in step 3. Skeleton uploads (`skeleton.update()`) already run once per `render()` call, guarded per frame in `WebGLObjects`. That is cheap (bones × mat4) but N per frame; acceptable.
- **Scrubbing:** pointer moves only set `clock.pendingTime`. Many `pointermove` events per frame collapse into one evaluate and one render. Drags use `getCoalescedEvents()` for precision, but evaluation is still once per frame.

### 4.4 Rules that keep React out of the hot path

1. No `setState` or zustand `set` per frame. Time, playhead, hover and drag previews live in **transient stores** (plain objects plus `subscribe`). Consumers update the DOM or canvas imperatively (`ref.current.style.transform`, canvas redraw).
2. Document-driven 3D objects (bones, control shapes, constraint helpers) are created and updated by an imperative `SceneSync` that subscribes to doc change sets. There is no React component per bone. R3F composes the app-level scene (canvas, lights, grid, camera rigs, helper toggles).
3. React subscribes only through narrow selectors (`useStore(store, selector, shallow)`) for panels that change at human speed: channel box values *on gesture end*, outliner, attribute editor.
4. Large lists (outliner, Dope Sheet rows, channel lists) use `@tanstack/react-virtual@3.14.13`.
5. Handlers are stable (`useCallback` or a module-level controller). Panels never re-render because the clock ticked.

### 4.5 Picking

| Target | Method | Notes |
| --- | --- | --- |
| Control curves (rings, boxes, arrows) | **Analytic, screen-space:** project the control's polyline (cached per view and updated on pose change) and test point-to-segment distance in px, with tolerance `6 px × DPR` | Exact, pixel-constant tolerance, no GPU stall. `Line2`'s raycast (`raycaster.params.Line2.threshold`) also works, but screen-space is simpler for many cameras. |
| Joints | Same screen-space test on the projected joint position and radius | Priority below controls |
| Skinned meshes (click on a body part → select a control) | **GPU ID buffer:** render the viewport rect into a small `RGBA8` target with an ID material (skinning still on the GPU), then `readRenderTargetPixelsAsync` | Avoids CPU skinning in `SkinnedMesh.raycast`. Async readback avoids stalls on hover. Map triangle → dominant skin weight → bone → control. |
| Marquee selection | Project all controls and joints into screen rects (CPU) | Dozens to hundreds of items, trivially fast |
| Static props (later) | `three-mesh-bvh@0.9.15` | BVH is not refit for skinned poses |

Selection priority: manipulator > control > joint > mesh. Alt-click (desktop-DCC convention) cycles through overlapping hits.

### 4.6 Control shapes (DCC-style circles)

- Rendered with `Line2`/`LineSegments2` + `LineMaterial` (`worldUnits: false`, 1.5–2 px × DPR). They draw in the overlay pass with `depthTest` off ("always on top"), or with a dimmed "occluded" segment pass. Colors follow the usual DCC rigging conventions: left = blue, right = red, center = yellow, selected = white or green.
- The shape is data in the document (control record: shape preset or custom polyline, size, orientation offset, color). That keeps it serializable, collaborative and exportable as extras.
- Modeling later (splines first) reuses the same polyline/curve primitives and picking. Keep `viewport/curves` generic, not "rig-only".

### 4.7 Manipulators (gizmos)

| Option | Pros | Cons | Use |
| --- | --- | --- | --- |
| three `TransformControls` (addon, r186) via drei wrapper or directly | Mature; translate/rotate/scale; world/local; snapping | No **gimbal** mode (essential for Euler-curve animators), no view ring/trackball parity with the desktop DCC, no rotate-mode feedback arcs | **M1** |
| drei `PivotControls` | Nice visuals | Matrix-based, different UX, not desktop-DCC-like | No |
| **Custom `ManipulatorKit`** (imperative three objects in `viewport/manipulators`) | Desktop-DCC parity: Object/World/Gimbal/Parent modes, view-axis ring, trackball, step snap, numeric HUD, "drag along tangent" ring interaction | Costs about 2–3 weeks | **M2** |

### 4.8 Skinned-mesh performance while scrubbing

- GPU skinning only; never call `computeBoundingSphere()` per frame. Set `frustumCulled = false` on skinned meshes in the editor (bind-pose bounds are wrong for animated poses), or compute clip-wide bounds once per clip in the worker.
- Do not create objects in the hot path. Pose writes go into existing `Vector3`/`Quaternion` instances from a `Float32Array`.
- Default work viewports: no shadows, one hemisphere light plus one directional light, MSAA 4× (or FXAA), DPR capped at 2. Wireframe-on-shaded uses a second draw with a wireframe material, not post-processing.
- VRM spring bones and constraints from `@pixiv/three-vrm`: "update secondary motion" is a viewport toggle, off while scrubbing (deterministic preview) and on during playback.

### 4.9 Robustness

- Handle `webglcontextlost`/`restored`. The document is the source of truth, so `SceneSync` rebuilds GPU resources from it after a restore.
- If WebGL context creation fails, show a clear message. The docs, file conversion (worker) and the 2D editors still work.

---

## 5. Graph Editor, Dope Sheet and time slider rendering

### 5.1 Options

| Criterion | SVG/DOM | **Canvas2D** | WebGL (three/regl/pixi) |
| --- | --- | --- | --- |
| Thousands of keys (one node per key + 2 tangent handles) | Tens of thousands of DOM nodes; style, layout and paint costs on every pan/zoom | Immediate mode; cost ∝ visible primitives; batched paths | Best raw throughput |
| Text (axis labels, frame numbers) | Easy | Easy (`fillText`, cached metrics) | Hard (SDF fonts) |
| Thin antialiased 1 px lines, dashed infinity curves | Easy | Easy (`setLineDash`, half-pixel alignment) | Needs a line shader |
| Hit-testing | Free (DOM events) | Our own (sorted keys → binary search) | Our own, or GPU picking |
| hi-DPI | Automatic | Manual (`dpr` backing store) | Manual |
| Shares the 3D WebGL context | No | No (separate 2D context, no GPU-context pressure) | Would need its own context or the scissor system |
| Complexity | Low | Medium | High |

**Decision: Canvas2D on the main thread**, behind a `CurveRenderer` interface. The **M0 benchmark gate** is 50k loaded keys, ~10k visible, pan/zoom ≤ 8 ms per redraw in Chrome and Safari on the reference laptop. If it fails, only the curve layer moves to a WebGL backend; interaction and hit-testing stay. OffscreenCanvas in a worker is not used: the renderer needs synchronous access to the document and input state, and a worker would duplicate both.

### 5.2 Rendering architecture

- **Two stacked canvases per editor:** *base* (grid, infinity curves, curves, keys, tangent handles) is redrawn only when the view transform or the visible curves change. *Overlay* (playhead, hover, marquee, snapping guides, drag preview) is redrawn cheaply on pointer moves and playback. The outliner and channel list on the left are virtualized DOM.
- **View transform:** independent time and value scales (`x = (t − t0)·sx`, `y = (v0 − v)·sy`), plus the desktop DCC's modes: *Frame All (A)*, *Frame Selection (F)*, *Normalize* (per-curve min/max → [−1, 1]) and *Stacked*.
- **Adaptive sampling:** for each visible segment `[k_i, k_{i+1}]`, use `n = clamp(ceil(Δx_px / 3), 2, 256)` samples through the **same `anim-core` evaluator** the viewport uses. Linear segments use one `lineTo`. Stepped segments use two. Weighted (2D Bezier) tangents are drawn directly with `bezierCurveTo` using the transformed control points, which is exact and needs no sampling.
- **Culling:** keys are sorted by time per curve, so a binary search gives the visible index range `[lo, hi]`. Cached per-segment value bounds (from the Bezier hull) skip segments outside the visible value range.
- **Batching:** one `Path2D` per (curve color × state) for lines, one `Path2D` for all unselected key squares, and one for selected keys. That is about 3 `fill`/`stroke` calls per curve instead of one per key. Each curve's base color follows the desktop DCC (X red, Y green, Z blue, others white or yellow).
- **hi-DPI:** backing store = CSS size × DPR via `ResizeObserver` (`devicePixelContentBoxSize` where available; **Safari does not implement it**, so fall back to `contentRect × devicePixelRatio`), `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`, and 1 px lines at `x + 0.5`.
- **Hit-testing order:** tangent handle > key > curve segment > empty (marquee). Key hits use binary search in `[t − tol, t + tol]` and then a value check. Curve hits use distance to the sampled polyline of the segment under the cursor. The marquee is a range query per visible curve.
- **Interaction state machine** (one per editor): idle → hover → press → (drag-keys | drag-tangent | marquee | pan | zoom) → commit or cancel (Esc restores). Every drag runs inside a document **gesture** (§6.3), so one undo step covers the whole drag. Pointer capture is required. Pointer Lock is used for infinite "virtual slider" drags (the desktop DCC's middle-mouse drag in the channel box).
- **Shared code:** Dope Sheet and time slider reuse the transform, culling, batching and hit-testing modules. A key tick in the time slider and a Dope Sheet cell are just different glyph painters.

---

## 6. State architecture

### 6.1 Three tiers

| Tier | Contents | Store | Undo | Collaborative later |
| --- | --- | --- | --- | --- |
| **Document** | assets (by content hash), rigs, controls, constraints, clips, curves, keys, scene/characters, project settings | custom op-log kernel (`packages/doc`), exposed through a zustand vanilla store for subscriptions | yes (op inverses) | yes (op ↔ Yjs binding) |
| **Session/UI** | selection, current time, playback, tool and manipulator mode, viewport cameras, panel layout, graph view transforms, preferences | zustand 5 slices (`subscribeWithSelector`), layout in dockview JSON | selection: optional (the desktop DCC puts selection in the undo queue; make it a preference) | presence/awareness, not the document |
| **Hot/transient** | evaluated pose buffers, projected control polylines, hover, drag preview | mutable singletons and typed arrays | no | no |

### 6.2 Why not immer, mutative, valtio or jotai for the document

| Option (version) | Problem as the *document* core | Use it? |
| --- | --- | --- |
| zustand 5.0.15 | No undo or ops by itself, but an excellent subscription container | **Yes**, as the container and for UI state |
| immer 11.1.21 patches | Proxy drafting is slow on large data. Typed arrays are not draftable. Patches are **path/index based** (`["curves", 3, "keys", 812]`), so they do not merge under concurrent edits and lose intent ("insert key with id X") | No (fine inside UI slices if wanted) |
| mutative 2.0.0 | Faster immer-like API, but has the same path-patch model. 2.0 is 5 days old | No |
| valtio 2.3.2 | Mutable proxies make it hard to capture *intent* ops and gestures. Snapshot per change | No |
| jotai 3.0.1 | An atom per key/curve explodes at 50k keys. Good for derived UI, not for the document | No |
| Yjs 13.6.33 from day one | CRDT overhead on every edit; typed arrays are not native; undo semantics change; slows MVP iteration | **Later**, through the op binding |

### 6.3 Document kernel design

```ts
type Id = string;                        // UUIDv7/nanoid, stable across sessions and replicas
interface CurveRecord {
  id: Id; target: { controlId: Id; channel: 'tx'|'ty'|'tz'|'rx'|'ry'|'rz'|'sx'|'sy'|'sz'|string };
  pre: InfinityMode; post: InfinityMode; weighted: boolean;
  keys: KeyBuffer;                       // immutable once published (copy-on-write per edit)
}
interface KeyBuffer {                    // struct-of-arrays, sorted by time
  id: Uint32Array;                       // stable per-curve key ids (CRDT layer maps to (client, clock))
  t: Float64Array; v: Float64Array;      // time (frames or seconds, decided in doc schema), value
  inX: Float32Array; inY: Float32Array; outX: Float32Array; outY: Float32Array; // tangents
  flags: Uint16Array;                    // in/out tangent types, broken, locked, weight-locked (selection lives in session state)
}
type Op =
  | { k: 'key.insert'; curve: Id; keys: KeyRows }            // inverse: key.remove
  | { k: 'key.update'; curve: Id; ids: number[]; before: KeyPatch; after: KeyPatch }
  | { k: 'key.remove'; curve: Id; keys: KeyRows }            // inverse: key.insert
  | { k: 'record.put'; rec: AnyRecord; before?: AnyRecord }   // controls, constraints, clips, curves…
  | { k: 'record.del'; rec: AnyRecord };
// applyOp(doc, op) → doc'   pure; structural sharing per record; KeyBuffer replaced, not mutated
```

- **Transactions:** `doc.transact(label, tx => …)` applies ops, emits one `ChangeSet` (`{ changedRecords: Set<Id>, changedCurves: Set<Id> }`) and pushes `{label, ops, inverses}` onto the undo stack.
- **Gestures:** `beginGesture('Move keys')` applies ops live for preview, `commitGesture()` compacts them into one entry (first `before` + last `after` per key), and `cancelGesture()` reverts. This is needed for desktop-DCC-like drags and for collaboration (one network update per gesture plus a throttled live preview).
- **Change routing:** the evaluator invalidates caches only for changed curves. The Graph Editor redraws only if a changed curve is visible. `SceneSync` updates only changed controls. React panels re-render only through their selectors.
- **Determinism:** ops are plain data, so the same ops feed undo, the autosave journal, the worker replica (§7), tests (replay and fuzzing) and, later, Yjs.
- **Schema versioning:** every saved document has `schemaVersion`. Migrations are pure functions in `doc/migrations`.

### 6.4 Rules that keep collaboration possible

1. Every entity, including every **key**, has a stable ID. Identity never comes from an array index.
2. Mutations go only through ops. A `YjsBinding` later maps `record.*` → `Y.Map` per record and `key.*` → a `Y.Map<keyId, KeyStruct>` per curve (sorted view derived locally).
3. Undo is per user. The op-based stack can be replaced with `Y.UndoManager({ trackedOrigins })`.
4. Presence (selection, current time, active camera, cursor, "who is editing which control") goes through **awareness**, never the document.
5. "Four hands on one character": soft locks per control or body part through awareness (highlight in the outliner and viewport) instead of hard locks, so concurrent key edits on the *same* curve stay rare and merge by key ID.
6. Float precision is canonical (`Float64` time/value in the document, `Float32` in render buffers), so replicas evaluate identically.

---

## 7. Workers

| Task | Where | Why |
| --- | --- | --- |
| Fetch, then parse into a three.js scene (`GLTFLoader` + `VRMLoaderPlugin`) | **main** (decoders run in their own WASM workers) | three objects cannot be transferred |
| Source of truth for round-trip export (original bytes + glTF Transform `Document`, or the append-only GLB patcher for VRM; see 03 §0.2) | **IO worker** | Lossless export; CPU-heavy |
| `gltf-validator` (about 1 MB dart2js) | IO worker | CPU-heavy, isolates a large dependency |
| Bake: evaluate rig over frames → samplers (LINEAR/STEP/CUBICSPLINE), Euler → quaternion, key reduction, VRMA build | IO worker | CPU-bound; keeps the UI responsive |
| Export write (GLB/VRMA; meshopt compression via `meshoptimizer@1.3.0`) | IO worker | |
| Per-frame pose evaluation, Canvas2D drawing | main | latency; data is small |
| Playblast/thumbnails (later) | main render + WebCodecs `VideoEncoder` in a worker | |

- **Worker replica:** the worker gets the initial document snapshot once, then the **same op stream** the main thread applies, via the shared `doc.applyOp`. A bake request then sends only `{clipId, range, fps, options}`. There is no 1–2 MB structured clone per export, and this proves the replica model collaboration will need.
- **RPC:** a small typed RPC in `io/rpc` (about 150 LoC) with request IDs, `AbortSignal` cancellation, progress events, `Transferable` results (`ArrayBuffer` of the exported GLB) and serialized errors. `comlink@4.4.2` (Apache-2.0, last release 2024-11) would work, but it has no cancellation or progress model.
- **No SharedArrayBuffer and no COOP/COEP in the MVP.** Cross-origin isolation would require CORP headers on every cross-origin asset (Ekza registry storage, user URLs), and static export cannot set headers. Revisit only if a threaded WASM solver needs it.

---

## 8. Panels and docking

| Library (version) | License | Last activity | Tabs/docking | Floating | Popout windows | Serialize | Keep panel DOM alive | React 19 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **dockview-react 8.4.0** (8.6.0 next) | MIT core; separate commercial "Enterprise" tier | pushed 2026-10-16; ~3.5k stars | yes | yes | yes | `toJSON`/`fromJSON` | `renderer: 'always'` | peer `^16.8 … ^19` |
| flexlayout-react 0.11.1 | MIT | pushed 2026-10-09; ~1.4k stars | yes | yes | yes | `Model.toJson`/`fromJson` | partly | `^18 \|\| ^19` |
| react-mosaic-component 7.2.1 | Apache-2.0 | 2026-09-28 | tiling, limited tabs | no | no | tree JSON | — | `16–19` |
| allotment 1.20.x | MIT | 2026-10-16 | split panes only | no | no | manual | — | `^17–^19` |
| golden-layout 2.6.0 | MIT | last npm release 2023-02 | yes | yes | yes | yes | — | no official binding |

**Decision: dockview 8.** The MIT edition includes everything we need: dockable grid, floating groups, popouts, edge groups, maximize, save/restore, theming, keyboard navigation. Enterprise-only features (layout history, multi-row tabs, smart guides, keyboard docking) are not needed. Mitigate the open-core risk with a `WorkspaceHost` adapter (panel registry + serialized layout) so FlexLayout can replace it. `allotment` is fine *inside* a panel for fixed splits (for example the Graph Editor's outliner | curves).

Panel set for M1: Viewport (N instances), Outliner, Channel Box, Attribute Editor, Graph Editor, Dope Sheet, Time Slider + Range Slider, Clip/Trax list, Script/Console (later). Presets ("Animation", "Rigging", "Graph-heavy") ship as JSON layouts. Viewports use `renderer: 'always'` so the canvas registration survives tab switches.

---

## 9. UI kit

- **Tailwind CSS 4.3.3** (`@tailwindcss/postcss` in Next, `@tailwindcss/vite` in the playground). Tokens live in CSS (`@theme`: colors, 4 px spacing grid, radii, font sizes 11/12/13 px). Pro density: 22–24 px rows, 11–12 px UI text, a tabular-number monospace face for numeric fields. Dark theme first. All colors are CSS variables, so panels, the 2D canvases and 3D overlays read **the same tokens** (canvas painters read computed variables once per theme change).
- **shadcn/ui components copied into `packages/ui`** (we own the code) on **Radix primitives** (`radix-ui@1.6.7`, unified package; 1.8.x next). Radix's Menubar, ContextMenu, DropdownMenu, Popover, Tooltip, Dialog, Slider and Toggle Group cover a DCC shell. Base UI (`@base-ui/react@1.8.0`, MUI team) is an equivalent alternative that shadcn also supports. The choice is cheap to revisit because the components are ours.
- **CSS Modules** are allowed for bespoke widgets (channel-box virtual sliders, timeline chrome) where utility classes get noisy.
- **Icons:** `lucide-react@1.50.0` (ISC) for generic actions, plus our own `ui/icons` SVG set for animation glyphs that lucide lacks: tangent types (auto, spline, clamped, linear, flat, stepped, plateau), break/unify, weighted, key/breakdown, infinity modes.
- **Keymap:** our own context-aware keymap (focused panel > global), the `dcc` preset first. Browser constraints: some chords cannot be intercepted (`Ctrl/Cmd+W/T/N` in Chrome). Alt+drag conflicts with window managers on some Linux desktops, so offer an alternative navigation preset (e.g. middle-mouse based). Suppress the context menu (for marking menus later) and Windows middle-click autoscroll. The Keyboard Lock API works only in fullscreen. A desktop wrapper (Tauri) is a later option for full shortcut capture.

---

## 10. TypeScript, lint, format

### 10.1 Facts (as of 2026-10-17)

- TypeScript **7.0.2** (2026-07-08, the native Go compiler) builds 8–12× faster than 6.0 and **ships no programmatic API**. Microsoft expects a new API in 7.1. Tools that import the compiler need 6.0 through `@typescript/typescript6` (an alias that provides `tsc6` and the 6.0 API).
- **typescript-eslint 8.71.x declares `typescript >=4.8.4 <6.1.0`**, so ESLint with type-aware rules cannot run on TS 7.
- **Next.js 16:** the docs say `next build` uses the project-local `tsc` CLI by default, which supports TS 7. The `experimental.useTypeScriptCli` flag (added in 16.2.12) is still marked experimental.
- **Oxlint type-aware linting is stable** (tsgolint 7, built on TS 7.0.2, 59 of 61 typescript-eslint type-aware rules, 12–18× faster). Oxlint also has **22 React Compiler rules** (2026-08) as well as react-hooks, jsx-a11y, import, unicorn and vitest plugins.
- Vitest and Vite transpile with Oxc/esbuild and never load the TS API. Biome does not depend on TypeScript.

### 10.2 Decision

| Concern | Tool | Version |
| --- | --- | --- |
| Type check | `typescript` **7.0.2**: `tsc -b` with project references, one run for the monorepo in CI and in `turbo typecheck` | 7.0.2 |
| Lint | **oxlint 1.86.0** + **oxlint-tsgolint 7.0.2003** (`options.typeAware: true`): `no-floating-promises`, `no-misused-promises`, React Compiler rules, rules-of-hooks, exhaustive-deps, jsx-a11y | — |
| Format + import sorting | **Biome 2.5.15** (formatter and organize-imports only; linter off) | — |
| Layering | dependency-cruiser 18.5.0 | — |
| Unused deps/exports | knip 6.39.0 (optional, weekly) | — |
| Escape hatch | `"typescript6": "npm:@typescript/typescript6@6.0.2"` only for a tool that needs the TS API (TypeDoc, API Extractor) | — |

Fallback if TS 7 blocks something critical: TS 6.0.3 + ESLint 10 + typescript-eslint 8.71 + Prettier 3.9. The code is the same, since TS 7 compiles whatever compiles cleanly on 6.0 with 6.0's defaults. So keep `tsconfig` free of options deprecated in 6.0: no `baseUrl`, use `moduleResolution: "bundler"`, `module: "esnext"`, `verbatimModuleSyntax`, `isolatedDeclarations` for publishable packages, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

---

## 11. Testing and CI

### 11.1 Unit and property tests (Vitest 5.0.3, Node environment)

- `anim-core`: tangent math against reference values (desktop-DCC semantics documented in the anim research), Euler filter, resample/reduce round-trip error bounds. **Property-based tests with `fast-check@4.10.2`:** evaluation is continuous for smooth tangents, monotonic time is preserved, `reduce(resample(c))` stays within ε.
- `doc`: for any random op sequence, `apply(op)` followed by `apply(inverse(op))` equals the original doc; gesture compaction is equivalent to the uncompacted ops; migrations are idempotent.
- `io`: GLB/VRM/VRMA round-trip on CC0 fixtures, comparing animation samplers within ε, with **`gltf-validator@2.0.0-dev.3.10` reporting 0 errors** on every exported file (warnings are snapshotted).
- `vitest bench` for evaluation (ns per curve), op application and Graph Editor path building, tracked over time.

### 11.2 Browser tests (Vitest browser mode, `@vitest/browser-playwright@5.0.3`)

Real Chromium for `curve-editor` painters (pixel snapshots at DPR 1 and 2), picking math against a real WebGL context, and `ViewportManager` scissor layouts.

### 11.3 End-to-end (Playwright 1.63.0)

- Runs against the **production build** of `apps/web` (`next build && next start`) plus a smoke run of the static export.
- WebGL on GPU-less Linux CI: Chromium's documented SwANGLE path, `--use-gl=angle --use-angle=swiftshader`, plus `--enable-unsafe-swiftshader`. Automatic SwiftShader fallback is deprecated (WebGL creation fails without the opt-in from M139). The flag is acceptable because the tests run only our own trusted content. Prefer the new headless mode (`channel: 'chromium'`), and verify context creation in a first "WebGL available" test.
- **Screenshot tests:** fixed viewport 1440×900, `deviceScaleFactor: 1`, `?e2e=1` (fixed time, no animations, fixed seed), baselines **only from the Linux CI container** (the Playwright Docker image matching the pinned version) to avoid cross-OS raster differences. A tolerance of `maxDiffPixelRatio` ≈ 0.002 applies to 3D views.
- Beyond pixels: the e2e build exposes a read-only test hook (`window.__ANIMATOR_TEST__`: doc stats, selection, current time). Key flows: load fixture VRM → select control → set key → scrub → graph-edit tangent → undo/redo → export GLB and VRMA → validate the downloaded files in Node with `gltf-validator` → re-import.
- Firefox and WebKit: smoke tests only (load, render, export).

### 11.4 CI (GitHub Actions)

`install` (pnpm cache, `--frozen-lockfile`) → parallel `format-check` (Biome) · `lint` (Oxlint type-aware) · `typecheck` (`tsc -b`) · `deps` (dependency-cruiser) · `unit` (Vitest) → `build` (turbo) → `e2e` (Playwright container) · `size` (size-limit) · `licenses` (`pnpm licenses list --json`, block GPL/AGPL/SSPL/unknown in runtime deps) · `fixtures` (validate every file in `fixtures/` and check that `fixtures/LICENSES.md` covers it). PRs use `turbo run … --affected`. Required checks gate merges into `dev` (the Ekza gitflow: features → `dev`, releases → `main`).

### 11.5 Dependency hygiene

Renovate (or Dependabot) with `minimumReleaseAge: "14 days"`, groups `react` + `react-dom` + `@types/react` + `@react-three/*` (R3F's React-minor upper bound), `three` + `@types/three` + `@pixiv/three-vrm*`, and `@gltf-transform/*`. Lockfile maintenance weekly.

---

## 12. License and open-source hygiene

| | **MIT** | Apache-2.0 | MPL-2.0 |
| --- | --- | --- | --- |
| Type | permissive | permissive | file-level weak copyleft |
| Patent grant | implicit at best | **explicit** + retaliation clause | explicit |
| Alignment | three.js, R3F, drei, glTF Transform, three-vrm, Ekza web packages (`ekza-avatar-renderer`, `core`) are MIT | Rust ecosystem often dual MIT/Apache (`ekza-bevy-sdk`) | OMOBA client is MPL-2.0 |
| Embedding in Ekza Studio and third-party products | trivial | trivial (keep NOTICE) | allowed; modified MPL files stay MPL |
| Contributor friction | lowest | low | medium |

**Recommendation: MIT** for the whole repository, with **DCO** (`Signed-off-by:` checked by a GitHub app) instead of a CLA. A permissive license gives no reason to relicense later, so a CLA adds friction without benefit. Add `TRADEMARKS.md`: the code is MIT, but the "Ekza" name and logo are not licensed, so forks must rebrand. If a corporate contributor requires an explicit patent grant, switch to Apache-2.0 *before* the first external contribution. Never mix in GPL, AGPL or SSPL runtime dependencies.

Repository basics: `README` (vision, GIF, quick start), `CONTRIBUTING.md` (setup: Node 24, pnpm 11, `pnpm i && pnpm dev`; package map; how to add a panel or an op; test commands; DCO), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (private disclosure; untrusted GLB parsing is the main attack surface; limit file sizes), issue and PR templates, `docs/adr/` for decisions, and `fixtures/LICENSES.md` (CC0 VRMs from Open Source Avatars, Quaternius clips; see 03 §2.1).

---

## 13. Reusing Ekza code (stack view)

- `ekza-avatar-renderer` is pinned to `three <0.186` and developed on React 18 / R3F 8. Do not depend on it in M0. Copy the pure helpers listed in 03 §2.1 into `rig`/`io` with attribution. Later, widen its peer range so a "Preview as Ekza Space" panel can use the real renderer for parity.
- `core` (Ekza Space) has the same engine-boundary principle we adopt ("engine must not import app"). Its Socket.IO pose protocol is presence-only and cannot replace CRDT document sync.
- Ekza Studio (`ekza-registry/web`) runs on React 18, so integration goes through the **iframe `/embed` contract** first and direct package imports of non-React packages later.
- Ekza conventions to follow: MIT for web packages, exact pins, `.agent/tasks` evidence style, feature PRs into `dev`.

---

## 14. Stack decision table

All versions were released on or before 2026-10-03 unless marked. "Next bump" = newer release to adopt after its 14-day soak.

| Area | Choice | Pinned version (release date) | Next bump | License |
| --- | --- | --- | --- | --- |
| Runtime | Node.js LTS | 24.x (`.nvmrc` `24`) | 26 LTS after 2026-10-28 | MIT |
| Package manager | pnpm | 11.28.3 (2026-09-30) | 12.x when needed | MIT |
| Task runner | Turborepo | 2.11.7 (2026-10-02) | 2.11.9 | MIT |
| App shell | Next.js (App Router, Turbopack) | 16.3.8 (2026-09-30) | 16.4.x after 2026-10-20 | MIT |
| Library/test host | Vite + @vitejs/plugin-react | 8.3.2 (2026-10-01) + 6.1.1 (2026-08-28) | 8.3.4 / 6.1.2 | MIT |
| UI runtime | React / React DOM / @types/react | 19.3.0 (2026-09-09) | 19.3.1 | MIT |
| 3D engine | three / @types/three | 0.186.1 (2026-09-24) / 0.186.0 (2026-09-11) | — | MIT |
| React renderer | @react-three/fiber | 9.8.1 (2026-09-24) | 9.8.2 | MIT |
| R3F helpers | @react-three/drei (selective) | 10.7.9 (2026-09-25) | — | MIT |
| VRM | @pixiv/three-vrm, @pixiv/three-vrm-animation | 3.5.5 (2026-07-09) | — | MIT |
| glTF IO | @gltf-transform/core, /functions, /extensions | 4.5.1 (2026-09-28) | — | MIT |
| Mesh compression | meshoptimizer | 1.3.0 (2026-09-25) | — | MIT |
| Validation | gltf-validator | 2.0.0-dev.3.10 (2024-10-22, only line) | — | Apache-2.0 |
| Document kernel | in-house `packages/doc` (op log, typed-array keys) | — | — | MIT (ours) |
| UI/session state | zustand | 5.0.15 (2026-08-13) | — | MIT |
| Collaboration (later) | yjs + y-protocols + y-websocket / Hocuspocus; yrs later | 13.6.33 / 1.0.7 / 3.1.0 | — | MIT |
| Docking | dockview-react | 8.4.0 (2026-09-30) | 8.6.0 | MIT (core) |
| Split panes inside panels | allotment | 1.20.5 | 1.20.6 | MIT |
| Virtual lists | @tanstack/react-virtual | 3.14.13 (2026-09-14) | 3.14.21 | MIT |
| Styling | tailwindcss + @tailwindcss/postcss | 4.3.3 (2026-07-16) | — | MIT |
| Primitives | radix-ui (via shadcn components we own) | 1.6.7 (2026-07-24) | 1.8.x | MIT |
| Component CLI (dev only) | shadcn | 4.21.1 (2026-10-01) | — | MIT |
| Icons | lucide-react + own glyph set | 1.50.0 (2026-10-02) | — | ISC |
| Language | TypeScript (native) | 7.0.2 (2026-07-08) | 7.1 (API) | Apache-2.0 |
| Lint | oxlint + oxlint-tsgolint | 1.86.0 (2026-09-28) + 7.0.2003 (2026-09-24) | 1.88 / 7.0.2004 | MIT |
| Format | @biomejs/biome (formatter only) | 2.5.15 (2026-09-30) | — | MIT/Apache-2.0 |
| Layering check | dependency-cruiser | 18.5.0 (2026-09-30) | — | MIT |
| Unit/bench | vitest | 5.0.3 (2026-09-30) | 5.0.5 | MIT |
| Property tests | fast-check | 4.10.2 (2026-09-19) | — | MIT |
| Browser tests | @vitest/browser-playwright | 5.0.3 | 5.0.5 | MIT |
| E2E | @playwright/test | 1.63.0 (2026-09-04) | 1.64.x after 2026-10-28 | Apache-2.0 |
| Package builds (when publishing) | tsdown | 0.23.0 (2026-09-03) | 0.23.1 | MIT |
| Worker RPC | in-house typed RPC (comlink 4.4.2 as fallback) | — | — | — |
| Project license | MIT + DCO | — | — | — |

---

## 15. Repository layout

```
ekza-animator/
├── apps/
│   ├── web/                         # Next.js 16 shell
│   │   ├── app/
│   │   │   ├── (site)/              # landing, docs links (RSC, no three.js)
│   │   │   ├── editor/              # page.tsx (RSC) → EditorIsland.tsx ('use client', ssr:false)
│   │   │   ├── embed/               # iframe route for Ekza Studio (postMessage contract)
│   │   │   └── api/                 # upload proxy, auth callback (dynamic deploy only)
│   │   ├── workers/io.worker.ts     # one line: import '@ekza-studio/io/worker'
│   │   ├── public/decoders/         # self-hosted draco / meshopt / basis transcoders
│   │   ├── e2e/                     # Playwright specs + screenshot baselines (Linux)
│   │   └── next.config.ts
│   └── playground/                  # Vite 8 host: embedding conformance, perf scenes, browser tests
├── packages/
│   ├── anim-core/                   # curves, tangents, evaluate, euler filter, resample, reduce (0 deps)
│   ├── doc/                         # schema, records, ops/applyOp, transactions, gestures, undo, migrations, io-json
│   ├── rig/                         # skeleton/humanoid (VRM map), controls, constraints, FK/IK, SoA pose buffers
│   ├── io/                          # gltf/glb/vrm/vrma import-export, append-only VRM bake, validate, worker + rpc
│   ├── viewport/                    # ViewportManager, cameras+nav, picking, control shapes, manipulators, overlays
│   ├── curve-editor/                # Canvas2D graph editor, dope sheet, time slider (renderers + controllers)
│   ├── editor/                      # React app: WorkspaceHost(dockview), panels, zustand stores, commands, keymap
│   ├── ui/                          # Tailwind v4 tokens, shadcn components, animation icon set
│   ├── collab/                      # LATER: Yjs binding (ops ↔ Y.Doc), awareness/presence
│   └── ekza/                        # LATER: Ekza registry client, typed asset profiles, upload flow
├── fixtures/                        # CC0 VRM/GLB/VRMA test assets + LICENSES.md
├── tooling/                         # tsconfig presets, dependency-cruiser rules, scripts (validate, license check)
├── docs/
│   ├── research/                    # 01..NN research inputs (this file)
│   ├── adr/                         # architecture decision records
│   └── architecture.md
├── .github/                         # workflows/ci.yml, ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md, renovate.json
├── package.json                     # packageManager: pnpm@11.28.3; scripts → turbo
├── pnpm-workspace.yaml              # packages, catalog:, minimumReleaseAge
├── turbo.json  tsconfig.base.json  .oxlintrc.json  biome.json  .nvmrc  .editorconfig
└── LICENSE  README.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  TRADEMARKS.md
```

### M0 spikes (1–2 days each, before feature work)

1. **Viewport spike:** single canvas, 4 viewports, 2 CC0 VRMs, `frameloop="demand"`, evaluate-once scheduler, analytic ring picking, GPU mesh picking. Measure against §1.
2. **Graph Editor spike:** Canvas2D with 50k keys. Pan/zoom/drag benchmark in Chrome and Safari. This decides Canvas2D vs. the WebGL curve layer.
3. **Toolchain spike:** Next 16 + Turbopack + workspace JIT packages + module worker from the host + TS 7 `tsc -b` + Oxlint type-aware + Vitest browser mode + Playwright SwiftShader on CI. Also test the static export build.
4. **Doc kernel spike:** ops, gestures and undo with property tests; a worker replica fed by the op stream; a bake request with no snapshot copy.

---

## 16. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| R3F 9 caps React minors (`<19.4`); a React bump can break the viewport | Renovate group; upgrade React only together with an R3F release |
| Three.js focus moves to WebGPU; R3F 10 still alpha | Overlays isolated, WebGPU-twin addons, `viewport` imperative so a renderer swap is local |
| TS 7 has no API (7.1 pending); some tools may need it | `@typescript/typescript6` alias; fallback toolchain in §10.2 |
| dockview open-core shift | `WorkspaceHost` adapter; FlexLayout as plan B |
| Canvas2D cannot reach 50k-key budgets in Safari | `CurveRenderer` interface; WebGL curve layer only |
| Browser-reserved shortcuts break desktop-DCC muscle memory | Remappable keymap, alternative presets, desktop wrapper later |
| Next static export cannot set headers or host APIs | The editor never depends on Next server features; uploads go direct to the Ekza API in static mode |
| SwiftShader may be removed entirely in a future Chromium | Run e2e also on a GPU runner (self-hosted or paid) for nightly screenshot runs |
| `gltf-validator` npm has had no release since 2024-10 | It is the Khronos reference; pin it; optionally run the CLI binary in CI |

Open questions for the owner:

1. npm scope for published packages: `@ekza/animator-*` (existing `@ekza` org) or a neutral scope, given the working name may change.
2. Hosted demo: Vercel (matches Ekza web) or a self-hosted container? Do we also want an IPFS static build for the Ekza ecosystem?
3. MIT vs Apache-2.0: is an explicit patent grant important for expected contributors?
4. Is a desktop wrapper (Tauri) in scope within 6 months? It changes keymap and file-system decisions.
5. Should selection changes be in the undo queue by default (the desktop DCC's behavior) or off?

---

## 17. Sources

Versions, release dates, licenses and peer ranges: npm registry (`https://registry.npmjs.org/<package>`), queried 2026-10-17; crates.io API for `yrs` (0.28.0).

- TypeScript 7.0 announcement (no API, `@typescript/typescript6`): https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- typescript-eslint and TS 7 peer range: https://github.com/typescript-eslint/typescript-eslint/issues/12518
- Next.js TypeScript config (TS 7 via `tsc` CLI): https://nextjs.org/docs/app/api-reference/config/typescript
- Next.js `useTypeScriptCli`: https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli
- Next.js static exports (unsupported features): https://nextjs.org/docs/app/guides/static-exports
- Next.js Turbopack reference (workers, magic comments, `turbopackWorkerAssetPrefix`, root): https://nextjs.org/docs/app/api-reference/turbopack
- Next.js `transpilePackages` (workspace packages auto-transpiled by Turbopack): https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages
- Next.js lazy loading (`ssr: false` only in Client Components): https://nextjs.org/docs/app/guides/lazy-loading
- Next.js 16.4 summary (third-party): https://alternativeto.net/news/2026/10/next-js-16-4-boosts-performance-with-turbopack-optimizations-and-react-19-3-integration/
- pnpm 12 release notes: https://pnpm.io/blog/releases/12.0 · pnpm 11: https://pnpm.io/blog/releases/11.0
- Oxlint type-aware linting stable: https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
- Oxlint React Compiler support: https://oxc.rs/blog/2026-08-18-react-compiler-support
- Oxfmt beta status: https://oxc.rs/blog/2026-02-24-oxfmt-beta
- Biome 2.5: https://biomejs.dev/blog/biome-v2-5/
- drei `View`: https://drei.docs.pmnd.rs/portals/view (implementation read from `@react-three/drei@10.7.9/web/View.js`)
- R3F loop API (`invalidate`, `advance`, `addEffect`): https://r3f.docs.pmnd.rs/api/additional-exports (types read from `@react-three/fiber@9.8.1`)
- R3F v10 alpha (WebGPU): https://newreleases.io/project/npm/@react-three/fiber/release/10.0.0-alpha.5
- three.js WebGPURenderer manual (WebGL feature freeze): https://threejs.org/manual/en/webgpurenderer
- three.js r186 sources: `examples/jsm/lines/LineSegments2.js` (raycast threshold), `src/renderers/WebGLRenderer.js` (`readRenderTargetPixelsAsync`, `matrixWorldAutoUpdate`), `src/renderers/webgl/WebGLObjects.js` (skeleton update per frame): https://github.com/mrdoob/three.js/tree/r186
- WebGPU browser support: https://web.dev/blog/webgpu-supported-major-browsers
- Chromium SwiftShader (deprecated fallback, opt-in flags): https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- dockview licensing (MIT vs Enterprise feature matrix): https://dockview.dev/docs/overview/licence
- FlexLayout: https://github.com/caplin/FlexLayout
- Turborepo boundaries (experimental): https://turborepo.com/docs/reference/boundaries
- Mutative vs Immer (vendor benchmark): https://mutative.js.org/docs/extra-topics/comparison-with-immer
- Safari `devicePixelContentBoxSize` (not implemented): https://bugs.webkit.org/show_bug.cgi?id=219005
- React Compiler ref-mutation warning: https://github.com/facebook/react/issues/29106
- shadcn Radix/Base UI choice (third-party summary): https://www.shadcnblocks.com/blog/introducing-base-ui-and-component-styles
- Node.js release schedule change: https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule · schedule table: https://github.com/nodejs/release
- Yjs Rust port: https://crates.io/crates/yrs
