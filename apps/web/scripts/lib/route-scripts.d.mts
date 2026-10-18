// Types of route-scripts.mjs for the app's tests.
export declare function gzip9(data: string | Uint8Array): number;
export declare function kB(bytes: number): string;
export declare function chunkPath(url: string): string;
export declare function htmlScripts(html: string): string[];
export declare function chunkLoaders(source: string): { id: number; target: number; files: string[] }[];
export declare function isE2eBuild(nextDir: string): boolean;
export interface RouteScripts {
  readonly html: readonly string[];
  readonly dynamic: readonly string[];
  readonly initial: readonly string[];
  readonly missing: readonly string[];
  readonly lazy: readonly {
    readonly id: number;
    readonly target: number;
    readonly definedIn: string;
    readonly files: readonly string[];
  }[];
  readonly chunks: readonly string[];
  readonly sizes: ReadonlyMap<string, number>;
  readonly sources: ReadonlyMap<string, string>;
  readonly e2eBuild: boolean;
}
export declare function readRouteScripts(nextDir: string, route?: string): RouteScripts;
