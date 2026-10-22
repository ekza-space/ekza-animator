// tooling/omoba-validate.mjs (M6B-SPEC §0.4.6; C10): skips without a checkout, uses the checkout's shared cargo cache,
// never runs cargo clean. The validator itself runs only locally (INT, AS-MVP-1 step 12), never here.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commandFor, findCheckout, main, targetDirOf } from '../omoba-validate.mjs';

test('no checkout: skipped, exit 0', () => {
  const env = { EKZA_OMOBA_BEVY: join(tmpdir(), 'no-such-omoba-bevy') };
  assert.equal(findCheckout(env), null);
  assert.equal(main(['some.vrm'], env), 0);
  assert.equal(main([], env), 2);
});

test('a checkout is a directory with passport/src/humanoid.rs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omoba-'));
  mkdirSync(join(dir, 'passport', 'src'), { recursive: true });
  assert.equal(findCheckout({ EKZA_OMOBA_BEVY: dir }), null);
  writeFileSync(join(dir, 'passport', 'src', 'humanoid.rs'), '// stub');
  assert.equal(findCheckout({ EKZA_OMOBA_BEVY: dir }), dir);
});

test('cargo run with the shared target dir (git common dir/../target), never clean', () => {
  const git = () => ({ status: 0, stdout: '/repo/omoba-bevy/.git\n' });
  assert.equal(targetDirOf('/repo/omoba-bevy-worktree', git), '/repo/omoba-bevy/target');
  assert.equal(
    targetDirOf('/x', () => ({ status: 128, stdout: '' })),
    '/x/target',
  );
  const { command, args, options } = commandFor('/repo/omoba-bevy', '/tmp/a.vrm', '/repo/omoba-bevy/target');
  assert.equal(command, 'cargo');
  assert.deepEqual(args, ['run', '-q', '-p', 'omoba-passport', '--bin', 'validate-runtime-vrm', '--', '/tmp/a.vrm']);
  assert.equal(options.cwd, '/repo/omoba-bevy');
  assert.equal(options.env.CARGO_TARGET_DIR, '/repo/omoba-bevy/target');
  assert.ok(!args.includes('clean'));
});
