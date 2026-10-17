# 06 — Real-time collaborative animation architecture

Status: research / proposal · Date: 2026-10-17 · Scope: how Ekza Animator lets several people animate in one session, and what the **MVP document model must already do** so that collaboration is an additive change later.

Related: `03-ekza-reuse-audit.md` §8 (why `ekza-rust-server` cannot host this as is). This document goes further: concrete schema, store boundary, undo semantics, measured CRDT behaviour, phasing.

---

## 0. TL;DR (decisions)

| # | Decision | Why (short) |
|---|---|---|
| D1 | **Yjs 13.6.x** is the document CRDT. **Loro 1.16** is the named alternative behind the same boundary. Automerge 3, Liveblocks and a custom OT server are rejected for now. | Most mature sync, presence and server ecosystem (Hocuspocus, y-indexeddb, yrs). Pure JS (the unminified ESM build is about 63 KB gzipped). Per-key LWW maps fit animation data. §3, §4 |
| D2 | **P0 ships the Yjs-backed `DocumentStore` locally (no network)** behind our own interface. Domain code never imports `yjs`. | P1 then only *adds a provider*, which is smaller than swapping the store. The boundary also protects against Yjs 14 (still RC) and keeps a Loro adapter possible. §7 |
| D3 | **Flat, ID-keyed maps of plain values**: `keys: Map<KeyId, KeyTuple>` plus a `curves` registry. No lazily created nested containers at deterministic addresses. | Measured: concurrent lazy creation of the same nested `Y.Map` **silently drops one user's keys**. Flat entries never collide. §4.2 |
| D4 | **Our own patch-based undo manager** (per user, compare-before-restore), not `Y.UndoManager`. | Measured: `Y.UndoManager` can make a contested key **vanish** on undo. Our undo also spans several docs and works identically offline. §9 |
| D5 | **Drag = local preview, commit on pointer-up.** Collaborators see the drag as a ghost through presence at about 15 Hz. | 10-key drag streamed at 60 Hz for 10 s = **485 KiB on the wire** and 600 undo-relevant transactions. One commit = **0.8 KiB**. §4.3 |
| D6 | **Partition**: `scene`, `char:<id>` (rig/controls), `clip:<id>` (layers/curves/keys), `review` docs per project. | CRDT servers authorize **per document**, not per op. Hard per-character permissions (P2) and lazy loading need doc boundaries now. §6, §11 |
| D7 | **Soft locks ("claims") in presence**, optional persistent assignments in the doc. No hard locking in P1. | Prevents most semantic conflicts without blocking offline or reconnecting users (Blender Multi-user and Unreal Multi-User use ownership and locks for the same reason). §8 |
| D8 | **Binary data never goes in the CRDT**: GLB/VRM/textures/dense sampled tracks are content-addressed (`sha256` + size) blobs. Docs hold refs only. | Dense 66k samples: 1.79 MB as CRDT items vs 258 KiB as one blob. Hash refs match Registry rendition contracts. §10 |
| D9 | **P1 server: Hocuspocus 4 (MIT) as a separate Node service**, with SQLite (self-host) or Postgres/S3 persistence and Redis for scale. **Not inside `ekza-rust-server`.** A Rust `yrs` server stays a P3 option. | Auth hooks, read-only connections, debounced persistence, multiplexed docs, all MIT. Next.js serverless cannot hold WebSockets. §3, §14 |
| D10 | **Auth (P2)**: the Next.js backend checks the Ekza (Supabase) session and project role, then mints a **short-lived collab JWT** (`sub`, `project`, `docs`, `role`). The sync server verifies only that token. | Decouples the sync server from Supabase and keeps self-hosting with any IdP possible. §11 |
| D11 | **"Four hands" on one character**: support it through **per-user animation layers + region claims** (P3). Do not support it as free co-editing of the same curves. Prioritise scenario A (two characters) and C (review). | Body mechanics are coupled through hips, COG and spine, so an arms-vs-legs split is low value. A face/fingers/secondary split, mentoring and review are high value. §16 |

---

## 1. Scenarios and what each one requires

| Scenario | Users do | Conflict surface | Must have | Value for pros |
|---|---|---|---|---|
| **A. Two characters, one scene** | Each animates own character, sees the other live (contact, eyelines, timing) | Almost none: disjoint `char:`/`clip:` docs. Shared: scene range/fps, props, cameras | Live sync, presence (who and where), per-character assignment, shared playback/follow | **High**: interaction shots (fights, handshakes, dialogue) are hard to time blind |
| **B. Same character, "four hands"** | A on arms, B on legs (or body vs face/fingers) | Hips/root/spine (shared FK parents), IK targets, shared selection sets, the same curves | Region claims, per-user layers, remote previews, conflict-aware undo | **Low to medium** (see §16); high only for face/fingers/secondary passes and mentoring |
| **C. Review** | Viewer scrubs, leaves frame-anchored notes, optionally draws over the viewport | None on animation data (comments are their own doc) | Comment threads anchored to clip + frame range + control + camera; presenter/follow playback; read-only roles | **High**: replaces "export playblast → send → notes in chat" |

---

## 2. Prior art: what others do and what we take

