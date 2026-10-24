# M7 G-b + G-c — the generation gateway and the provider adapters (`m7/gbc-gateway`)

Work packages G-b and G-c of [MODELING-PLAN](../MODELING-PLAN.md) §7.2 under [ADR 0017](../adr/0017-ai-generation-boundary.md)
and §3.11: a turnkey path from a prompt or a picture, through a provider API, to a GLB the editor imports — with an API
remesh of an existing mesh and a provider rig. Branch off `dev` `22b007b6`. Provider facts were re-verified on the web
on 2026-10-24: [research 15 addendum A](../research/15-ai-3d-generation.md#addendum-a--re-verification-for-m7-g-bg-c-2026-10-24).
Decisions: [DECISIONS-OPEN §T](../DECISIONS-OPEN.md#t-m7-g-b-and-g-c--generation-gateway-and-provider-adapters-2026-10-24),
rows `M7-GB-1` … `M7-GB-16` and `M7-GC-1` … `M7-GC-9`.

## What landed

| Part | Files | What |
|---|---|---|
| Contract | `packages/gen-core/src/{types,state,validate,sse,hash,provenance,client}.ts` | `ekza-gen/v1`: types, the job state machine, strict request parsing (unknown fields refused), SSE framing, SHA-256, provenance helpers, the typed **`GenerationClient`**. Zero dependencies; the only generation code allowed in a browser bundle |
| Gateway | `packages/gen-gateway/src/{config,handler,engine,http,inputs,egress,logger,stores}.ts` | Default-deny configuration; the Fetch handler `handle(Request) → Response`; the job engine (per-provider scheduler with a fair per-caller queue, provider stages, never re-POST a create, polling with `Retry-After` and webhook pokes, immediate download + SHA-256, spend caps, restart recovery); upload checks; egress allow-list; redacting logger; memory stores |
| Adapters | `packages/gen-gateway/src/adapters/{tripo,meshy,common,types,index}.ts` | Tripo v3 (P1 low-poly, H3.1, P2 quads, rig v3.0 with VRM bone names, retopology `/mesh/decimate`, HMAC webhooks) and Meshy (Smart Topology t2.5, preview → refine, image → 3D, `/remesh` of an uploaded GLB, `/rigging`, unsigned webhook hints); pinned models |
| Node | `packages/gen-gateway/src/node/{server,main,fsStores}.ts` | The standalone server (`/healthz`, loopback peer checks), the CLI (exit 78 on a refused configuration), file stores under `GEN_DATA_DIR` |
| Next mount | `apps/web/app/api/gen/[...path]/route.gen.ts`, `apps/web/instrumentation.gen.ts`, `packages/gen-gateway/src/next.ts` | Server builds only (`.gen.ts` is a page extension of server builds); the startup hook stops `next start` (exit 78) on a refused configuration |
| CSP | `apps/web/csp.ts`, `next.config.ts`, `app/layout.tsx` | The app's first Content-Security-Policy: a header in server builds, a meta tag in static exports, the gateway origin from `STUDIO_GEN_GATEWAY_URL` |
| Boundary check | `tooling/check-gen-boundary.mjs`, `tooling/gen-boundary.json`, `package.json` `ci`, `.github/workflows/ci.yml` | After the build: no provider key name, provider host or gateway code in a browser bundle |
| Editor slot | `packages/editor-core/src/types.ts` | `EditorServices.generation?: GenerationClient \| null` (type-only) |
| Testing kit | `packages/gen-gateway/src/testing/{mockProviders,fixtures}.ts` | The Node mock provider server (Tripo-like and Meshy-like state machines, scripted faults) and code-made fixtures (cube GLB, PNG/JPEG/WebP with and without metadata, Tripo webhook signatures) |
| Smoke | `packages/gen-gateway/scripts/smoke-real.ts` | Manual real-provider run, `--confirm-spend` required, hard $5 cap, quotes first, `--record` for live exchanges. **Not run** (no keys yet) |
| Deploy | `packages/gen-gateway/deploy/{gen-gateway.env.example,gen-gateway.service.example,Caddyfile.example}` | The dev VPS runbook below |
| Layering | `tooling/check-deps.mjs`, `.oxlintrc.json`, `tsconfig.json`, `turbo.json` | gen-core: relative imports only; gen-gateway root: gen-core only, no Node globals (`node:*` only in `src/node`, `src/testing`); editor-core: gen-core types only; `apps/web/app/api/**` and the hook: `@ekza-studio/gen-gateway/next` only |

## The HTTP API (`ekza-gen/v1`)

| Method and path | Purpose |
|---|---|
| `GET /v1/providers` | `{ protocol: 'ekza-gen/v1', providers: GenProviderInfo[], caps }` — capabilities, pinned models, terms, `configured`, `byoAllowed`, the server caps and what remains of them |
| `POST /v1/uploads` | raw body, `Content-Type` image/png · image/webp · image/jpeg · model/gltf-binary → `GenUpload` (201) |
| `POST /v1/quote` | `GenRequest` → `GenQuote` (credits, USD, `exact`, items, caps) |
| `POST /v1/jobs` | `GenRequest` (+ optional `Idempotency-Key` header equal to the body's) → `GenJob`; 201 created, 200 the existing job of that key; 409 the key with another request; 422 quote above `maxCostUsd`; 402 a server cap; 409 no key configured; 503 paused |
| `GET /v1/jobs`, `GET /v1/jobs/:id` | the caller's jobs (newest first), one job |
| `GET /v1/jobs/:id/events` | SSE: `event: job` with the full `GenJob` on every change (`id` = revision), heartbeats, closes at a terminal state |
| `DELETE /v1/jobs/:id` | cancel: before the create always; Meshy while pending (refunded); otherwise 409 |
| `GET /v1/artifacts/:sha256` | the bytes, only for a caller who owns a job or upload with that hash |
| `POST /v1/hooks/:provider` | provider callbacks (only with `GEN_PUBLIC_URL`; Tripo also needs `TRIPO_WEBHOOK_SECRET`) |

Errors: `{ error: { code, message, retryable } }` (`GenApiErrorCode`). Disabled or unknown paths: a plain `404 Not Found`.

## The `GenerationClient` contract for G-d

```ts
import { createGenerationClient, type GenerationClient } from '@ekza-studio/gen-core';

interface GenerationClient {
  readonly protocol: 'ekza-gen/v1';
  readonly baseUrl: string;
  providers(signal?): Promise<GenProvidersResponse>;      // 404 → GenClientError 'not-found': hide the feature
  upload(bytes: Uint8Array, mime: UploadMime, signal?): Promise<GenUpload>;
  quote(req: GenRequest, signal?): Promise<GenQuote>;
  submit(req: GenRequest, signal?): Promise<GenJob>;     // idempotent per req.idempotencyKey
  job(id, signal?): Promise<GenJob>;
  jobs(signal?): Promise<readonly GenJob[]>;              // resume after a reload
  cancel(id, signal?): Promise<GenJob>;
  watch(id, onJob: (job: GenJob) => void, onError?): { close(): void };   // SSE, polling fallback
  artifact(a: GenArtifact | sha256, signal?): Promise<Uint8Array>;        // verified against its SHA-256
}

createGenerationClient({
  baseUrl: process.env.NEXT_PUBLIC_EKZA_GEN_GATEWAY,   // '/api/gen' (server build) · build-time URL · '' = no gateway
  token: () => operatorToken,                          // the self-host bearer token, kept in memory by the panel
  providerKey: (provider) => byoKey ?? null,           // only when providers()[i].byoAllowed
  pollMs: 3000,
});
```

How G-d uses it:

1. **Availability.** `NEXT_PUBLIC_EKZA_GEN_GATEWAY === ''` → no panel. Otherwise `providers()`: a 404 means the gateway
   is not enabled (hide), a 401 means "ask for the gateway token". Set `EditorServices.generation` to the client (or
   `null`). The response carries everything the panel shows: `capabilities` (ops, image types, low-poly and retopology
   ranges, texture modes, rest poses, rig skeletons, forward axis, typical seconds), `terms` (ownership for paid and free
   tiers, training, retention, attribution, restrictions, terms link) and the remaining caps.
2. **Inputs.** Re-encode images in the browser (`OffscreenCanvas` → **PNG**: both providers take it; Tripo does not take
   WebP) before `upload()`; the gateway rejects EXIF/XMP and sizes outside 64–8,192 px. A GLB for retopology or rig is
   uploaded as `model/gltf-binary` (self-contained, no `uri`).
3. **Request.** `GenRequest` = `{ provider, op, prompt?, images?: [{ upload, view? }], source?: { job } | { upload },
   params: { faceLimit?, lowPoly?, quad?, texture?, textureSize?, restPose?, seed?, symmetric?, skeleton?,
   heightMeters? }, idempotencyKey (16–128 of [A-Za-z0-9_-]; `crypto.randomUUID()` without dashes), maxCostUsd,
   attestation: { tier: 'paid' | 'free' | 'unknown', realPersonPhoto? } }`. Out-of-range values are refused with the
   provider's range in the message; presets (Prop ≤ 500, Character ≤ 3k, Hero ≤ 10k) map to `faceLimit` + `lowPoly`.
   Show `quote()` (USD, credits, items) before `submit()`.
4. **Progress.** `watch()` delivers `GenJob` snapshots: `queued` (`submitted` false = waiting in the gateway, true = in
   the provider's queue) → `submitting` → `running` (`progress` 0–100 over all stages) → `fetching` → `succeeded`, or
   `failed` / `blocked` / `canceled` / `expired` with `error: { code, message, retryable }`. A `timeout` error with
   `retryable: false` means the provider may have created the task: say "check the provider console" and never resubmit
   silently; a resubmit needs a new idempotency key.
5. **Import.** `artifact(job.artifacts.find(role 'model' | 'rigged'))` → bytes already hash-checked → the normal `io`
   budgets, validator and importer (`gen.import`). Thumbnails (`role: 'thumbnail'`) are optional.
6. **Provenance.** `job.provenance` is the document's `GeneratorProvenance` field for field (tested assignable):
   `{ kind: 'ai', digitalSourceType, service, model (pinned), op, params (as sent), inputSha256, termsSnapshot,
   rawSha256 (the model artifact), postSteps: [], promptSha256, prompt: null, tier, taskId }`. Write it to
   `AssetRecord.provenance = { origin: 'generated', derivedFrom: [], redistributable, generator }`; on the user's
   opt-in `withPromptOptIn(p, text)` (checks the hash, Q-GEN-5); every post step through `withPostStep(p, op,
   aiMarksMayBeAltered)` (`MARK_ALTERING_STEPS` lists reduce, palette bake, texture downsize). The `taskId` stays in the
   document only (the export drops it, ADR 0017 §7).
7. **Provider rig.** Tripo `op: 'rig'` with `skeleton: 'vrm'` (default) returns a GLB with VRM 1.0 bone names (role
   `rigged`) for `char.makeEditable`; Meshy's rig is `skeleton: 'native'` only. A rig of an earlier Tripo job is sent
   by task id (no re-upload).

## Deployment

| Mode | How | Auth | Notes |
|---|---|---|---|
| Self-host, server build | `next start` with `GEN_GATEWAY_ENABLED=1`, `GEN_GATEWAY_TOKEN`, caps, keys; the route is `/api/gen` | token (or a session hook, M4b) | the app's own origin; `GEN_DATA_DIR` for persistence |
| Standalone (dev VPS, later the Hub) | `node packages/gen-gateway/src/node/main.ts` | token behind a proxy; loopback-only bind for a gateway on one's own machine | Node ≥ 24 runs the sources; no build; `deploy/` examples |
| Static export | build with `STUDIO_GEN_GATEWAY_URL=https://gen.example.org`; the gateway allows the editor's origin in `GEN_ALLOWED_ORIGINS` | token | the build's CSP lists only that origin |

### Running the gateway on the dev VPS (when it is reachable again)

The dev editor (`studio.dev.ekza.io`) is a static export on Vercel, so it talks to a standalone gateway at a fixed
origin, e.g. `gen.dev.ekza.io`, behind the VPS's Caddy (ekza-registry `docs/dev-contour.md`; the VPS was unreachable on
2026-10-24). Verified locally from a clean export of this branch: the filtered production install is 24 kB and the CLI
answers `/healthz` and refuses unauthenticated calls.

1. **DNS** (owner, name.com, zone backed up first): `gen.dev.ekza.io` A `146.103.102.18`.
2. **Node ≥ 24** on the VPS (`node -v`; type stripping is needed).
3. **Code**: `git archive <commit> | tar -x -C /opt/ekza-gen-gateway/app`, then in it
   `pnpm install --frozen-lockfile --prod --filter @ekza-studio/gen-gateway` (no third-party packages).
4. **Secrets**: `/opt/ekza-dev/secrets/gen-gateway.env` (0600) from `deploy/gen-gateway.env.example`:
   `GEN_GATEWAY_ENABLED=1`, `GEN_GATEWAY_TOKEN=$(openssl rand -hex 32)`, `GEN_GATEWAY_HOST=127.0.0.1`,
   `GEN_GATEWAY_PORT=18787`, `GEN_CAP_DAILY_USD=5`, `GEN_CAP_MONTHLY_USD=30`,
   `GEN_ALLOWED_ORIGINS=https://studio.dev.ekza.io`, `GEN_DATA_DIR=/var/lib/ekza-gen-gateway`, `TRIPO_API_KEY`,
   `MESHY_API_KEY`; optional `GEN_PUBLIC_URL=https://gen.dev.ekza.io` + `TRIPO_WEBHOOK_SECRET`.
5. **Service**: `deploy/gen-gateway.service.example` → `/etc/systemd/system/ekza-gen-gateway.service` (user
   `ekza-gen`, `RestartPreventExitStatus=78`, sandboxing, 512 MB), `systemctl enable --now ekza-gen-gateway`.
6. **Caddy**: the site block of `deploy/Caddyfile.example` (TLS, `flush_interval -1` for SSE, 21 MB body limit) as an
   operator-managed fragment preserved across Registry deployments, like the Account API's (ekza-registry
   `deploy/dev/README.md`, Caddy section).
7. **Editor**: rebuild the dev editor with `STUDIO_GEN_GATEWAY_URL=https://gen.dev.ekza.io` (`editor-dev.sh` passes the
   environment to the static export) — after G-d, which adds the panel.
8. **Check**: `curl https://gen.dev.ekza.io/healthz` → `ok`; `/v1/providers` → 401 without the token, the provider list
   with it; the journal shows `gateway.listening`; exit 78 means the env file was refused (the message says why).

### Configuration reference (server environment; never `NEXT_PUBLIC_*`)

| Variable | Default | Meaning |
|---|---|---|
| `GEN_GATEWAY_ENABLED` | unset → disabled (404) | `1` mounts the gateway |
| `GEN_GATEWAY_TOKEN` | — | shared bearer token, ≥ 32 characters |
| `GEN_GATEWAY_HOST`, `GEN_GATEWAY_PORT` | `127.0.0.1`, `8787` | standalone bind; a loopback host without a token = loopback mode |
| `GEN_CAP_DAILY_USD`, `GEN_CAP_MONTHLY_USD` | required | server spend caps, UTC day and month |
| `GEN_ALLOWED_ORIGINS` | none | CORS origins (https, or http on loopback) |
| `GEN_PUBLIC_URL` | none | https base for webhooks |
| `TRIPO_API_KEY`, `MESHY_API_KEY` | none | provider keys (self-hosted mode) |
| `TRIPO_WEBHOOK_SECRET` | none | the Tripo endpoint's `whsec_…` |
| `GEN_BYO_KEYS` | `0` | `1` accepts `X-Gen-Provider-Key` |
| `GEN_GATEWAY_PAUSED` | `0` | kill switch for new jobs |
| `GEN_DATA_DIR` | memory | persistent jobs and blobs |
| `GEN_UPLOAD_MAX_BYTES`, `GEN_ARTIFACT_MAX_BYTES` | 20 MB, 100 MB | limits (uploads cannot exceed 20 MB) |
| `GEN_RATE_JOBS_PER_MIN`, `GEN_RATE_UPLOADS_PER_MIN` | 10, 30 | per caller |
| `GEN_LOG_LEVEL` | `info` | JSON lines on stderr, redacted |
| `GEN_BASE_PATH` | `''` | standalone path prefix |
| `GEN_TRIPO_BASE_URL`, `GEN_MESHY_BASE_URL` | the providers' | tests and the mock provider server only |
| `STUDIO_GEN_GATEWAY_URL` (build) | none | the editor build's gateway; enters the CSP |

## Tests

| Where | What |
|---|---|
| `gen-core/test/core.test.ts`, `client.test.ts` (14) | state machine, request parsing, canonical form, SSE reader, provenance assignable to the document's `GeneratorProvenance`, prompt opt-in hash check; the client's auth header, BYO header only on quote/submit, error envelopes, protocol check, artifact integrity, SSE then polling fallback |
| `gen-gateway/test/config.test.ts` | default deny: disabled = 404 everywhere (incl. hooks and OPTIONS); keys without auth refused (keys named, values not printed); loopback only standalone; token strength; caps required, daily ≤ monthly; URL checks |
| `handler.test.ts` | auth, loopback anti-proxy/anti-rebinding, CORS, upload checks (EXIF/XMP in PNG, JPEG, WebP; type mismatch; size; GLB `uri`) |
| `jobs.test.ts` | full jobs against the mock: Tripo image → P1 with provenance; prompt never in logs or rows; Meshy preview → refine billing; idempotency (concurrent submits, conflict); over-budget and spend caps; **never re-POST** after a dropped or hanging create; 429 retried / 402 failed; status 503s, step-back, moderation blocks; truncated, invalid and expired downloads; remesh of an uploaded GLB; VRM rig by task id; cancel rules; session isolation of jobs and artifacts; BYO on/off and redaction; restart recovery with file stores (resume, ghost `submitting`, unsent queued) |
| `webhooks.test.ts` | Tripo HMAC: valid, duplicate delivery, wrong secret, outside the window, altered body, garbage; the body is never trusted; Meshy hints |
| `contract.test.ts` | recorded exchanges (documentation examples, 2026-10-24) for every Tripo and Meshy call the adapters make, exact request bodies; pinned models; quote rules |
| `standalone.test.ts` | real HTTP server in loopback mode incl. SSE; refusal → `GatewayConfigError`; the CLI exits 78 without printing the key; the redacting logger |
| `boundary.test.ts`, `tooling/test/check-gen-boundary.test.mjs` | the boundary list covers every adapter variable and host; the check finds key names, hosts and the marker, and fails on a missing build |
| `apps/web/test/csp.test.ts` | the policy and the gateway-origin rules |
| `apps/web/e2e/gen-00-boundary.spec.ts` | the route is 404 unless enabled (GET/POST, hooks, artifacts); the CSP header on `/`, `/editor`, `/autorig`, `/app`; no `securitypolicyviolation` while the editor boots and loads Polybot, Auto-Rig and `/app` boot; a direct fetch to a provider origin is blocked |

Manual checks on the production build (recorded here, not automated): `next start` without the variable → 404 on
`/api/gen/*` and the CSP header on `/editor`; with `TRIPO_API_KEY` and no token → exit 78 with the reason; with a token
and the mock providers → a Meshy image job through `/api/gen` (`submitting > queued > running > fetching > succeeded`,
artifact verified); a static export with `STUDIO_GEN_GATEWAY_URL=https://gen.dev.ekza.io` → no gateway route, the meta
policy lists only that origin, `check:gen-boundary` clean on `out/`.

## Measurements

Production build (`check:size`, gzip -9, first visit): `/editor` 897,211 B, `/autorig` 657,809 B, `/app` 715,694 B —
**unchanged** (the gateway is server-only; the slot is a type). Gate: see the final gate record below.

## Owner actions

1. **Provider accounts and keys** (the API refuses free accounts at Meshy; both bill through Stripe in USD, so a
   non-Russian card or entity is needed — research 15 A.5):
   - Tripo international (developers.tripo3d.ai): buy credits (from $1; $10–20 covers testing), create an API key →
     `TRIPO_API_KEY`. Optional: a webhook endpoint `https://gen.dev.ekza.io/v1/hooks/tripo` → `TRIPO_WEBHOOK_SECRET`.
   - Meshy (meshy.ai): a paid plan (Pro $20/month is the minimum for API access), an API key → `MESHY_API_KEY`; set the
     key's monthly credit limit and its IP allow-list (the VPS address) in the Meshy console as a second fence.
2. **Caps and token**: `GEN_CAP_DAILY_USD` / `GEN_CAP_MONTHLY_USD` (suggested 5 / 30 for dev), a fresh
   `GEN_GATEWAY_TOKEN` shared only with testers.
3. **First real run** (≈ $0.40; `--full` ≈ $1.50; hard cap $5):
   `TRIPO_API_KEY=… MESHY_API_KEY=… node packages/gen-gateway/scripts/smoke-real.ts --confirm-spend --out <dir> --record packages/gen-gateway/test/recorded/live`
   — then replace the documentation-derived recordings with the live ones (M7-GC-7) and settle the Tripo `whsec_` key
   question (M7-GB-10).
4. **Written confirmations (Q-GEN-4)** before a hosted platform key or BYO keys on an Ekza-hosted gateway:
   - Tripo: (a) may one Ekza account's key serve many users of a hosted editor (platform key)? (b) may users' own keys
     pass through Ekza's hosted gateway, given §3.2 (no transfer of credentials without written approval)? (c) the HMAC
     key: the whole `whsec_…` string or without the prefix?
   - Meshy: (a) is a hosted gateway with one paid account serving many users allowed under §2.6 (v) (no reselling or
     redistributing access) and (vi) (no multiple users per account)? (b) BYO keys through Ekza's gateway? (c) may
     reduce and palette bake alter the invisible AI marks of outputs (provenance records `aiMarksMayBeAltered`)? (d) API
     retention for Studio plans: 3 days (terms, docs) or 14 days (pricing page)? (e) a no-training option short of
     Enterprise?
5. **Decide** (DECISIONS §T): the G2 third adapter (fal.ai proposed, M7-GC-8) and the Russia-billed route (M7-GC-9).
6. **Dev VPS**: DNS and the Caddy fragment for `gen.dev.ekza.io` when the server is back (runbook above).

## Deviations and open items

- **Recordings are from the documentation**, not live traffic (no keys) — M7-GC-7; the smoke script records live ones.
- **Not built in G-b/G-c**: the panel, operators and post-chain (G-d), the E2E-GEN-01…04 scenarios against the mock
  gateway and the self-host guide (G-e). The mock provider server is importable from
  `@ekza-studio/gen-gateway/testing` (`startMockProviders({ pollsToFinish, pollsQueued, modelBytes, keys })`, faults
  by `inject(…)`) so G-e can run the e2e server with `GEN_TRIPO_BASE_URL`/`GEN_MESHY_BASE_URL` pointed at it; its
  `modelBytes` hook can serve a repository fixture (e.g. a rigged character) instead of the cube.
- **Long-running servers only**: the engine polls providers and downloads results in the background of the process
  that created the job, so the Next mount needs `next start` (or the standalone server), not a serverless platform
  whose functions stop after the response.
- **Multiview** is not offered (M7-GC-6).
- **CSP limits** (M7-GB-11): `'unsafe-inline'` scripts; the static meta tag follows Next's first preload tags.
- **Stores**: JSON files, one process per data directory; no garbage collection of blobs or old job rows yet (a
  retention job belongs with G3's hosted mode).
- `GEN_API_KEY`, `FAL_KEY`, `RODIN_API_KEY`, `HYPER3D_API_KEY`, `TENCENTCLOUD_SECRET_*`, `STABILITY_API_KEY` are
  already on the boundary list so later adapters inherit the check.
- Trademarks: no third-party DCC or auto-rigging-service names in code or docs (TM-1); provider names appear only as
  integration targets, as in ADR 0017.

## Final gate

`EKZA_E2E_PORT=3185 pnpm run ci` at `d5347bbb` (the code of this branch; the later commit adds documentation only),
2026-10-24, **green**:

| Step | Result |
|---|---|
| `format:check`, `lint` (oxlint type-aware), `typecheck` (`tsc -b`) | clean (2,800 files formatted) |
| `check:deps` / `check:fixtures` / `check:licenses` | 24 packages follow the rules / 25 fixtures / 177 production packages allowed (no new third-party dependency) |
| `test` | 25 of 25 turbo tasks (16 cached from the previous run of the same inputs): gen-core 14, gen-gateway 63 (7 files), tooling 40 |
| `build`, `check:size` | `/editor` 897,211 B, `/autorig` 657,809 B, `/app` 715,694 B — all ≤ 5,000,000 B and unchanged |
| `check:gen-boundary` | no provider key name, provider host or gateway code in `apps/web/.next/static` |
| `test:e2e` | **475 passed**, 99 skipped, 0 failed (5.4 min), `gen-00-boundary` 5/5 |

The first run stopped on a halo unit test that timed out at 5 s with the machine at load average 40 (it passes
alone, 12/12); the second on this branch's own CSP unit test (`'wasm-unsafe-eval'` contains the substring
`unsafe-eval`), fixed in `d5347bbb`.
