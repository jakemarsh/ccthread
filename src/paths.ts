import { homedir } from "node:os";
import { join, basename, isAbsolute, dirname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { detectCurrentSession } from "./util/current-session.ts";

export function projectsDir(): string {
  return process.env.CCTHREAD_PROJECTS_DIR
    || join(homedir(), ".claude", "projects");
}

export class NoProjectsDirError extends Error {
  constructor(public dir: string) {
    super(`no Claude Code projects dir found at ${dir}. Set CCTHREAD_PROJECTS_DIR=... or install Claude Code.`);
  }
}

export function ensureProjectsDir(): string {
  const d = projectsDir();
  if (!existsSync(d)) throw new NoProjectsDirError(d);
  return d;
}

// Project dirs are named like "-Users-jakemarsh-great-work" — slashes in the
// real path are replaced with dashes. The encoding is LOSSY: a real "-" in a
// path component is indistinguishable from a path separator (so "great-work"
// and "great/work" encode identically). We walk the path from the root,
// greedily consuming the longest prefix of remaining parts that matches a
// real directory on disk. Falls back to the naive all-dashes-to-slashes
// decode if the filesystem doesn't help.
export function decodeProjectName(encoded: string): string {
  if (!encoded.startsWith("-")) return encoded;
  const parts = encoded.slice(1).split("-");
  let cur = "/";
  let i = 0;
  while (i < parts.length) {
    let found = -1;
    for (let take = parts.length - i; take >= 1; take--) {
      const candidate = parts.slice(i, i + take).join("-");
      const full = join(cur, candidate);
      if (existsSync(full)) { found = take; cur = full; break; }
    }
    if (found < 0) {
      // No match from here on — append remaining parts joined by "/" (naive).
      const tail = parts.slice(i).join("/");
      return cur === "/" ? "/" + tail : join(cur, tail);
    }
    i += found;
  }
  return cur;
}

export function encodeProjectPath(p: string): string {
  return p.replace(/\//g, "-");
}

export interface ProjectDir {
  name: string;       // encoded form on disk (e.g. "-Users-jakemarsh-foo")
  decodedPath: string; // best-effort decoded path
  basename: string;   // last segment of decoded path
  fullPath: string;   // absolute path on disk
}

export async function listProjects(): Promise<ProjectDir[]> {
  const dir = ensureProjectsDir();
  const entries = await readdir(dir, { withFileTypes: true });
  const out: ProjectDir[] = [];
  let hasRootFiles = false;
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".jsonl")) { hasRootFiles = true; continue; }
    if (!e.isDirectory()) continue;
    const decoded = decodeProjectName(e.name);
    out.push({
      name: e.name,
      decodedPath: decoded,
      basename: basename(decoded) || decoded,
      fullPath: join(dir, e.name),
    });
  }
  if (hasRootFiles) {
    // Orphan sessions that sit directly at ~/.claude/projects/ (no project
    // subdir). Surface them under a synthetic "(unscoped)" project so they're
    // searchable and resolvable.
    out.push({
      name: "",
      decodedPath: "(unscoped)",
      basename: "(unscoped)",
      fullPath: dir,
    });
  }
  return out;
}

export async function listSessionFiles(projectDir: string): Promise<string[]> {
  const entries = await readdir(projectDir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith(".jsonl"))
    .map(e => join(projectDir, e.name));
}

export async function listAllSessionFiles(): Promise<{ project: ProjectDir; files: string[] }[]> {
  const projects = await listProjects();
  const out: { project: ProjectDir; files: string[] }[] = [];
  for (const p of projects) {
    const files = await listSessionFiles(p.fullPath);
    if (files.length) out.push({ project: p, files });
  }
  return out;
}

export interface SessionRef {
  sessionId: string;     // UUID from filename
  shortId: string;       // first 8 chars (or longer on collision — caller decides)
  path: string;
  project: ProjectDir;
  mtime: Date;
  size: number;
}

export async function listAllSessions(): Promise<SessionRef[]> {
  const out: SessionRef[] = [];
  for (const { project, files } of await listAllSessionFiles()) {
    for (const path of files) {
      const stat = statSync(path);
      const sessionId = basename(path, ".jsonl");
      out.push({
        sessionId,
        shortId: sessionId.slice(0, 8),
        path,
        project,
        mtime: stat.mtime,
        size: stat.size,
      });
    }
  }
  return out;
}

