import { join, dirname, basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Some tool results overflow to sibling files at:
//   <project>/<session>/tool-results/<id>.txt
// The session jsonl lives at <project>/<session>.jsonl; the sibling directory
// is named after the session. Return the overflow text if present, else null.
export function resolveOverflow(sessionPath: string, toolUseId: string): string | null {
  const dir = dirname(sessionPath);
  const sessionBase = basename(sessionPath, ".jsonl");
  const overflowDir = join(dir, sessionBase, "tool-results");
  const direct = join(overflowDir, `${toolUseId}.txt`);
  if (existsSync(direct)) return readFileSync(direct, "utf8");
  // Older layouts used task-id as the filename. Try a fuzzy match.
  return null;
}
