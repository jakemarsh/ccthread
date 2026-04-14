import { listProjects, listSessionFiles } from "../paths.ts";
import { statSync } from "node:fs";

export interface ProjectsOptions { json?: boolean; plain?: boolean }

export async function runProjects(opts: ProjectsOptions = {}): Promise<string> {
  const projects = await listProjects();
  const rows = await Promise.all(projects.map(async p => {
    const files = await listSessionFiles(p.fullPath);
    let latest = 0;
    for (const f of files) {
      const t = statSync(f).mtimeMs;
      if (t > latest) latest = t;
    }
    return {
      name: p.name,
      path: p.decodedPath,
      basename: p.basename,
      sessions: files.length,
      lastActive: latest ? new Date(latest).toISOString() : null,
    };
  }));
  rows.sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

  if (opts.json) return JSON.stringify(rows, null, 2);

  const lines: string[] = [];
  if (!opts.plain) lines.push(`# Projects (${rows.length})\n`);
  for (const r of rows) {
    const lastStr = r.lastActive ? r.lastActive.slice(0, 10) : "—";
    lines.push(`- \`${r.path}\` — ${r.sessions} session${r.sessions === 1 ? "" : "s"}, last ${lastStr}`);
  }
  return lines.join("\n") + "\n";
}