| System | Model | Lesson for us |
|---|---|---|
| **Figma** multiplayer | Server-authoritative, **LWW per (object, property)**, client-generated IDs (client id inside object id), fractional indexing for child order, parent link stored on the child. Undo rewrites redo history at undo time. Offline edits are reapplied on a fresh copy ([Figma blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)) | Animation data is "Figma-shaped": many small records with LWW properties, no rich text. Use client-generated IDs, fractional order and parent-on-child. Undo must not clobber others |
| **tldraw sync** | Server-authoritative push/pull/**rebase** of record diffs, one room instance globally (Durable Objects), deliberately not a CRDT ([docs](https://tldraw.dev/docs/sync), [TLSyncClient](https://tldraw.dev/reference/sync-core/TLSyncClient)) | Shows that a record-store plus an authoritative server is viable. Our op-based `DocumentStore` keeps that route open (§3, option 10). tldraw's licence is not OSS-compatible for reuse, so we take ideas only |
| **Unreal Multi-User Editing** | Server records transactions and relays them. Level edits sync immediately, most assets sync **on save** with locks. Sequencer playback sync is **not frame-accurate** across machines ([Epic docs](https://dev.epicgames.com/documentation/unreal-engine/multi-user-editing-overview-for-unreal-engine)) | Coarse ownership of heavy assets works. Shared playback should be "same frame, approximately", with an explicit presenter |
| **NVIDIA Omniverse Live Sessions** | A "Live Layer" is inserted into the USD layer stack. A **Presenter** controls the timeline for review ([omni.kit.usd.layers](https://docs.omniverse.nvidia.com/kit/docs/omni.kit.usd.layers/2.7.2/Overview.html)) | Layers are the natural unit of parallel animation work, which is our P3 per-user layers. Presenter role for review |
| **Blender Multi-user add-on** | Replicates results, not operators. **Datablock rights**: owned by one user or common ([features](https://multi-user.readthedocs.io/en/latest/about/features.html)) | Ownership per datablock is the practical conflict avoider. Our claims are the soft version |
| **Maya animation layers** | Additive/override layers with weight, mute/solo and merge ([Autodesk](https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-BBCA0BC3-7608-4E86-8E9F-B4099C316156.htm)) | Per-user override/additive layers turn same-curve conflicts into an explicit merge step that animators already understand |
| **`ekza-rust-server`** (Space) | Socket.IO events. **Whole room state replaced** per update with `serverRevision` optimistic concurrency (`stale_revision` reject). One JSON file per room, single process, ≤200 objects, `room_updates` bucket 10 burst / 2 per s | Correct for Space layouts, wrong for animation: every key edit would resend the doc, and concurrent editors would get constant `stale_revision`. Reuse **patterns only**: persist before broadcast, token buckets, origin guard, duplicate-tab presence claims, server-side Ekza session verification (`realtime/ekza.rs`) |

---

## 3. Options evaluated

Versions were checked on 2026-10-17 against the npm registry and crates.io.

| # | Option | Version / licence | Pros | Cons | Verdict |
|---|---|---|---|---|---|
| 1 | **Yjs + Hocuspocus** | `yjs@13.6.33` MIT. `@hocuspocus/server`/`provider@4.7.1` MIT (4.x stable since May 2026; runs on Node/Bun/Deno/Workers; extensions `database`, `sqlite`, `s3`, `redis`, `throttle` @4.7.1) | Mature. `onAuthenticate` with `connection.readOnly`, debounced `onStoreDocument`, `onChange`, awareness hooks, **multiple docs over one socket** (`HocuspocusProviderWebsocket`). Redis horizontal scaling | Node service to run. No per-op authorization (true of every CRDT server) | **P1 choice** |
| 2 | Yjs + `y-websocket` | `y-websocket@3.1.0` (client only), `@y/websocket-server@0.1.5` MIT | Minimal, standard y-sync wire | No auth or persistence hooks out of the box; you fork the server | Dev/e2e only |
| 3 | Yjs + `y-webrtc` | `10.3.0` (last release Dec 2023) | P2P, no server for data | Needs signalling and TURN, no persistence, no authority, weak on NAT | LAN/demo only |
| 4 | Yjs + **PartyServer / `y-partyserver`** on Cloudflare Durable Objects | `y-partyserver@2.2.0` ISC (PartyKit acquired by Cloudflare in 2024) | One DO per room, cheap global hosting | Vendor lock to Workers/DO. Self-hosters need another server | Optional hosted adapter later |
| 5 | **y-sweet** (Rust, S3) | crate `y-sweet@0.9.1` (last release Sep 2025) MIT | Rust + yrs, S3 persistence, client tokens | Release activity stalled since Sep 2025, so maintenance is uncertain | Watch, do not depend |
| 6 | **yrs inside `ekza-rust-server`** | `yrs@0.28.0` (Sep 2026) MIT, has `sync::{Awareness, Protocol, Message}` and `undo`. `yrs-axum@0.8.2` (Mar 2025, third party) | Rust stack consolidation, same CRDT as clients | The server is Space-specific (Solana room ids, wallet auth, file-per-room JSON, single process, **no licence file**). JS clients would need a custom Socket.IO Yjs transport. Release coupling with Space | **Not in that server.** P3 option: a *separate* axum + yrs service speaking the same wire protocol |
| 7 | **Automerge 3** + automerge-repo | `@automerge/automerge@3.5.0` MIT. `automerge-repo` latest tag `2.6.0-alpha.3` | Best history/branching story. 3.0 cut memory more than 10x ([blog](https://automerge.org/blog/automerge-3/)). Smallest saved size in our test | WASM about 3.6 MB raw. Load was 7x slower than Yjs in our test. Nested objects become CRDT maps, so there are no opaque values. Thinner server/presence ecosystem | Rejected for now |
| 8 | **Loro** | `loro-crdt@1.16.4`, crate `loro@1.16.2` MIT. `loro-websocket@0.6.x` | Compact snapshots (about 0.55x Yjs on the flat layout), shallow snapshots, **movable tree** (good for scene graph and future modeling), version DAG/time travel, `EphemeralStore` with per-key presence updates ([v1.5](https://loro.dev/changelog/v1.5.0)), Rust core | WASM about 3.4 MB raw / 1.1 MB gzipped. Server/protocol still 0.x ([Loro Protocol](https://loro.dev/blog/loro-protocol)) | **Alternative**; re-evaluate at P1 start |
| 9 | **Liveblocks** | client `3.24.3` Apache-2.0. Server `@liveblocks/server` **AGPL-3.0**, open-sourced Feb 2026 for dev/test; production self-hosting "not quite yet" ([blog](https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server)) | Polished presence, comments and notifications | SaaS dependency. Cannot be the default for a self-hostable OSS tool | Community provider at most |
| 10 | **Custom authoritative ops** (Figma/tldraw style) | n/a | Per-op validation and permissions, simplest mental model for LWW records | We would build offline rebase, presence, persistence and reconnection ourselves | Not now. Our op-based store API keeps it possible later |

**Why Yjs over Loro today:** the server side decides it. Hocuspocus 4 already gives auth hooks, read-only connections, persistence backends, Redis fan-out and multi-doc multiplexing under MIT. `yrs` gives a Rust path for Ekza services (export workers, OMOBA tooling). Loro is technically attractive, especially the movable tree and compact snapshots, so the boundary in §7 is designed to make a `LoroDocumentStore` a contained rewrite.

**Yjs 14:** `yjs` `latest` is still 13.6.33. v14 is a pre-release line (GitHub `v14.0.0-rc.29` on 2026-10-15; npm `@y/y` publishes `14.0.0-rc.*`) with planned breaking changes. Pin `yjs@~13.6` and confine it to one package.

---

## 4. Measured: CRDT behaviour on animation-shaped data

The method is in Appendix A. It was run with Node 25 on 2026-10-17. The workload is one character with a 56-control rig: rotate XYZ per control plus root translate XYZ = **171 curves × 40 keys = 6,840 keys**. That is a dense hand-keyed 10 s shot.

### 4.1 Size and load per character (one clip doc)

| Layout | Yjs V1 | **Yjs V2** | Load (V2) | Loro snapshot |
|---|---|---|---|---|
| A. Nested `Y.Map` per curve, key = plain object | 714 KiB | 642 KiB | 27 ms | — |
| B. Flat `keys` map, full curve address string in every key | 995 KiB | 975 KiB | 23 ms | — |
| C. Flat `keys` map + `curves` registry (8-char curve id in key) | 791 KiB | 771 KiB | 22 ms | 429 KiB |
| **D. = C with tuple-encoded keys (recommended)** | 497 KiB | **477 KiB** | **10 ms** | — |

Other measurements:

- **Editing history:** in a separate nested-layout run (10-char ids, slightly different key fields; 589 KiB initial), 5,000 random committed key edits grew the doc only to 615 KiB. Yjs garbage-collects overwritten map values.
- **Library comparison** on that same nested-object data:
  - Yjs 589 KiB, 26 ms load, about 3.2 MB JS heap.
  - Loro 402 KiB snapshot, or 240 KiB as a shallow snapshot after the edits, 32 ms load.
  - Automerge 236 KiB saved, 191 ms load.
  - WASM heap figures for Loro and Automerge were not measured reliably.
- **Takeaway:** a 4-character scene with dense keys is about 2 MB in Yjs. That is comfortable. Doc size is not the constraint; data loss patterns are (§4.2).

### 4.2 Semantics hazards (all reproduced)

| ID | Situation | Yjs result | Design response |
|---|---|---|---|
| **H1** | A and B both lazily create `curves["ctl:X/rotate.x"] = new Y.Map()` and insert a key | **One container wins and the other user's key is silently gone** | Rule R1: never lazily create nested containers at deterministic addresses. Use a flat `keys` map plus a `curves` registry with random ids. Duplicate curve records merge in projection without loss |
| **H2** | A deletes a container (layer) while B inserts into it | B's insert is lost | Rule R4: soft-delete structural records (`deleted` field). Hard-delete only leaf keys |
| **H3** | A deletes a key while B edits it | Edit wins (key reappears) | Acceptable ("edit beats delete"). Document it in UX |
| **H4** | A and B set the same key concurrently, then A undoes with `Y.UndoManager` | If A won: **key disappears** (A's item deleted, prior value not restored because a remote item exists). With `ignoreRemoteMapChanges: true` the old value is restored even when **B** won, which silently discards B's edit | Decision D4: own compare-before-restore undo (§9) |
| **H5** | Sequential overwrite (B overwrites after seeing A's value), then A undoes | B's value kept (correct) | Our undo reproduces this: skip and report |
| **H6** | Streaming a 10-key drag at 60 Hz for 10 s | Wire 485 KiB, V1 doc growth 52.6 KiB. V2 compresses the deleted runs | D5: preview locally, commit once (0.8 KiB) |
| **H7** | Dense sampled data (55 bones × 4 quaternion components × 300 frames = 66k samples) | 1.79 MB as map items vs **258 KiB** as one `Uint8Array` | D8: sampled tracks are blobs (asset refs) |
| **H8** | Map metadata growth with alternating writes to many keys | Known Yjs behaviour (the `y-utility` `YKeyValue` rationale; V2 encoding mitigates on the wire, not in memory) ([forum](https://discuss.yjs.dev/t/is-ykeyvalue-still-necessary-with-yjs-update-version-2-optimizations/3516)) | Budgets plus versioned compaction (§10.4) |

### 4.3 Convergence of disjoint work

Concurrent edits by A (arm keys) and B (leg keys) always converged to the union. With per-user undo, A's undo restored only A's keys. This is the property scenario A and the region-claimed scenario B rely on.

---

## 5. Design rules for a CRDT-ready animation document

These rules apply from P0, even with no network.

| Rule | Statement |
|---|---|
| **R1** | **Stable random IDs, never array indices.** Keys use `nanoid(12)`; other records use `nanoid(16)` (URL-safe). IDs are generated on the client and are valid offline. |
| **R2** | **Flat maps of plain immutable values** (`Map<Id, Value>`). A value is replaced as a whole, so its record is the LWW unit. Nested CRDT containers are allowed only for records created by a single writer with a random id, e.g. a node's property map. |
| **R3** | **Granularity = what two people may legitimately change at once.** One key is one LWW unit (time, value, tangents together). One curve's metadata is one unit. Node and control properties are per-property LWW (nested map per record). Scalar channels are separate curves, so `rotate.x` and `rotate.y` never conflict. |
| **R4** | **Soft-delete structural records** (`deleted: {by, at}`), hard-delete leaf keys. Garbage-collect tombstones only during compaction (§10.4). |
| **R5** | **Store intent, never derived data.** Auto, clamped and plateau tangents are computed at evaluation from neighbours, and only `fixed`/broken handles are stored. Baked world matrices, caches and thumbnails stay out of the doc. Otherwise one user's key edit would rewrite neighbours' tangents and create false conflicts. |
| **R6** | **Integer time.** Store key times as integer **flicks** (705,600,000 per second, exact for 24/25/30/48/50/60/90/100/120 fps; [Flicks](https://github.com/facebookarchive/Flicks)). Then "same frame" equality is exact for deduplication, and an fps change never rescales stored keys. 2^53 flicks ≈ 147 days. |
| **R7** | **Order by fractional index strings** (`fractional-indexing@4.0.0`, CC0) for layers, nodes and controls. Keys need no order because they are sorted by `t` in projection. |
| **R8** | **Parent pointer on the child** (Figma). Cycles from concurrent reparenting are broken deterministically in projection: the node with the smallest id in the cycle is detached. |
| **R9** | **Projection resolves invariants deterministically and never writes during read.** For duplicate times on a curve, the winner is the key with the greatest `KeyId`; losers are hidden and flagged. For duplicate curve records with the same `(layer, target, channel)`, the canonical curve is the smallest `CurveId` and keys are unioned. Dangling refs are ignored in evaluation and listed in an "Orphans" panel. Cleanup writes happen later, as normal undoable transactions by the claim holder. |
| **R10** | **Binary data and dense samples go to the content-addressed asset store.** The doc holds `AssetRef {sha256, size, mime}` only. |
| **R11** | **Schema version in every doc** (`meta.schemaVersion`, `meta.minWriterVersion`). Migrations must be deterministic and idempotent, because two clients may migrate concurrently and must produce identical writes (derive new ids from old ids). Older clients open newer docs read-only. |
| **R12** | **No user-local UI state in the doc.** Free viewport cameras, panel layout, graph zoom, current time and selection are presence or local preferences. Shot cameras and bookmarks are doc data. |

---

## 6. Document schema proposal

TypeScript-ish. `YMap<K, V>` means a Yjs `Y.Map`. Values are plain JSON unless marked. The canonical domain types live in the doc-model research and code; this is the **CRDT mapping**.

### 6.1 Partition (document names = Hocuspocus document names)

```
project/<projectId>/scene          meta, nodes (scene graph), assets, cameras/bookmarks
project/<projectId>/char/<nodeId>   one per character: rig binding, controls, constraints, selection sets
project/<projectId>/clip/<clipId>   one per clip (targets one character): layers, curves, keys, sampled tracks, markers
project/<projectId>/review         comment threads and messages
```

Why: per-doc ACL (§11), lazy loading (open only visible characters and active clips), export per clip, bounded doc sizes. **Cross-doc writes are not atomic.** Every multi-doc operation is written in dependency order, is idempotent, and tolerates partial application. For example, "create character" writes the `char` doc first and the scene `node` second; a node whose char doc is missing renders as "loading/missing".

### 6.2 Shared types

```ts
type Id = string;            // nanoid, URL-safe
type Flicks = number;        // integer, 705_600_000 per second
type UserId = string;        // auth subject (Ekza account id or local id)
type Tombstone = { by: UserId; at: number } | null;   // R4
type AssetRef = { sha256: string; size: number; mime: string; name?: string };

type DocMeta = {             // YMap 'meta' in every doc (per-property LWW)
  kind: 'scene' | 'char' | 'clip' | 'review';
  schemaVersion: number;     // e.g. 1
  minWriterVersion: number;  // clients below this open read-only
  projectId: Id;
};
```

### 6.3 Scene doc

```ts
interface SceneDoc {
  meta: YMap<keyof SceneMeta, unknown>;   // DocMeta & SceneMeta
  assets: YMap<Id, AssetRef & { role: 'model' | 'texture' | 'audio' | 'reference' }>;
  nodes: YMap<Id, YMap<keyof NodeProps, unknown>>;   // single-writer creation, per-property LWW
  bookmarks: YMap<Id, CameraBookmark>;               // shared camera views (not user free cams)
}
interface SceneMeta {
  name: string;
  fps: { num: number; den: number };       // display/snap rate; keys stay in flicks
  range: { start: Flicks; end: Flicks };
  upAxis: 'Y'; unit: 'm';
}
interface NodeProps {
  kind: 'character' | 'prop' | 'camera' | 'light' | 'group' | 'spline' /* future modeling */;
  name: string;
  parent: Id | null;                // R8
  order: string;                    // fractional index among siblings (R7)
  transform: { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] };
  asset?: Id;                       // -> assets (GLB/VRM) for character/prop
  charDoc?: Id;                     // character only: id used in project/<p>/char/<id>
  assignee?: UserId | null;         // persistent "who animates this" (scenario A), advisory
  deleted: Tombstone;
}
```

### 6.4 Character doc (rig and control rig)

```ts
interface CharDoc {
  meta: YMap;                                   // DocMeta & { node: Id; skeleton: 'vrm1-humanoid' | 'gltf-nodes' }
  bones: YMap<Id, BoneRef>;                     // stable ids for skeleton joints
  controls: YMap<Id, YMap<keyof ControlProps, unknown>>;
  selectionSets: YMap<Id, { name: string; controls: Id[]; color?: string; deleted: Tombstone }>;
}
type BoneRef = { humanoid?: string /* VRM humanBone name, e.g. 'leftUpperArm' */; nodePath?: string; deleted: Tombstone };
interface ControlProps {
  name: string;                                 // e.g. 'L_arm_FK_ctrl'
  parent: Id | null; order: string;             // control hierarchy
  shape: { kind: 'circle' | 'square' | 'arrow' | 'box'; radius: number; normal: 'X' | 'Y' | 'Z'; color: string };
  drives: { bone: Id; constraint: 'parent' | 'orient' | 'point'; offset: number[] /* 4x4 or TRS */ } | null;
  rest: { t: number[]; r: number[]; s: number[] };
  channels: { [ch in ChannelName]?: { keyable: boolean; locked: boolean; min?: number; max?: number } };
  rotateOrder: 'XYZ' | 'YZX' | 'ZXY' | 'XZY' | 'YXZ' | 'ZYX';
  deleted: Tombstone;
}
type ChannelName = 'translate.x' | 'translate.y' | 'translate.z' | 'rotate.x' | 'rotate.y' | 'rotate.z'
                 | 'scale.x' | 'scale.y' | 'scale.z' | `attr.${string}`;   // e.g. attr.ikFkBlend, attr.space
