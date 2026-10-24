// Auto-Rig sends: the wizard context, the intake wrapper and a keymap binding.
export const BINDINGS = [{ key: 'Delete', op: 'scene.delete', args: { ids: 'selected', depth: 0 } }];

export async function step(ctx, file) {
  await ctx.run('autorig.controls', { hidden: true });
  await runIntake(ctx, file.name, 'autorig.intake', { bytes: file.bytes, name: file.name });
  quiet(ctx, 'library.stop');
}
