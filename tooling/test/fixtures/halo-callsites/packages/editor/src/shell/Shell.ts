export function closeAll(shell) {
  void shell.runFromUi('ui.close');
  quiet(shell.app, 'library.stop');
  void shell.runFromUi('ui.open', { dialog: 'export' });
}
