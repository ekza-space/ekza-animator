# ADR 0017 — AI 3D generation boundary: server gateway, provider-agnostic contract, provenance by construction

- Status: Proposed (2026-10-18, revised 2026-10-19 after the design review, MODELING-PLAN §12). Items 7–8
  (provenance record, export block, lints) are **Accepted** (2026-10-19, with [M6A-SPEC](../M6A-SPEC.md) v1.0, which
  builds them in M6a: §4.2 `AssetProvenance`, §4.5 `ekza_model_v1` and the provenance lints); the rest is accepted
  when the M7 spec freezes.
- Inputs: research [15](../research/15-ai-3d-generation.md) (D1–D10, §5, §9), [14](../research/14-skinning-own-models.md)
  §9.5, §11, [13](../research/13-mesh-kernel.md) §5.17, [12](../research/12-lowpoly-workflow.md) L2–L3,
  [08](../research/08-extensibility-modeling.md) §8.2, [03](../research/03-ekza-reuse-audit.md); [MODELING-PLAN](../MODELING-PLAN.md)
  §3.11, §7; ADRs 0005, 0009, 0010, 0014, 0015.

## Context

After the modeling base (M6a) and characters from own models (M6b), the owner wants API-based 3D generation. Hosted
providers (Tripo, Meshy, Tencent HY 3D, Rodin, fal.ai) are asynchronous, paid per call, change models and modes
within months (Meshy retired `meshy-5` on 2026-10-10 and retires its `lowpoly` mode on 2026-10-30), and differ in
output ownership, training on inputs, retention and attribution duties. Providers state that keys must not be used
from browser JavaScript. Open-weight models carry licence traps (Hunyuan3D territory and MAU clauses; TRELLIS.2's
setup pulls NVIDIA rasterizer code under a non-commercial licence). The editor ships as a static export too
(`ANIMATOR_STATIC_EXPORT=1`), where no server code runs, and its first-visit route sits under a 900,000 B gate.
Generated meshes are dense, often non-manifold, mis-oriented and unrigged; the Ekza registry hashes
`asset.extras.<name>_v1` blocks; EU AI Act Art. 50 transparency duties apply from 2026-08-02.

## Decision

1. **Server-side generation behind one provider-agnostic contract, `ekza-gen/v1`.** The browser talks only to a
   gateway (same origin, or a URL fixed in the build config, with CORS). Provider adapters, keys, webhooks, job state
   and result downloads live on the server. No provider SDK, key name or provider origin appears in the client bundle
   (CI check). **`apps/web` sends no Content-Security-Policy today**; M7 package G-b adds one before BYO keys ship —
   response headers in server builds, a `<meta>` tag in static exports, `connect-src` listing `'self'` and the
   gateway origin from build config (a static export cannot reflect a gateway URL chosen at runtime, so static
   builds take the gateway origin at build time), and an e2e test of the policy. Until it lands, nothing here relies
   on a CSP.
2. **Packages**: `gen-core` (isomorphic types and job state machine; zero dependencies), `gen-gateway` (server-only
   Fetch-API handler `handle(req) → Response`: adapters, job store memory/SQLite/Postgres, blob store by SHA-256,
   webhook verifiers, fetcher with a per-adapter egress allow-list, quotas, redacting logger). Mounted as a Next route
   handler only in server builds (a dedicated page extension added by `next.config.ts` when not exporting statically,
   the technique `page.dev.tsx` already uses) or as a standalone `apps/gen-gateway`, and **off by default**: the route
   exists only with `GEN_GATEWAY_ENABLED=1` and either an auth (a shared bearer token from env, or a session once
   accounts exist) or a loopback-only bind; the server refuses to start when provider keys are set without auth; a
   test asserts 404 when the gateway is not enabled. Editor side:
   `EditorServices.generation?: GenerationClient | null` (null hides the feature), `gen.*` operators, a lazily loaded
   Generate panel and job tray.
3. **Keys and deployment modes, one code path**: self-hosted (keys from server env; the default for contributors and
   studios; **auth required**, see decision 2); BYO key (sent per request over HTTPS in a header, never persisted,
   redacted, and the UI says the gateway sees it); hosted platform key (only with Ekza accounts, M4b, per-user and
   global spend caps, a kill switch, and written provider confirmation that the integration is allowed under their
   resale terms). **BYO on a hosted Ekza gateway** sends users' keys to Ekza's server, and Tripo's terms say keys may
   not be sold or transferred, so it joins the written-confirmation list (Q-GEN-4) before it ships. Every mode has
   **server-side daily and monthly spend caps from env**, independent of the client's `maxCostUsd`. Static builds hide
   the panel or offer the gateway configured at build time.
4. **Results are untrusted bytes and enter through the normal import path**: download every artifact immediately
   (retention is 1–7 days), cap size, SHA-256, `AssetStore.put`, `io` input budgets and structural checks, validator,
   the existing GLB importer. Clients never send URLs (no SSRF); the gateway uploads its own stored bytes to providers.
   No special "AI asset" format.
5. **The post-processing chain is the modeling toolkit**: normalize (+Z forward, metres, origin at bottom centre),
   merge by distance, cleanup, reduce (meshoptimizer, index-only so UVs and weights stay valid), quadrangulate,
   symmetrize, normals, palette bake to per-face palette slots, then the M6b rig/skin or a provider rig imported through
   `char.makeEditable`. Every step is an undoable, adjustable `mesh.*`/`skin.*` operator usable by hand, by presets and
   by agents.
