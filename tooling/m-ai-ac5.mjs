#!/usr/bin/env node
// MVP-AC-5 (MCP-SPEC §0.4.6): one real Claude Code session against the live editor, recorded.
//
// What it does:
//   1. writes an MCP config for the built server (packages/mcp-server/dist/cli.mjs) with a fresh workspace folder,
//      a fixed bridge port and the editor's origin allowed;
//   2. opens the editor (`<url>/editor?agentPort=<port>`, a production `next start`) in Chrome through Playwright,
//      clicks Connect in the Agent panel and reads the pairing code from the page;
//   3. runs `claude -p "<prompt with the code>" --mcp-config <file> --strict-mcp-config --output-format stream-json`;
//   4. plays the user while Claude works: in the grants dialog it turns on Edit, Files, Workspace folder and View and
//      clicks Allow; on every confirm card it clicks Allow (the only touches the acceptance allows);
//   5. saves the transcript, the contact sheets Claude received, screenshots of the editor and the agent panel, and
//      the files Claude wrote into the workspace under docs/evidence/m-ai-mvp/.
//
// Prerequisites: `pnpm mcp:build`; the web app built and served (`pnpm --filter web build && pnpm --filter web start`,
// default http://localhost:3000); a logged-in `claude` CLI on PATH; local Chrome.
//
// Usage: node tooling/m-ai-ac5.mjs [--url http://localhost:3000] [--port 47829] [--out docs/evidence/m-ai-mvp]
//        [--model <claude model>] [--headed] [--prompt "<text with {CODE}>"]
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
};
const url = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const port = Number(flag('port', '47829'));
const out = resolve(ROOT, flag('out', 'docs/evidence/m-ai-mvp'));
const model = flag('model', null);
const headed = args.includes('--headed');
const PROMPT =
  flag('prompt', null) ??
  'Connect to the Ekza Studio editor with pairing code {CODE}. Then: (1) bring the Polybot sample into the scene and ' +
    'make Polybot wave its right hand over 2 seconds in a new clip; capture a contact sheet of the wave and check it. ' +
    '(2) Then import the Cube Lad sample (cube_lad), rig it and add a walk from the clip library, and export the rigged ' +
    'Cube Lad as a VRM into the workspace folder (delivery: workspace; author "Ekza Studio AC-5", licence cc0). ' +
    'Report briefly what you did.';

