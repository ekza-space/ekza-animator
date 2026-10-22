// M6b test API, INT group (M6B-SPEC §4.8, §0.5; C0 stub file, INT fills it). Not part of the closed
// `EkzaStudioTestApi` type (§9.1): INT's e2e specs reach it through `window.__EKZA_STUDIO_TEST__` with this type.
import type { M6bTestApiContext } from './support';

export interface M6bIntegrationTestApi {
  /**
   * Resolves once the character registry has no pending work: model characters' container rebuilds and the display
   * models they load (`CharacterRegistry.settled()`). E2E-RIG-10 waits for it after Bind Skin, whose rebuilt display
   * would otherwise land inside the idle window.
   */
  charactersSettled(): Promise<true>;
}

/** The kernel registry's `settled()` (editor-core's `KernelCharacters`, not exported: the app's registry has it). */
type Settling = { readonly settled?: () => Promise<void> };

export function m6bIntegrationTestApi(ctx: M6bTestApiContext): M6bIntegrationTestApi {
  return {
    async charactersSettled() {
      await (ctx.shell.app.characters as unknown as Settling).settled?.();
      return true;
    },
  };
}
