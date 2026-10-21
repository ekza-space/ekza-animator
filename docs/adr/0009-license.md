# ADR 0009 — License: MIT + DCO, Apache-2.0 islands, no copyleft

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [04](../research/04-web-stack.md) §12, [05](../research/05-landscape.md) §5(b), §5(c),
  [03](../research/03-ekza-reuse-audit.md) §2, §4, R7, [08](../research/08-extensibility-modeling.md) §12.

## Context

The project is open source and part of the Ekza ecosystem, whose web packages (`ekza-avatar-renderer`, `core`) are
MIT, as are three.js, R3F, glTF Transform and three-vrm. The closest web neighbours are GPL/AGPL (Reze Studio,
Pose Studio, Roboticela, Theatre.js studio). Autodesk AnimX, which we port, is Apache-2.0. The design review
checked the pinned dependency tree against the npm registry: `next@16.3.8` depends on `caniuse-lite`
(CC-BY-4.0) and optionally on `sharp`, whose `@img/sharp-libvips-*` binaries are LGPL-3.0-or-later and load
in-process; `@tailwindcss/postcss` → `lightningcss` is MPL-2.0. v0.1 also had no CI step that enforced any of
this, and no notices for the shipped bundle.

## Decision

1. **Repository license: MIT.** Contributions are accepted under the **Developer Certificate of Origin**
   (`Signed-off-by:` trailer on every commit, checked by a `dco` CI job on every PR); no CLA.
2. **Scope statement** (README, `LICENSE` header note, `REUSE.toml`): the code is MIT;
   `packages/anim-core/src/curve/animx/**` is Apache-2.0 (port of AnimX, per-file headers, package
   `LICENSE-APACHE-2.0` and `NOTICE`); files under `fixtures/` are under the licences listed in
   [`fixtures/LICENSES.md`](../../fixtures/LICENSES.md) (CC0-1.0, VRM Public License 1.0), not MIT.
3. **Copy-adapt from MIT sources with attribution headers** (source repository, path, commit, license): the
   `ekza-avatar-renderer` helpers listed in [ARCHITECTURE §13](../../ARCHITECTURE.md#13-ekza-integration).
4. **Never** copy code from or depend at runtime on GPL, AGPL, SSPL, LGPL-in-process, unlicensed or proprietary
   sources (including `@theatre/studio`, tldraw SDK, `dockview-enterprise`, Liveblocks server, Blender core,
   Studio Library). Clean-room re-implementation of *features* is fine.
5. **Production dependency allow-list**, enforced by `tooling/check-licenses.mjs` in `pnpm ci` and the CI
   workflow over `pnpm licenses list --prod --json`: `MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD,
   BlueOak-1.0.0, CC0-1.0, OFL-1.1 (fonts)`. Anything else must be listed in `tooling/license-exceptions.json`
   with a reviewed rationale. Initial exceptions:
   - `caniuse-lite` (CC-BY-4.0): browserslist data used at build time; attribution in the notices file.
   - `lightningcss` and its platform packages (MPL-2.0): unmodified build tool (Tailwind 4); file-level copyleft
     does not reach our code.
6. **`sharp` is never installed**: `ignoredOptionalDependencies: ["sharp"]` in `pnpm-workspace.yaml`
   (`images.unoptimized: true` already disables Next image optimization); `check-licenses` fails if `sharp` or
   any `@img/sharp-*` package appears, so the hosted (Vercel) build never loads LGPL libvips in-process.
7. **Notices**: `apps/web` generates `THIRD_PARTY_NOTICES.txt` from the packages in the client bundle (licence
   texts, the Apache-2.0 NOTICE of gltf-validator when the validator worker ships, the AnimX NOTICE, OFL font
   notices); the About dialog links it, next to the sample credits.
8. Assets: only redistributable fixtures (ADR 0012); `fixtures/LICENSES.md` records source, licence and SHA-256 of
   every binary, checked by `check:fixtures`. Mixamo or other non-redistributable clips never enter the
   repository.
9. `TRADEMARKS.md`: the code is MIT; the "Ekza" name and logo are not licensed; forks must rebrand. Product names
   of other vendors are used descriptively only ("Maya-style hotkeys"), never in UI branding.

## Alternatives

Apache-2.0 for the whole repository (explicit patent grant) is the fallback if a corporate contributor requires
it; switch before the first external contribution. MPL-2.0 would add friction without benefit. Replacing
Tailwind to avoid `lightningcss` was rejected: MPL-2.0 on an unmodified build tool imposes nothing on our code.

## Consequences

- Ekza Hub and third parties can embed packages without obligations beyond attribution.
- Reviewers reject PRs that paste code from copyleft neighbours; `CONTRIBUTING.md` states the clean-room rule.
- Adding a dependency with a new licence is a visible, reviewed change to `license-exceptions.json`.
