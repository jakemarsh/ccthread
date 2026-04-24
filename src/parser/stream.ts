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
  let firstChunk = true;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    // Strip UTF-8 BOM if the file starts with one. Some editors / exports
    // leave it in; JSON.parse chokes on the first line otherwise.
    if (firstChunk) {
      if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
      firstChunk = false;
    }

    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      let raw = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lineNumber++;
      // Handle CRLF line endings (files written on Windows).
      if (raw.charCodeAt(raw.length - 1) === 0x0d) raw = raw.slice(0, -1);
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
      if (strict) throw Object.assign(new Error(issue.message), issue);
      onIssue(issue);
    }
  }
}

export async function readAllLines(path: string): Promise<LogLine[]> {
  const out: LogLine[] = [];
  for await (const { line } of streamJsonl(path)) out.push(line);
  return out;
}