```

### 6.5 Clip doc (the hot document)

```ts
interface ClipDoc {
  meta: YMap;                    // DocMeta & ClipMeta
  layers: YMap<Id, Layer>;       // plain values (R2)
  curves: YMap<Id, CurveMeta>;   // curve registry, random 8-12 char ids
  keys: YMap<Id, KeyTuple>;      // ALL keys of the clip, flat (R1, R2, D3)
  samples: YMap<Id, SampledTrack>;   // dense imported/mocap data as blob refs (R10)
  markers: YMap<Id, { t: Flicks; label: string; color?: string; deleted: Tombstone }>;
}
interface ClipMeta {
  name: string;                  // export name; Ekza clip slot vocabulary (see 03 §6.3)
  character: Id;                 // scene node id
  range: { start: Flicks; end: Flicks };
  loop: boolean;
}
interface Layer {
  name: string;
  mode: 'override' | 'additive';
  weight: number; mute: boolean; solo: boolean;
  order: string;                 // fractional index; base layer = lowest
  owner: UserId | null;          // P3 per-user layers ("four hands")
  deleted: Tombstone;
}
interface CurveMeta {
  layer: Id;
  target: { kind: 'control' | 'bone' | 'morph' | 'node'; id: Id };
  channel: ChannelName;
  pre: Infinity; post: Infinity;   // 'constant'|'linear'|'cycle'|'cycleOffset'|'oscillate'
  color?: string; locked?: boolean; muted?: boolean;
  deleted: Tombstone;
}
type Infinity = 'constant' | 'linear' | 'cycle' | 'cycleOffset' | 'oscillate';

