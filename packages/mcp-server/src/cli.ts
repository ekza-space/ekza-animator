// The `ekza-animator-mcp` bin (MCP-SPEC §5.22.2): parses arguments, logs to stderr, serves MCP over stdio and exits
// when stdin closes. stdout carries only MCP messages (and the --version / --help text).
import { parseArgs, USAGE } from './args';
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
      process.stderr.write(`ekza-animator-mcp: ${parsed.message}\n${USAGE}`);
      return 2;
    case 'serve': {
      if (parsed.httpRequested !== null) {
        process.stderr.write('ekza-animator-mcp: --http is not available in this build yet\n');
        return 2;
      }
      const server = await startMcpServer(parsed.config);
      await server.closed;
      return 0;
    }
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`ekza-animator-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
