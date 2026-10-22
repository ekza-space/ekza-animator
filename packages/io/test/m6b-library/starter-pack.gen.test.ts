// The starter-pack generator and its check (M6B-SPEC §0.4.7, Q-MVP-8, Q-MVP-21; C12). One file, run by vitest because
// the generator needs io's TypeScript:
//
//   pnpm run test                                  → the CHECK: regenerates every output in memory and fails when a
//                                                    committed file differs (bytes), is missing or is extra
//   EKZA_WRITE_STARTER_PACK=1 vitest run <this>    → WRITES the outputs (tooling/make-starter-pack.mjs wraps both)
//
// It reads `fixtures/animations/quaternius-ual.glb`, verifies its SHA-256 against `fixtures/LICENSES.md`, retargets the
// 14 clips of the §0.4.7 table onto the VRM normalized T-pose, writes `<id>.vrma` (VRMA 1.0, `ekza_animation_v1`
// provenance CC0 / Quaternius / the UAL clip name), `starter-pack.json` and `LICENSE.md` to
// `apps/web/public/library/animations/`, and keeps the repository-rooted "Starter pack" rows of `fixtures/LICENSES.md`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../../src/glb/parse';
import { parseStarterPackManifest } from '../../src/library/manifest';
import { retargetUalClip, ualRestWorld } from '../../src/library/retarget';
import { writeHumanoidVrma } from '../../src/library/vrma';
import type { StarterPackClip, StarterPackManifest } from '../../src/types';

const ROOT = new URL('../../../../', import.meta.url);
const OUT_DIR = 'apps/web/public/library/animations/';
const SOURCE = 'fixtures/animations/quaternius-ual.glb';
const LICENSES = 'fixtures/LICENSES.md';
const GENERATOR = 'tooling/make-starter-pack.mjs v1';
const WRITE = process.env['EKZA_WRITE_STARTER_PACK'] === '1';
/** §0.4.7 budget: all committed files together. */
const BUDGET_BYTES = 4 * 1024 * 1024;

/** The §0.4.7 clip table (ids are file names; slots are suggestions applied by Use Clip when free). */
const STARTER_PACK_CLIPS: readonly {
  readonly id: string;
  readonly source: string;
  readonly label: string;
  readonly slot: string | null;
  readonly loop: boolean;
}[] = [
  { id: 'idle', source: 'Idle_Loop', label: 'Idle', slot: 'idle', loop: true },
  { id: 'walk', source: 'Walk_Loop', label: 'Walk', slot: 'walk', loop: true },
  { id: 'run', source: 'Sprint_Loop', label: 'Run', slot: 'run', loop: true },
  { id: 'jog', source: 'Jog_Fwd_Loop', label: 'Jog', slot: null, loop: true },
  { id: 'sword-attack', source: 'Sword_Attack', label: 'Sword attack', slot: 'attack', loop: false },
  { id: 'punch', source: 'Punch_Cross', label: 'Punch', slot: null, loop: false },
  { id: 'cast', source: 'Spell_Simple_Shoot', label: 'Cast', slot: 'cast', loop: false },
  { id: 'hit', source: 'Hit_Chest', label: 'Hit', slot: 'hit', loop: false },
  { id: 'death', source: 'Death01', label: 'Death', slot: 'death', loop: false },
  { id: 'dance', source: 'Dance_Loop', label: 'Dance', slot: 'dance', loop: true },
  { id: 'pistol-shoot', source: 'Pistol_Shoot', label: 'Pistol shoot', slot: null, loop: false },
  { id: 'jump-start', source: 'Jump_Start', label: 'Jump start', slot: 'jump', loop: false },
  { id: 'jump-loop', source: 'Jump_Loop', label: 'Jump loop', slot: null, loop: true },
  { id: 'jump-land', source: 'Jump_Land', label: 'Jump land', slot: null, loop: false },
];

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const path = (relative: string): URL => new URL(relative, ROOT);
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The SHA-256 recorded for a path in fixtures/LICENSES.md (path cell relative to fixtures/ or repository-rooted). */
function recordedSha(markdown: string, row: string): string | null {
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[1] === `\`${row}\``) return /`([0-9a-f]{64})`/.exec(cells[cells.length - 2] ?? '')?.[1] ?? null;
  }
  return null;
}

const LICENSE_MD = [
  '# Starter pack licence',
  '',
  'The animation clips in this folder (`*.vrma`) and their manifest `starter-pack.json` are derived from the',
  '**Universal Animation Library by Quaternius**, released under',
  '[CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/).',
  'Source: <https://quaternius.com/packs/universalanimationlibrary.html>.',
  '',
  "Each clip was retargeted once from the library's Rigify skeleton onto the VRM humanoid (VRM Animation 1.0) by",
  "Ekza Studio's `tooling/make-starter-pack.mjs`; the retargeted files are dedicated to the public domain under the",
  'same CC0 1.0 terms. No attribution is required; we credit the author gladly:',
  '',
  '> Universal Animation Library by Quaternius (CC0)',
  '',
].join('\n');

interface Output {
  readonly file: string;
  readonly bytes: Uint8Array;
}