/** Storage codec v1. Domain code sees `Key`, never the tuple. */
type KeyTuple = [curve: Id, t: Flicks, v: number, flags: number, ix: number, iy: number, ox: number, oy: number];
interface Key {                  // decoded
  curve: Id; t: Flicks; v: number;
  inType: TangentType; outType: TangentType;   // flags bits 0-2 / 3-5
  broken: boolean;               // bit 6
  weighted: boolean;             // bit 7
  inHandle: [dtSeconds: number, dv: number];   // only meaningful when inType === 'fixed' (R5)
  outHandle: [dtSeconds: number, dv: number];
}
type TangentType = 'auto' | 'spline' | 'clamped' | 'flat' | 'linear' | 'step' | 'plateau' | 'fixed';
interface SampledTrack {
  layer: Id; target: { kind: 'bone' | 'control'; id: Id };
  layout: 'quat' | 'vec3' | 'scalar';
  fps: { num: number; den: number }; start: Flicks; count: number;
  data: AssetRef;                // little-endian Float32Array blob
  deleted: Tombstone;
}
```

Notes:

- Concurrent first keys on the same `(layer, target, channel)` can create two `CurveMeta` records. Both survive, projection unions their keys, and the claim holder later re-points keys to the canonical curve (R9). Nothing is lost (contrast with H1).
- A key move in time is `keys.set(id, newTuple)`, so identity is preserved. A concurrent tangent edit by someone else loses to LWW. Claims (§8) make that rare.
- Tuple encoding cut Yjs size by 38% (771 → 477 KiB) and halved load time. The codec is versioned through `meta.schemaVersion`; new fields are appended and missing trailing fields get defaults.
- Keep `Key` independent of three.js. The evaluator compiles curves into `Float32Array`/three `KeyframeTrack` caches, invalidated per curve by store change events.

### 6.6 Review doc

```ts
interface ReviewDoc {
  meta: YMap;
  threads: YMap<Id, {
    anchor: { clip: Id; start: Flicks; end: Flicks; control?: Id; camera?: CameraBookmark; sketch?: AssetRef /* draw-over PNG/SVG */ };
    status: 'open' | 'resolved'; createdBy: UserId; createdAt: number; deleted: Tombstone;
  }>;
  messages: YMap<Id, { thread: Id; author: UserId; body: string /* markdown, author-only LWW edits */; createdAt: number; editedAt?: number; deleted: Tombstone }>;
}
```

### 6.7 Presence (ephemeral, never persisted)

```ts
interface Presence {                     // Yjs awareness local state; keep < 1 KiB JSON
  v: 1;
  user: { id: UserId; name: string; color: string };  // color from a palette that avoids X/Y/Z red/green/blue and selection yellow
  view: { clip?: Id; panel?: 'viewport' | 'graph' | 'dope' };
  time: { t: Flicks; playing: boolean; rate?: number; since?: number };
  sel: { controls: Id[]; keys?: Id[] /* capped at 200 */ };
  claims: Claim[];
  cursor?: { panel: 'graph'; t: Flicks; v: number } | { panel: 'viewport'; ndc: [number, number] };
  drag?: { kind: 'keys' | 'control'; ids: Id[]; delta: number[] };  // ghost preview, about 15 Hz
  follow?: UserId;                        // following someone's time/camera
  presenting?: boolean;                   // review presenter
}
interface Claim { scope: 'character' | 'selectionSet' | 'control' | 'layer' | 'rig'; id: Id; since: number }
```

Graph-editor cursors are expressed in **curve space** `(t, v)`, so they map correctly across different zooms. If peers look at different curves, the UI shows a chip such as "Alice · L_hand_ctrl.rotate.z" instead of a cursor.

---

## 7. MVP abstraction boundary

### 7.1 Package layout (monorepo)

```
packages/doc-model      // pure TS: ids, Key/Curve/Layer types, codecs, invariants resolver, projection. No yjs, no three.
packages/doc-store      // interfaces below + UndoManager + PreviewSession + contract test suite
packages/doc-store-yjs  // the ONLY package that imports 'yjs' / '@hocuspocus/provider' / 'y-indexeddb'
packages/asset-store    // content-addressed blobs: OPFS/IndexedDB (local), presigned HTTP (remote)
apps/web                // Next.js + R3F; talks to DocumentStore, PresenceChannel, AssetStore only
apps/sync               // (P1) Hocuspocus server
```

Enforce the boundary with ESLint `no-restricted-imports`: `yjs`, `@hocuspocus/*` and `y-*` are allowed only in `packages/doc-store-yjs` and `apps/sync`. Core's `src/engine` boundary works the same way: "engine must not import realtime".

### 7.2 Interfaces

```ts
// packages/doc-store/src/types.ts
export type DocName = `project/${string}/${'scene' | 'review' | `char/${string}` | `clip/${string}`}`;
export type Table = 'meta' | 'assets' | 'nodes' | 'bookmarks' | 'bones' | 'controls' | 'selectionSets'
                  | 'layers' | 'curves' | 'keys' | 'samples' | 'markers' | 'threads' | 'messages';
export type Origin = 'local' | 'undo' | 'redo' | 'remote' | 'load' | 'migration' | 'cleanup';

export interface TxMeta { label: string; coalesceKey?: string; coalesceMs?: number /* default 0 */ }