export class SessionNotFoundError extends Error {
  constructor(arg: string) {
    super(`session not found: ${arg}\n  try: ccthread list`);
  }
}
export class CurrentSessionUndetectableError extends Error {
  constructor() {
    super(
      `can't detect the current Claude Code session. Try one of:\n`
      + `  - pass the session id explicitly\n`
      + `  - use 'last' for the most recently modified session\n`
      + `  - set CCTHREAD_SESSION_ID=<uuid> in the environment\n`
      + `  - install the ccthread plugin (adds a SessionStart hook that records the current id)`
    );
  }
}
export class SessionAmbiguousError extends Error {
  constructor(public arg: string, public matches: SessionRef[]) {
    super(`ambiguous session id: ${arg} (matches ${matches.length})`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f-]+$/i;

// Resolve <id-or-path> per spec:
// 1. Path-shaped → file path
// 2. "last"|"latest" → most recently modified
// 3. Full UUID → exact match across all projects
// 4. Hex prefix ≥6 chars → unique prefix match
// 5. Else → treat as path attempt
export async function resolveSession(arg: string, opts: { projectFilter?: string } = {}): Promise<SessionRef> {
  if (arg.startsWith("/") || arg.startsWith("./") || arg.startsWith("../") || arg.startsWith("~") || /^[A-Za-z]:[\\\/]/.test(arg)) {
    const path = resolveTilde(arg);
    if (!existsSync(path)) throw new SessionNotFoundError(path);
    return refFromPath(path);
  }

  let candidates = await listAllSessions();
  if (opts.projectFilter) {
    const filt = opts.projectFilter;
    candidates = candidates.filter(s =>
      s.project.name === filt
      || s.project.decodedPath === filt
      || s.project.basename === filt
      || s.project.name === encodeProjectPath(filt)
    );
  }

  if (arg === "last" || arg === "latest") {
    if (!candidates.length) throw new SessionNotFoundError(arg);
    candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return candidates[0]!;
  }

  if (arg === "current") {
    const detected = detectCurrentSession();
    if (!detected) throw new CurrentSessionUndetectableError();
    // Prefer the transcript_path if the hook gave us one — it's exact.
    if (detected.transcriptPath && existsSync(detected.transcriptPath)) {
      return refFromPath(detected.transcriptPath);
    }
    const m = candidates.filter(s => s.sessionId.toLowerCase() === detected.sessionId.toLowerCase());
    if (m.length === 1) return m[0]!;
    if (m.length > 1) throw new SessionAmbiguousError(arg, m);
    throw new SessionNotFoundError(`current (${detected.sessionId.slice(0, 8)})`);
  }

  if (UUID_RE.test(arg)) {
    const m = candidates.filter(s => s.sessionId.toLowerCase() === arg.toLowerCase());
    if (!m.length) throw new SessionNotFoundError(arg);
    if (m.length > 1) throw new SessionAmbiguousError(arg, m);
    return m[0]!;
  }

  if (HEX_RE.test(arg) && arg.length >= 6) {
    const m = candidates.filter(s => s.sessionId.toLowerCase().startsWith(arg.toLowerCase()));
    if (!m.length) throw new SessionNotFoundError(arg);
    if (m.length > 1) throw new SessionAmbiguousError(arg, m);
    return m[0]!;
  }

  const path = resolveTilde(arg);
  if (existsSync(path)) return refFromPath(path);
  throw new SessionNotFoundError(arg);
}

function resolveTilde(p: string): string {
  if (p.startsWith("~")) return join(homedir(), p.slice(1).replace(/^[\\\/]/, ""));
  return resolve(p);
}

function refFromPath(path: string): SessionRef {
  const stat = statSync(path);
  const sessionId = basename(path, ".jsonl");
  const projDir = dirname(path);
  const projName = basename(projDir);
  return {
    sessionId,
    shortId: sessionId.slice(0, 8),
    path,
    project: {
      name: projName,
      decodedPath: decodeProjectName(projName),
      basename: basename(decodeProjectName(projName)) || projName,
      fullPath: projDir,
    },
    mtime: stat.mtime,
    size: stat.size,
  };
}

export function isAbsoluteOrRelative(s: string): boolean {
  return s.startsWith("/") || s.startsWith("./") || s.startsWith("../") || s.startsWith("~") || isAbsolute(s);
}
