// Types of route-scripts.mjs for the app's tests.
export declare function gzip9(data: string | Uint8Array): number;
export declare function kB(bytes: number): string;
export declare function chunkPath(url: string): string;
export declare function htmlScripts(html: string): string[];
export declare function chunkLoaders(source: string): { id: number; target: number; files: string[] }[];
export declare function isE2eBuild(nextDir: string): boolean;
export declare const ROUTE_INITIAL_MARKERS: Readonly<Record<string, readonly string[]>>;
export declare function stripRouteGroups(entry: string): string;
export declare function routeSegment(nextDir: string, route: string): string;
export declare function loadableManifests(
  nextDir: string,
  segment: string,
): { readonly page: string; readonly layouts: readonly string[] };
export interface RouteScripts {
  readonly html: readonly string[];
  /** The route's app-paths-manifest entry, route groups included (`/(studio)/editor/page`). */
  readonly segment: string;
  /** The loadable manifests read: the page's, then the layouts' that exist. */
  readonly loadableManifests: readonly string[];
  readonly dynamic: readonly string[];
  /** Lazy groups counted as initial by the route's initial markers (shared-layout host and shell). */
  readonly promoted: readonly { readonly id: number; readonly files: readonly string[] }[];
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
export declare function readRouteScripts(
  nextDir: string,
  route?: string,
  opts?: { readonly initialMarkers?: readonly string[] },
): RouteScripts;
