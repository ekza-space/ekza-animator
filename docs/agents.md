# AI agents in Ekza Studio (MCP)

Ekza Studio ships an [MCP](https://modelcontextprotocol.io) server, **`ekza-studio-mcp`**, so an AI agent — Claude
Code, Claude Desktop, Cursor, VS Code or any other MCP client — can work on your animation:

- **live**, in the editor tab you have open: after you pair the tab with a one-time code, the agent reads the scene,
  keys poses, makes clips, rigs a model, adds library clips, looks at the viewport (`view_capture`) and exports. Every
  change is one undo step labelled `AI: …` in History, listed in the Agent panel, and `Mod+Z` takes it back;
- **headless**, on files in a workspace folder: the agent opens `.ekzanim`, `.vrm`, `.glb` files or a bundled sample,
  edits them in the same way and saves or exports into that folder.

The server runs on your computer only: stdio to the client, a loopback WebSocket (`127.0.0.1:47821–47830`) to the
editor tab, no network access, no telemetry. Tool list: [agent-tools-reference.md](agent-tools-reference.md)
(generated). Design and contracts: [MCP-SPEC.md](MCP-SPEC.md) (§0.4 is the MVP), [ADR 0018](adr/0018-agent-bridge-mcp.md),
[ADR 0022](adr/0022-m-ai-mvp-cut.md).

> **Status (MVP, toolset `1.0.0-mvp.2`)**: the package is not on npm yet. Until it is, run the server from a clone of
> this repository (`pnpm install && pnpm mcp:build`, then use `node <repo>/packages/mcp-server/dist/cli.mjs`). The
> `npx -y ekza-studio-mcp` lines below are for after the first publish.

## 1. Add the server to your client

`<repo>` is the absolute path of your clone. Node.js 22 or later.

### Claude Code

```bash
# from a clone (now)
claude mcp add ekza-studio -- node <repo>/packages/mcp-server/dist/cli.mjs
# after the npm publish
claude mcp add ekza-studio -- npx -y ekza-studio-mcp
```

Claude Code sets `CLAUDE_PROJECT_DIR` to the project it runs in; the server uses it as its **workspace folder**
(where headless files are read and exports are written). Add `--workspace <folder>` after the command to pin another
folder; a user-scope entry with a fixed `--workspace` pins every project to that folder.

Contributors: this repository has a `.mcp.json` (server `ekza-studio`, `node packages/mcp-server/dist/cli.mjs`);
run `pnpm mcp:build` once and Claude Code offers it when you open the repository.

### Claude Desktop

`claude_desktop_config.json` (Settings › Developer › Edit Config), then quit and restart Claude Desktop:

```json
{
  "mcpServers": {
    "ekza-studio": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/cli.mjs", "--workspace", "/absolute/path/to/folder"]
    }
  }
}
```

After the publish: `"command": "npx", "args": ["-y", "ekza-studio-mcp", "--workspace", "/absolute/path/to/folder"]`.

### Cursor

`.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "ekza-studio": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/cli.mjs", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "ekza-studio": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/cli.mjs", "--workspace", "${workspaceFolder}"]
    }
  }
}
```

### Options

`node <repo>/packages/mcp-server/dist/cli.mjs --help` lists them. The ones you may need:

| Option | What it does |
|---|---|
| `--workspace <dir>` | The folder headless files come from and exports go to. Never `/` or your home folder (the file tools turn off then). Overwritten files are kept in `<dir>/.ekza-trash/`. |
| `--allow-origin <origin>` | Also accept an editor served from another address, e.g. `--allow-origin http://localhost:3100`. |
| `--bridge-port <n>` | A fixed bridge port (default: the first free of 47821–47830). |
| `--no-bridge` | Headless only. |
| `--samples-dir <dir>` | Folder with `seed-san.vrm` / `quaternius-ual.glb` (the repository's `fixtures/` works). Polybot, its unskinned GLBs and the Cube Lad are bundled. |
| `--audit-log <file>` | One JSON line per call (tool, project, ok, error code, duration; no document data). |

## 2. Pair the agent with your editor

1. Open the editor: `pnpm dev` → <http://localhost:3000/editor>, or the hosted editor.
2. Open the **Agent panel**: click the **AI** pill in the status line (or Windows › Agent). Click **Connect**. The
   panel finds the server and shows a code such as `K7Q-M4P` (valid for two minutes, single use).
3. Tell the agent: *"Connect to the editor with code K7Q-M4P"*. It calls `editor_connect`.
4. The editor asks **"Allow … to work in this project?"** with the grants:
   - **Read** — see the project and pictures of the viewport (always on);
   - **Edit** — change animation, rig a model, add clips; every change is an `AI: …` undo step;
   - **Files** — exports and imports; **Workspace folder** also lets files move between the editor and the agent's
     workspace folder (off: exports download in the browser after you confirm);
   - **View** — change what you see (active character and clip, playhead). Rigging (`rig_create`) and model imports
     need it, because they make the new character the active one.
   Click **Allow**. The pill reads **AI connected**.
5. While the agent works, the pill says what it does (`AI is editing: …`), the panel lists every call with **Show**
   and **Undo**/**Revert**, and consequential calls (rigging, replacing the project, downloads, overwrites) ask you on
   a card next to the status line first. **Pause** stops new calls; **Disconnect** ends the pairing (pair again with a
   new code). **Revert all AI changes since pairing** takes back everything the agent did and keeps your own edits.

The hosted editor (`https://studio.ekza.io`) talks to the server on your computer, so Chrome asks once **"Access
other apps and services on this device"** (Local Network Access). Choose **Allow**. If you blocked it: click the
icon left of the address › Site settings › *Local network access* › Allow, reload, Connect again. Safari does not
let an https page reach a loopback WebSocket: use Chrome, Edge or Firefox, or the local editor. An editor on another
address needs `--allow-origin <its origin>` on the server.

## 3. What to ask

- "Make Polybot wave its right hand over 2 seconds in a new clip, then show me a contact sheet."
- "Rig the model in my scene and add a walk, then export a VRM to the workspace." (the `rig_and_animate` prompt does
  the same step by step: inspect, fix, rig, library clip, export)
- "Retime the jump so the takeoff is 4 frames faster", "Ease out the head turn at frame 30".
- Headless, without the editor: "Open `walk.ekzanim` from the workspace, mirror the left arm pose to the right, save."

The agent never touches your selection, playhead or unkeyed pose unless you gave it View, edits only the clip it
names, and an edit over curves you changed since it last read them fails instead of overwriting your work.

## 4. Limits of the MVP

- One editor tab per server; a dropped connection ends the pairing (no resume).
- Headless `view_capture` is not available (the agent works with numbers there; export and look in Studio).
- Weight painting, modeling and the `operator_run` escape hatch are not available to agents yet.
- Shaded captures of untrusted models can contain text; the agent treats names and text from files as data, not
  instructions, but review what it does.
- `--http` (Streamable HTTP) is not in this build.

## 5. Troubleshooting

| The panel says | Do |
|---|---|
| "No agent server found" | Start the agent (it starts the server); check that `node <repo>/packages/mcp-server/dist/cli.mjs --version` works; on another address add `--allow-origin`. |
| "Local network access is blocked" | Site settings › Local network access › Allow, reload. |
| "The agent server ended the connection" | The agent's session ended; Connect again and give it the new code. |
| The agent says `not_granted` | Turn the grant on in the Agent panel (Files + Workspace folder for workspace files, View for rigging). |
