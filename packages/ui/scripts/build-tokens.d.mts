// Types of build-tokens.mjs for the ui tests.
export declare const TOKENS_JSON: string;
export declare const TOKENS_CSS: string;
export declare const DOCKVIEW_CORE_CSS: string;
export declare const DOCKVIEW_VERSION: string;
export declare function renderTokensCss(tokens: unknown): string;
export declare function stripDockviewThemes(css: string): string;
export declare function renderDockviewCoreCss(source: string): string;
export declare function dockviewSourcePath(): string;
export declare function formatWithBiome(path: string, css: string): string;
export declare function generate(): Map<string, string>;