const CLI = join(ROOT, 'packages/mcp-server/dist/cli.mjs');
if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run pnpm mcp:build`);
mkdirSync(out, { recursive: true });
const workspace = mkdtempSync(join(tmpdir(), 'ekza-ac5-'));
const origin = new URL(url).origin;
const mcpConfig = join(out, 'mcp-config.json');
writeFileSync(
  mcpConfig,
  `${JSON.stringify(
    {
      mcpServers: {
        'ekza-studio': {
          command: process.execPath,
          args: [CLI, '--workspace', workspace, '--bridge-port', String(port), '--allow-origin', origin],
        },
      },
    },
    null,
    2,
  )}\n`,
);
const log = (line) => process.stderr.write(`[ac5] ${line}\n`);
log(`workspace ${workspace}; bridge ${port}; editor ${url}`);

// --- the browser (the user) -------------------------------------------------------------------------------------------
const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const userActions = [];
let claude = null;
let finished = false;

/** Starts Claude once the page shows a code (the server starts with Claude, so the page connects after it). */
async function pairingCode() {
  await page.goto(`${url}/editor?agentPort=${port}`);
  await page.getByTestId('agent-panel').waitFor({ timeout: 60_000 });
  for (let i = 0; i < 120; i++) {
    // a fresh profile opens the welcome dialog first: the user closes it
    const modal = page.locator('[role="dialog"]').filter({ hasNot: page.getByTestId('agent-grants') });
    if (
      await modal
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await page.keyboard.press('Escape');
      userActions.push({ at: new Date().toISOString(), action: 'closed the welcome dialog (Esc)' });
    }
    const code = page.getByTestId('agent-code');
    if (await code.isVisible().catch(() => false)) return ((await code.textContent()) ?? '').trim();
    const connect = page.getByTestId('agent-connect');
    if (await connect.isVisible().catch(() => false)) await connect.click().catch(() => {});
    const retry = page.getByTestId('agent-retry');
    if (await retry.isVisible().catch(() => false)) await retry.click().catch(() => {});
    const server = page.locator(`[data-testid="agent-server-${port}"]`);
    if (await server.isVisible().catch(() => false)) await server.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  throw new Error('the editor never showed a pairing code');
}

/** The user's side: grants dialog and confirm cards, nothing else. */
async function playUser() {
  let shot = 0;
  while (!finished) {
    const dialog = page.getByTestId('agent-grants');
    if (await dialog.isVisible().catch(() => false)) {
      for (const grant of ['edit', 'files', 'workspace', 'view']) {
        const box = dialog.getByTestId(`agent-grant-${grant}`);
        if (!(await box.isChecked().catch(() => true))) await box.click().catch(() => {});
      }
      await page.screenshot({ path: join(out, 'grants-dialog.png') }).catch(() => {});
      await page.getByTestId('agent-allow').click();
      userActions.push({ at: new Date().toISOString(), action: 'grants: Allow (Edit, Files, Workspace, View)' });
      log('user: allowed the pairing');
    }
    const card = page.getByTestId('agent-confirm');
    if (await card.isVisible().catch(() => false)) {
      const text = ((await card.textContent()) ?? '').trim();
      await page.screenshot({ path: join(out, `confirm-${++shot}.png`) }).catch(() => {});
      await page
        .getByTestId('agent-confirm-allow')
        .click()
        .catch(() => {});
      userActions.push({ at: new Date().toISOString(), action: `confirm: Allow — ${text}` });
      log(`user: allowed "${text}"`);
    }
    await page.waitForTimeout(250);
  }
}

// --- Claude Code --------------------------------------------------------------------------------------------------
// The pairing code comes from the MCP server, which Claude Code spawns at launch, so the prompt cannot be an argument:
// Claude starts in streaming-input mode (`--input-format stream-json`), the page finds the server and shows the code,
// and only then the script sends the user message with the code.
async function runClaudeStreaming() {
  const claudeArgs = [
    '-p',
    '--input-format',
    'stream-json',
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-turns',
    '80',
    '--allowedTools',
    'mcp__ekza-studio',
    // editor_connect carries `requiresUserInteraction`: Claude Code asks the host, which is this script playing the user
    '--permission-prompt-tool',
    'stdio',
    ...(model === null ? [] : ['--model', model]),
  ];
  log(`claude ${claudeArgs.join(' ')}`);
  const lines = [];
  let stderr = '';
  claude = spawn('claude', claudeArgs, { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let resultSeen = null;
  const resultPromise = new Promise((resolveResult) => {
    resultSeen = resolveResult;
  });
  claude.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at = buffer.indexOf('\n');
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim() !== '') {
        lines.push(line);
        try {
          const event = JSON.parse(line);
          for (const block of event.message?.content ?? []) {
            if (block.type === 'tool_use') log(`tool ${block.name} ${JSON.stringify(block.input).slice(0, 160)}`);
            if (block.type === 'text' && event.type === 'assistant') log(`claude: ${block.text.slice(0, 200)}`);
          }
          if (event.type === 'result') resultSeen(event);
          if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool') {
            // the user answers Claude Code's permission prompt: the editor's own tools yes, anything else no
            const tool = String(event.request.tool_name ?? '');
            const allow = tool.startsWith('mcp__ekza-studio__');
            userActions.push({
              at: new Date().toISOString(),
              action: `Claude Code permission: ${allow ? 'Allow' : 'Deny'} ${tool}`,
            });
            log(`user: ${allow ? 'allowed' : 'denied'} ${tool} in Claude Code`);
            const response = allow
              ? { behavior: 'allow', updatedInput: event.request.input ?? {} }
              : { behavior: 'deny', message: 'Only the Ekza Studio tools are allowed in this session.' };
            claude.stdin.write(
              `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: event.request_id, response } })}\n`,
            );
          }
        } catch {
          // not JSON
        }
      }
      at = buffer.indexOf('\n');
    }
  });
  claude.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const closed = new Promise((resolveClose) => claude.on('close', resolveClose));
  // the MCP server starts with Claude Code: the page can now find it and offer a code
  const code = await pairingCode();
  log(`pairing code ${code}`);
  await page.screenshot({ path: join(out, 'pairing-code.png') }).catch(() => {});
  const prompt = PROMPT.replace('{CODE}', code);
  writeFileSync(join(out, 'prompt.txt'), `${prompt}\n`);
  claude.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`);
  const result = await Promise.race([resultPromise, closed.then(() => null)]);
  claude.stdin.end();
  const status = await closed;
  return { status, lines, stderr, result };
}

