# Fixture and sample asset licenses

Every binary asset in `fixtures/models/` and `fixtures/animations/` is redistributable. Each entry records its
source, license and SHA-256 so it can be re-verified (`pnpm check:fixtures`). These files are **not** covered by
the repository's MIT license; each is under the license in its row. Generated test data in `fixtures/synthetic/`
is part of the code base (MIT).

Derived fixtures are added together with the script that produces them and their own row (for example
`animations/quaternius-idle-meshopt.glb`, generated from `quaternius-ual.glb` by
`tooling/make-compressed-fixture.mjs`, CC0 1.0 like its source).

| File | Content | Author | License | Source | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `models/polybot.vrm` | VRM 0.x humanoid avatar "Polybot" (no embedded clips) | Polygonal Mind (100Avatars R1) | CC0 1.0 (also declared in the file's VRM meta) | [Open Source Avatars](https://github.com/ToxSam/open-source-avatars) | `e255bace0d7de8b5fc90756efc83e167080e6db97692f23623fec5f1c67c423d` |
| `models/seed-san.vrm` | VRM 1.0 humanoid avatar "Seed-san" with spring bones and node constraints | VirtualCast, Inc. | [VRM Public License 1.0](https://vrm.dev/en/licenses/1.0/index): redistribution allowed, modification and redistribution allowed, commercial use allowed, **credit required** | [vrm-c/vrm-specification `samples/Seed-san`](https://github.com/vrm-c/vrm-specification/tree/837f156dbce43ad69183ce1bdab549961ae1c1ee/samples/Seed-san) at commit `837f156` | `624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23` |
| `animations/quaternius-ual.glb` | Universal Animation Library: 46 humanoid clips on a Rigify `DEF-*` skeleton with a mannequin mesh | Quaternius | CC0 1.0 | [quaternius.com](https://quaternius.com/packs/universalanimationlibrary.html), glTF mirror [J-Ponzo/gltf-universal-animation-library](https://github.com/J-Ponzo/gltf-universal-animation-library) | `b94b87af722757a3e8971d97e0968c4fca3a1963ec49f216c1935618a9723a09` |

`quaternius-ual.glb` is the upstream `AnimationLibrary_Godot_Standard.gltf` + `.bin`
packed into a single GLB without any other change (source SHA-256: `.gltf`
`0ff075c7ad6855c5c2c37a171592ee8f0d6ab2f58259e2be77a9b63dd8027765`, `.bin`
`6e65377d81558333c4093dbb144a48fd19019343d82b1a3a7992a98ec0e0543c`).

## Credits

- "Seed-san" model by VirtualCast, Inc., licensed under the VRM Public License 1.0.
- "Polybot" by Polygonal Mind, CC0 1.0.
- Universal Animation Library by Quaternius, CC0 1.0.

## Not allowed in this repository

- Avatars whose embedded VRM meta forbids modification or redistribution, even if a
  collection-level listing says otherwise. Example: the NeonGlitch86 "SHAPEY" VRM 1.0
  (`ekza-avatar-renderer` test fixture) declares `modification: prohibited` and
  `commercialUsage: personalNonProfit`, and carries an embedded Mixamo clip.
- Mixamo animations or any clip that is not redistributable as a standalone file.
- CC-BY assets without an attribution entry above.
