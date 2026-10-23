// The `ekza-studio-mcp` bin (MCP-SPEC §5.22.2): parses arguments, logs to stderr, serves MCP over stdio and exits
// when stdin closes. stdout carries only MCP messages (and the --version / --help text).
import { parseArgs, USAGE } from './args';
import { createLogger } from './log';
import { startMcpServer } from './start';
import { SERVER_VERSION } from './version';

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), process.env, process.cwd());
  switch (parsed.kind) {
    case 'version':
      process.stdout.write(`${SERVER_VERSION}\n`);
      return 0;
    case 'help':
      process.stdout.write(USAGE);
      return 0;
    case 'error':
      process.stderr.write(`ekza-studio-mcp: ${parsed.message}\n${USAGE}`);
      return 2;
    case 'serve': {
      const log = createLogger(parsed.config.logLevel, process.stderr);
      for (const warning of parsed.warnings) log.warn(warning);
      if (parsed.httpRequested !== null) {
        process.stderr.write('ekza-studio-mcp: --http is not available in this build yet\n');
        return 2;
      }
      const server = await startMcpServer(parsed.config);
      await server.closed;
      // §5.22.2: answers written just before stdin closed still reach the client (a pipe write is asynchronous and
      // `process.exit` would drop what is still buffered, e.g. a 64 KiB tools/list).
      await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
      return 0;
    }
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`ekza-studio-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
