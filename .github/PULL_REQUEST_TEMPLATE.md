## What and why

<!-- One paragraph: what this PR changes and why. Link the issue, work package (MVP-SPEC §7) or ADR. -->

## How it was tested

<!-- Unit / headless / browser / e2e tests added or run; manual checks. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/).
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] `pnpm run ci` passes locally (or the failing step is explained below).
- [ ] Contract changes (MVP-SPEC §4 or a §7 *Public API* block) update `docs/MVP-SPEC.md` first.
- [ ] No new dependency, or a dependency request was approved (only the integration agent edits `package.json` files and `pnpm-lock.yaml`).
- [ ] No code copied from GPL/AGPL/LGPL, unlicensed or proprietary sources (clean-room rule); copy-adapted MIT code carries an attribution header.
- [ ] New binary fixtures have a row in `fixtures/LICENSES.md` with source, licence and SHA-256.
