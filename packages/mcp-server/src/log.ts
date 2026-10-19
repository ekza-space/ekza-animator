// The stderr logger (MCP-SPEC §5.22.2): stdout carries only MCP messages; everything else goes to stderr.
import type { McpServerConfig } from './config';

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;

export function createLogger(level: McpServerConfig['logLevel'], stderr: NodeJS.WritableStream): Logger {
  const at = LEVELS[level];
  const write = (kind: keyof typeof LEVELS, message: string): void => {
    if (LEVELS[kind] <= at) stderr.write(`ekza-animator-mcp ${kind}: ${message}\n`);
  };
  return {
    error: (message) => write('error', message),
    warn: (message) => write('warn', message),
    info: (message) => write('info', message),
    debug: (message) => write('debug', message),
  };
}
