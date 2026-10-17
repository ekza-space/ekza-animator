# Tooling test fixtures

`deps-violation/` is a fake workspace that breaks every rule `tooling/check-deps.mjs` enforces (a forbidden
dependency, an upward edge, a dependency on `doc-yjs`, a cycle, a missing `catalog:`/`workspace:*` spec, a version
range and an unknown package). `check-deps.test.mjs` asserts that each one is reported.
