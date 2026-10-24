# Tooling test fixtures

`deps-violation/` is a fake workspace that breaks every rule `tooling/check-deps.mjs` enforces (a forbidden
dependency, an upward edge, a dependency on `doc-yjs`, a cycle, a missing `catalog:`/`workspace:*` spec, a version
range and an unknown package). `check-deps.test.mjs` asserts that each one is reported.

`param-lint-violation/` is a fake workspace for the static part of `tooling/param-lint.mjs`: an editor file and an
editor-core operator file that import the Halo-only forms (the subpath and a relative path), and an `addParams`
declaration; the touch shell's import, editor-core's test import and a comment that mentions `addParams` are allowed.
`param-lint.test.mjs` asserts exactly those violations.