6. **Default rig for generated humanoids**: the provider's rig when it names bones by the VRM convention (Tripo rig
   `v3.0-20260909` with `spec: "vrm"`), otherwise Quick Rig + Auto (low-poly); geodesic voxel binding joins in M7 G2.
7. **Provenance by construction**: `AssetRecord.provenance { origin: 'imported' | 'generated' | 'authored',
   derivedFrom[], redistributable, generator }` (schema v3, ADR 0015) with `GeneratorProvenance` (kind `ai`, IPTC
   digital source type, service, **pinned** model version, op, params, input hashes, a snapshot of the provider's
   terms, raw-bytes hash, post steps; the provider task id stays in the document only). Exported in the hashed
   `asset.extras.ekza_model_v1.provenance.generator` block (deterministic, lowercase hex, no timestamps, no key named
   `uri`, no download URLs); prompt text only on the user's opt-in (default: its hash). Provider metadata and AI marks
   found in the source GLB are carried over, never stripped; because reduce and palette bake can destroy invisible
   watermarks in geometry or textures (Meshy's terms forbid removing them), those post steps record
   `aiMarksMayBeAltered: true`, and Meshy is asked under Q-GEN-4 whether that use is allowed. The user attests the
   provider tier (paid or free) at submit, since the API does not reveal it; free-tier outputs belong to the provider
   (Tripo) or come under CC BY (Meshy). VRM meta defaults (credit notation, third-party licences) are proposed from
   the terms and confirmed by the user.
8. **Lints** (ADR 0010 table shape): `ekza.provenance-ai-undisclosed` (error/error), `ekza.provenance-attribution`
   (warning/error), `ekza.provenance-territory` (warning/error until the registry decides), `ekza.provenance-free-tier`
   (warning on export; **error for a T3 publish** when the generation was free-tier or has no paid-tier attestation).
9. **Terms before submit**: the panel shows, per provider, output ownership, whether inputs train models, retention
   days, attribution and territory exclusions (`GenTerms`). Open-weight deployments: weights are downloaded at deploy
   time under their own licences and never vendored; the GPU worker image carries an SBOM and CI fails on a
   non-commercial licence in a commercial profile; Hunyuan3D open weights only as an operator opt-in with a geo-gate
   and the licence NOTICE; GPL tools (ComfyUI, Blender's `bpy`) only as separate processes, never linked into MIT
   packages.
10. **Cost and abuse controls**: quote before submit and refuse above the request's `maxCostUsd`; client idempotency
    keys; never re-POST after a create timeout (look the task up instead); per-provider concurrency below provider
    limits with a fair per-user queue; Tripo webhooks verified by HMAC over `t + "." + rawBody` with a 5-minute window
    and delivery dedupe; unsigned webhooks (Meshy) treated as hints and re-fetched; input images **re-encoded in the
    browser** before upload (`OffscreenCanvas` → PNG/WebP drops EXIF and GPS; `sharp` stays banned, ADR 0009), and the
    gateway verifies the image type and rejects files that still carry EXIF/XMP segments (or re-encodes with a WASM
    codec under the allowed licences); photo inputs need an attestation.
11. **Testing**: paid APIs are never called in CI; an in-repo mock provider server replays recorded state machines
    with scripted failures (401, 402, 429 with and without `Retry-After`, 5xx, moderation blocks, step-backs, create
    timeouts, expired URLs, bad or replayed signatures); real providers only in a manual smoke script with a spend cap.
12. **First adapters**: Tripo (default for characters: native low-poly, VRM-named rig, no training on paid users' data)
    and Meshy (default for props: cheapest clean low-poly path; second adapter that keeps the contract honest). Later:
    fal.ai, Tencent HY 3D cloud, Rodin, and a `selfhost` adapter speaking the same protocol to a GPU worker (TRELLIS.2,
    TripoSG, UniRig). Model versions are pinned in adapters and recorded in provenance; `latest` is never sent.

## Alternatives

| Alternative | Why not |
|---|---|
| Call provider APIs from the browser | Exposes keys to every extension and future plugin; providers forbid it; would force provider origins into the CSP that G-b adds |
| Gateway mounted in every server build with optional auth (v0.1) | Any reachable `next start` with a provider key set lets anyone spend the operator's credits; client-supplied `maxCostUsd` and per-user quotas do not stop an anonymous caller |
| One provider SDK built into the editor | Provider churn would ripple into the client; no BYO/self-host path |
| A dedicated "AI asset" type and pipeline | Two pipelines to secure and test; generated meshes must become ordinary editable meshes and characters anyway |
| Store provider download URLs or task ids in exports | URLs expire in days; task ids are provider-private; the registry rejects any key named `uri` |
| Reconstruct provenance at export time | Steps and terms are lost by then; provenance is written at import |
| Make Hunyuan3D open weights a default | Territory exclusion (EU, UK, South Korea), 1M-MAU cap and "no improving other models" clause are incompatible with an MIT project's default |
| Self-host only | Needs a ≥ 8–24 GB GPU per operator; hosted adapters give the turnkey path first |

## Consequences

- M6a carries only the provenance record, the export block and the four lints; the gateway, adapters, panel,
  intake operators and the app's first CSP are M7 work. Nothing generated is special downstream of import.
- The feature costs the first-visit route nothing (lazy chunk; the meshoptimizer WASM loads on demand).
- Prices and model names in research 15 are a 2026-10-18 snapshot; the M7 spec re-verifies them.
- Upstream proposals (owner decision): a registry `prop` kind and AI-provenance fields with a Studio badge.
- Legal context is shown, not decided: prompts alone may not make outputs copyrightable (US Copyright Office, Part 2,
  2025-01-29); the human edits made in the editor are what can carry authorship.
