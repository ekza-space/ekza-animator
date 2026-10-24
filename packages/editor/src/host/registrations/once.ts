// Idempotent contributions for the host's registrations (STUDIO-TOUCH-SPEC §20.3 item 12; T3): an operator, menu item
// or marking menu whose id is already registered — by an extension, a test, or a second registration of the same
// part — is left as it is, so registering a part twice changes nothing and its disposer removes only what it added.
import type { Disposer } from '@ekza-studio/anim-core';
import type { Contribution, EditorApp } from '@ekza-studio/editor-core';

type Registered = Extract<Contribution, { readonly kind: 'operator' | 'menu' | 'markingMenu' }>;

function present(app: EditorApp, contribution: Registered): boolean {
  const { id } = contribution.def;
  if (contribution.kind === 'operator') return app.operators.get(id) !== undefined;
  if (contribution.kind === 'menu') return app.menus.get(id) !== undefined;
  return app.markingMenus.get(id) !== undefined;
}

/** Contributes each entry whose id is not registered yet; the disposer removes those (in reverse order). */
export function registerOnce(app: EditorApp, contributions: readonly Registered[]): Disposer {
  const disposers: Disposer[] = [];
  for (const contribution of contributions) {
    if (!present(app, contribution)) disposers.push(app.contribute(contribution));
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
