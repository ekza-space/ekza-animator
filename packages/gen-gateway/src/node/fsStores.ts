// Persistent stores under GEN_DATA_DIR: one JSON file per job and per upload (written atomically: temp file + rename),
// blobs by SHA-256 under blobs/<first two hex>/<hash>. Rows are loaded into memory at open; a single gateway process
// owns the directory.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SHA256_HEX, sha256Hex } from '@ekza-studio/gen-core';
import { type BlobStore, type JobRow, MemoryJobStore, type UploadRow } from '../stores.ts';

async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
}

async function readJsonDir<T>(dir: string): Promise<T[]> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const out: T[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    out.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as T);
  }
  return out;
}

export class FileJobStore extends MemoryJobStore {
  private readonly dir: string;
  private constructor(dir: string) {
    super();
    this.dir = dir;
  }

  static async open(dir: string): Promise<FileJobStore> {
    const store = new FileJobStore(dir);
    for (const row of await readJsonDir<JobRow>(join(dir, 'jobs'))) store.rows.set(row.job.id, row);
    for (const up of await readJsonDir<UploadRow>(join(dir, 'uploads'))) store.uploads.set(up.id, up);
    return store;
  }

  override async put(row: JobRow): Promise<void> {
    await writeAtomic(join(this.dir, 'jobs', `${row.job.id}.json`), JSON.stringify(row));
    await super.put(row);
  }

  override async putUpload(row: UploadRow): Promise<void> {
    await writeAtomic(join(this.dir, 'uploads', `${row.id}.json`), JSON.stringify(row));
    await super.putUpload(row);
  }
}

export class FileBlobStore implements BlobStore {
  private readonly dir: string;
  private constructor(dir: string) {
    this.dir = dir;
  }

  static async open(dir: string): Promise<FileBlobStore> {
    await mkdir(join(dir, 'blobs'), { recursive: true, mode: 0o700 });
    return new FileBlobStore(join(dir, 'blobs'));
  }

  private path(sha: string): string {
    return join(this.dir, sha.slice(0, 2), sha);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const sha = await sha256Hex(bytes);
    const file = this.path(sha);
    try {
      await readFile(file, { flag: 'r' }).then(() => undefined);
      return sha;
    } catch {
      await mkdir(join(this.dir, sha.slice(0, 2)), { recursive: true, mode: 0o700 });
      await writeAtomic(file, bytes);
      return sha;
    }
  }

  async get(sha: string): Promise<Uint8Array | null> {
    if (!SHA256_HEX.test(sha)) return null;
    try {
      return new Uint8Array(await readFile(this.path(sha)));
    } catch {
      return null;
    }
  }
}

export async function openFileStores(dir: string): Promise<{ store: FileJobStore; blobs: FileBlobStore }> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return { store: await FileJobStore.open(dir), blobs: await FileBlobStore.open(dir) };
}
