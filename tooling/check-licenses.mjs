#!/usr/bin/env node
// Licence gate (ADR 0009, MVP-SPEC §2): every production dependency must carry an allowed licence, or be listed in
// tooling/license-exceptions.json with a rationale; `sharp` and `@img/sharp-*` (LGPL libvips) must never be installed.
//
// Usage: node tooling/check-licenses.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'OFL-1.1',
]);

/** True when the SPDX expression is satisfiable with allowed licences (OR: any operand; AND: every operand). */
export function isAllowedExpression(expression, allowed = ALLOWED_LICENSES) {
  const tokens = String(expression)
    .replace(/[()]/g, (p) => ` ${p} `)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let index = 0;
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[index]?.toUpperCase() === 'OR') {
      index++;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[index]?.toUpperCase() === 'AND') {
      index++;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  };
  const parseAtom = () => {
    const token = tokens[index++];
    if (token === '(') {
      const value = parseOr();
      if (tokens[index++] !== ')') throw new Error(`Unbalanced licence expression '${expression}'`);
      return value;
    }
    if (token === undefined) throw new Error(`Incomplete licence expression '${expression}'`);
    // `X WITH exception` grants at least X's permissions.
    if (tokens[index]?.toUpperCase() === 'WITH') index += 2;
    return allowed.has(token);
  };
  const result = parseOr();
  if (index !== tokens.length) throw new Error(`Unexpected token in licence expression '${expression}'`);
  return result;
}

export function isForbiddenPackage(name) {
  return name === 'sharp' || name.startsWith('@img/sharp-');
}

export function matchException(exceptions, name, license) {
  return exceptions.find(
    (e) => e.license === license && (e.name.endsWith('*') ? name.startsWith(e.name.slice(0, -1)) : e.name === name),
  );
}

/** Lockfile package keys that would install sharp or its libvips binaries (link: overrides are not packages). */
export function forbiddenLockfileEntries(lockfile) {
  const found = new Set();
  for (const match of lockfile.matchAll(/^ {2}'?((?:@img\/sharp-[^@'\s]+)|sharp)@[^:\s']+'?:/gm)) found.add(match[1]);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** `pnpm licenses list --prod --json` → [{ name, version, license }]. */
export function flattenLicenseReport(report) {
  const out = [];
  for (const [license, packages] of Object.entries(report)) {
    for (const pkg of packages)
      for (const version of pkg.versions) out.push({ name: pkg.name, version, license: pkg.license ?? license });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function checkLicenses(packages, exceptions, lockfile) {
  const problems = [];
  const used = new Set();
  for (const { name, version, license } of packages) {
    if (isForbiddenPackage(name)) {
      problems.push(`${name}@${version}: sharp / libvips must never be installed (ADR 0009)`);
      continue;
    }
    let allowed;
    try {
      allowed = isAllowedExpression(license);
    } catch (error) {
      problems.push(`${name}@${version}: ${error.message}`);
      continue;
    }
    if (allowed) continue;
    const exception = matchException(exceptions, name, license);
    if (exception === undefined)
      problems.push(`${name}@${version}: licence '${license}' is not allowed and has no exception`);
    else used.add(exception);
  }
  for (const name of forbiddenLockfileEntries(lockfile)) {
    problems.push(`pnpm-lock.yaml installs ${name}; sharp / libvips must never be installed (ADR 0009)`);
  }
  const unused = exceptions.filter((e) => !used.has(e)).map((e) => e.name);
  return { problems, unused };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const json = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const packages = flattenLicenseReport(JSON.parse(json));
  const { exceptions } = JSON.parse(readFileSync(join(root, 'tooling', 'license-exceptions.json'), 'utf8'));
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const { problems, unused } = checkLicenses(packages, exceptions, lockfile);
  for (const name of unused) console.warn(`check-licenses: exception '${name}' matched no installed package`);
  if (problems.length > 0) {
    console.error(`check-licenses: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-licenses: ${packages.length} production packages have allowed licences or reviewed exceptions`);
}
