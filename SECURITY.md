# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**, never in a public issue or pull request: use GitHub's private
vulnerability reporting ("Report a vulnerability" on the repository's **Security** tab). Include what you found, how
to reproduce it (a minimal file if the problem is in a parser) and the impact you expect. We aim to acknowledge reports
within five working days and to agree on a disclosure date with you.

## Supported versions

Until `v1.0`, only the latest release and the `dev` branch receive security fixes.

## Scope and threat model

Ekza Animator runs entirely in the browser (or headless in Node for tests) and opens files that users drop into it.
The main attack surface is **untrusted file parsing**:

- GLB, VRM, VRMA and `.ekzanim` files are parsed by our own readers (`packages/io`) and by three.js loaders. Every
  import first passes avatar-scale input budgets and structural checks (accessor ranges, buffer views, sparse indices,
  node cycles) before large allocations ([ARCHITECTURE §16](ARCHITECTURE.md#16-security-and-robustness),
  MVP-SPEC §4.11.14). Reports of crashes, hangs or memory blow-ups caused by crafted files are in scope.
- Compressed meshes are decoded by the self-hosted Draco, meshopt and KTX2 decoders shipped with three.js; no
  third-party CDN is used at runtime.
- The app uses no `eval`, holds no secrets in the client and works without network access after loading.
- Exports must never leak data that was not in the source document; a bug where a bake writes foreign bytes into a
  user's file is a security issue.

Out of scope: vulnerabilities that require a malicious browser extension, a compromised machine, or a user running a
modified build.