/** Every committed output of the generator, in memory. */
async function generate(): Promise<{
  readonly outputs: readonly Output[];
  readonly manifest: StarterPackManifest;
  readonly licenseRows: readonly string[];
}> {
  const fixture = new Uint8Array(readFileSync(path(SOURCE)));
  const ual = await parseGlb(fixture);
  const recorded = recordedSha(readFileSync(path(LICENSES), 'utf8'), 'animations/quaternius-ual.glb');
  if (recorded !== ual.sha256) {
    throw new Error(`${SOURCE}: SHA-256 ${ual.sha256} does not match ${LICENSES} (${String(recorded)})`);
  }
  const rest = ualRestWorld(ual);
  const outputs: Output[] = [];
  const clips: StarterPackClip[] = [];
  for (const entry of STARTER_PACK_CLIPS) {
    const data = retargetUalClip(ual, entry.source);
    const bytes = await writeHumanoidVrma(
      data,
      {
        generator: GENERATOR,
        license: 'CC0-1.0',
        credit: 'Quaternius',
        source: entry.source,
        sourceSha256: ual.sha256,
      },
      rest,
    );
    const file = `${entry.id}.vrma`;
    outputs.push({ file, bytes });
    clips.push({
      id: entry.id,
      source: entry.source,
      label: entry.label,
      slot: entry.slot,
      loop: entry.loop,
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      duration: Math.round(data.duration * 1e6) / 1e6,
      fps: 30,
      license: 'CC0-1.0',
      credit: 'Quaternius',
    });
  }
  const manifest: StarterPackManifest = {
    version: 1,
    id: 'ekza/starter-pack',
    title: 'Starter pack — Universal Animation Library',
    license: 'CC0-1.0',
    credit: 'Universal Animation Library by Quaternius (CC0)',
    sourceUrl: 'https://quaternius.com/packs/universalanimationlibrary.html',
    source: { file: SOURCE, sha256: ual.sha256 },
    generator: GENERATOR,
    clips,
  };
  outputs.push({ file: 'starter-pack.json', bytes: encode(`${JSON.stringify(manifest, null, 2)}\n`) });
  outputs.push({ file: 'LICENSE.md', bytes: encode(LICENSE_MD) });
  const labelOf = new Map(STARTER_PACK_CLIPS.map((entry) => [`${entry.id}.vrma`, entry]));
  const licenseRows = [...outputs]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map(({ file, bytes }) => {
      const clip = labelOf.get(file);
      const content =
        clip !== undefined
          ? `Starter-pack clip "${clip.label}": UAL \`${clip.source}\` retargeted to the VRM humanoid (VRMA 1.0)`
          : file === 'starter-pack.json'
            ? "The starter pack's manifest (clips, slots, loop flags, sizes and SHA-256)"
            : "The starter pack's licence note (CC0 1.0 and the credit line)";
      return `| \`${OUT_DIR}${file}\` | ${content}; generated by \`tooling/make-starter-pack.mjs\` | Quaternius | CC0 1.0 (derived from \`animations/quaternius-ual.glb\`) | this repository, from \`animations/quaternius-ual.glb\` | \`${sha256(bytes)}\` |`;
    });
  return { outputs, manifest, licenseRows };
}

/** fixtures/LICENSES.md with the "Starter pack" table body replaced by `rows`. */
function withStarterPackRows(markdown: string, rows: readonly string[]): string {
  const lines = markdown.split('\n');
  const section = lines.indexOf('## Starter pack');
  if (section < 0) throw new Error(`${LICENSES} has no "## Starter pack" section`);
  const separator = lines.findIndex((line, i) => i > section && line.startsWith('| ---'));
  let end = separator + 1;
  while (end < lines.length && (lines[end] as string).startsWith('|')) end++;
  return [...lines.slice(0, separator + 1), ...rows, ...lines.slice(end)].join('\n');
}

describe('starter pack (§0.4.7)', () => {
  it('committed outputs equal a fresh generation, bytes (EKZA_WRITE_STARTER_PACK=1 writes them)', async () => {
    const { outputs, manifest, licenseRows } = await generate();
    const dir = path(OUT_DIR);
    const licenses = readFileSync(path(LICENSES), 'utf8');
    if (WRITE) {
      mkdirSync(dir, { recursive: true });
      const keep = new Set(outputs.map((output) => output.file));
      for (const name of readdirSync(dir)) if (!keep.has(name)) unlinkSync(new URL(name, dir));
      for (const output of outputs) writeFileSync(new URL(output.file, dir), output.bytes);
      writeFileSync(path(LICENSES), withStarterPackRows(licenses, licenseRows));
      return;
    }
    expect(existsSync(dir)).toBe(true);
    const committed = readdirSync(dir).sort();
    expect(committed).toEqual(outputs.map((output) => output.file).sort());
    for (const output of outputs) {
      const bytes = new Uint8Array(readFileSync(new URL(output.file, dir)));
      expect(sha256(bytes)).toBe(sha256(output.bytes));
    }
    expect(withStarterPackRows(licenses, licenseRows)).toBe(licenses);
    expect(parseStarterPackManifest(manifest)).toEqual(manifest);
  });

  it('is deterministic and within the 4 MiB budget; the manifest lists the §0.4.7 table', async () => {
    const a = await generate();
    const b = await generate();
    expect(a.outputs.map((o) => sha256(o.bytes))).toEqual(b.outputs.map((o) => sha256(o.bytes)));
    const total = a.outputs.reduce((sum, output) => sum + output.bytes.length, 0);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(a.outputs.length).toBe(16);
    expect(a.manifest.clips.map((clip) => [clip.id, clip.source, clip.label, clip.slot, clip.loop])).toEqual(
      STARTER_PACK_CLIPS.map((clip) => [clip.id, clip.source, clip.label, clip.slot, clip.loop]),
    );
    // The loop flag a plain file.importAnimation derives from the VRMA's animation name (/loop/i) agrees.
    for (const clip of a.manifest.clips) expect(/loop/i.test(clip.source)).toBe(clip.loop);
  });
});