export interface Tx {
  // record-level (plain value, whole-record LWW)
  put<T>(doc: DocName, table: Table, id: string, value: T): void;
  remove(doc: DocName, table: Table, id: string): void;               // keys only (R4)
  // property-level (nested single-writer record: nodes, controls, meta)
  setProp(doc: DocName, table: Table, id: string, prop: string, value: unknown): void;
  softDelete(doc: DocName, table: Table, id: string): void;           // sets deleted: Tombstone
  restore(doc: DocName, table: Table, id: string): void;
  get<T>(doc: DocName, table: Table, id: string): T | undefined;      // read-your-writes inside tx
}

export interface Change {
  doc: DocName; table: Table; id: string; prop?: string;
  before?: unknown; after?: unknown;          // present for local/undo/redo; remote may omit `before`
}
export interface ChangeBatch { origin: Origin; txId: string; label?: string; user?: string; changes: Change[] }

export interface DocumentStore {
  open(doc: DocName): Promise<void>;          // load from cache/provider; idempotent
  close(doc: DocName): void;
  isOpen(doc: DocName): boolean;
  read<T>(doc: DocName, table: Table, id: string): T | undefined;
  list<T>(doc: DocName, table: Table): ReadonlyMap<string, T>;        // cached snapshot, structural sharing
  transact<R>(meta: TxMeta, fn: (tx: Tx) => R): R;                   // one gesture = one tx = one undo step = one network update
  subscribe(fn: (batch: ChangeBatch) => void): () => void;           // drives projection/evaluator invalidation
  readonly undo: UndoManager;
  beginPreview(label: string): PreviewSession;
  readonly presence: PresenceChannel;          // LocalPresence in P0
  readonly sync: SyncStatus;                   // { state: 'local' | 'connecting' | 'synced' | 'offline'; pending: number }
  exportDoc(doc: DocName): Uint8Array;         // project file / snapshots (§10)
  importDoc(doc: DocName, bytes: Uint8Array): void;   // merges (CRDT), never overwrites
}

export interface UndoManager {
  undo(): UndoResult; redo(): UndoResult;
  canUndo(): boolean; canRedo(): boolean;
  stopCapturing(): void;                       // next tx starts a new step even inside coalesce window
  clear(): void;
  on(ev: 'change', fn: () => void): () => void;
}
export interface UndoResult { label?: string; applied: number; skipped: Array<{ change: Change; reason: 'changed-by-other' | 'missing-doc' }> }

export interface PreviewSession {               // local overlay; NOT in the CRDT until commit
  put(doc: DocName, table: Table, id: string, value: unknown): void;
  setProp(doc: DocName, table: Table, id: string, prop: string, value: unknown): void;
  readonly conflicts: ReadonlyArray<Change>;    // remote changes to previewed ids during the drag
  commit(meta?: Partial<TxMeta>): void;         // one transaction
  cancel(): void;
}

export interface PresenceChannel {
  setLocal(patch: Partial<Presence>): void;     // throttled by the adapter (cursor/drag ≤ 15–20 Hz)
  peers(): ReadonlyMap<number, Presence>;
  subscribe(fn: () => void): () => void;
}

