export function Dialog(props) {
  return <button type="button" onClick={() => props.shell.runFromUi('ui.close', null)} />;
}
