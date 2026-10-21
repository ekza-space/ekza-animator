// C10 content helpers (M6B-SPEC §3 rule 5): run `file.exportCharacter` through the test API and capture its download
// with `lastExport()`, read a GLB's JSON in Node, rewrite a GLB's JSON (lint fixtures), and check an exported
// character on `/e2e/character-check` (three-vrm load, raw bones, a VRMA idle).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, type TestInfo } from '@playwright/test';
import { failIfBlocked, lastExport, type RunResult } from './test-api';

export interface CharacterArtifactSummary {
  readonly kind: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly lints: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
  readonly readBack: Record<string, unknown> | null;
  readonly validation: { readonly errors: number } | null;
}

/** Runs `file.exportCharacter` (artifact summaries only cross into Node). */
export async function runExportCharacter(
  page: Page,
  args: Record<string, unknown>,
): Promise<{ readonly result: RunResult; readonly artifact: CharacterArtifactSummary | null }> {
  const result: RunResult = await page.evaluate(async (exportArgs): Promise<RunResult> => {
    const api = window.__EKZA_STUDIO_TEST__;
    if (api === undefined) return { status: 'failed', error: { code: 'internal', message: 'no test API' } };
    const ran = await api.run('file.exportCharacter', exportArgs);
    const artifacts = Array.isArray(ran.value)
      ? (
          ran.value as {
            kind: string;
            fileName: string;
            sha256: string;
            bytes: Uint8Array;
            lints: unknown[];
            readBack: unknown;
            validation: { errors: number } | null;
          }[]
        ).map((a) => ({
          kind: a.kind,
          fileName: a.fileName,
          sha256: a.sha256,
          byteLength: a.bytes.byteLength,
          lints: a.lints,
          readBack: a.readBack,
          validation: a.validation === null ? null : { errors: a.validation.errors },
        }))
      : ran.value;
    return { ...ran, value: artifacts };
  }, args);
  const artifacts = Array.isArray(result.value) ? (result.value as CharacterArtifactSummary[]) : [];
  return { result, artifact: artifacts[0] ?? null };
}

/** Exports a character that must download: the download, the artifact and `lastExport()` are one file. */
export async function exportCharacterFile(
  page: Page,
  args: Record<string, unknown>,
): Promise<{ readonly artifact: CharacterArtifactSummary; readonly bytes: Uint8Array }> {
  const download = page.waitForEvent('download', { timeout: 120_000 });
  const { result, artifact } = await runExportCharacter(page, args);
  failIfBlocked('file.exportCharacter', result);
  expect(result.status, `file.exportCharacter: ${result.reason ?? result.error?.message ?? ''}`).toBe('finished');
  if (artifact === null) throw new Error('no artifact');
  expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  expect(file.suggestedFilename()).toBe(artifact.fileName);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
  const last = await lastExport(page);
  expect(last?.sha256).toBe(artifact.sha256);
  return { artifact, bytes };
}

const u32 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

/** The JSON chunk of a GLB. */
export function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const length = u32(bytes, 12);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as Record<string, unknown>;
}

/** The same GLB with its JSON chunk replaced by `edit(json)` (the BIN chunk kept). */
export function withGlbJson(bytes: Uint8Array, edit: (json: Record<string, unknown>) => void): Uint8Array {
  const json = glbJson(bytes);
  edit(json);
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const oldJson = u32(bytes, 12);
  const rest = bytes.subarray(20 + oldJson);
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const dv = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12), 0);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out;
}

export interface CharacterCheck {
  readonly metaVersion: '0' | '1' | null;
  readonly meta: {
    readonly name: string | null;
    readonly authors: readonly string[];
    readonly licenseUrl: string | null;
    readonly thumbnail: { readonly width: number; readonly height: number } | null;
  };
  readonly humanoid: readonly string[];
  readonly unresolved: readonly string[];
  readonly skinnedMeshes: number;
  readonly tris: number;
  readonly joints: number;
  readonly clips: readonly string[];
  readonly vrmaMotion: number;
  readonly vrmaPlayed: boolean;
  readonly clipMotion: number;
}

/** Opens `/e2e/character-check` in a fresh page of the test's project and checks `bytes` there. */
export async function checkCharacter(browser: Browser, testInfo: TestInfo, bytes: Uint8Array): Promise<CharacterCheck> {
  const baseURL = testInfo.project.use.baseURL;
  const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/e2e/character-check');
    await page.waitForFunction(() => window.__EKZA_CHARACTER_CHECK__ !== undefined);
    const base64 = Buffer.from(bytes).toString('base64');
    return await page.evaluate(async (data) => {
      const binary = atob(data);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      const api = window.__EKZA_CHARACTER_CHECK__;
      if (api === undefined) throw new Error('no character check API');
      return api.check(out);
    }, base64);
  } finally {
    await context.close();
  }
}

declare global {
  interface Window {
    /** `/e2e/character-check` (app/e2e/character-check/CharacterCheck.tsx). */
    __EKZA_CHARACTER_CHECK__?: { check(bytes: Uint8Array): Promise<CharacterCheck> };
  }
}
