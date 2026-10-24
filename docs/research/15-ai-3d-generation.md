# 15 — AI 3D generation: providers, open models and the integration architecture

> Research note for Ekza Animator. Date: 2026-10-18. Status: proposal for review; nothing here is decided until the
> owner accepts it.
> Scope: which hosted APIs and open-weight models can generate 3D assets for a **low-poly character and prop
> pipeline** (model → rig/skin → animate → export to Ekza), what they cost and allow, and how to integrate them into
> the Animator without putting provider keys in the browser, without bypassing our glTF pipeline and with provenance
> recorded on every asset. AI generation is scheduled **after** the modeling base and the rig/skin pipeline
> ([research 14](14-skinning-own-models.md)); this note fixes the contracts now so that the later integration is cheap.
> Sibling notes: the low-poly targets and palette model come from [research 12](12-lowpoly-workflow.md), the mesh
> kernel and its Reduce/Cleanup ops from [research 13](13-mesh-kernel.md) §5.17, the rig/skin hand-off from
> [research 14](14-skinning-own-models.md) §11.
> Method: provider documentation, pricing pages and terms read on 2026-10-18 (machine-readable docs where offered:
> Meshy `llms-full.txt`, Tripo `llms-full.txt`, Hyper3D docs, Tencent Cloud API reference); Hugging Face model-card
> metadata for open-weight licences; GitHub READMEs and licence files; read-only review of this repository
> (`EditorServices`, `AssetRecord`, `ClipProvenance`, `next.config.ts`). Prices and model names in this field change
> monthly (Meshy retired `meshy-5` on 2026-10-10 and retires `model_type: "lowpoly"` on 2026-10-30), so every number
> below carries its date. Items marked **(unverified)** come from secondary sources only.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|---|---|
| D1 | **Generation is a server-side service behind one provider-agnostic contract** (`ekza-gen/v1`). The browser talks only to a same-origin gateway; provider adapters, keys, webhooks and result downloads live on the server. | Providers say so explicitly ("Don't call the API from browser JavaScript. It exposes your API key", Meshy docs); keys in the page are readable by extensions and future plugins (research 08 §8.2 rule 1); CSP `connect-src 'self'` stays intact. |
| D2 | **First providers: Tripo (primary) and Meshy (second), both behind the same adapter interface.** | Tripo: native low-poly models (P1: 48–20,000 faces; P2: quads), auto-rig with a **VRM 1.0 skeleton convention** (`spec: "vrm"`, rig v3.0, 2026-10), HMAC-signed webhooks, and its terms say it does **not** train on paid users' inputs/outputs. Meshy: the cheapest clean low-poly path (Smart Topology `meshy-t2.5`, 100–30,000 triangles, 5 credits mesh-only), the best API documentation (OpenAPI spec, SSE, rate-limit headers, `consumed_credits`), rig 5 credits + animation 3 credits/action. Two adapters prove the abstraction. |
| D3 | **Self-hosted open path: TRELLIS.2 (MIT, image→PBR mesh) and TripoSG (MIT, geometry only, ≥ 8 GB VRAM) behind the same contract, UniRig (MIT) for non-humanoid rigging.** Hunyuan3D open weights are **opt-in only** with a territory gate. | TRELLIS.2 is the strongest open model whose licence has no territory, revenue or MAU clause. Hunyuan3D 2.x/Omni licences exclude the EU, UK and South Korea and cap at 1 M MAU, which an MIT project cannot make its default. Trap: TRELLIS.2's setup installs `nvdiffrast`/`nvdiffrec` under NVIDIA Source Code Licences whose §3.3 limits use to non-commercial (§3.3). |
| D4 | **Results enter through the normal import path**: download → SHA-256 → `AssetStore.put` → `io` budgets/validator → importer operator. No special "AI asset" format. | One pipeline to secure and test; generated assets become ordinary editable assets (modeling `MeshData`, characters, clips). |
| D5 | **The post-processing chain is built from the modeling tools, not a separate AI feature**: weld/merge by distance, prune, Reduce (meshoptimizer), soften/harden edges, palette bake to vertex colours, symmetrize, tris→quads, then the research-14 rig/skin. Every step is an undoable operator with an "adjust last operation" panel. | The owner asked for a modeling base first; these are *Mesh › Reduce / Cleanup / Merge / Soften-Harden / Quadrangulate / Apply Color* in a leading commercial desktop DCC ("the desktop DCC") and *Decimate / Merge by Distance / Tris to Quads / Symmetrize* in a popular open-source DCC ("the open-source DCC"). Building them once serves hand modeling and AI cleanup; research 13 §5.17 already plans this chain in `mesh-core`. |
| D6 | **Provenance is recorded by construction** on the asset record and exported in hashed `asset.extras.ekza_model_v1.provenance` (sibling of ADR 0010's `ekza_animation_v1`), with the provider's output terms, model version, input hashes and the post-processing steps. Provider metadata/watermarks in the GLB are preserved. | The Ekza registry hashes `asset.extras.<name>_v1`; curators and licences need the chain; Meshy's terms forbid removing AI-identifying metadata; EU AI Act Art. 50 marking duties apply from 2026-08-02 (to providers; we must not strip their marks). |
| D7 | **Three deployment modes, one code path**: self-hosted OSS (keys from server env), hosted Ekza (platform key + per-user quota, needs accounts, M4b), and BYO key (sent per request to the gateway, never stored, redacted from logs). The static export build has no gateway: the Generate panel offers "connect a gateway URL" or stays hidden. | `ANIMATOR_STATIC_EXPORT=1` builds cannot run route handlers; the OSS build must work without any Ekza account. |
| D8 | **Low-poly first, with native low-poly modes preferred over decimating dense output.** Presets: Prop ≤ 500 triangles, Character ≤ 3,000, Hero ≤ 10,000; palette ≤ 16 colours by default. | Decimated 500k-triangle scans look "melted"; Tripo P1/P2, Meshy T2/T2.5, Hunyuan LowPoly and Rodin Quad presets already target game budgets. |
| D9 | **Never hit paid APIs in CI.** A mock provider server replays recorded state machines (including `banned`, 402, 429, expired URLs, bad webhook signatures); real-provider smoke tests run manually with a spend cap. | Cost, flakiness, and provider terms. |
| D10 | **Pin provider model versions in adapters** (`P1-20260311`, `meshy-t2.5`, rig `v3.0-20260909`) and record them in provenance; `latest` is never sent. | Providers silently upgrade `latest` and retire versions within months. |

---

## 1. What generation gives a low-poly character pipeline in 2026, and what it does not

**Gives.** A textured mesh from one image (or 2–5 views, or text) in 4 s – 4 min; optional PBR maps with baked
lighting removed (Meshy `remove_lighting`, Tripo `delight`, both default on); **native low-poly output with a face
budget** (Tripo P1/P2, Meshy Smart Topology, Hunyuan `LowPoly`, Rodin `Quad` presets); rest-pose conditioning for
humanoids (Meshy `pose_mode: t-pose|a-pose`, Rodin `TAPose`, Tripo's image template `t_pose` before 3D); automatic
humanoid rigs (Meshy, Tripo, Hunyuan cloud) and preset animation libraries.

**Does not give** (our tool's job):

| Gap | Why it matters for Ekza | Where we fix it |
|---|---|---|
| Exact, consistent budgets and style across a set | Ekza packs need a coherent look (palette, density) | post chain presets, palette bake (§5.9) |
| Clean deformation loops at shoulders, elbows, knees | Skinning quality; generated low-poly tends to put edges arbitrarily | modeling tools (edge loops, symmetrize) and research 14 weights |
| Correct axes, units, facing, origin | Tripo exports **X-forward by default** (`export_orientation: "+x"`); glTF and VRM 1.0 face +Z; Meshy rigging requires +Z | normalize step on import |
| Clean manifold topology | Generators leave holes and fused parts (TRELLIS.2's card notes "small holes or minor topological discontinuities") | cleanup ops; regenerate |
| Ekza-valid containers | Provider GLBs may require Draco/meshopt; OMOBA allows only `KHR_materials_unlit`, `KHR_texture_transform` in `extensionsRequired` | our writers + existing `ekza.*` lints (ADR 0010) |
| Humanoid mapping, slot clips, VRM meta | Space and OMOBA profiles | research 14 + existing M2a animation tools |
| Licence and provenance chain | Registry curation, attribution duties | §5.10 |

Quads: glTF has no quad primitive. Quad outputs arrive as FBX (Tripo H-series forces FBX when `quad: true`) or OBJ;
via GLB they are triangulated. To keep quads in the editor we either import OBJ (small, MIT-friendly reader), import
FBX (M2b), or re-quadrangulate triangles (*Tris to Quads* / *Quadrangulate*, an angle-threshold pairing pass) after
import. Recommendation: re-quadrangulate on import (one code path for every provider) and add OBJ import later.

---

## 2. Hosted APIs (verified 2026-10-18)

### 2.1 Comparison

Prices are per request at the provider's published credit price. Meshy's API needs a paid plan; its credit costs
$0.0125–$0.02 depending on plan (Pro $20/1,000 credits … Ultra $100/8,000). Tripo international sells credits at
$0.01. Tencent HY 3D Global postpaid is $0.02/credit, prepaid packs $0.0135–$0.015.

| Provider (API) | Inputs | Low-poly control | Quads | Rig / animation | Typical latency | Price examples | Retention | Output terms | Trains on your data |
|---|---|---|---|---|---|---|---|---|---|
| **Tripo** (`openapi.tripo3d.ai/v3`) | text, image, multiview | **P1** native low-poly 48–20,000 faces; **P2** 48–50,000 tri / 48–25,000 quad; H3.1 + `smart_low_poly` 500–20,000 tri / 500–10,000 quad; retopology v3.0 500–20,000 | P2 `quad`; H-series `quad` (+5, forces FBX); retopology quad | rig-check (free), rig 25 cr: biped + quadruped/hexapod/octopod/avian/serpentine/aquatic/others, skeleton specs `tripo, actorcore, unity, unreal, vrm` plus one named after a web auto-rigging service (v3.0); retarget 10 cr/clip (11 presets on rig v2.5, 90+ biped on v1.0) | P1 ~10 s geometry, ~60 s textured; H3.1 ~40 s; rig ~30 s; retarget ~5 s | P1 image→3D 40/50/60 cr ($0.40–0.60); H3.1 image 20/30 cr, +10 smart low-poly; P2 100–130 cr | signed URLs; task can reach `expired` | **paid users hold all rights**; free users: Tripo retains rights | **no** for paid users (terms §5.2.2) |
| **Meshy** (`api.meshy.ai/openapi`) | text, image, 1–4 images | **Smart Topology** `meshy-t2` 100–15,000 / `meshy-t2.5` 100–30,000 triangles (default 15,000); remesh 100–300,000; `decimation_mode` 1–4 | remesh `topology: quad` (Smart Topology is triangle-only) | rig 5 cr (textured humanoid, ≤ 300,000 faces, +Z facing when sent by URL, `height_meters`), returns walk/run; animation 3 cr/action, ≤ 10 actions per request; text-to-motion 3/10 cr | medians Sept 2026: T2 image→mesh 4 s, +2K texture 60 s; 7.1 textured 2 min; rig 40 s; animation 15 s; remesh 2 min | T2.5 image mesh 5 cr, +2K tex 15 cr ($0.19–0.30); 7.1 textured 30 cr; remesh/UV 5 cr | **3 days** (API, non-Enterprise) | paid: you own output; free plan: Meshy owns, CC BY 4.0 to you | **yes** for non-Enterprise (terms §2.9) |
| **Tencent HY 3D Global** (Tencent Cloud, `ap-singapore`, `na-siliconvalley`) | text, image, multiview (left/right/back; more on 3.1) | `GenerateType: LowPoly` with `PolygonType: triangle / quadrilateral` (model 3.0 only); `FaceCount` 3,000–1,500,000 | LowPoly quadrilateral | post-processing: auto rigging 10 cr, smart topology 50, UV 10, parts 30 | not published | Normal 25 cr, LowPoly 30, Geometry 15, +PBR/+multiview/+FaceCount 10 each; Express 15 | JobId valid 24 h | see Tencent Cloud terms (not reviewed in depth) | not reviewed |
| **Hyper3D Rodin** (`api.hyper3d.com/api/v2`) | 1–5 images, text | `quality` presets: Quad 4,000/8,000/18,000/50,000; Raw 20k–1M; `quality_override` 500–2,000,000 (Quad ≤ 200,000) | `mesh_mode: Quad` | none in API | "Fast mode" for Raw GLB ≤ 20,000 faces; times not published | Gen-2.5 base **0.5 credit**; API only on Business ($120/month, "about 416 models") ≈ $0.29/model; direct credits $1.5 | **7 days**, API policy dated 2026-08-03 | paid plans: "broader export and usage rights" | **no** (API data retention policy) |
| **Stability** Stable Fast 3D (platform API) | image | remesh triangle/quad + target vertex count (open repo) | yes (repo option) | none | sub-second model | Fast 3D 10 credits (price list effective 2025-08-01) | n/a | platform terms (not reviewed) | not reviewed |
| **Sloyd** (`api.sloyd.ai/api`) | text, image, multi-image | `targetFaceCount` up to 500,000; procedural/parametric generators; T-pose | quads +5 cr | none | not published | image→3D 10 cr + texture 10 (+5 text, +10 multi-image) at 75 cr/USD → ~$0.27 | not stated | API output terms not found (web-app paid plans: commercial licence) | not reviewed |
| **fal.ai** (aggregator, queue API + `fal_webhook`) | per hosted model | hosts Tripo H3.1/P2, Meshy 6/7/7.1, Rodin 2.5, Hunyuan 3.1 pro/rapid/**smart-topology**/part, TRELLIS/TRELLIS.2, SAM 3D | per model | per model | per model | TRELLIS.2 $0.25/0.30/0.35 (512/1024/1536); Hunyuan v3 $0.375, LowPoly $0.45, geometry $0.225, +$0.15 per add-on | per fal | upstream terms + fal terms | per fal |
| Anything World | static model → rig + animate | n/a | n/a | rig + animate (Unity-centric) | n/a | tiers with revenue caps: $0 (<$100k), $50 (<$200k), $250 (<$4M) /month | — | — | — |
| Kaedim | image | artist-in-the-loop | — | — | hours, not seconds | enterprise-only API (unverified figures) | — | — | — |
| CSM, Luma Genie, Masterpiece X | — | — | — | — | — | **excluded**: CSM's site was unreachable from the research network and third-party claims (incl. an acquisition) are unverified; Luma's current API docs list only video/image models; Masterpiece X now sells "WorldEngen", an agentic scene tool, with no public generation API found | — | — | — |

API shapes, all asynchronous:

- **Meshy**: `POST` returns `202 {"result": "<task_id>"}`; poll `GET …/{id}` (honour `Retry-After`, default 5 s),
  stream `GET …/{id}/stream` (SSE), or webhooks (max 5 per account, HTTPS only, **no signature documented**, auto-
  disabled after repeated failures). States `PENDING → IN_PROGRESS → SUCCEEDED | FAILED` (failed tasks refunded;
  credits charged at creation; a task may step back from `IN_PROGRESS` to `PENDING`). Rate limits: 20 req/s, 10
  queued tasks on Pro (30 Premium, 100 Ultra). "Wait at least 60 minutes" before giving up; a POST that times out
  must **not** be resent (it creates a second paid task). `DELETE` on an `IN_PROGRESS` task returns 409 since
  2026-09-11. Signed download URLs expire with the task; reference earlier tasks by `input_task_id`, never by a
  stored URL. `moderation: true` screens inputs.
- **Tripo**: `POST /v3/generation/{text|image|multiview}-to-model`, `/v3/animations/{rig-check,rig,retarget}`,
  `/v3/mesh/{decimate,segment,complete,uv}`; `GET /v3/tasks/{id}`; envelope `{code, data}`. States `queued, running,
  success, failed, banned (content policy), expired, cancelled`; credits frozen at creation, refunded on failure or
  cancel. Webhooks `task.completed`, `task.failed`, `balance.low`, signed `Tripo-Webhook-Signature: t=<unix>,v1=<hex>`
  = HMAC-SHA256 over `t + "." + rawBody`, idempotency by `Tripo-Webhook-Delivery`. Concurrency 10 per category by
  default, P-series 3. File upload via presigned PUT (30 min). Separate China site with CNY billing; the
  international console is `developers.tripo3d.ai`.
- **Tencent HY 3D Global**: Tencent Cloud API 3.0 actions `SubmitHunyuanTo3DProJob` / `…RapidJob` + query; 3
  concurrent Pro jobs (extra concurrency $5,000/month each); 20 req/s.
- **Rodin**: multipart `POST /api/v2/rodin` → `uuid` + `jobs.subscription_key`; poll status with the subscription
  key, download with the uuid; `API_PARALLELISM_LIMIT_REACHED` on overload; always send an explicit Gen-2.5 `tier`
  (omitting it silently falls back to Gen-1/1.5).

### 2.2 Provider notes that change the design

- **Tripo's rig `spec: "vrm"`** (rig v3.0, Oct 2026) names bones by VRM 1.0 humanoid convention. Combined with our
  humanoid mapper this is the shortest path to an Ekza Space avatar. Its retarget presets (`idle, walk, run, jump,
  slash, hurt, …`) overlap the Ekza slot vocabulary but we do not need them: animating is the product.
- **Meshy's rig needs a textured humanoid ≤ 300,000 faces (facing +Z when sent by URL)**, so order matters: generate textured →
  rig → then reduce, or reduce in our tool and rig with research 14. Index-only reduction keeps skin weights valid
  (§5.9), so either order works.
- **Meshy terms**: "The Service may include machine-readable metadata, digital watermarks, or other identifiers in
  Customer Output … You agree not to remove … such identifiers"; non-Enterprise inputs/outputs may be used for
  training (§2.9); API output deleted after 3 days (§2.5); prohibited: reselling or redistributing access to the
  Service (§2.6 (v)), PII in inputs (§2.2), and the AUP bars using the service for a competing product. A hosted
  Ekza deployment that pays Meshy and serves many users needs written confirmation that this is an allowed
  integration (open question Q4).
- **Tripo terms** (updated 2025-07-11): free users' inputs/outputs belong to Tripo; paid users hold all rights and
  Tripo "will not use Inputs and Outputs as training data"; API credits are prepaid and non-refundable; keys may not
  be sold or transferred.
- **Rodin API retention policy** (2026-08-03): payloads and output kept 7 days, not used to train, not published.
  The strongest privacy terms, but API access starts at $120/month and there is no rig endpoint.
- **Hunyuan cloud** offers rigging and smart topology as post-processing; LowPoly is unavailable on model 3.1.
- **fal.ai** is the pragmatic "one key, many models" adapter for BYO users and for TRELLIS.2 without our own GPU;
  it loses provider-specific endpoints we care about (Tripo rig `spec`, Meshy animation library).

---

## 3. Open-weight models (verified 2026-10-18)

| Model | Code / weights licence | Use limits | Input → output | Hardware, speed | Notes and traps |
|---|---|---|---|---|---|
| **TRELLIS.2-4B** (Microsoft, HF card created 2025-12) | MIT / MIT | none in the licence | image → mesh with PBR (base colour, roughness, metallic, opacity) | Linux, NVIDIA ≥ 24 GB (A100/H100 tested); H100: ~3 s at 512³, ~17 s at 1024³, ~60 s at 1536³ | image-only (no text); `setup.sh` installs `nvdiffrast` v0.4.0 and `nvdiffrec`, both NVIDIA Source Code Licence: "The Work and any derivative works thereof only may be used or intended for use non-commercially" (§3.3). A commercial self-host must confirm which export path calls them and replace the rasterizer/baker or obtain an NVIDIA licence. |
| TRELLIS (v1, image-large; text variants) | MIT / MIT | as above | image or text → mesh/GS | ~16 GB (unverified) | superseded by TRELLIS.2; same rasterizer trap |
| **TripoSG** (VAST, 2025-03) | MIT / MIT (HF) | none | image (and scribble variant) → **untextured** GLB | ≥ 8 GB VRAM | `--faces` caps the face count; pairs well with our palette/vertex-colour bake for flat-colour low-poly |
| TripoSF (VAST) | MIT / MIT | none | shape refinement (sparse high-res) | — | not needed for low-poly |
| TripoSR (VAST + Stability, 2024) | MIT / MIT | none | image → coloured mesh | fast | legacy quality |
| **Stable Fast 3D**, SPAR3D (Stability) | Stability AI Community Licence (gated) | licence terminates above **$1 M annual revenue** | image → UV-textured mesh, remesh `triangle / quad`, target vertex count | ~6 GB VRAM; **runs on Apple MPS** (experimental) | good local dev/test model on a Mac; not a default for commercial hosting |
| InstantMesh (TencentARC, 2024) | Apache-2.0 | none in the licence | image → mesh | — | uses nvdiffrast for FlexiCubes rendering (same trap); legacy |
| **Hunyuan3D 2.0 / 2.1 / 2mini / Omni** (Tencent) | Tencent Hunyuan 3D Community Licence | **Territory excludes the EU, UK and South Korea** ("use outside the Territory is unlicensed"); > 1 M MAU needs Tencent's permission; Outputs may not be used "to improve any other AI model"; hosted services must name the actual provider and state Tencent is not affiliated; a NOTICE file on distribution | text/image/multiview → textured PBR mesh; Omni adds pose/bbox/point controls | 2.1: shape 10 GB, texture 21 GB, both 29 GB | Tencent claims no rights in Outputs. Hunyuan 3.0/3.1 are cloud-only (open release "planned" per press, not found) |
| Step1X-3D (StepFun, 2025-05) | Apache-2.0 | none | image → geometry + SD-XL texture (cartoon/sketch/photo styles) | not captured | candidate second open model |
| Direct3D-S2 | MIT (HF) | none | image → high-res geometry | — | high-poly focus |
| SAM 3D Objects (Meta, 2025-11) | SAM Licence (gated) | read the licence before any use | photo → object reconstruction (splats/mesh) | — | reconstruction of real objects, not stylized generation |
| **UniRig** (VAST, SIGGRAPH 2025) | MIT / MIT (HF) | none | mesh (`.obj/.fbx/.glb/.vrm`) → skeleton + skin weights (humans, animals, objects) | ≥ 8 GB VRAM | optional `bpy` (the open-source DCC's Python module, GPL) for the VRM add-on: keep it inside the worker container, never in MIT packages |

Licence rules for the self-host path: (1) weights are downloaded at deploy time under their own licences, never
vendored into this repository or its Docker images; (2) the worker image's SBOM lists native dependencies with
licences (nvdiffrast, flash-attn, spconv, …) and CI fails on a non-commercial licence in a "commercial" profile;
(3) the provider descriptor (`GenTerms`, §5.4) carries `territoryExcluded` and `restrictions`, so a Hunyuan
deployment can geo-gate and the export lints can warn.

---

## 4. Cost per accepted asset (planning numbers, 2026-10-18)

Generation is stochastic; plan for **2–4 candidates per accepted asset** (planning assumption, to be measured in G1).

| Pipeline for one low-poly textured humanoid | Provider credits | Cost per candidate | Cost per accepted (×3) |
|---|---|---|---|
| Tripo P1 image→3D standard texture + rig (VRM spec), animate in Ekza Animator | 50 + 25 | $0.75 | ~$2.25 |
| Tripo H3.1 image→3D + smart low-poly + rig | 30 + 10 + 25 | $0.65 | ~$1.95 |
| Meshy T2.5 image→3D + 2K texture + rig | 15 + 5 | $0.25–0.40 | ~$0.75–1.20 |
| Tencent HY 3D Global LowPoly + PBR + auto rig (postpaid) | 30 + 10 + 10 | $1.00 | ~$3.00 |
| Rodin Gen-2.5 Quad (Business plan amortized), rig in our tool | 0.5 | ~$0.29 | ~$0.87 + $120/month floor |
| Self-host TRELLIS.2 1024³ on one H100 + our reduce + our rig | — | ~17 GPU-seconds | GPU-hour price × 17 s × 3, plus idle time |

Props skip the rig. Provider preset clips (Meshy 3 credits/action, Tripo 10/clip) are optional: the M2a tools exist to
author clips, and provider clips carry their own provenance (§5.10).

---

## 5. Integration architecture

### 5.1 Principles

1. Keys never reach the browser, the document, the project file, plugins or logs.
2. One provider-agnostic contract; adapters are server code, capability-described, version-pinned.
3. Results are untrusted GLB bytes: same budgets, validator and structural checks as user imports (ARCHITECTURE §7, §16).
4. Provenance is written at import time, not reconstructed at export time.
5. Every generation, import and post step is an operator: undoable, attributable (`origin: 'gen:<provider>'`),
   scriptable and usable by agents through the operator registry (research 08 D4).
6. The editor works fully without generation; the feature is a lazily loaded chunk (the editor route is at the
   900 kB gzip budget, ROADMAP M-2).

### 5.2 Topology

```
Browser (editor, same origin)                 Gateway (server, Node 24)                     Outside
┌──────────────────────────────┐   /api/gen/v1   ┌───────────────────────────────────┐  HTTPS   ┌──────────────┐
│ Generate panel, job tray     │ ──────────────► │ auth / BYO key header / quotas    │ ───────► │ Tripo        │
│ editor-core ops: gen.*       │  SSE progress   │ job store (memory|SQLite|Postgres)│ ───────► │ Meshy        │
│ GenerationClient (service)   │ ◄────────────── │ scheduler: per-provider limits    │ ───────► │ HY 3D, Rodin │
│ AssetStore (sha256)          │  artifacts by   │ adapters: tripo, meshy, hunyuan,  │ ───────► │ fal.ai       │
│ io: budgets → importer op    │  sha256         │   rodin, fal, selfhost            │ ───────► │ GPU worker   │
│ post chain ops (worker)      │                 │ webhooks /v1/hooks/:provider      │ ◄─────── │ (TRELLIS.2,  │
└──────────────────────────────┘                 │ fetcher: download → sha256 → blob │          │ TripoSG,     │
                                                 │ blob store (FS | S3/R2, by hash)  │          │ UniRig)      │
                                                 └───────────────────────────────────┘          └──────────────┘
```

Packages (new):

| Package | Runs in | Contents | Depends on |
|---|---|---|---|
| `@ekza-studio/gen-core` | browser + server | types (`GenRequest`, `GenJob`, `GenCapabilities`, `GenTerms`, `GeneratorProvenance`), state machine, JSON schemas for params, cost formatting | nothing (zero deps, like `anim-core`) |
| `@ekza-studio/gen-gateway` | server only | Fetch-API handler `handle(req: Request): Promise<Response>`, adapters, job store and blob store interfaces, webhook verifiers, fetcher, quotas, redacting logger | `gen-core`; no React, no three |
| post chain = `@ekza-studio/mesh-core` operators (research 13 §5.17) | worker for heavy jobs (research 13 K9) + Node tests | normalize, weld, prune, reduce, normals, palette bake, budget report | `meshoptimizer` 1.3.0 (MIT, lazy Wasm), `@gltf-transform/*` 4.5.1 (already pinned) |
| editor panel + ops | browser | Generate panel, job tray, `gen.*` operators, `GenerationClient` (HTTP + SSE) | `editor-core`, `gen-core` |

Mounting: in server builds, `apps/web/app/api/gen/[...path]/route.ts` re-exports the gateway handler
(`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`). Static export cannot contain dynamic route handlers, so the file
uses a dedicated extension (for example `route.gen.ts`) that `next.config.ts` adds to `pageExtensions` only when
`ANIMATOR_STATIC_EXPORT !== '1'` — the same technique the repository already uses for `page.dev.tsx`. For Ekza's
hosted deployment the same handler runs as a standalone service (`apps/gen-gateway`) so the editor can stay on a CDN.

### 5.3 Deployment modes

| Mode | Who pays | Key location | Auth | Webhooks | Notes |
|---|---|---|---|---|---|
| Self-hosted OSS (`pnpm dev`, `next start`, Docker) | the operator | server env (`TRIPO_API_KEY`, `MESHY_API_KEY`, …; never `NEXT_PUBLIC_*`) | ~~none or basic~~ *revised (ADR 0017 §2–§3): the gateway is off unless `GEN_GATEWAY_ENABLED=1`, and then needs a shared bearer token or session, or a loopback-only bind; startup refuses keys without auth; server-side daily/monthly caps from env* | off by default (localhost is unreachable); polling | default for contributors and studios |
| Hosted Ekza, platform key | Ekza | secret manager | Ekza session (M4b) | on (`GEN_PUBLIC_URL`) | per-user daily credit cap, global monthly cap, kill switch; needs provider confirmation for resale (Q4) |
| Hosted Ekza, BYO key | the user | browser memory → `X-Gen-Provider-Key` header per request over HTTPS → adapter; never persisted, redacted | Ekza session or anonymous with rate limit | polling | the gateway still sees the key: say so in the UI; Tripo's terms forbid transferring keys, so this mode needs the written confirmation of Q4 first |
| Static export (Pages, IPFS) | — | — | — | — | panel hidden, or a gateway configured **at build time**; the gateway must allow that origin via CORS, and the build's meta-tag CSP lists it (a static export cannot reflect a URL chosen at runtime). *Note: `apps/web` has no CSP yet; M7 G-b adds it* |
| Local GPU worker | the operator | none (worker on a private network) | shared secret between gateway and worker | worker → gateway callback | `selfhost` adapter speaks the same protocol (§5.5) |

### 5.4 Contracts (sketch)

```ts
// gen-core (isomorphic)
export type GenOp = 'text-to-model' | 'image-to-model' | 'multiview-to-model'
  | 'texture' | 'retopology' | 'rig-check' | 'rig' | 'retarget';
export type JobState = 'queued' | 'running' | 'fetching' | 'succeeded' | 'failed' | 'blocked' | 'canceled' | 'expired';

export interface GenCapabilities {
  readonly ops: readonly GenOp[];
  readonly maxImages: number;                                       // 1 = single image; 4 = multiview
  readonly lowPoly: null | { readonly native: boolean; readonly tris: readonly [number, number];
                             readonly quads: readonly [number, number] | null };
  readonly texture: readonly ('none' | 'color' | 'pbr')[];
  readonly restPose: readonly ('t' | 'a')[];
  readonly rig: null | { readonly types: readonly ('biped' | 'quadruped' | 'other')[];
                         readonly skeletons: readonly ('vrm' | 'autorig' | 'native')[] };  // 'autorig' = common auto-rigger names
  readonly forward: '+z' | '+x' | 'auto';                           // provider's default facing, normalized on import
  readonly typicalSeconds: Partial<Record<GenOp, number>>;          // shown in the UI, never used as a timeout
}

export interface GenTerms {
  readonly outputLicense: string;           // SPDX id or LicenseRef-*, e.g. 'LicenseRef-Tripo-Paid-Output'
  readonly termsUrl: string;                // never a key named `uri` (registry rule, ADR 0010)
  readonly ownership: 'user' | 'provider-cc-by' | 'provider' | 'unclear';
  readonly trainsOnInputs: boolean | 'unknown';
  readonly retentionDays: number | null;
  readonly attribution: string | null;      // credit line when required
  readonly territoryExcluded: readonly string[];   // e.g. ['EU', 'GB', 'KR'] for Hunyuan open weights
  readonly restrictions: readonly ('keep-ai-marks' | 'no-competing-models' | 'no-improve-other-models'
                                   | 'revenue-cap-1m' | 'mau-cap-1m')[];
}

export interface GenRequest {
  readonly provider: string;                // 'tripo' | 'meshy' | 'hunyuan-cloud' | 'rodin' | 'fal' | 'selfhost:trellis2'
  readonly op: GenOp;
  readonly prompt?: string;
  readonly images?: readonly { readonly uploadId: string; readonly view?: 'front' | 'back' | 'left' | 'right' }[];
  readonly source?: { readonly sha256: string };                   // texture / retopology / rig input
  readonly params: {
    readonly faceLimit?: number; readonly quad?: boolean; readonly texture?: 'none' | 'color' | 'pbr';
    readonly textureSize?: 1024 | 2048 | 4096; readonly restPose?: 't' | 'a'; readonly seed?: number;
    readonly symmetric?: boolean; readonly skeleton?: 'vrm' | 'native'; readonly heightMeters?: number;
    readonly extras?: Readonly<Record<string, string | number | boolean>>;  // validated per adapter schema
  };
  readonly idempotencyKey: string;          // client-generated; resubmits return the same job
  readonly maxCostUsd: number;              // refused when the quote exceeds it
}

export interface GenArtifact {
  readonly role: 'model' | 'rigged' | 'animation' | 'thumbnail';
  readonly sha256: string; readonly size: number; readonly mime: 'model/gltf-binary' | 'image/png' | 'image/webp';
  readonly fileName: string;
}

export interface GenJob {
  readonly id: string; readonly provider: string; readonly op: GenOp; readonly state: JobState;
  readonly progress: number | null; readonly typicalSeconds: number | null; readonly createdAt: string;
  readonly quoteUsd: number; readonly costUsd: number | null;       // actual, from consumed_credits / credits_consumed
  readonly error: null | { readonly code: 'moderation' | 'insufficient-credits' | 'rate-limited' | 'invalid-input'
                                        | 'provider-failed' | 'expired' | 'timeout' | 'gateway';
                           readonly message: string; readonly retryable: boolean };
  readonly artifacts: readonly GenArtifact[];
  readonly provenance: GeneratorProvenance | null;
}

// gen-gateway (server only)
export interface ProviderAdapter {
  readonly id: string; readonly label: string; readonly version: string;     // adapter version
  readonly capabilities: GenCapabilities; readonly terms: GenTerms;
  readonly paramSchema: object;                                              // JSON Schema for GenRequest.params
  quote(req: GenRequest): { readonly credits: number; readonly usd: number; readonly exact: boolean };
  submit(req: GenRequest, ctx: AdapterContext): Promise<{ readonly taskId: string }>;
  status(taskId: string, ctx: AdapterContext): Promise<ProviderStatus>;      // mapped state, progress, retryAfter
  verifyWebhook?(raw: Uint8Array, headers: Headers, ctx: AdapterContext): Promise<{ readonly taskId: string } | null>;
  cancel?(taskId: string, ctx: AdapterContext): Promise<'canceled' | 'too-late' | 'unsupported'>;
}
export interface AdapterContext {
  readonly key: string;                                                      // from env, vault or BYO header
  readonly fetch: typeof fetch;                                              // egress allow-list enforced here
  uploadInput(uploadId: string): Promise<{ readonly providerRef: string }>;  // provider file upload, never a client URL
  readonly log: RedactingLogger; readonly signal: AbortSignal;
}
```

Client side, `EditorServices` gains `readonly generation?: GenerationClient | null` (same optional-service pattern as
`autosave`); `null` hides the feature. Operators: `gen.quote`, `gen.submit`, `gen.cancel`, `gen.retry`,
`gen.import`, `gen.post.<step>`; the import operator calls the existing `gltf-model` importer with a provenance
argument.

### 5.5 Gateway HTTP API (`ekza-gen/v1`)

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /v1/providers` | adapters with capabilities, terms, typical times, BYO allowed | drives the panel; no secrets |
| `POST /v1/uploads` | input image upload | ≤ 20 MB (Meshy's limit), ~~re-encoded to PNG/WebP server-side~~ re-encoded to PNG/WebP **in the browser** (`OffscreenCanvas`; `sharp` is banned by ADR 0009) and verified server-side (type check, files with EXIF/XMP segments rejected), **EXIF and GPS stripped**, `uploadId` returned; images of real people require an attestation flag (Meshy forbids PII in inputs) |
| `POST /v1/quote` | cost estimate for a `GenRequest` | credits and USD, `exact` flag |
| `POST /v1/jobs` | create a job | idempotent by `idempotencyKey`; refuses when quote > `maxCostUsd` or quota exhausted |
| `GET /v1/jobs?mine` | list the caller's jobs | lets a reloaded editor resume |
| `GET /v1/jobs/:id` | job snapshot | `GenJob` |
| `GET /v1/jobs/:id/events` | SSE: state, progress, artifacts ready | falls back to polling |
| `DELETE /v1/jobs/:id` | cancel | maps provider rules (Meshy refunds only `PENDING`) |
| `GET /v1/artifacts/:sha256` | download bytes | same origin; caller must own a job that produced it |
| `POST /v1/hooks/:provider` | provider callbacks | Tripo: HMAC verified, 5-min replay window, dedupe by delivery id; Meshy (unsigned): payload treated as a hint, task re-fetched with the key |

The `selfhost` adapter talks to a GPU worker with the same verbs (`POST /jobs`, `GET /jobs/:id`, artifacts by hash),
so TRELLIS.2/TripoSG/UniRig plug in without new client code. ComfyUI (GPL-3.0) may sit behind the worker as a separate
process; it is never linked into MIT packages.

### 5.6 Job lifecycle and queue

| Ours | Meshy | Tripo | Rodin / HY 3D | Gateway action |
|---|---|---|---|---|
| `queued` | `PENDING` | `queued` | submitted | wait (webhook, SSE upstream or poll with `Retry-After`, 5 s default, jittered backoff to 30 s) |
| `running` | `IN_PROGRESS` (may step back to `PENDING`) | `running` | running | forward `progress` 0–100 |
| `fetching` | `SUCCEEDED` | `success` | done | download every artifact **immediately** (Meshy 3 days, Rodin 7 days, HY JobId 24 h, signed URLs), cap size, SHA-256, store by hash, run the GLB structural check |
| `succeeded` | — | — | — | artifacts and provenance available |
| `blocked` | `FAILED` with moderation reason | `banned` | `IMAGE_CONTENT_VIOLATION` / risk control | show the provider's policy link; no automatic retry |
| `failed` | `FAILED` | `failed` | failed | refund is the provider's; retry is the user's choice |
| `expired` | 404 after retention | `expired` | — | only if fetching was impossible in time |
| `canceled` | — | `cancelled` | — | |

Scheduler rules: per-provider concurrency below the provider's limit (Meshy Pro 10 queued tasks; Tripo P-series 3;
HY 3D 3; Rodin parallelism limit) with a per-user fair queue; never re-POST after a create timeout (look the task up
instead, or let it orphan and reconcile by listing tasks); overall wait ≥ 60 minutes for Meshy; job rows survive a
gateway restart; credits accounted from the provider's reported consumption (Meshy `consumed_credits`, Tripo
`credits_consumed`, Rodin `consumed`).

### 5.7 Security, abuse and privacy

| Threat | Control |
|---|---|
| Key leakage | server-only env/vault; BYO header redacted; a CI check fails if any provider key name or provider origin appears in the client bundle; a CSP (added in M7 G-b; none exists today) lists only `'self'` and the configured gateway in `connect-src` |
| SSRF through "model URL" inputs | clients never send URLs; the gateway uploads its own stored bytes (Tripo `file_token`, Meshy data URI ≤ 100 MB or a short-lived signed URL from our blob store); egress allow-list per adapter |
| Malicious or oversized GLB | `io` input budgets before allocation, glTF validator, reject external `uri` and unknown `extensionsRequired`, decode Draco/meshopt/KTX2 in a worker |
| Cost attacks | gateway off by default and authenticated when on; quote before submit, per-user caps and **server-side daily/monthly caps from env** (never only the client's `maxCostUsd`), idempotency keys, rate limits, kill switch, alert on Tripo `balance.low` |
| Webhook forgery and replay | HMAC + timestamp window (Tripo); refetch for unsigned providers |
| Harmful content | provider moderation on (`moderation: true` for Meshy); show the provider AUP; keep prompts/inputs only as long as the privacy policy says |
| Real-person likeness, IP | attestation for photo inputs; warn on brand/character prompts (Meshy AUP §3); registry curation |
| Plugin access | plugins never receive provider keys or the gateway session; `gen.*` operators are host-owned and confirm cost (research 08 §8.2) |
| Provider data use | the panel shows `trainsOnInputs` and `retentionDays` per provider before submit |

### 5.8 Editor UX

- **Generate panel** (dockview, lazy chunk): mode tabs *Image / Text / Views*; provider selector showing terms badges
  (owns output, trains on data, retention); preset *Prop ≤ 500 / Character ≤ 3k / Hero ≤ 10k*; *Texture: none ·
  palette · texture*; *Rest pose: T · A* (characters); *Variants: 1–4*; quote line ("≈ $0.50 each, typically ~60 s");
  Generate.
- **Job tray** in the help line (research 09 §1): spinner + count; click opens cards with thumbnail, progress bar,
  elapsed vs typical time, cancel, retry, error with policy link. Jobs survive reloads (`GET /v1/jobs?mine`).
- **Import** (manual or automatic): the post-process dialog opens with the preset's chain, live triangle/vertex/
  byte counts against the Ekza profile budgets, and the *adjust last operation* panel for each step.
- **Provenance badge** on the asset in the Outliner/asset list ("AI · Tripo P1-20260311 · paid output"), with the
  licence view and attribution text.

### 5.9 Import and post-processing chain

| # | Step (operator) | Implementation | Defaults (Character preset) | Notes |
|---|---|---|---|---|
| 1 | `gen.import` | gateway artifact → verify SHA-256 → `AssetStore.put` → `io` budgets → `gltf-model` importer | — | the raw provider bytes stay in the store; `rawSha256` in provenance |
| 2 | `mesh.normalize` | rotate to +Z forward (Tripo default is +X), metres, origin at bottom centre, optional target height | height 1.7 m (Meshy's default `height_meters`) | records the applied transform |
| 3 | `mesh.mergeByDistance` | own implementation (glTF Transform 4.x `weld()` is lossless-only since its lossy options were removed) | 0.1 % of bbox diagonal | desktop-DCC *Merge*, open-source-DCC *Merge by Distance* |
| 4 | `mesh.cleanup` | drop degenerate/duplicate triangles; `simplifyPrune` for tiny islands; consistent winding | prune below 0.5 % extents | desktop-DCC *Cleanup*; meshoptimizer 1.3's experimental remesher (research 13) may close broken soup first: evaluate in G1 |
| 5 | `mesh.reduce` | meshoptimizer `simplifyWithAttributes` (UV/normal weights, `vertex_lock`), flags `Regularize` for skinned meshes, `LockBorder` for open borders, `Permissive` only on request; binary search on target index count to hit an exact triangle budget; `simplifySloppy` as an explicit "aggressive" option | ≤ 3,000 triangles | index-only output reuses the original vertices, so **UVs and skin weights stay valid**; glTF Transform `simplify()` exposes only ratio/error/lockBorder, so we call meshoptimizer directly |
| 6 | `mesh.quadrangulate` | pair triangles into quads by planarity/angle threshold | 40° | needs modeling `MeshData` (n-gons); optional |
| 7 | `mesh.symmetrize` | mirror one half across X with seam weld | off | fixes asymmetric T-poses; modeling tool |
| 8 | `mesh.normals` | flat (split per face) or auto-smooth by angle; recompute after reduce | characters: smooth with hard edges > 60°; props: flat | desktop-DCC *Soften/Harden Edge* |
| 9 | `mesh.paletteBake` | sample base colour per face (area-weighted, several barycentric points), k-means in OKLab, write a **per-face palette index** (the editable colour truth, research 12 L2); export derives the palette PNG with collapsed UVs (research 12 L3) or `COLOR_0` | 16 colours | the classic stylized low-poly look; VRM/MToon ignores vertex colours, hence the palette texture default; texture decoding uses `createImageBitmap`/`OffscreenCanvas` in the browser (`sharp` is excluded by ADR 0009) |
| 10 | `mesh.textureDownsize` | when keeping the texture: resize to 512–1024 in the browser | off when palette is on | |
| 11 | `rig.auto` | research 14: Quick Rig markers on the VRM humanoid template + geodesic voxel binding (built for polygon soup); alternative: provider rig imported as a skinned GLB (Meshy and Tripo's default specs use common auto-rigger skeleton names and need humanoid inference, FR-IO-13/M2b; Tripo `spec: "vrm"` names bones by VRM convention and skips that step); UniRig via the self-host worker for creatures | research 14 default | reduce before skinning gives better weights; both orders are valid |
| 12 | `export.lint` | existing ADR 0010 lints + new `ekza.provenance-*` lints | — | profile `ekza/space-avatar-v1` or `ekza/omoba-humanoid-v1` |

Budget targets (to verify in G1): steps 2–9 on a 500,000-triangle input finish in under 2 s in a worker on the
reference laptop (ARCHITECTURE §14); meshoptimizer's simplifier ships as a separate lazily loaded Wasm module.

### 5.10 Provenance and licence metadata

Document side: `AssetRecord` gains `provenance: AssetProvenance | null` (schema migration owned by the modeling
iteration), reusing the existing `DerivedFrom` and `Redistributable` types from `ClipProvenance`:

```ts
interface AssetProvenance {
  readonly origin: 'imported' | 'generated' | 'authored';
  readonly derivedFrom: readonly DerivedFrom[];       // title, author, license (SPDX | LicenseRef-*), sourceSha256
  readonly redistributable: Redistributable;          // 'yes' | 'no' | 'unknown'
  readonly generator: GeneratorProvenance | null;     // name per research 14 §11
}
interface GeneratorProvenance {
  readonly kind: 'ai';                                // research 14 §11: `generator = { kind: 'ai', service }`
  readonly digitalSourceType: 'trainedAlgorithmicMedia' | 'compositeWithTrainedAlgorithmicMedia';  // IPTC vocabulary
  readonly service: string;                           // provider id, e.g. 'tripo'
  readonly model: string;                             // 'P1-20260311'
  readonly op: GenOp;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly inputs: readonly { readonly kind: 'prompt' | 'image'; readonly sha256: string; readonly text?: string }[];
  readonly terms: GenTerms;                           // snapshot at generation time
  readonly rawSha256: string;                         // provider bytes before post-processing
  readonly steps: readonly { readonly op: string; readonly args: Readonly<Record<string, unknown>> }[];
  readonly providerTaskId: string | null;             // document only, never exported
}
```

Export side: `asset.extras.ekza_model_v1 = { schema: 1, provenance: { tool, toolVersion, projectSha256,
derivedFrom[], generator: { kind: 'ai', digitalSourceType, service, model, op, params, inputs: [{kind, sha256}], terms:
{outputLicense, termsUrl, attribution, territoryExcluded, restrictions}, rawSha256, steps } } }`. Same rules as
ADR 0010: inside `asset.extras` so the registry hash covers it, deterministic key order, lowercase hex, no
timestamps, **no key named `uri`** anywhere, no download URLs or task ids (the terms URL is the only link), prompt text exported only when the user
opts in (default: prompt hash only). Provider metadata found in the source GLB (`asset.generator`,
`asset.copyright`, `asset.extras`) is copied into `derivedFrom` and the original `asset.extras` members are carried
over, so AI identifiers survive our re-export.

VRM 1.0 `meta` defaults proposed from `GenTerms` (the user confirms in the export dialog): `authors` = the user;
`creditNotation: 'required'` when `attribution` is set (e.g. a Meshy free-plan file, CC BY 4.0); `otherLicenseUrl` =
`termsUrl`; `thirdPartyLicenses` carries the provider credit line (research 14 §11); `commercialUsage` and
`allowRedistribution` left to the user, with lints:

| Lint (new) | Rule | Local | Ekza profile |
|---|---|---|---|
| `ekza.provenance-ai-undisclosed` | an asset with `generator` exports without `ekza_model_v1.provenance.generator` | error | error |
| `ekza.provenance-attribution` | `terms.attribution` set but VRM `creditNotation` is not `required` | warning | error |
| `ekza.provenance-territory` | `terms.territoryExcluded` non-empty | warning | error (until the registry decides) |
| `ekza.provenance-free-tier` | `ownership` is `provider` or `provider-cc-by` | warning | warning |

Legal context to show, not to decide: the US Copyright Office (Part 2 report, 2025-01-29) holds that prompts alone
do not make an output copyrightable, so "ownership" clauses may give fewer rights than they suggest; the human edits
made in our tool are what can carry authorship. EU AI Act Art. 50 transparency duties apply since 2026-08-02 (the
marking duty sits with generative-AI providers; systems already on the market have until 2026-12-02 per the Digital
Omnibus, secondary sources). C2PA has no glTF embedding that we could find; a sidecar manifest is a later option.

Registry implications (upstream, owner decision): avatars (VRM ≤ 50 MiB) and weapons (GLB ≤ 8 MiB with
`ekza_handheld_v1`) are the only kinds; generated props beyond handhelds need a new `prop` kind; the registry should
read `ekza_model_v1.provenance.generator` and show an AI badge in Studio.

---

## 6. Recommendation

**First integration: Tripo + Meshy.**

| | Tripo | Meshy |
|---|---|---|
| Low-poly fit | native P1 (48–20,000 faces), P2 with quads; H3.1 smart low-poly with quads | Smart Topology T2.5 (100–30,000 tri), triangle-only; quad remesh separately |
| Character pipeline | rig-check (free), rig with **VRM skeleton naming**, many creature types | rig documented for bipeds ("works well only with standard humanoid assets"), textured input, ≤ 300k faces |
| Cost per textured low-poly model | $0.40–0.60 | $0.19–0.30 |
| API quality | v3 REST, signed webhooks, presigned uploads, pinned snapshots | OpenAPI spec, SSE, rate-limit headers, unsigned webhooks, best docs |
| Data terms | paid: user owns, **no training** | paid: user owns, **training allowed** (non-Enterprise), 3-day retention, keep AI marks |
| Main risk | two regional sites; prepaid non-refundable credits | resale clauses for a hosted platform key; ToS training clause |

Ship Tripo as the default for character work (VRM-named rig, no-training terms) and Meshy as the default for cheap
props and as the second adapter that keeps the contract honest. Add the fal.ai adapter in G2 for BYO users who want
one key across many models (including TRELLIS.2 and Hunyuan 3.1 smart topology). Hunyuan cloud and Rodin are good
later adapters (Rodin for privacy-sensitive studios: 7-day retention, no training).

**Self-hosted path.** One GPU worker image (`selfhost` adapter) with three pipelines: **TRELLIS.2** for textured
image→3D (MIT; ≥ 24 GB; resolve the nvdiffrast/nvdiffrec licence before any commercial use), **TripoSG** for
geometry-only low-poly blanks that our palette bake colours (MIT; ≥ 8 GB), and **UniRig** for creature rigs (MIT).
**Stable Fast 3D** is the local test model on a Mac (MPS) under its Community Licence. Hunyuan3D open weights only
as an operator opt-in with a geo-gate and the licence NOTICE.

---

## 7. Phasing for the TODO

| Phase | When | Scope | Size (agent-days) | Acceptance |
|---|---|---|---|---|
| **G0 — contracts** | inside the modeling iteration | `AssetRecord.provenance` + migration; `ekza_model_v1` export block and the four lints; normalize/merge/cleanup/reduce/normals/palette/symmetrize/quadrangulate built as **modeling operators**; `gen-core` types; `EditorServices.generation` slot (null) | ~1.5 on top of the modeling ops | a hand-imported dense GLB reduces to ≤ 3,000 triangles with UVs intact and exports with provenance; existing e2e unchanged |
| **G1 — first providers** | after the modeling base and research 14 rig/skin | gateway (jobs, uploads, SSE, artifacts, quotas, redaction), Tripo + Meshy adapters, mock provider server, Generate panel + job tray, `gen.*` operators, post chain presets, provider-rig import, docs | ~15 (gateway 4, adapters 3, mock server 2, UI 3, post presets/integration 2, e2e 1) | from one reference image a user gets a rigged ≤ 3,000-triangle, ≤ 16-colour humanoid, animates idle/walk with M2a tools and exports a VRM 1.0 that passes `ekza/space-avatar-v1` lints with provenance; no provider key or origin in the client bundle (CI check); everything green against the mock server |
| **G2 — open path and breadth** | after G1 | GPU worker (TRELLIS.2, TripoSG, UniRig, SF3D for dev), `selfhost` + `fal` + `hunyuan-cloud` adapters, multiview, text→image→3D chain (provider image endpoints, Tripo `t_pose` template), OBJ import for quads | ~10 | same scenario via the self-host worker; licence SBOM check in the worker CI |
| **G3 — hosted Ekza** | with M4a/M4b | platform key with per-user quotas and spend dashboards, BYO key on hosted, registry AI fields + Studio badge (upstream), optional C2PA sidecar | ~6 + upstream | hosted demo with a monthly cap; registry accepts a generated avatar with provenance |

---

## 8. Testing

- **Contract tests per adapter** against recorded HTTP exchanges (request shape, header names, status mapping, cost
  parsing as decimals — Tripo returns credits with two decimals).
- **Mock provider server** (Node, in-repo): Tripo-like and Meshy-like state machines with deterministic small GLBs
  produced by our own fixture generator (no provider output in the repository); scripted failures: 401, 402,
  429 with and without `Retry-After`, 5xx, moderation `banned`, step back `IN_PROGRESS → PENDING`, create timeout,
  expired URL, bad/old webhook signature, duplicate deliveries.
- **Gateway tests**: idempotency, quotas, caps, cancellation semantics, restart recovery, SSRF attempts, oversized
  uploads, EXIF stripping.
- **Post chain**: golden tests (triangle counts within ±1 % of target, UV and `JOINTS_0/WEIGHTS_0` validity after
  index-only reduce, palette size, determinism), validator clean, Ekza lints.
- **E2E**: Generate → job tray → import → post chain → rig → export, against the mock gateway, Chrome + SwiftShader.
- **Real providers**: manual smoke script with a $5 cap, never in CI.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Provider churn (model retirements, renamed endpoints, price changes) | high | adapter breakage | pinned versions, capability discovery, contract tests, watch provider changelogs each release |
| Generated humanoids rig badly (fused limbs, merged hands, asymmetric poses) | high | rig/skin failures | rest-pose conditioning, rig-check, symmetrize, modeling cleanup, manual fix-up, multiple variants |
| Decimated output looks "melted" at low budgets | high | poor low-poly look | prefer native low-poly modes; palette bake; quadrangulate; hand cleanup |
| Terms: resale/redistribution clauses for a hosted platform key | medium | account termination | BYO and self-hosted first; written confirmation before platform-key launch |
| Licence traps (Hunyuan territory and MAU; nvdiffrast non-commercial; Stability revenue cap; SAM licence) | medium | legal exposure for the OSS project or operators | `GenTerms` restrictions, geo-gate, worker SBOM licence check, no weights in repo |
| Training on user inputs (Meshy non-Enterprise) | medium | user IP leaks into provider training | show `trainsOnInputs` before submit; Tripo default for characters |
| Key leakage or cost attacks | medium | money | server-only keys, caps, quotes, CI bundle check |
| AI-content regulation and disclosure | medium | compliance | provenance by construction, keep provider marks, AI badge in registry |
| Network reachability: some provider and model-hub domains are blocked on some networks | medium | gateway cannot reach providers | run the gateway where providers are reachable; self-host fallback |
| Bundle budget (M-2 at the limit) | medium | editor route grows | lazy chunk; meshoptimizer Wasm loaded on demand |
| Quads lost through GLB | certain | modelers expect quads | re-quadrangulate on import; OBJ/FBX import later |

---

## 10. Open questions for the owner

1. **Q1 Hosted generation**: will Ekza pay for generation for logged-in users (platform key with quotas), or is the
   hosted editor BYO-only until accounts exist (M4b)?
2. **Q2 Default provider**: Tripo for characters (no training, VRM rig) and Meshy for props (cheapest) — or one
   default for both?
3. **Q3 Hunyuan**: allow Hunyuan open weights at all (territory exclusion, 1 M MAU, "no improving other models")?
   Allow the Hunyuan cloud API?
4. **Q4 Resale**: ask Meshy and Tripo for written confirmation (or a partner agreement) before a platform-key mode
   charges or serves many users.
5. **Q5 Prompt privacy**: export the prompt text in provenance, or only its hash (proposed default: hash)?
6. **Q6 Registry**: add a `prop` kind and AI-provenance fields upstream; show an AI badge in Studio?
7. **Q7 GPU**: who runs the self-host worker (Ekza infra, rented GPU, the owner's machine) and with what budget?
8. **Q8 Rig default**: provider rig (Tripo VRM spec) or our research-14 rig as the default for generated humanoids?

---

## Sources

Provider documentation, pricing and terms (read 2026-10-18):

- Meshy API overview and full docs (task model, retention, webhooks, rate limits, pricing, rigging, animation, changelog): https://docs.meshy.ai/en/llms-full.txt · https://docs.meshy.ai/en/api/pricing · https://docs.meshy.ai/en/api/rate-limits · https://docs.meshy.ai/en/api/changelog · https://docs.meshy.ai/api/task-lifecycle · https://docs.meshy.ai/api/asset-retention · https://docs.meshy.ai/api/webhooks · https://docs.meshy.ai/api/rigging · https://docs.meshy.ai/api/animation · https://docs.meshy.ai/openapi.yaml
- Meshy plans, terms and acceptable use: https://www.meshy.ai/pricing · https://www.meshy.ai/terms-of-use · https://www.meshy.ai/acceptable-use-policy
- Tripo API (international): https://developers.tripo3d.ai/en/docs/introduction.md · https://developers.tripo3d.ai/en/pricing · https://developers.tripo3d.ai/en/models · https://developers.tripo3d.ai/en/models/p1 · https://developers.tripo3d.ai/en/terms
- Tripo API reference corpus (rigging, retarget, retopology, billing, changelog, models, task lifecycle, webhooks): https://developers.tripo3d.com/llms-full.txt · https://developers.tripo3d.com/llms.txt · https://developers.tripo3d.com/en/docs/webhooks.md · https://developers.tripo3d.com/en/docs/task-lifecycle.md · https://developers.tripo3d.com/assets/developer/tripo-v2-to-v3-migration/SKILL.md
- Tencent HY 3D Global API and billing: https://intl.cloud.tencent.com/document/product/1284/75540 · https://intl.cloud.tencent.com/document/product/1284/75281
- Hyper3D Rodin: https://docs.hyper3d.ai/en/get-started/features · https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5 · https://docs.hyper3d.ai/en/get-started/changelog · https://docs.hyper3d.ai/en/legal/data-retention-policy · https://hyper3d.ai/pricing?lang=en
- Stability AI: https://stability.ai/api-pricing-update-25 · https://stability.ai/stable-3d · https://stability.ai/license · https://github.com/Stability-AI/stable-fast-3d
- Sloyd API: https://www.sloyd.ai/api · https://www.sloyd.ai/api/pricing · https://www.sloyd.ai/pricing
- fal.ai: https://fal.ai/models/fal-ai/trellis-2 · https://fal.ai/models/fal-ai/hunyuan3d-v3/image-to-3d · https://docs.fal.ai/model-apis/model-endpoints/webhooks · https://fal.ai/terms
- Anything World pricing: https://anything.world/pricing · Masterpiece X: https://www.masterpiecex.com/ · Luma API docs: https://docs.lumalabs.ai/docs/api
- Secondary (unverified) for Kaedim, CSM, Rodin resellers: https://tooliverse.ai/tools/kaedim · https://costbench.com/software/ai-3d-generation/csm/ · https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026 · https://empiriolabs.ai/models/hyper3d-gen2

Open-weight models and licences:

- TRELLIS.2: https://huggingface.co/microsoft/TRELLIS.2-4B · https://github.com/microsoft/TRELLIS.2 · https://github.com/microsoft/TRELLIS.2/blob/main/setup.sh
- nvdiffrast licence: https://github.com/NVlabs/nvdiffrast · https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt
- TRELLIS v1: https://huggingface.co/microsoft/TRELLIS-image-large
- TripoSG, TripoSF, TripoSR, UniRig: https://github.com/VAST-AI-Research/TripoSG · https://huggingface.co/VAST-AI/TripoSG · https://huggingface.co/VAST-AI/TripoSF · https://huggingface.co/stabilityai/TripoSR · https://github.com/VAST-AI-Research/UniRig · https://huggingface.co/VAST-AI/UniRig
- Stable Fast 3D, SPAR3D: https://huggingface.co/stabilityai/stable-fast-3d · https://huggingface.co/stabilityai/stable-point-aware-3d
- Hunyuan3D: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1 · https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE · https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE · https://huggingface.co/tencent/Hunyuan3D-Omni · https://www.notebookcheck.net/Tencent-s-new-Hunyuan-3D-3-0-brings-realistic-AI-model-generation-to-developers-and-creators.1116964.0.html
- InstantMesh: https://huggingface.co/TencentARC/InstantMesh · Step1X-3D: https://huggingface.co/stepfun-ai/Step1X-3D · Direct3D-S2: https://huggingface.co/wushuang98/Direct3D-S2 · SAM 3D Objects: https://github.com/facebookresearch/sam-3d-objects

Post-processing libraries:

- meshoptimizer releases and JS simplifier API: https://github.com/zeux/meshoptimizer/releases · https://github.com/zeux/meshoptimizer/blob/master/js/README.md · https://www.npmjs.com/package/meshoptimizer
- glTF Transform `simplify()` options and changelog (lossy `weld()` options removed): https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/simplify.ts · https://github.com/donmccurdy/glTF-Transform/blob/main/CHANGELOG.md

Legal and provenance context:

- US Copyright Office, Copyright and AI Part 2 (2025-01-29): https://copyright.gov/newsnet/2025/1060.html
- EU AI Act Art. 50 timeline and the Digital Omnibus (secondary commentary): https://www.ropesgray.com/en/insights/viewpoints/2026/08/102nfqm/you-talkin-to-me-operationalising-the-eu-ai-acts-transparency-obligations · https://compliancehub.wiki/eu-ai-act-article-50-transparency-digital-omnibus-2026/
- IPTC digital source type vocabulary: http://cv.iptc.org/newscodes/digitalsourcetype/
- C2PA implementation guidance: https://spec.c2pa.org/specifications/specifications/2.3/guidance/Guidance.html

Repository context: [ADR 0010](../adr/0010-ekza-integration-tiers.md) (metadata contract, lints, profiles),
[research 03](03-ekza-reuse-audit.md) (registry rules, profiles), [research 06](06-collaboration.md) (blobs by hash),
[research 08](08-extensibility-modeling.md) (operators, plugin threat model, `MeshData`),
[ARCHITECTURE](../../ARCHITECTURE.md) (input budgets, performance budgets), [ROADMAP](../ROADMAP.md) (M-2 bundle budget).

---

## Addendum A — re-verification for M7 G-b/G-c (2026-10-24)

> Read 2026-10-24 for the gateway and adapter build ([wp-note m7-gbc](../wp-notes/m7-gbc.md), DECISIONS-OPEN §T).
> Method: the providers' machine-readable docs fetched and grepped (Tripo international per-page Markdown
> `developers.tripo3d.ai/en/docs/<page>.md` — its `llms-full.txt` answers 404 on the `.ai` site, and the `.com` corpus
> is the China region; Meshy `llms.txt`, `llms-full.txt`, `openapi.yaml` and `/api/<page>.md`), the pricing pages
> (Tripo's from its rendered page and JS bundle), terms pages, and for Part A/B the providers' payment pages and
> terms. Items marked **(unverified)** rest on one secondary source or a search snippet. The research network exits
> through Singapore, so IP blocking from Russia could not be tested.

### A.1 Tripo (international API v3)

| Item | Finding (2026-10-24) |
|---|---|
| Base, auth | `https://openapi.tripo3d.ai/v3`, `Authorization: Bearer <key>`; v2 (`api.tripo3d.ai/v2/openapi`) still answers and shares keys; China region `openapi.tripo3d.com/v3` (Alipay, CNY) |
| Create | `POST /generation/text-to-model` (`prompt` ≤ 1,024 chars, `negative_prompt` ≤ 255) and `POST /generation/image-to-model` (`input` = a `file_…` token, a URL or a `task_…` id); answer `{code: 0, data: {task_id}}` |
| Models | `model` omitted = H3.1 `v3.1-20260211`; **`P1-20260311`** native low-poly, **50–20,000** faces (the 48 minimum of the snapshot belongs to P2); `P2-20260801` preview, native quads 48–25,000 (triangles 48–50,000); H3.0 `v3.0-20250812`, H2.5 `v2.5-20250123` |
| P-series fields | `face_limit`, `texture` (default true), `pbr` (default true, forces texture), `texture_quality` fast/standard/detailed/extreme, `texture_version`, `delight`, `auto_size`, `export_uv`, `export_orientation` (default **+x**), `model_seed`/`texture_seed`; `quad` P2 only (400 on P1); `smart_low_poly`, `generate_parts`, `geometry_quality` are H-series only |
| Upload | `POST /files` multipart (images JPEG/PNG ≤ 20 MB; models GLB/glTF/FBX/OBJ/STL ≤ 150 MB) → `file_token`; or `POST /files/presign` → presigned PUT (30 min; also WebP) |
| Task | `GET /tasks/{id}` → `status` queued/running/success/failed/cancelled (+ `banned`, `expired` in the lifecycle page), `progress` 0–100, `output.model_url`, `output.rendered_image_url` (the v2 names `pbr_model`/`base_model` are gone), `credits_consumed` **decimal** (e.g. `48.00`), `error_code`/`error_message` |
| Rig | `POST /animations/rig-check` (free) and `/animations/rig`: input task/file/URL; the version field is **`model`** (not `rig_version`), default still `v1.0-20240301`, so `v3.0-20260909` must be sent; `rig_type` biped (default) … `others` (v3.0); `spec` tripo (default), actorcore, unity, unreal, `vrm` (VRM 1.0 naming) and one named after a web auto-rigging service — the newer specs need v3.0 and apply to biped; `out_format` glb/fbx; 25 credits. Retarget `/animations/retarget`, 10 credits per animation |
| **Remesh of an existing or uploaded mesh** | **`POST /mesh/decimate`**: `input` task/file token/URL (GLB/glTF/FBX/OBJ/STL ≤ 150 MB); `model` `v3.0` (35 credits triangles, 40 quads; 500–20,000 tris / 500–10,000 quads; `smart_uv`), `v2.0` (30), `v1.0` (10, `face_limit` required, up to 2M); `bake` (default true). Smart UV `POST /mesh/uv` (20 credits, ≤ 80k triangles). Changelog dates the v3.0 retopology "2026-10" |
| Webhooks | console only (no per-request URL); events `task.completed`, `task.failed`, `balance.low`; headers `Tripo-Webhook-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, `t + "." + rawBody`), `Tripo-Webhook-Delivery` (dedupe), `Tripo-Webhook-Id`, `Tripo-Webhook-Event`; reject `t` older than ≈ 300 s; answer 2xx within ≈ 5 s. Whether the `whsec_` prefix is part of the HMAC key: **(unverified)**, the sample uses the whole string |
| Limits, errors | per key 429 code 1007 (`X-RateLimit-*`); concurrency 429 code 2000 with `Retry-After`; default concurrency H-series 10, **P-series 5** (the snapshot said 3), mesh operations 10, animation 10; envelope `{code, status: "error", message, suggestion, request_id}`; 1000/1001 key, 2008 content policy, 2010 insufficient credits (HTTP 403), 2015 version deprecated; a live unauthenticated call answers the undocumented code 2 |
| Prices ($0.01/credit, Stripe, from $1) | P1 text→3D 30 / 40 (no / standard texture), image→3D 40 / 50, detailed 60; P2 100 / 110; H3.1 text 10 / 20, image 20 / 30, smart low-poly +10, quad +5; rig 25, rig-check 0, retarget 10, retopology v3.0 35 / 40, Smart UV 20 |
| Terms (2025-07-11) | paid users hold the rights to inputs and outputs and Tripo "will not use Inputs and Outputs as training data"; free users: Tripo keeps the rights; keys may not be transferred without written approval (§3.2); no competing models; credits non-refundable |

### A.2 Meshy

| Item | Finding (2026-10-24) |
|---|---|
| Base, auth | `https://api.meshy.ai/openapi/…`, `Authorization: Bearer msy_…`; per-key monthly credit limit and IP allow-list (403 `ip_not_authorized`); the shared test key was retired on 2026-09-16; creates answer **202** `{result: <id>}`; timestamps in ms |
| Text→3D | `POST /openapi/v2/text-to-3d`, still two stages: `mode: "preview"` (`prompt` ≤ 800, `model_type` standard / **smart-topology** / lowpoly (deprecated), `ai_model` `meshy-t2`/`meshy-t2.5` for Smart Topology, `target_polycount`, `pose_mode`, `moderation`, `target_formats`) then `mode: "refine"` (`preview_task_id`, `enable_pbr`, `texture_resolution` 2k/4k/8k; inherits `ai_model`) |
| Image→3D | `POST /openapi/v1/image-to-3d`, `image_url` = URL or data URI (JPG/PNG/WebP ≤ 20 MB); Smart Topology = `model_type: "smart-topology"` + `ai_model: "meshy-t2.5"` (100–30,000, default 15,000; `meshy-t2` 100–15,000); triangle only (`topology: quad` → 400); `should_texture`, `enable_pbr`, `texture_resolution`; `remove_lighting`/`image_enhancement` → 400 with Smart Topology. Multi-image `POST /openapi/v1/multi-image-to-3d` (1–4) has **no** Smart Topology |
| `lowpoly` retirement | confirmed for **2026-10-30**; the endpoint pages name `smart-topology` + `meshy-t2.5` as the replacement (the `llms.txt` summary still says t2) |
| **Remesh of an existing or uploaded mesh** | **`POST /openapi/v1/remesh`**: `input_task_id` or `model_url` (URL ≤ 400 MB, or a data URI ≤ 100 MB with MIME `application/octet-stream`; GLB/glTF/OBJ/FBX/STL); `topology` quad/triangle, `target_polycount` 100–300,000 (default 30,000), `decimation_mode`, `target_formats`; resize/origin options moved to `/resize` and `/convert` (1 credit each); **5 credits**. Also UV unwrap `/v1/uv-unwrap` (GLB ≤ 40k faces, 5) and retexture `/v1/retexture` (10/15) |
| Task | `GET /openapi/<v>/<collection>/{id}` (+ `/stream` SSE); `status` PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED (IN_PROGRESS may step back to PENDING); `model_urls.glb`, `thumbnail_url`, `consumed_credits` (integer, 0 on FAILED), `task_error {type: invalid_input / timeout / service_unavailable / server_error, message}`; GET answers carry `Retry-After`; DELETE refunds a PENDING task, 409 on IN_PROGRESS |
| Rig, animation | `POST /openapi/v1/rigging` (`input_task_id` ≤ 320k faces or a GLB `model_url` facing +Z; `height_meters` default 1.7; humanoid textured models; 5 credits; `result.rigged_character_glb_url`); since 2026-10-23 `texture_image_url` is deprecated. Animation `POST /openapi/v1/animations` 3 credits per action |
| Webhooks | still **unsigned**; configured in the developer platform (5 active, 10 total, every active webhook receives every task); body = the task object; retries up to 4 (in progress) / 9 (final); out of order and duplicates possible — dedupe on (`id`, `status`) |
| Limits, errors | 20 req/s; concurrent tasks Pro 10, Premium 30, Ultra 100, Studio 60; 429 "Rate limit exceeded" (with `Retry-After`) or `NoMorePendingTasks` (without); 402 = no credits **or the Free plan**; envelope `{message}`; new optional `X-Meshy-Metadata` header (2026-10-21, Studio/Enterprise) |
| Prices | t2/t2.5 text preview 5; image mesh-only 5, + 2K/4K texture 15, 8K 20; refine 10 (2K/4K) / 15; remesh 5; UV 5; rig 5; animation 3/action; plans Pro $20/1,000 ($0.020), Premium $40/3,000 ($0.0133), Ultra $100/8,000 ($0.0125), Studio $70/5,500 + $10/seat; the API needs a paid plan; credit-pack prices **(unverified)** |
| Terms (2026-09-19) | API output of non-Enterprise customers deleted after 3 days (the pricing page advertises 14 days for Studio — a conflict to ask about); Meshy may train on non-Enterprise inputs and outputs (§2.9); paid plans own outputs, Free plan: Meshy owns, CC BY 4.0; AI marks must not be removed; no reselling or redistributing access (v), no multiple users per account (vi) |

### A.3 Changes against the 2026-10-18 snapshot

- Tripo P1 range is **50–20,000** faces (48 is P2's floor); P-series concurrency is **5**, not 3.
- Tripo's rig version is sent in **`model`**; the default is still v1.0, so the adapter always sends `v3.0-20260909`.
- Tripo has a retopology `v3.0` (35/40 credits, `smart_uv`) and Smart UV (20 credits); rig, retopology and Smart UV accept a file token or URL, so **uploaded meshes work** at Tripo as at Meshy.
- Tripo's multipart upload accepts JPEG/PNG only (WebP through presign); the v3 task output names are `model_url`/`rendered_image_url`.
- Webhooks are configured in the consoles at both providers; neither takes a per-request URL.
- Meshy: unchanged prices and ranges; `X-Meshy-Metadata` (10-21) and the deprecated rigging `texture_image_url` (10-23) are new; the 3-day vs 14-day retention conflict for Studio.

### A.4 Remesh/retopology of an existing mesh (the owner's "API cleanup" step)

| Where | Endpoint | Input | Range, topology | Price |
|---|---|---|---|---|
| Meshy | `POST /openapi/v1/remesh` | earlier task or uploaded model (data URI ≤ 100 MB) | 100–300,000, quad or triangle | 5 credits ($0.06–0.10) |
| Tripo | `POST /v3/mesh/decimate` (`model: v3.0`) | earlier task, file token (≤ 150 MB) or URL | 500–20,000 tris / 500–10,000 quads | 35 / 40 credits ($0.35 / $0.40) |
| Tencent HY 3D (intl) | `Submit3DSmartTopologyJob` | GLB/OBJ ≤ 200 MB by URL | triangle or quadrilateral, `FaceLevel` high/medium/low (no exact count) | 50 credits (≈ $0.75) |
| fal.ai | `fal-ai/hunyuan-3d/v3.1/smart-topology`; `tripo3d/tripo/remesh` | URL | as upstream | $0.75; "$0.01 per unit" (unit undefined, likely Tripo credits) |
| Rodin, Stability, the RUB aggregator below | none | — | — | — |

G-c ships both direct paths (Meshy remesh, Tripo decimate) as the `retopology` op.

### A.5 Availability and payment from Russia (Part A)

No provider below names Russia as a restricted country in its terms; the blocker is **payment**: every Western checkout
is Stripe or a USD card/ACH, and Stripe says Russian-issued cards are "unlikely to be successful" (Mir unsupported).
IP blocking from Russia was not tested (no evidence found either way).

| Provider | Russia restricted? | Payment | Russian cards | Note |
|---|---|---|---|---|
| Tripo international | no (general "applicable laws") | Stripe, USD; AWS Marketplace (500k credits $4,500) | no | China site `tripo3d.com`: Alipay, Chinese corporate bank transfer, fapiao |
| Meshy | no | Stripe (cards, Alipay via Stripe, Link); PayPal not for Russia; crypto US only; Enterprise wire | no (Meshy's help: Russia on Stripe's restricted list) | — |
| Hyper3D Rodin | no (sanctions only in force majeure) | USD; API needs Business $120/month | very likely no **(unverified)** | — |
| Tencent Cloud intl (HY 3D) | no (lists Iran, Cuba, DPRK, Syria, Crimea, DNR/LNR) | cards incl. UnionPay; USD bank transfer | Visa/MC no; UnionPay of a Russian bank possible in theory **(unverified)** | the only direct contract that plainly admits a Russian customer; perpetual rights to train on inputs, no opt-out |
| Stability AI | no (US embargoes) | prepaid credits, processor not named | no | — |
| fal.ai | no (US embargo, restricted parties) | card or ACH in USD (ToS §9(c)) | no | — |

- **RUB route:** a Russian aggregator (gen-api.ru, ООО «ИНФИМУМ») resells Rodin, Tripo H3.1, Meshy 6/7, Hunyuan3D and
  TRELLIS generation for RUB (callback URL unsigned, results 14 days); **no remesh and no rig**. Other Russian API
  aggregators checked expose no 3D models.
- **Domestic:** Sber GigaChat `text2model3d` (text → FBX only; legal entities through cloud.ru from 2026-09-01); no 3D
  API found at other Russian clouds.
- Consequence for the owner: the international launch needs a non-Russian payment instrument or entity for Tripo,
  Meshy (and fal in G2); a Russia-billed tenant can generate through the RUB aggregator (a later adapter) and remesh or
  rig in the editor or through an international tenant.

### A.6 Alternatives for a third adapter (Part B)

| | Rodin direct | Tencent HY 3D intl | Stability SPAR3D / SF3D | fal.ai |
|---|---|---|---|---|
| API | `api.hyper3d.com/api/v2`, multipart create, poll | TC3-HMAC API 3.0, Submit/Query, JobId 24 h | synchronous GLB response | queue `queue.fal.run/{endpoint}` + `fal_webhook` |
| Low-poly / quads | Gen-2.5 tiers, `mesh_mode` Quad | LowPoly + quadrilateral (not on 3.1), `FaceCount` | `remesh` triangle/quad, `target_count` 100–20,000 | per hosted model |
| Remesh of an upload | no | yes (smart topology) | no | yes (Hunyuan smart topology, Tripo remesh) |
| Rig | no | `SubmitAutoRiggingJob` (FBX/OBJ ≤ 60 MB, T-pose) + 48 motions | no | Meshy rigging/animation for any GLB |
| Price | 0.5 credit ≈ $0.75 direct; Business $120/month | Pro 25 cr ($0.375), LowPoly 30, smart topology 50, rig 10 | SPAR3D $0.04, SF3D $0.10 | Hunyuan 3.1 $0.375, smart topology $0.75; Tripo H3.1 $0.20–0.40; Meshy 7.1 $0.80/1.20; Rodin 2.5 $0.40; TRELLIS.2 $0.25–0.35 |
| Retention / training | 7 days / no training | output ≤ 7 days / perpetual training right, no opt-out | "as long as reasonably necessary" / opt-out | payloads 90 days unless `X-Fal-Store-IO: 0`; usage data may feed fal's models |
| Webhook signing | none | none | n/a | **ED25519** (JWKS, ±300 s) |

**Recommendation (G2):** fal.ai as the third adapter — one integration adds Hunyuan 3.1 (incl. LowPoly quads and smart
topology of uploads), Tripo remesh, Meshy rig/animation for any GLB, Rodin 2.5 without the $120 plan, TRELLIS.2, and
the only standard webhook signature; it is USD card/ACH only. Tencent HY 3D direct is the fallback when no
international payment works (risks: concurrency 1–3, training rights, the platform's 2026-09-30 model-hub migration —
ask Tencent whether the 3D actions survive it). A RUB-aggregator adapter for a Russia-billed tenant (generation only).
Skip Rodin direct and Stability for now.

Sources (read 2026-10-24): https://developers.tripo3d.ai/en/docs/introduction.md · …/migration-v2-to-v3.md ·
…/models-and-versions.md · …/generation-image-to-model/p.md · …/generation-text-to-model/p.md · …/files.md ·
…/files-presign.md · …/task-query.md · …/task-lifecycle.md · …/animations-rig.md · …/animations-rig-check.md ·
…/mesh-decimate.md · …/webhooks.md · …/rate-limits.md · …/error-handling.md · https://developers.tripo3d.ai/en/pricing ·
https://developers.tripo3d.ai/en/terms · https://developers.tripo3d.com/llms-full.txt (China region) ·
https://docs.meshy.ai/llms.txt · https://docs.meshy.ai/en/llms-full.txt · https://docs.meshy.ai/openapi.yaml ·
https://docs.meshy.ai/api/{text-to-3d,image-to-3d,multi-image-to-3d,remesh,rigging,animation,webhooks,rate-limits,errors,pricing,asset-retention,changelog}.md ·
https://www.meshy.ai/pricing · https://www.meshy.ai/terms-of-use · https://help.meshy.ai/en/articles/9991955-what-payment-methods-do-you-offer ·
https://support.stripe.com/questions/sanctions-on-russia-and-belarus · https://www.tripo3d.ai/terms ·
https://aws.amazon.com/marketplace/pp/prodview-hwlbvx7vubh7c · https://developers.tripo3d.com/en/docs/b2b-payment.md ·
https://hyper3d.ai/legal/terms · https://hyper3d.ai/pricing?lang=en · https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5 ·
https://docs.hyper3d.ai/en/legal/data-retention-policy · https://www.tencentcloud.com/document/product/301/9248 ·
https://www.tencentcloud.com/document/product/555/7425 · https://intl.cloud.tencent.com/document/product/301/78149 ·
https://www.tencentcloud.com/document/api/1284/75531 · https://www.tencentcloud.com/document/api/1284/77048 ·
https://www.tencentcloud.com/document/api/1284/79641 · https://www.tencentcloud.com/document/product/1284/75281 ·
https://intl.cloud.tencent.com/document/product/1284/75295 · https://www.tencentcloud.com/announce/detail/101147 ·
https://stability.ai/terms-of-service · https://docs.stability.ai/pricing ·
https://docs.stability.ai/api-reference/3d/stable-point-aware-3d.md · https://www.fal.ai/legal/terms-of-service ·
https://fal.ai/docs/model-apis/model-endpoints/webhooks · https://fal.ai/docs/model-apis/model-endpoints/queue ·
https://fal.ai/docs/model-apis/data-retention · https://api.fal.ai/v1/models · https://gen-api.ru/collections/3d ·
https://developers.sber.ru/docs/ru/gigachat/guides/3d-models-generation
