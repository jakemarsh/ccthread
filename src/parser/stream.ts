import type { LogLine } from "./types.ts";

export interface ParseIssue {
  path: string;
  lineNumber: number;
  message: string;
}

// Default issue handler used when callers don't supply their own. Writes one
// line to stderr per bad line. Gated by `CCTHREAD_SILENT=1` for tests.
export function defaultIssueHandler(i: ParseIssue): void {
  if (process.env.CCTHREAD_SILENT) return;
  process.stderr.write(`warn: ${i.path}:${i.lineNumber}: ${i.message}\n`);
}

export interface ParsedLine {
  line: LogLine;
  raw: string;
  lineNumber: number;
}

// Stream a .jsonl file line by line. Yields parsed objects; invalid JSON
// lines are reported via `onIssue` (defaults to stderr warn) and skipped.
// Files up to 100MB+ exist in the wild — never buffer the whole file.
export async function* streamJsonl(
  path: string,
  opts: { onIssue?: (i: ParseIssue) => void; strict?: boolean } = {}
): AsyncGenerator<ParsedLine> {
  const onIssue = opts.onIssue ?? defaultIssueHandler;
  const strict = opts.strict || !!process.env.CCTHREAD_STRICT;
  const file = Bun.file(path);
  const stream = file.stream();
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let lineNumber = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;

    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lineNumber++;
      if (!raw.trim()) continue;
      try {
        const line = JSON.parse(raw) as LogLine;
        yield { line, raw, lineNumber };
      } catch (err) {
        const issue: ParseIssue = {
          path,
          lineNumber,
          message: `invalid json: ${(err as Error).message}`,
        };
        if (strict) throw Object.assign(new Error(issue.message), issue);
        onIssue(issue);
      }
    }
  }

  if (buf.trim()) {
    lineNumber++;
    try {
      const line = JSON.parse(buf) as LogLine;
      yield { line, raw: buf, lineNumber };
    } catch (err) {
      const issue: ParseIssue = {
        path,
        lineNumber,
        message: `invalid json (trailing): ${(err as Error).message}`,
      };
      if (opts.strict) throw Object.assign(new Error(issue.message), issue);
      opts.onIssue?.(issue);
    }
  }
}

export async function readAllLines(path: string): Promise<LogLine[]> {
  const out: LogLine[] = [];
  for await (const { line } of streamJsonl(path)) out.push(line);
  return out;
}
