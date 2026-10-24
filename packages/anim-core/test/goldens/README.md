# Curve-engine goldens

`animx-goldens.json` holds curve values and auto-tangent slopes computed by the AnimX library (commit
`11c31ac74e526b599031414866db639383c9a5e0` of the upstream repository pinned in
`tooling/animx-oracle/generate.mjs`). It is generated, never edited by hand:

```sh
node tooling/animx-oracle/generate.mjs           # regenerate
node tooling/animx-oracle/generate.mjs --check   # verify the committed file
```

`../curve/animx-goldens.test.ts` checks the TypeScript port against it (values ≤ 1e-9, auto slopes ≤ 1e-12). The
case list, the adapter conventions and the known deviations are in
[tooling/animx-oracle/README.md](../../../../tooling/animx-oracle/README.md).
