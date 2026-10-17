# ADR 0012 — Sample avatars and test fixtures

- Status: Accepted (2026-10-17); erratum and fixture addition 2026-10-17 (rev. 2)
- Inputs: coordinator defaults; research [03](../research/03-ekza-reuse-audit.md) §2.1, §4;
  [09](../research/09-ui-ux-spec.md) §10.1, §10.3; `fixtures/LICENSES.md` (fixtures pass, 2026-10-17).

## Context

The coordinator's default named two bundled samples: the NeonGlitch86 VRM 1.0 test fixture from
`ekza-avatar-renderer` ("CC0") and 100Avatars R1 "Polybot" (VRM 0.x, CC0). Research 03 also called the
NeonGlitch86 file CC0, based on a collection-level listing. The embedded VRM 1.0 `meta` of that exact file was
read on 2026-10-17:

```
allowRedistribution: false, modification: "prohibited", commercialUsage: "personalNonProfit",
avatarPermission: "onlyAuthor", creditNotation: "required"
```

It also carries an embedded Mixamo clip (`Armature|mixamo.com|Layer0`), which is not redistributable as a
standalone animation, and its meta `name`/`authors` are the literal string `undefined`, which suggests converter
defaults rather than the author's intent. The file's own licence metadata wins over a collection listing.

**Erratum to research 03** (research files are read-only inputs and stay unchanged): research 03 §2.1 and §4
describe `ekza-avatar-renderer/test/fixtures/vrm1-sample.vrm` as CC0 and "safe to vendor". That is wrong for this
file. The ecosystem follow-up (the MIT `ekza-avatar-renderer` repository still redistributes it) is tracked as
DECISIONS-OPEN Q-EKZA-9.

## Decision

1. **The NeonGlitch86 fixture is not shipped** in this repository, not used by in-repo tests, and not bundled as a
   sample. (Coordinator default overridden on evidence; recorded in [DECISIONS-OPEN](../DECISIONS-OPEN.md).)
2. **Bundled samples and fixtures** (credited in `fixtures/LICENSES.md`):

   | File | Role | Licence |
   |---|---|---|
   | `fixtures/models/seed-san.vrm` | VRM 1.0 sample avatar; spring bones, node constraints (robot arm), 5 skins, MToon: the hardest surgeon test | VRM Public License 1.0 — redistribution, modification and commercial use allowed, **credit required** ("Seed-san" by VirtualCast, Inc.) |
   | `fixtures/models/polybot.vrm` | VRM 0.x sample avatar (faces −Z, identity rest rotations; has `rightToes` but no `leftToes`) | CC0 1.0 (Polygonal Mind, 100Avatars R1) |
   | `fixtures/animations/quaternius-ual.glb` | Generic skinned GLB with 46 embedded clips at 24 fps on a Rigify `DEF-*` skeleton: 1:1 FK rig, clip import, surgeon replace-in-place tests | CC0 1.0 (Quaternius Universal Animation Library) |
   | `fixtures/animations/quaternius-idle-meshopt.glb` (added by WP-4) | UAL reduced to the `Idle_Loop` clip, meshes and animation compressed with `EXT_meshopt_compression` by `tooling/make-compressed-fixture.mjs` (glTF Transform + meshoptimizer): compressed-mesh loading and `compressed-animation` rejection tests | CC0 1.0 (derived from the UAL) |

   Generated synthetic fixtures (`fixtures/synthetic/*.json`) are test data under the repository licence and are
   not samples.
3. The web app serves the samples from `apps/web/public/samples/` (copied by a build script from `fixtures/`,
   never duplicated in git) and shows credits in the sample picker and Help → About.
4. CI verifies that every licensed binary in `fixtures/models/` and `fixtures/animations/` has a
   `fixtures/LICENSES.md` row with a matching SHA-256.
5. Licence awareness in the product: the import summary shows the VRM meta badge; imported clips inherit
   provenance (ADR 0010); the export dialog gates "bake into model" for avatars whose meta forbids modification or
   redistribution.

## Consequences

- Seed-san is 10.9 MB; e2e uses it for the VRM 1.0 path, export and hand-control tests, and Polybot (1 MB) for
  most interaction tests.
- The owner may supply a CC0 VRM 1.0 avatar later; it would replace Seed-san as the default sample only.