const user = playUser();
let run;
try {
  run = await runClaudeStreaming();
} finally {
  finished = true;
  await user.catch(() => {});
}

// --- evidence -----------------------------------------------------------------------------------------------------

// Evidence leaves this machine (it is committed): no home folder, temporary paths or the local Claude Code setup.
const HOME = process.env.HOME ?? '\u0000';
const scrub = (text) =>
  text
    .split(workspace)
    .join('<workspace>')
    .replaceAll(`/private${workspace}`, '<workspace>')
    .split(ROOT)
    .join('<repo>')
    .split(HOME)
    .join('<home>')
    .replace(/\/(private\/)?var\/folders\/[^"'\s\]]+/g, '<tmp>');
const scrubEvent = (line) => {
  try {
    const event = JSON.parse(line);
    if (event.type === 'system' && event.subtype === 'init') {
      // keep what identifies the run, not the local plugins, skills, commands and memory paths
      return JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: event.model,
        claude_code_version: event.claude_code_version,
        permissionMode: event.permissionMode,
        mcp_servers: event.mcp_servers,
        tools: (event.tools ?? []).filter((tool) => String(tool).startsWith('mcp__ekza-studio')),
      });
    }
  } catch {
    // not JSON
  }
  return scrub(line);
};
writeFileSync(join(out, 'transcript.jsonl'), `${run.lines.map(scrubEvent).join('\n')}\n`);
if (run.stderr.trim() !== '') writeFileSync(join(out, 'claude-stderr.txt'), scrub(run.stderr));
writeFileSync(join(out, 'user-actions.json'), `${JSON.stringify(userActions, null, 2)}\n`);
// images Claude received (view_capture contact sheets)
let image = 0;
const readable = [];
for (const line of run.lines) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  for (const block of event.message?.content ?? []) {
    if (block.type === 'tool_use') readable.push(`→ ${block.name} ${JSON.stringify(block.input)}`);
    if (block.type === 'text') readable.push(`${event.type === 'assistant' ? 'Claude' : 'User'}: ${block.text}`);
    if (block.type !== 'tool_result') continue;
    const parts = Array.isArray(block.content) ? block.content : [];
    for (const part of parts) {
      if (part.type === 'image' && part.source?.data) {
        const file = `contact-sheet-${++image}.${part.source.media_type === 'image/webp' ? 'webp' : 'png'}`;
        writeFileSync(join(out, file), Buffer.from(part.source.data, 'base64'));
        readable.push(`← image ${file}`);
      } else if (part.type === 'text') {
        readable.push(`← ${part.text.slice(0, 600)}`);
      }
    }
    if (typeof block.content === 'string') readable.push(`← ${block.content.slice(0, 600)}`);
  }
  if (event.type === 'result') readable.push(`RESULT (${event.subtype}): ${event.result ?? ''}`);
}
writeFileSync(
  join(out, 'transcript.md'),
  scrub(`# MVP-AC-5 transcript\n\n\`\`\`text\n${readable.join('\n')}\n\`\`\`\n`),
);
await page.screenshot({ path: join(out, 'editor-final.png') }).catch(() => {});
await page
  .getByTestId('agent-panel')
  .screenshot({ path: join(out, 'agent-panel-final.png') })
  .catch(() => {});
// the files Claude wrote into the workspace
const files = join(out, 'workspace');
if (existsSync(workspace)) {
  cpSync(workspace, files, { recursive: true, filter: (path) => !path.includes('.ekza-trash') });
}
const listing = existsSync(files) ? readdirSync(files, { recursive: true }).map(String) : [];
writeFileSync(
  join(out, 'summary.json'),
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      editor: url,
      claudeExit: run.status,
      result: run.result === null ? null : { subtype: run.result.subtype, turns: run.result.num_turns },
      userActions: userActions.length,
      contactSheets: image,
      workspaceFiles: listing,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(mcpConfig, scrub(readFileSync(mcpConfig, 'utf8').replace(process.execPath, 'node')));
await browser.close();
log(`done: exit ${run.status}, ${image} contact sheet(s), workspace files: ${listing.join(', ') || 'none'}`);
process.exit(run.status === 0 ? 0 : 1);
