/**
 * stdout is the MCP stdio channel, so every log line goes to stderr.
 */
export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function stderrLogger(prefix = '[flowcanvas-mcp]'): Logger {
  const w = (level: string, msg: string) => process.stderr.write(`${prefix} ${level}${msg}\n`);
  return {
    info: (m) => w('', m),
    warn: (m) => w('warn: ', m),
    error: (m) => w('error: ', m),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** A tool error with a message written for Claude to act on. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