export interface AssetStore {
  put(bytes: Blob | Uint8Array, mime: string): Promise<AssetRef>;     // sha256 via SubtleCrypto
  get(ref: AssetRef): Promise<Blob>;             // verifies sha256 + size
  has(sha256: string): Promise<boolean>;
}
```

### 7.3 What changes between phases

| Piece | P0 (local) | P1 (sync) | P2 (Ekza auth) |
|---|---|---|---|
| `DocumentStore` | `YjsDocumentStore`, one `Y.Doc` per `DocName`, persisted with `y-indexeddb@9.0.12` (or OPFS) | Same class plus `HocuspocusProvider` per open doc over one `HocuspocusProviderWebsocket` | Same, with `token` |
| `UndoManager` | `PatchUndoManager` (ours) | Unchanged; remote batches are ignored by construction | Unchanged |
| `PresenceChannel` | `LocalPresence` (self only) | Awareness of the **scene** doc provider (one awareness per session) | Unchanged |
| `AssetStore` | OPFS/IndexedDB by hash | `HttpAssetStore` (presigned PUT/GET) plus local cache | Same, project-scoped ACL |
| Domain/UI code | — | **No change** besides presence UI | Role-aware UI (read-only states) |

### 7.4 Contract tests

These ship in P0 and run against every adapter.

- `createTestNetwork(n)`: N stores joined by an in-memory bus with controllable delay, drop, reorder and partition.
- Property-based fuzzing (`fast-check`): random op sequences on random peers, then heal and check:
  1. all peers converge to the same projection;
  2. projection invariants hold (unique key times, no cycles, no dangling evaluation refs);
  3. per-user undo/redo never modifies a record last written by another user.
- Golden regressions for H1–H5 (§4.2).
- Performance gates: open a 6.8k-key clip in under 50 ms (desktop); a commit of a 100-key edit stays below 16 ms including projection invalidation.

---

## 8. Interaction protocols

### 8.1 Drags, nudges and auto-key

1. On pointer-down: `p = store.beginPreview('Move keys')`.
2. On pointer-move: `p.put(...)` on the local overlay, viewport and graph re-evaluate from doc ⊕ overlay, and `presence.setLocal({drag})` is sent throttled to about 15 Hz so peers see a ghost.
3. On pointer-up: `p.commit()` writes one transaction.
4. If `p.conflicts` is non-empty (someone else wrote those ids during the drag), the commit asks "Overwrite Alice's change to 2 keys?" before writing.

Rotating a control in the viewport with auto-key on is the same flow: preview the pose, and on release write the keys at the current time. Keyboard nudges use `coalesceKey: 'nudge'` with `coalesceMs: 500`, so a burst of nudges is one undo step and one network update every ≤500 ms.

### 8.2 Claims (soft locks) and assignments

**Scopes**

| Scenario | Scope | Persistent? |
|---|---|---|
| A | `character` | Optional persistent `node.assignee` |
| B | `selectionSet` (e.g. "Left arm", "Face") or `layer` | No |
| — | `rig` (structural rig edits) | No; exclusive |

**Acquiring a claim:** selecting or manipulating anything inside a scope claimed by someone else shows their colour outline. The first manipulation prompts "Claimed by Alice: Take over / Edit anyway / Cancel".

**Ties:** two simultaneous claims are resolved deterministically by `(since, awareness clientID)`. The loser sees "contested".

**Lifetime:** claims vanish when the peer disconnects. Awareness times out after 30 s ([y-protocols](https://github.com/yjs/y-protocols/blob/master/awareness.js)), so an offline user never blocks others. Claims are advisory: the CRDT still converges if someone ignores them.

**Shared parents:** in scenario B, `root`/`hips`/`spine` controls belong to whoever claims "Body". Others see them as dimmed and must request a hand-off. This is the main defence against the coupled-hierarchy problem (§16).

### 8.3 Presence UI (P1)

- **Time slider:** coloured remote time markers with initials.
- **Viewport:** remote selected controls outlined in the user's colour. The remote free-camera frustum is optional and off by default.
- **Graph editor:** remote cursors and selection outlines in curve space; a remote drag shows as ghost curves.
- **Avatars bar:** click to **follow** (time + camera), double-click to jump to their clip.

User colours come from a 12-colour palette chosen to avoid the X/Y/Z channel colours and selection highlight. Presence draws outlines and badges and never recolours curves.

### 8.4 Playback

Every client plays locally, with independent time by default. **Presenter mode** for review: the presenter publishes `time {t, playing, rate, since}` and followers compute `t_now = t + (now - since) * rate`, accepting a few frames of skew. Unreal also documents that cross-machine playback is not frame-accurate. A shared transport is **not** written to the doc.

### 8.5 Comments (scenario C)

Threads are anchored to `clip + [start, end] + optional control + optional camera bookmark + optional sketch blob`. Clicking a thread jumps time and camera. Reviewers need write access only to the `review` doc (§11). Resolved threads stay as history.

---

## 9. Undo/redo semantics (per user)

**Model.** Each local transaction records `Change{doc, table, id, prop?, before, after}`. `before` is captured at op time inside `Tx`, so no Yjs internals are needed. One transaction is one stack item (with coalescing). The stack is per session and per user (remote batches are never recorded) and is capped at 500 items.

**Undo** applies the reverse of the item in a new transaction with `origin='undo'`. For each change, newest first:

```
current = read(doc, table, id, prop)
if deepEqual(current, change.after):  write(change.before)    // incl. delete if before === undefined, restore if tombstoned
else:                                 skip, report {change, reason: 'changed-by-other'}
```

**Redo** is symmetric. A non-empty `skipped` list shows a toast: "2 keys were changed by Alice since; not undone". This matches Figma's principle that undo must not destroy others' work, and avoids H4.

**Multi-doc:** a single stack item may touch the scene, char and clip docs. Each doc gets its own Yjs transaction, all with the same `txId`.

**Why not `Y.UndoManager`:**

1. H4 (key vanishes; or B's edit is overwritten when `ignoreRemoteMapChanges` is set).
2. It is scoped to one `Y.Doc` (cross-doc needs a separate manager).
3. The adapter-agnostic undo keeps Loro or an authoritative backend swappable.

`Y.UndoManager` (options verified in source 13.6.33: `captureTimeout` 500 ms default, `trackedOrigins` default `{null}`, `captureTransaction`, `deleteFilter`, `ignoreRemoteMapChanges`; [docs](https://docs.yjs.dev/api/undo-manager)) remains fine for a future rich-text comment editor.

---

## 10. Assets, persistence, versions, compaction, migrations

### 10.1 Binary assets

- **Hashing and refs:** the client computes `sha256` with WebCrypto and stores `AssetRef` in `scene.assets`.
- **Upload (P1):**
  1. `POST /api/assets/upload-url {sha256, size, mime}` returns a presigned PUT, or `exists: true` (dedupe).
  2. The client PUTs the blob.
  3. The server verifies hash and size before marking it available.
- **Download:** a presigned GET, then the client verifies sha256 and size. This is the same exact-size and SHA-256 contract `ekza-bevy-sdk` applies to Registry renditions.
- **Storage:** private bucket (Supabase Storage / S3 / R2 / local FS for self-host). Key: `assets/<sha256>`.
- **GC:** mark-and-sweep from all docs and retained versions; blobs are never deleted while referenced.

### 10.2 Server persistence (P1)

Hocuspocus `onStoreDocument` is debounced (tune `debounce`/`maxDebounce`, e.g. 2 s / 10 s) and stores `encodeStateAsUpdateV2(doc)`. Backends:

| Deployment | Backend |
|---|---|
| Self-host default | `@hocuspocus/extension-sqlite` |
| Ekza | `extension-database` → Postgres `bytea` |
| Large | `extension-s3` |

Also append a lightweight **audit row per stored batch**: `doc, user, bytes, at`. That gives "who touched this clip when" without Yjs attribution features.

### 10.3 Versions (named snapshots)

- **Create:** a "Save version" stores each doc's full V2 state as a blob (`versions/<versionId>/<docName>.yupd`) plus a DB row `{id, project, label, author, createdAt, parent}`. Auto-checkpoints are taken every 15 min of activity.
- **Browse:** load the version into detached read-only `Y.Doc`s and diff by projection (curves changed, keys added/removed). No `gc:false` or `Y.snapshot` is needed.
- **Restore:** compute the record-level diff from current to version and apply it as **one normal transaction** with label "Restore version X". It is undoable and syncs to everyone. History is never rewound.
- **Branch:** "Duplicate from version" creates a new project with new doc names. Ids are kept, so cross-project copy/paste of keys stays meaningful.

### 10.4 Compaction (epochs)

Yjs metadata only grows. When a clip doc exceeds its budget (§13) or yearly:

1. The owner triggers **epoch rollover**: the server freezes the doc (read-only), writes a version, and creates `clip/<id>@e2` from the JSON projection.
2. Clients reload on an `epoch` notice.
3. Offline clients holding unsynced edits for the old epoch get a "rebase offline changes?" flow: export their pending projection diff and re-apply it as transactions.

Epoch rollover is rare and explicit. It is never automatic during a session.

### 10.5 Project file (works without any server)

A `.ekzanim` file is a zip of `manifest.json`, `docs/<docName>.yupd` and `assets/<sha256>`. Opening it **merges** into any existing local copy, because the docs are CRDTs. Two people can exchange files by email and merge their work: an offline "collaboration" that comes free with D2.

### 10.6 Schema migrations

Migrations follow R11: deterministic, idempotent, `origin='migration'`, excluded from undo. `minWriterVersion` stops old clients writing into new-schema docs; they get read-only plus an "update the app" banner. This matters for an OSS tool with many self-hosted versions in the wild.

---

## 11. Auth and permissions (P2)

### 11.1 Token flow

```
Browser ──(Supabase session, Ekza account)──▶ Next.js route POST /api/collab/token {projectId}
         ◀── 5-min JWT (EdDSA) {sub, project, role, docs: [patterns], color, exp}
Browser ──ws(token)──▶ Hocuspocus onAuthenticate: verify (jose@6.x, public key)
                       ├─ doc not in token.docs → reject
                       └─ role lacks write on this doc kind → connection.readOnly = true
