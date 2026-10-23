// The workspace sandbox (MCP-SPEC §5.17.3, §5.19 T7): every lexical check before any filesystem call, realpath inside
// realpath'd roots, the extension allow-list, overwrites with a `.ekza-trash/` backup (newest 50 files, ≤ 500 MB),
// the `io` input budget for reads; refuses `/`, the home folder and system folders as a default root (file tools off).
// Messages name roots by folder name only: no absolute path outside a root ever reaches the agent.
import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  AgentToolFailure,
  EXPORTS_DIR,
  fileExtension,
  isReservedName,
  READ_EXTENSIONS,
  WRITE_EXTENSIONS,
} from '@ekza-studio/agent-tools';

/** The `io` input budget (§5.5, §5.17.3): reads above it are refused before reading. */
export const READ_MAX_BYTES = 256 * 1024 * 1024;
export const TRASH_DIR = '.ekza-trash';
export const TRASH_MAX_FILES = 50;
export const TRASH_MAX_BYTES = 500 * 1024 * 1024;

/** POSIX system folders (§5.17.3) that are never a default workspace. */
const SYSTEM_DIRS = [
  '/System',
  '/Library',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private',
  '/private/var',
  '/private/etc',
  '/opt',
  '/Applications',
];

export interface SandboxOptions {
  /** The workspace (read-write) as configured (absolute). */
  readonly root: string;
  readonly readOnlyRoots: readonly string[];
  /** Where the workspace came from: an unsafe default (`env`/`cwd`) turns the file tools off. */
  readonly source: 'flag' | 'env' | 'cwd';
  /** The home folder (tests); default `os.homedir()`. */
  readonly home?: string;
}

export interface SandboxRead {
  /** The path as the agent sees it: relative to its root (`walk.ekzanim`, `models/bot.vrm`). */
  readonly path: string;
  readonly bytes: Uint8Array;
}
export interface SandboxWrite {
  readonly path: string;
  /** `.ekza-trash/<UTC timestamp>-<name>` when an existing file was replaced. */
  readonly backup: string | null;
}

export interface WorkspaceSandbox {
  /** The realpath'd workspace root. */
  readonly root: string;
  /** False when the workspace defaulted to `/`, the home folder or a system folder (§5.17.3). */
  readonly enabled: boolean;
  /** Folder names of the roots, for messages. */
  readonly rootNames: readonly string[];
  read(path: string, opts?: { readonly extensions?: readonly string[] }): Promise<SandboxRead>;
  write(
    path: string,
    bytes: Uint8Array,
    opts: { readonly overwrite: boolean; readonly extensions?: readonly string[] },
  ): Promise<SandboxWrite>;
}

