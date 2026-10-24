// Where Studio reads contracts (CHARACTER-CONTRACT-SPEC §8.1; decision CC-16): first the copy pinned in the document
// (a target record holds its contract document), then this session's cache, then the bundled snapshot served
// same-origin (`<contractsPath><game>/index.json` and `…/<revision>.json`, checked against the index's size and
// SHA-256, its revision recomputed). The live fetch from Hub (`CC-Q8`, on an explicit *Check for newer* only) waits for
// Hub's contract routes (C4); nothing here leaves the origin. Part of the target chunk.
import { type Disposer, EkzaError, sha256Hex } from '@ekza-studio/anim-core';
import {
  type ContractIndex,
  type ContractModel,
  canonicalJson,
  parseContractIndex,
  readContract,
  readContractText,
} from '@ekza-studio/io';
import type { EditorApp } from '../../types';
import { type TargetRecord, targetRecords } from './table';

/** The default base URL of the bundled snapshots (`EditorServices.contractsPath`). */
export const DEFAULT_CONTRACTS_PATH = '/contracts/';

type Fetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface ContractServiceOptions {
  readonly fetch?: Fetch;
}

/** A contract ready to pin: the model and its canonical document text. */
export interface LoadedContract {
  readonly model: ContractModel;
  readonly document: string;
}

const models = new Map<string, { readonly document: string; readonly model: ContractModel | EkzaError }>();

/**
 * The model of a pinned document, memoized by revision (pure; a document that no longer parses — a newer schema, a
 * damaged copy — yields its error, which the panel shows).
 */
export function pinnedModel(target: TargetRecord): ContractModel | EkzaError {
  const hit = models.get(target.contract.revision);
  if (hit !== undefined && hit.document === target.document) return hit.model;
  let model: ContractModel | EkzaError;
  try {
    model = readContractText(target.document);
    if (model.revision !== target.contract.revision) {
      model = new EkzaError('invalid-input', 'The pinned contract does not match its revision');
    }
  } catch (error) {
    model = error instanceof EkzaError ? error : new EkzaError('invalid-input', String(error));
  }
  models.set(target.contract.revision, { document: target.document, model });
  return model;
}

export class ContractService {
  private readonly fetchImpl: Fetch;
  private readonly indexes = new Map<string, Promise<ContractIndex>>();
  private readonly loaded = new Map<string, Promise<LoadedContract>>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly app: EditorApp,
    opts: ContractServiceOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((url) => globalThis.fetch(url));
  }

  private base(): string {
    const path = this.app.services.contractsPath ?? DEFAULT_CONTRACTS_PATH;
    return path.endsWith('/') ? path : `${path}/`;
  }

  /** The bundled snapshot index of a game (cached; a failed load is retried by the next call). */
  index(game: string): Promise<ContractIndex> {
    let pending = this.indexes.get(game);
    if (pending === undefined) {
      pending = this.fetchText(`${this.base()}${game}/index.json`).then((text) => {
        const index = parseContractIndex(JSON.parse(text) as unknown);
        if (index.game !== game) throw new EkzaError('invalid-input', `The contract index is not ${game}'s`);
        return index;
      });
      this.cache(this.indexes, game, pending);
    }
    return pending;
  }

  /** A contract revision of a game: pinned in the document, else cached, else the bundled snapshot. */
  load(game: string, revision: string): Promise<LoadedContract> {
    const pinned = targetRecords(this.app.store).find(
      (target) => target.game === game && target.contract.revision === revision,
    );
    if (pinned !== undefined) {
      const model = pinnedModel(pinned);
      if (!(model instanceof EkzaError)) return Promise.resolve({ model, document: pinned.document });
    }
    const key = `${game}\u0000${revision}`;
    let pending = this.loaded.get(key);
    if (pending === undefined) {
      pending = this.index(game).then(async (index) => {
        const entry = index.revisions.find((candidate) => candidate.revision === revision);
        if (entry === undefined) {
          throw new EkzaError('unavailable', `Contract ${revision.slice(0, 15)}… is not bundled with this Studio`);
        }
        const text = await this.fetchText(`${this.base()}${game}/${entry.file}`);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
          throw new EkzaError('checksum', 'The bundled contract failed its checksum');
        }
        const json = JSON.parse(text) as unknown;
        const model = readContract(json);
        if (model.revision !== revision)
          throw new EkzaError('invalid-input', 'The bundled contract has another revision');
        return { model, document: canonicalJson(json) };
      });
      this.cache(this.loaded, key, pending);
    }
    return pending;
  }

  /** The live channel's revision of a game in the bundled snapshot. */
  async latest(game: string): Promise<LoadedContract> {
    const index = await this.index(game);
    return this.load(game, index.channels.live);
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private cache<T>(map: Map<string, Promise<T>>, key: string, pending: Promise<T>): void {
    map.set(key, pending);
    pending.then(
      () => this.notify(),
      () => {
        if (map.get(key) === pending) map.delete(key);
        this.notify();
      },
    );
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  private async fetchText(url: string): Promise<string> {
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new EkzaError('unavailable', 'The contract could not be loaded', { cause: error });
    }
    if (!response.ok) throw new EkzaError('unavailable', `The contract could not be loaded (HTTP ${response.status})`);
    return response.text();
  }
}