```

**Verifying the Ekza session in Next.js:** use Supabase **asymmetric JWT signing keys** via `/auth/v1/.well-known/jwks.json` and `jose.createRemoteJWKSet`. Projects still on the legacy HS256 secret return an empty JWKS and must call `/auth/v1/user` instead ([Supabase JWT docs](https://supabase.com/docs/guides/auth/jwts)). **Check which mode the Ekza project uses.**

**Why minted tokens:** the sync server needs one public key and no Supabase dependency. Self-hosters plug in any IdP (OIDC) or simple share-link tokens. Hocuspocus forwards the provider `token` to `onAuthenticate`, and v4 also has an `onTokenSync` hook for token updates.

**Native and agent clients:** reuse the Registry device-consent account link with a new scope (`animator-session`, alongside existing `library` and `space-session`). This mirrors how Space verifies Ekza sessions server-side.

### 11.2 Role matrix (doc-level enforcement)

| Role | scene | char/* | clip/* | review | Notes |
|---|---|---|---|---|---|
| owner | rw | rw | rw | rw | Manage members, epochs, delete |
| editor | rw | rw | rw | rw | |
| animator (scoped to characters S) | ro (*) | rw for S, ro others | rw if `clip.meta.character ∈ S`, ro others | rw | Scenario A hard mode |
| commenter | ro | ro | ro | rw | Scenario C |
| viewer | ro | ro | ro | ro | Share link |

(*) Scoped animators cannot edit scene layout. Their claims travel in awareness. **Verify in P1** that Hocuspocus read-only connections still exchange awareness; if not, put presence on the `review` doc, which they can write.

**Hard limit of CRDT servers:** they cannot validate or reject individual ops cheaply. **The document is the permission unit**, which is why D6 partitions now. Server-side hygiene:

- `extension-throttle` and per-connection rate limits;
- a max update size (e.g. 1 MiB);
- async schema validation in `onChange`: decode into a scratch projection. On violation, close the connection, flag the doc, and keep the last good version for restore.

---

## 12. Offline

- **P0:** fully offline by design (IndexedDB plus project file).
- **P1:** the provider buffers updates while disconnected and `y-indexeddb` keeps them across reloads, so reconnect merges automatically. UI shows the `sync.state` and `pending` count, plus a "you were offline 2 h; 3 curves you edited were also edited by Bob" summary. To compute it, compare the pre-merge local projection with the post-merge projection for curves touched by local pending transactions.
- **Claims** don't survive offline (by design). Offline work on a claimed scope is allowed and merges LWW. The summary above is the safety net.

---

## 13. Scale limits and budgets

| Quantity | Budget | Basis |
|---|---|---|
| Keys per clip doc | Warn at 50k (≈3.5 MB V2 tuple), hard 200k | 6.8k keys = 477 KiB, 10 ms load (§4.1) |
| Keys per curve | Warn at 2,000. Offer "reduce keys" or keep as sampled track | Graph-editor usability; projection sort cost |
| Dense data | Always `SampledTrack` blobs | H7 |
| Docs open per client | Scene + visible chars + active clips (typically under 10) | One socket, multiplexed |
| Update size | ≤1 MiB per message (server-enforced) | Large pastes must be chunked into several transactions |
| Awareness state | <1 KiB JSON, cursor/drag ≤15–20 Hz | y-protocols re-sends the **full** local state as JSON on each change |
| Users per doc | Design target 2–8 concurrent, tested to 16 | Presence fan-out is O(n²) |
| Server memory | About doc size × open docs (a 4-character project is about 2–3 MB) | Hocuspocus keeps open docs in memory; Redis extension for more than one instance |

---

## 14. Topology

```
                ┌──────────────────────── apps/web (Next.js 16, React 19, R3F 9) ───────────────────────┐
 Browser        │ UI ─▶ DocumentStore(Yjs) ─▶ y-indexeddb cache                                         │
                │        └─ HocuspocusProviderWebsocket (one socket, N docs, awareness on scene doc)    │
                │ AssetStore ─▶ OPFS cache                                                              │
                └──────┬───────────────────────────────┬────────────────────────────────┬─────────────┘
                       │ HTTPS (route handlers)        │ WSS                            │ presigned GET/PUT
                       ▼                               ▼                                ▼
   Next.js server: /api/collab/token,     apps/sync: Hocuspocus 4 (Node ≥22)     Object storage
   /api/assets/upload-url, /api/versions   onAuthenticate · onLoad/onStore ·     (Supabase Storage / S3 / R2 / FS)
   Postgres: projects, members, versions,  onChange validation · throttle
   audit (Supabase for Ekza; any PG/SQLite  persistence: SQLite | Postgres | S3
   for self-host)                          Redis (only when >1 instance)