function sandboxError(message: string, hint: string, detail?: Record<string, unknown>): AgentToolFailure {
  return new AgentToolFailure('sandbox', message, hint, {
    retryable: false,
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * Step 1 of §5.17.3 on the raw string: NUL; UNC and device prefixes; drive-relative paths; a `:` anywhere but an
 * absolute drive prefix (NTFS streams); reserved device names; segments ending in a space or a dot. Returns the
 * reason, or null.
 */
export function lexicalProblem(raw: string): string | null {
  if (raw.length === 0) return 'an empty path';
  if (raw.includes('\0')) return 'a NUL character';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return 'a control character';
  }
  if (raw.startsWith('\\\\') || raw.startsWith('//') || raw.startsWith('\\??\\')) return 'a UNC or device path';
  if (/^[A-Za-z]:(?![\\/])/.test(raw)) return 'a drive-relative path';
  const body = /^[A-Za-z]:[\\/]/.test(raw) ? raw.slice(2) : raw;
  for (const segment of body.split(/[\\/]/)) {
    if (segment === '' || segment === '.' || segment === '..') continue;
    if (segment.includes(':')) return 'a colon in a file name';
    if (isReservedName(segment)) return 'a reserved device name';
    if (/[ .]$/.test(segment)) return 'a name ending in a space or a dot';
  }
  return null;
}

/** `/`, the home folder or a system folder (§5.17.3): never a default workspace. */
export function isUnsafeRoot(path: string, home: string): boolean {
  const normal = resolve(path);
  if (normal === resolve('/') || normal === resolve(home)) return true;
  if (/^[A-Za-z]:\\?$/.test(normal)) return true;
  if (process.platform === 'win32') {
    for (const env of ['WINDIR', 'ProgramFiles', 'ProgramFiles(x86)', 'USERPROFILE']) {
      const dir = process.env[env];
      if (dir !== undefined && dir !== '' && resolve(dir).toLowerCase() === normal.toLowerCase()) return true;
    }
  }
  return SYSTEM_DIRS.includes(normal);
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

interface Root {
  readonly given: string;
  readonly real: string;
  readonly writable: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fsp.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function realOrSelf(path: string): Promise<string> {
  try {
    return await fsp.realpath(path);
  } catch {
    return resolve(path);
  }
}

/** `20261023T171500.123Z`: sortable, no colons. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '');
}

/** Builds the sandbox; every root is realpath'd once, here (§5.17.3). */
export async function createWorkspaceSandbox(opts: SandboxOptions): Promise<WorkspaceSandbox> {
  const home = opts.home ?? homedir();
  const workspaceReal = await realOrSelf(opts.root);
  const unsafe = opts.source !== 'flag' && (isUnsafeRoot(opts.root, home) || isUnsafeRoot(workspaceReal, home));
  const roots: Root[] = [{ given: resolve(opts.root), real: workspaceReal, writable: true }];
  for (const dir of opts.readOnlyRoots)
    roots.push({ given: resolve(dir), real: await realOrSelf(dir), writable: false });
  const rootNames = roots.map((root) => basename(root.real) || root.real);
  const where = `the workspace folder ${JSON.stringify(rootNames[0])}${
    rootNames.length > 1
      ? ` (read-only: ${rootNames
          .slice(1)
          .map((n) => JSON.stringify(n))
          .join(', ')})`
      : ''
  }`;

  const off = (): AgentToolFailure =>
    sandboxError(
      'No workspace folder: the server was started in the home folder, / or a system folder.',
      'no workspace folder: start the server with --workspace <folder>; project_open {sample} still works',
    );

  /** Steps 1–2: lexical checks and the root the path belongs to. */
  const locate = (raw: string, write: boolean, extensions: readonly string[]): { root: Root; abs: string } => {
    if (unsafe) throw off();
    const problem = lexicalProblem(raw);
    if (problem !== null) {
      throw sandboxError(`The path has ${problem}.`, `use a plain path inside ${where}`, { reason: problem });
    }
    const ext = fileExtension(raw);
    if (!extensions.includes(ext)) {
      throw sandboxError(
        `Files of this kind cannot be ${write ? 'written' : 'read'} here.`,
        `use one of ${extensions.join(', ')} inside ${where}`,
        { allowed: [...extensions] },
      );
    }
    const candidates = write ? roots.filter((root) => root.writable) : roots;
    let found: { root: Root; abs: string } | null = null;
    if (isAbsolute(raw)) {
      const abs = resolve(raw);
      for (const root of candidates) {
        if (inside(abs, root.given) || inside(abs, root.real)) {
          found = { root, abs: inside(abs, root.real) ? abs : join(root.real, relative(root.given, abs)) };
          break;
        }
      }
    } else {
      const root = candidates[0] as Root;
      const abs = resolve(root.real, raw);
      if (inside(abs, root.real)) found = { root, abs };
    }
    if (found === null) {
      throw sandboxError(
        `The path is outside ${write ? 'the workspace folder' : 'the allowed folders'}.`,
        `use a path relative to ${where}`,
      );
    }
    const rel = relative(found.root.real, found.abs);
    if (rel === '' || rel.split(sep).some((segment) => segment.startsWith('.'))) {
      throw sandboxError(
        'Paths may not name hidden or dot folders inside the workspace.',
        `use a plain path inside ${where}`,
      );
    }
    return found;
  };

  /** Steps 3–4: the real path must stay inside a realpath'd root. */
  const confine = (real: string, root: Root): void => {
    if (!inside(real, root.real)) {
      throw sandboxError('The path leads outside the allowed folders (a link).', `use a path inside ${where}`);
    }
  };

  const shown = (root: Root, abs: string): string => relative(root.real, abs).split(sep).join('/');

  const ioError = (what: string, error: unknown): AgentToolFailure => {
    const code =
      typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'EIO';
    return new AgentToolFailure('io_error', `${what} failed (${code}).`, `check the file inside ${where}`, {
      retryable: false,
      detail: { cause: /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : 'EIO' },
    });
  };

  const pruneTrash = async (trash: string): Promise<void> => {
    try {
      const names = (await fsp.readdir(trash)).sort().reverse(); // newest first (timestamp prefix)
      let total = 0;
      for (let i = 0; i < names.length; i++) {
        const file = join(trash, names[i] as string);
        const size = (await fsp.lstat(file)).size;
        total += size;
        if (i >= TRASH_MAX_FILES || total > TRASH_MAX_BYTES) await fsp.rm(file, { force: true });
      }
    } catch {
      // best effort
    }
  };

  return {
    root: workspaceReal,
    enabled: !unsafe,
    rootNames,
    async read(path, readOpts) {
      const { root, abs } = locate(path, false, readOpts?.extensions ?? READ_EXTENSIONS);
      let real: string;
      try {
        real = await fsp.realpath(abs);
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
          throw new AgentToolFailure(
            'not_found',
            `There is no file ${JSON.stringify(shown(root, abs))}.`,
            `list the files in ${where} and pass an existing one`,
          );
        }
        throw ioError('Reading the file', error);
      }
      confine(real, root);
      const info = await fsp.stat(real);
      if (!info.isFile()) throw sandboxError('The path is not a regular file.', `pass a file inside ${where}`);
      if (info.size > READ_MAX_BYTES) {
        throw new AgentToolFailure('limit', 'The file is larger than 256 MiB.', 'use a smaller file', {
          retryable: false,
          detail: { bytes: info.size, maxBytes: READ_MAX_BYTES },
        });
      }
      try {
        const handle = await fsp.open(real, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        try {
          return { path: shown(root, abs), bytes: new Uint8Array(await handle.readFile()) };
        } finally {
          await handle.close();
        }
      } catch (error) {
        throw ioError('Reading the file', error);
      }
    },
    async write(path, bytes, writeOpts) {
      const { root, abs } = locate(path, true, writeOpts.extensions ?? WRITE_EXTENSIONS);
      const parent = dirname(abs);
      // the parent must exist, except exports/ directly under the workspace, which is created
      if (parent === join(root.real, EXPORTS_DIR)) {
        try {
          await fsp.mkdir(parent, { recursive: false });
        } catch (error) {
          if ((error as { code?: string }).code !== 'EEXIST') throw ioError('Creating exports/', error);
        }
      }
      let realParent: string;
      try {
        realParent = await fsp.realpath(parent);
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
          throw sandboxError('The folder does not exist.', `write into an existing folder inside ${where}`);
        }
        throw ioError('Writing the file', error);
      }
      confine(realParent, root);
      const target = join(realParent, basename(abs));
      let present = false;
      try {
        const info = await fsp.lstat(target);
        if (!info.isFile()) {
          throw sandboxError(
            'The path names something that is not a regular file.',
            `pick another name inside ${where}`,
          );
        }
        present = true;
      } catch (error) {
        if (error instanceof AgentToolFailure) throw error;
        if ((error as { code?: string }).code !== 'ENOENT') throw ioError('Writing the file', error);
      }
      let backup: string | null = null;
      if (present) {
        if (!writeOpts.overwrite) {
          throw new AgentToolFailure(
            'exists',
            `${JSON.stringify(shown(root, abs))} already exists.`,
            'pass overwrite: true to replace it (the old file is kept in .ekza-trash/), or pick another name',
          );
        }
        const trash = join(root.real, TRASH_DIR);
        try {
          await fsp.mkdir(trash, { recursive: true });
          let name = `${stamp(new Date())}-${basename(target)}`;
          for (let n = 2; await pathExists(join(trash, name)); n++)
            name = `${stamp(new Date())}-${n}-${basename(target)}`;
          await fsp.rename(target, join(trash, name));
          backup = `${TRASH_DIR}/${name}`;
        } catch (error) {
          throw ioError('Keeping the old file in .ekza-trash/', error);
        }
        await pruneTrash(trash);
      }
      const temp = join(realParent, `.ekza-tmp-${randomBytes(6).toString('hex')}`);
      try {
        await fsp.writeFile(temp, bytes, { flag: 'wx', mode: 0o644 });
        await fsp.rename(temp, target);
      } catch (error) {
        await fsp.rm(temp, { force: true }).catch(() => {});
        throw ioError('Writing the file', error);
      }
      return { path: shown(root, target), backup };
    },
  };
}