```

- **Deploy:** `apps/sync` is a separate long-lived process. Vercel/serverless cannot hold WebSockets; Hocuspocus 4 also runs on Cloudflare Workers if a DO-based hosting is preferred later.
- **Rust path (P3, optional):** an axum + `yrs@0.28` service. Hocuspocus frames y-protocols messages with document names and its own auth messages, so the Rust service must implement that framing, or the client adapter switches to the plain y-websocket protocol. Either change stays inside `doc-store-yjs`.

---

## 15. Phased plan

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **P0 (MVP, single user, collab-ready)** | `doc-model` (ids, flicks, tuple codec, invariant resolver, projection); `doc-store` interfaces, `PatchUndoManager`, `PreviewSession`; `doc-store-yjs` (no provider, y-indexeddb); doc partition (scene/char/clip/review); `asset-store` (OPFS, sha256); `.ekzanim` import/export with merge; contract tests + fuzz convergence + H1–H5 regressions; lint boundary | All UI mutations go through `transact`; zero `yjs` imports outside the adapter; 2-peer in-memory fuzz green; 6.8k-key clip opens in <50 ms |
| **P1 (sync)** | `apps/sync` (Hocuspocus 4, SQLite/Postgres); provider wiring; awareness `Presence`; remote markers/cursors/selection/ghost drags; claims + take-over flow; follow + presenter; share-link tokens (owner-signed, edit/view); `HttpAssetStore` presigned uploads; named versions + restore-as-transaction; offline summary | Two browsers animate two characters (A) with live preview; claims prevent same-curve edits in B; kill/restart server loses no committed edits; offline 30 min then reconnect merges |
| **P2 (Ekza auth and permissions)** | Supabase-backed accounts; `/api/collab/token`; role matrix incl. character-scoped animators; review doc + comments UI + sketches; server validation + audit; Registry device scope `animator-session`; "Publish to Ekza" from a version (export pipeline per 03 §7) | Commenter cannot change animation (server-enforced); scoped animator cannot write another character's clip docs; publish creates a Registry asset from an exact version hash |
| **P3 (advanced)** | Per-user animation layers + layer merge ("four hands"); offline conflict review UI; epochs/compaction tooling; cross-character constraints in collab; optional Rust `yrs` sync service; Loro re-evaluation; spline modeling docs (`model/<id>`: control points as flat `Map<PointId, tuple>` with fractional order; polygon meshes as coarse LWW blobs) | Usage data says it's worth it (§16) |

---

## 16. Honest assessment: is "four hands on one character" useful?

**Mostly no, for body animation.** Professional practice assigns a shot, or a character within a shot, to one animator. The craft lives in whole-body coordination: weight shifts start in the hips and COG, then spine, then overlapping action in the arms and head.

In an FK hierarchy, whoever touches root/hips/spine changes the world-space arcs of everybody else's limbs. IK-planted feet and hand contacts couple the "legs person" and the "arms person" again. An arms-vs-legs split therefore produces constant "who moved the hips?" friction and a worse result than one person doing both. Real-time sync does not fix this; ownership does.

**Where parallel work on one character is valuable:**

1. **Passes on separate layers.** Body by A, face/lip-sync/eyes by B, fingers or secondary/props by C. Studios already split face and body work (body first, face later; separate lip-sync passes), and eyes often get separate timing ([Blender Studio shot production](https://studio.blender.org/tools/artist-guide/shot-production/animation)). Our per-user layers plus selection-set claims fit this directly.
2. **Mentoring and supervision.** A lead fixes a pose live while a student watches, or a supervisor sketches notes over the frame (scenario C with follow/presenter). This is high value in education and remote teams.
3. **Mocap cleanup split by time range**, with a blend zone at the seam. This is moderate value.
4. **Rig and animation in parallel.** A rigger adjusts control shapes and offsets in the `char` doc while an animator blocks in the `clip` doc. This works because they are different documents.

**Recommendation:**

- Build **A** (two characters) and **C** (review) as the collaboration headline features.
- Ship **B** as "claims + per-user layers" (P3), measure usage, and only then consider finer-grained co-editing.
- Market it honestly: "animate together in one scene", not "two people on one rig".

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Silent data loss from CRDT structure mistakes (H1/H2/H4) | Users lose keys without noticing | Rules R1–R4, own undo, golden regression tests, fuzzing |
| No per-op authorization in Yjs servers | A malicious or buggy client can corrupt a doc it can write | Doc-level ACL (D6), validation in `onChange`, versions for restore, rate limits |
| Yjs 14 breaking changes | Upgrade churn | Single adapter package, pinned `~13.6` |
| `y-indexeddb` last released 2023 | Browser-storage edge cases | Wrap behind adapter; OPFS fallback; project-file export |
| Doc metadata growth over months | Load time and memory creep | Budgets, monitoring of stored size, epochs (§10.4) |
| Presence floods (full-state awareness) | Bandwidth/CPU with many users | Small state, throttling, cap selections at 200 ids |
| Cross-doc non-atomicity | Dangling refs after partial ops | Dependency-ordered idempotent ops, tolerant projection, orphan panel |
| Supabase project on legacy HS256 keys | Cannot verify JWT locally | Minted collab tokens; Next.js calls `/auth/v1/user` in legacy mode |
| Over-investing in "four hands" | Engineering time for a niche | Phase it to P3 behind usage evidence (§16) |
| Hosting cost/ops of a stateful sync service | Ops burden for Ekza | SQLite single-instance first; Redis/S3 only when needed; DO/Workers option |

---

## 18. Open questions for the owner

1. **Hosting.** Where should the P1 sync service run: an Ekza-managed VPS (simple, stateful Node) or Cloudflare (Hocuspocus on Workers / PartyServer)? Are there data-residency requirements for user project data?
2. **Account-less sharing.** Should anonymous share-link sessions (no Ekza account) be allowed in P1, or must every collaborator sign in?
3. **Hard permissions.** Is character-scoped hard permission (P2) actually needed, or are soft claims plus versions enough?
4. **Registry asset kind.** Will Ekza Registry accept a new typed asset kind `animation` (e.g. profile `vrma-humanoid-v1`)? Should a published animation reference the exact project version hash for provenance?
5. **Project licence.** MIT or Apache-2.0? It doesn't block Yjs or Hocuspocus (MIT), but it rules AGPL server components (Liveblocks) in or out of the default distribution.
6. **Scene sizes.** What scene sizes do we target: characters per scene, typical clip length, how much mocap? This sets the §13 budgets.
7. **Loro vs Yjs gate.** Revisit at P1 start, given Loro's movable tree for future modeling? The proposed gate: Loro wins only if its server story (auth hooks, read-only, persistence, scale-out) matches Hocuspocus by then.

---

## Appendix A — Benchmark method (reproducible)

- **Setup:** throwaway directory with `yjs@13.6.33`, `loro-crdt@1.16.4`, `@automerge/automerge@3.5.0`; Node 25, `--expose-gc`.
- **Data:** IDs from `crypto.randomBytes` (base64url). Values from a seeded mulberry32 PRNG.
- **Workload:** 171 curves × 40 keys (rotate XYZ for 56 controls + root translate XYZ), key times in flicks at 30 fps every 7 frames.
- **Layouts:** A–D as in §4.1, each built in one transaction. Size = `encodeStateAsUpdate(V2)`. Load = `applyUpdateV2` into a fresh doc.
- **Editing:** 5,000 single-key replacements, one transaction each.
- **Drag:** 10 keys × 600 transactions (60 Hz × 10 s) vs one transaction. Wire = sum of `update` event byte lengths.
- **Hazard tests:** two docs with fixed `clientID`s (the higher id wins concurrent map sets), sync by exchanging full state updates, `Y.UndoManager` with `trackedOrigins: new Set([originA])`, `captureTimeout: 0`, with and without `ignoreRemoteMapChanges`.
- **Caveat:** a first run used a floating-point LCG that produced duplicate ids, which shrank sizes. Numbers above are from the corrected run. Heap numbers for WASM-based libraries are not reported because Node's counters don't capture them reliably.

Suggested home in the repo: `bench/crdt-layouts.bench.ts` (vitest bench). Re-run before P1 and on any Yjs/Loro major version.

## Sources

- Yjs: [releases](https://github.com/yjs/yjs/releases) · [UndoManager docs](https://docs.yjs.dev/api/undo-manager) · [UndoManager source v13.6.33](https://github.com/yjs/yjs/blob/v13.6.33/src/utils/UndoManager.js) · [y-protocols awareness](https://github.com/yjs/y-protocols/blob/master/awareness.js) · [y-websocket](https://github.com/yjs/y-websocket) · [y-websocket-server](https://github.com/yjs/y-websocket-server) · [y-webrtc](https://github.com/yjs/y-webrtc) · [y-indexeddb](https://github.com/yjs/y-indexeddb) · [YKeyValue / y-utility](https://github.com/yjs/y-utility) · [forum: YKeyValue vs V2](https://discuss.yjs.dev/t/is-ykeyvalue-still-necessary-with-yjs-update-version-2-optimizations/3516)
- Hocuspocus: [4.0 stable release](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release) · [server hooks](https://tiptap.dev/docs/hocuspocus/server/hooks) · [database extension](https://tiptap.dev/docs/hocuspocus/server/extensions/database) · [provider README (multiplexing)](https://github.com/ueberdosis/hocuspocus/tree/main/packages/provider)
- yrs / Rust: [y-crdt](https://github.com/y-crdt/y-crdt) · [docs.rs/yrs](https://docs.rs/yrs) · [yrs-axum](https://github.com/vagmi/yrs-axum) · [y-sweet](https://github.com/jamsocket/y-sweet)
- Loro: [1.0](https://loro.dev/blog/v1.0) · [v1.5 EphemeralStore](https://loro.dev/changelog/v1.5.0) · [movable tree](https://www.loro.dev/blog/movable-tree) · [Loro Protocol](https://loro.dev/blog/loro-protocol) · [protocol repo](https://github.com/loro-dev/protocol)
- Automerge: [Automerge 3.0](https://automerge.org/blog/automerge-3/)
- Liveblocks: [open-sourcing the sync engine (AGPL server)](https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server)
- Cloudflare/PartyKit: [acquisition](https://blog.cloudflare.com/cloudflare-acquires-partykit) · [PartyServer / y-partyserver](https://github.com/cloudflare/partykit)
- Prior art: [Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) · [tldraw sync](https://tldraw.dev/docs/sync) · [TLSyncClient](https://tldraw.dev/reference/sync-core/TLSyncClient) · [Unreal Multi-User Editing](https://dev.epicgames.com/documentation/unreal-engine/multi-user-editing-overview-for-unreal-engine) · [Omniverse live layers](https://docs.omniverse.nvidia.com/kit/docs/omni.kit.usd.layers/2.7.2/Overview.html) · [Blender Multi-user](https://multi-user.readthedocs.io/en/latest/about/features.html) · [Maya animation layer modes](https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-BBCA0BC3-7608-4E86-8E9F-B4099C316156.htm) · [Blender Studio shot production](https://studio.blender.org/tools/artist-guide/shot-production/animation)
- Auth: [Supabase JWTs / JWKS](https://supabase.com/docs/guides/auth/jwts) · [JWT signing keys](https://supabase.com/blog/jwt-signing-keys)
- Utilities: [Flicks](https://github.com/facebookarchive/Flicks) · [fractional-indexing](https://github.com/rocicorp/fractional-indexing)
- Ekza (sibling repos, read-only): `ekza-rust-server` (README, `src/realtime/mod.rs`, `src/realtime/ekza.rs`, `src/store.rs`, `src/limits.rs`), `ekza-registry` (`backend/app/api/account.py` device scopes), `core` (`src/engine/README.md` boundary rule), `ARCHITECTURE.md`.
